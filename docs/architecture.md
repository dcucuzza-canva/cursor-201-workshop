# Tally architecture

Tally is a small accounts-receivable (AR) console for a B2B design studio. It tracks what customers owe, records the money they send, handles disputes, and tells the collections team who to chase next.

This page is meant to be attached as context (`@docs/architecture.md`) when you ask Cursor to work on Tally.

## Stack

- **Next.js 16** (App Router, TypeScript, React 19) for the UI and the JSON API.
- **Prisma 7 + SQLite** (`prisma/dev.db`, via the `better-sqlite3` driver adapter). No server, no env vars.
- **Tailwind CSS 4** for styling.
- **Zod 4** for validation at every API boundary.
- **Vitest** for unit and integration tests, **Playwright** for end-to-end tests.

## Layers

Dependencies point downwards only. A layer may import from the layers below it, never above.

```
app/ (pages + app/api route handlers)      components/ (React UI)
        │                                         │
        ▼                                         ▼
lib/services/   application layer: transactions, permissions, audit log, Prisma queries
        │
        ▼
lib/domain/     pure business rules: state machines, allocation, aging, permissions
lib/money.ts    integer money helpers
        ▲
lib/validation/ zod schemas for request bodies and query strings
lib/http/       route helpers + the standard error shape
lib/db.ts       the one PrismaClient
```

| Folder | What lives there | Rules |
| --- | --- | --- |
| `lib/domain/` | `invoice-status.ts`, `dispute-status.ts`, `allocation.ts`, `credit-notes.ts`, `aging.ts`, `permissions.ts`, `audit.ts`, `statement.ts`, `errors.ts`, `dates.ts` | Pure functions. No Prisma, no Next.js, no I/O. Throws `DomainError`. Fully unit tested. |
| `lib/services/` | One module per aggregate: `invoices.ts`, `payments.ts`, `credit-notes.ts`, `disputes.ts`, `reports.ts`, `customers.ts`, `audit.ts` | The only code that touches `db`. Every write runs in `db.$transaction`, checks `assertCan(actor, ...)`, and calls `recordAudit(tx, ...)`. |
| `lib/validation/` | Zod schemas per resource | Route handlers parse **all** input with these. Amounts are integer minor units. |
| `lib/http/` | `route.ts` (`handle`, `ok`, `okList`, `created`, `parseJson`, `parseQuery`, `parseParams`), `errors.ts` | Every handler is wrapped in `handle()` so thrown errors become the standard error shape. |
| `lib/auth/` | Mocked current user (cookie `tally_user`) | `actorFromRequest(req)` in route handlers, `currentActor()` in server components. |
| `lib/client/` | Browser-side helpers: `api.ts` (fetch wrapper), `invoice-list-params.ts` | Client components only. |
| `lib/csv.ts` | CSV building for exports | Pure. Escapes commas, quotes and newlines, and neutralises spreadsheet formulas. |
| `app/api/` | JSON route handlers | Thin: parse → actor → one service call → respond. |
| `app/**/page.tsx` | Server-rendered pages | Read through services; mutations go through the API from client components. |
| `components/` | UI building blocks, grouped by feature | Client components call the API with `apiRequest` and then `router.refresh()`. |
| `prisma/` | `schema.prisma`, `seed.ts`, `demo-data.ts`, `reset-sqlite.ts` | The seed replays scripted history through the services. |
| `tests/unit/` | Domain logic tests | No database. |
| `tests/integration/` | Route handlers called directly against a throwaway SQLite DB | `callRoute()` helper in `tests/integration/helpers.ts`. |
| `e2e/` | Playwright specs | Run against their own seeded DB on port 3100. |

## Money

- Every amount is an integer number of **minor units** (cents, pence; yen have none) stored in a `*Minor` column next to a `currency` code (`AUD`, `USD`, `EUR`, `GBP`, `NZD`, `JPY`).
- Never use floats for money. Parse user input with `parseMoney("1,234.50", "AUD") → 123450` and display with `formatMoney(123450, "AUD")`.
- Totals are per currency. Reports never add AUD to USD.
- Prisma `Int` columns are 32-bit, so a single amount is capped at 2,000,000,000 minor units (`MAX_MINOR_UNITS`).

## Invoice lifecycle

`lib/domain/invoice-status.ts` owns the state machine. Status is stored as a string; the domain layer decides which transitions are allowed.

| From | Event | To | Guard |
| --- | --- | --- | --- |
| `draft` | `send` | `sent` (or `overdue` if already past due) | total > 0 |
| `draft`, `sent`, `overdue` | `void` | `void` | no payments applied |
| `sent`, `partially_paid` | `mark_overdue` | `overdue` | past due date, balance > 0 |
| `sent`, `partially_paid`, `overdue` | `settle` | `paid` / `overdue` / `partially_paid` / `sent` | derived from new balance and due date; balance can never go negative |

`settle` is raised by the services whenever a payment allocation or credit note changes an invoice balance. `paid` and `void` are terminal. The overdue sweep (`POST /api/invoices/mark-overdue`, or **Run overdue sweep** on the Collections page) stands in for a nightly job.

The invoice row keeps `amountPaidMinor`, `amountCreditedMinor` and a denormalised `balanceMinor` (so the list can sort on it). Only `lib/services/invoices.ts#applyBalanceChange` writes these, inside the caller's transaction.

## Payments, allocation and credit notes

- `POST /api/payments` records money received and allocates it with `planAllocation` (`lib/domain/allocation.ts`):
  - `{ "mode": "oldest_first" }` pays the customer's oldest due open invoices first.
  - `{ "mode": "explicit", "lines": [{ "invoiceId", "amountMinor" }] }` pays exactly what you list.
  - Same customer and same currency only. No line may exceed the invoice balance. Whatever is left over is stored as `unappliedMinor` (customer credit).
- `POST /api/credit-notes` reduces one invoice's balance (admin only, never more than the balance).

## Disputes

`lib/domain/dispute-status.ts` owns the state machine. An invoice with an **active** dispute (`open` or `under_review`) is on hold: it stays out of the collections queue. Only one active dispute per invoice; the disputed amount cannot exceed the balance.

| From | Event | To | Who |
| --- | --- | --- | --- |
| `open` | `start_review` | `under_review` | agent, admin |
| `open`, `under_review` | `withdraw` | `withdrawn` | agent, admin |
| `open`, `under_review` | `resolve` | `resolved` | admin |

`withdrawn` and `resolved` are terminal. `start_review` and `withdraw` go through `POST /api/disputes/:id/transitions`; `resolve` has its own endpoint, `POST /api/disputes/:id/resolve`, because it needs an outcome and a note:

- `accepted`: issues a credit note (reason `dispute_settlement`, linked to the dispute through `CreditNote.disputeId`) for `min(dispute amount, invoice balance)`, computed by `planDisputeResolution`. The invoice settles through the normal state machine and may become `paid`. If the invoice no longer has an open balance (paid or void), no credit note is issued.
- `rejected`: no money moves. The dispute is no longer active, so the invoice goes back into the collections queue.

Either way `lib/services/disputes.ts#resolveDispute` records `resolution`, `resolutionNote`, `resolvedAt` and `resolvedBy` on the dispute and writes a `dispute.resolved` audit entry (before/after include `status`, `resolution` and `creditNoteId`), all in one transaction. The credit note is created with `lib/services/credit-notes.ts#createCreditNoteInTx`, the same code `POST /api/credit-notes` uses.

## Aging and collections

`lib/domain/aging.ts` buckets open balances by days past due: `current` (not yet due), `0-30`, `31-60`, `61-90`, `90+`. Days are whole UTC days.

- `GET /api/reports/aging` returns totals per currency and per customer.
- `GET /api/collections` returns the queue: past-due, open, not-on-hold invoices, most overdue first, each with a suggested next step (reminder, call, final notice, escalate).

## Roles

The user switcher in the header sets a cookie. There is no real auth.

| Capability | viewer | agent | admin |
| --- | :-: | :-: | :-: |
| Read invoices, customers, payments, disputes, reports | ✓ | ✓ | ✓ |
| Create and send invoices, run the overdue sweep | | ✓ | ✓ |
| Record payments | | ✓ | ✓ |
| Open disputes, start review, mark withdrawn | | ✓ | ✓ |
| Read the audit log | | ✓ | ✓ |
| Void invoices, issue credit notes | | | ✓ |
| Resolve disputes (accept or reject) | | | ✓ |

Capabilities live in `lib/domain/permissions.ts`. Services enforce them with `assertCan`; the UI hides buttons the user can't use.

## Audit log

Every state change writes an `AuditEntry` in the same transaction: actor (or `system`), entity type and id, action (`lib/domain/audit.ts`), JSON snapshots of the state before and after, and a timestamp. Invoice and dispute pages show the relevant history; `/audit` shows everything.

## API

All responses are JSON except CSV exports. Success is `{ "data": ... }`, lists are `{ "data": [...], "meta": { "page", "pageSize", "total", "totalPages" } }`. Errors always look like:

```json
{ "error": { "code": "VALIDATION_FAILED", "message": "Request validation failed", "details": [{ "path": "amountMinor", "message": "..." }] } }
```

| Code | HTTP |
| --- | --- |
| `BAD_REQUEST`, `VALIDATION_FAILED` | 400 |
| `FORBIDDEN` | 403 |
| `NOT_FOUND` | 404 |
| `INVALID_TRANSITION` | 409 |
| `BUSINESS_RULE`, `CURRENCY_MISMATCH`, `OVER_ALLOCATION` | 422 |
| `INTERNAL` | 500 |

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/api/invoices` | `status`, `currency`, `customerId`, `q`, `sort` (`number`, `customer`, `issueDate`, `dueDate`, `totalMinor`, `balanceMinor`), `order`, `page`, `pageSize` |
| POST | `/api/invoices` | Create a draft with lines |
| GET | `/api/invoices/:id` | Detail with lines, allocations, credit notes, disputes |
| POST | `/api/invoices/:id/transitions` | `{ "action": "send" \| "void" }` |
| POST | `/api/invoices/mark-overdue` | Overdue sweep, optional `asOf` |
| GET, POST | `/api/payments` | List, or record + allocate |
| GET | `/api/payments/:id` | |
| POST | `/api/credit-notes` | |
| GET, POST | `/api/disputes` | List (`status` filter), or open |
| GET | `/api/disputes/:id` | |
| POST | `/api/disputes/:id/transitions` | `{ "action": "start_review" \| "withdraw" }` |
| POST | `/api/disputes/:id/resolve` | Admin only. `{ "resolution": "accepted" \| "rejected", "note": "5-1000 chars" }` → `{ "dispute", "creditNote" }` (`creditNote` is `null` when nothing was credited). `409` unless the dispute is `open` or `under_review` |
| GET | `/api/reports/aging` | Optional `asOf` |
| GET | `/api/collections` | Optional `asOf` |
| GET | `/api/collections/export` | Optional `asOf`. The queue as a `text/csv` attachment, `collections-YYYY-MM-DD.csv`: Customer, Invoice, Currency, Balance (plain decimal), Due date, Days late, Bucket, Next step. Fields escaped by `lib/csv.ts` (quoting, formula neutralising). Errors stay JSON. Any role |
| GET | `/api/customers`, `/api/customers/:id` | |
| GET | `/api/customers/:id/statement` | Optional `currency` (defaults to the customer's billing currency). Invoices (not draft or void) as debits, payments (full amount) and credit notes as credits, by date with a running balance and `closingBalanceMinor` |
| GET | `/api/audit` | `entityType`, `entityId`, paging |
| GET, PUT | `/api/session` | Current user, or switch user |

## The invoices list

`/invoices` is a client component (`components/invoices/invoice-list.tsx`). It keeps filters in the page URL, builds the query string with `lib/client/invoice-list-params.ts`, and fetches `GET /api/invoices`. Filtering, sorting and pagination all happen in the database (`lib/services/invoices.ts#listInvoices`).

## Tests

| Command | What it runs |
| --- | --- |
| `npm run test:unit` | `tests/unit/**`: domain logic, money, error mapping |
| `npm run test:integration` | `tests/integration/**`: route handlers against a temporary SQLite file |
| `npm test` | Both of the above |
| `npm run test:e2e` | Playwright specs in `e2e/` against a dev server on port 3100 with `prisma/e2e.db` |
| `npm run lint`, `npm run typecheck` | ESLint, `tsc --noEmit` |

Tests whose name starts with `[filter-bug]` are regression tests for the invoice status filter bug fixed in step 3.
