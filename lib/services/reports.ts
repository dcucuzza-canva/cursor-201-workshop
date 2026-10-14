import { toCsv } from "@/lib/csv";
import { db } from "@/lib/db";
import { buildAgingReport, buildCollectionsQueue, COLLECTIONS_ACTION_LABELS, type AgingInput } from "@/lib/domain/aging";
import { addDays, toIsoDate } from "@/lib/domain/dates";
import { ACTIVE_DISPUTE_STATUSES } from "@/lib/domain/dispute-status";
import { asInvoiceStatus, OPEN_INVOICE_STATUSES } from "@/lib/domain/invoice-status";
import { asCurrency, toDecimalString } from "@/lib/money";

async function loadAgingInputs(): Promise<AgingInput[]> {
  const invoices = await db.invoice.findMany({
    where: { status: { in: [...OPEN_INVOICE_STATUSES] }, balanceMinor: { gt: 0 } },
    include: {
      customer: { select: { name: true } },
      disputes: { where: { status: { in: [...ACTIVE_DISPUTE_STATUSES] } }, select: { id: true } },
    },
  });
  return invoices.map((invoice) => ({
    invoiceId: invoice.id,
    invoiceNumber: invoice.number,
    customerId: invoice.customerId,
    customerName: invoice.customer.name,
    currency: invoice.currency,
    status: asInvoiceStatus(invoice.status),
    dueDate: invoice.dueDate,
    balanceMinor: invoice.balanceMinor,
    onHold: invoice.disputes.length > 0,
  }));
}

export async function agingReport(asOf = new Date()) {
  return buildAgingReport(await loadAgingInputs(), asOf);
}

export async function collectionsQueue(asOf = new Date()) {
  return buildCollectionsQueue(await loadAgingInputs(), asOf);
}

const COLLECTIONS_CSV_HEADER = ["Customer", "Invoice", "Currency", "Balance", "Due date", "Days late", "Bucket", "Next step"];

export async function collectionsQueueCsv(asOf = new Date()) {
  const queue = await collectionsQueue(asOf);
  const rows = queue.items.map((item) => [
    item.customerName,
    item.invoiceNumber,
    item.currency,
    toDecimalString(item.balanceMinor, asCurrency(item.currency)),
    item.dueDate.slice(0, 10),
    String(item.daysPastDue),
    item.bucket,
    COLLECTIONS_ACTION_LABELS[item.suggestedAction],
  ]);
  return {
    filename: `collections-${toIsoDate(asOf)}.csv`,
    content: toCsv([COLLECTIONS_CSV_HEADER, ...rows]),
  };
}

export async function dashboardSummary(asOf = new Date()) {
  const [aging, openInvoices, overdueInvoices, activeDisputes, recentPayments] = await Promise.all([
    agingReport(asOf),
    db.invoice.count({ where: { status: { in: [...OPEN_INVOICE_STATUSES] } } }),
    db.invoice.count({ where: { status: "overdue" } }),
    db.dispute.count({ where: { status: { in: [...ACTIVE_DISPUTE_STATUSES] } } }),
    db.payment.groupBy({
      by: ["currency"],
      where: { receivedAt: { gte: addDays(asOf, -30) } },
      _sum: { amountMinor: true },
      _count: true,
    }),
  ]);
  return {
    aging,
    counts: { openInvoices, overdueInvoices, activeDisputes },
    collectedLast30Days: recentPayments.map((row) => ({
      currency: row.currency,
      amountMinor: row._sum.amountMinor ?? 0,
      count: row._count,
    })),
  };
}
