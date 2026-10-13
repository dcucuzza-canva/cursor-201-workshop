# Bugbot review guidance for Tally

Tally is an accounts-receivable app: invoices, payments, credit notes, disputes and a collections queue. Mistakes here move money or hide debts, so review for correctness first and style last. The architecture is described in `docs/architecture.md`.

## Money

- Amounts are integer minor units in `*Minor` fields with a `currency` code. Flag any float arithmetic on money (`parseFloat`, `Number(x) * 100`, `toFixed`, division without rounding to an integer), and any sum that mixes currencies.
- User input must go through `parseMoney`; display through `formatMoney` / `toDecimalString`. Flag hand-rolled currency formatting.
- Prisma `Int` columns are 32-bit. New amount fields need the `MAX_MINOR_UNITS` cap in their zod schema.

## State machines and business rules

- Invoice and dispute statuses may only change through `transitionInvoice` / `transitionDispute` in `lib/domain/`. Flag direct writes of a `status` value that bypass the domain function, and guards implemented in routes or components instead of `lib/domain/`.
- `balanceMinor`, `amountPaidMinor` and `amountCreditedMinor` on invoices are only written by `applyBalanceChange` in `lib/services/invoices.ts`. Flag any other writer.
- A balance can never go negative, a payment can't be allocated across customers or currencies, and an invoice with an active dispute stays out of the collections queue. Flag changes that could break these.

## Services, permissions and the audit log

- Only `lib/services/*` may use `db` (from `lib/db.ts`). Flag Prisma usage in `app/`, `components/` or `lib/domain/`.
- Every service function that changes data must: call `assertCan(actor, ...)` before touching data, run inside `db.$transaction`, use `tx` (not `db`) inside it, and call `recordAudit(tx, ...)` once per state change with useful `before` and `after` snapshots.
- Flag read-then-write sequences outside a transaction, and new capabilities that aren't added to `lib/domain/permissions.ts`.
- UI that hides a button is not access control. The service must enforce the role too.

## API boundary

- Every route handler is wrapped in `handle()` and parses all input (params, query, body) with a zod schema from `lib/validation/`. Flag unvalidated `request.json()` or `searchParams.get()`.
- Errors use the shared shape `{ "error": { "code", "message", "details"? } }` with the status codes in `lib/http/errors.ts`. Flag hand-built error JSON, new error codes, and leaking internal messages or stack traces.
- Client code builds query strings for `GET /api/invoices` with `lib/client/invoice-list-params.ts`. Parameter names must match `invoiceListQuerySchema` exactly; zod drops unknown keys silently, which is how a filter bug once slipped through.

## Files and exports

- CSV or spreadsheet exports must escape fields that contain commas, quotes or newlines, and neutralise values starting with `=`, `+`, `-` or `@` (formula injection).
- Exports and reports must not mix currencies in one total.

## Tests

- New domain logic needs unit tests in `tests/unit/`. New or changed endpoints need integration tests in `tests/integration/` using `callRoute`, covering the success path plus validation (400), permission (403), not found (404) and invalid transition (409) cases where they apply. New UI flows need a Playwright test in `e2e/`.
- Flag tests that were weakened, skipped or deleted to make a change pass, and assertions against hard-coded seed values that will break when the seed changes.

## Hygiene

- No secrets, tokens, `.env` files, SQLite databases (`prisma/*.db`) or test reports in the diff. `.cursor/mcp.json` must reference tokens as `${env:NAME}`.
- Don't flag style-only issues that ESLint or the type checker already catch.
