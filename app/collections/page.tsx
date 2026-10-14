import Link from "next/link";
import { OverdueSweepButton } from "@/components/collections/overdue-sweep-button";
import { AgingTable } from "@/components/reports/aging-table";
import { Money } from "@/components/ui/money";
import { EmptyState, PageHeader, Section } from "@/components/ui/page-header";
import { StatusBadge } from "@/components/ui/status-badge";
import { currentActor } from "@/lib/auth/session";
import { AGING_BUCKET_LABELS, COLLECTIONS_ACTION_LABELS } from "@/lib/domain/aging";
import { can } from "@/lib/domain/permissions";
import { formatDate } from "@/lib/format";
import { agingReport, collectionsQueue } from "@/lib/services/reports";

const BUCKET_TONE: Record<string, string> = {
  "0-30": "sent",
  "31-60": "partially_paid",
  "61-90": "open",
  "90+": "overdue",
};

export default async function CollectionsPage() {
  const now = new Date();
  const [queue, aging, actor] = await Promise.all([collectionsQueue(now), agingReport(now), currentActor()]);

  return (
    <>
      <PageHeader
        title="Collections"
        description={`${queue.items.length} past-due invoices to chase · ${queue.onHoldCount} on hold while in dispute`}
        actions={
          <>
            <a className="btn-secondary" href="/api/collections/export" download>
              Export CSV
            </a>
            {can(actor.role, "invoices:mark_overdue") ? <OverdueSweepButton /> : null}
          </>
        }
      />
      <div className="flex flex-col gap-6">
        <Section title="Aging">
          <AgingTable rows={aging.currencies} />
        </Section>
        <Section title="Queue">
          {queue.items.length === 0 ? (
            <EmptyState>Nothing past due. Nice.</EmptyState>
          ) : (
            <div className="overflow-x-auto">
              <table className="table" data-testid="collections-queue">
                <thead>
                  <tr>
                    <th>Customer</th>
                    <th>Invoice</th>
                    <th>Due</th>
                    <th className="text-right">Days late</th>
                    <th>Bucket</th>
                    <th>Next step</th>
                    <th className="text-right">Balance</th>
                  </tr>
                </thead>
                <tbody>
                  {queue.items.map((item) => (
                    <tr key={item.invoiceId} data-testid="queue-row">
                      <td>
                        <Link className="link" href={`/customers/${item.customerId}`}>
                          {item.customerName}
                        </Link>
                      </td>
                      <td>
                        <Link className="link font-mono text-xs" href={`/invoices/${item.invoiceId}`}>
                          {item.invoiceNumber}
                        </Link>
                      </td>
                      <td>{formatDate(item.dueDate)}</td>
                      <td className="text-right tabular-nums">{item.daysPastDue}</td>
                      <td>
                        <StatusBadge status={BUCKET_TONE[item.bucket]} label={AGING_BUCKET_LABELS[item.bucket]} />
                      </td>
                      <td>{COLLECTIONS_ACTION_LABELS[item.suggestedAction]}</td>
                      <td className="text-right font-medium">
                        <Money minor={item.balanceMinor} currency={item.currency} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Section>
      </div>
    </>
  );
}
