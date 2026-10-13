import type { InvoiceStatus } from "@/lib/domain/invoice-status";
import type { Currency } from "@/lib/money";
import type { InvoiceSortField } from "@/lib/validation/invoices";

// Filter, sort and pagination state for the invoices list. The same query string is used
// for the page URL (so filters survive a refresh) and for the GET /api/invoices request.

export interface InvoiceListParams {
  status?: InvoiceStatus;
  currency?: Currency;
  q?: string;
  sort: InvoiceSortField;
  order: "asc" | "desc";
  page: number;
}

export const DEFAULT_INVOICE_LIST_PARAMS: InvoiceListParams = { sort: "dueDate", order: "asc", page: 1 };

export function toInvoiceSearchParams(params: Partial<InvoiceListParams>): URLSearchParams {
  const search = new URLSearchParams();
  if (params.status) search.set("status", params.status);
  if (params.currency) search.set("currency", params.currency);
  if (params.q) search.set("q", params.q);
  if (params.sort && params.sort !== DEFAULT_INVOICE_LIST_PARAMS.sort) search.set("sort", params.sort);
  if (params.order && params.order !== DEFAULT_INVOICE_LIST_PARAMS.order) search.set("order", params.order);
  if (params.page && params.page > 1) search.set("page", String(params.page));
  return search;
}

export function fromInvoiceSearchParams(search: URLSearchParams): InvoiceListParams {
  const page = Number(search.get("page") ?? "1");
  return {
    status: (search.get("status") as InvoiceStatus | null) ?? undefined,
    currency: (search.get("currency") as Currency | null) ?? undefined,
    q: search.get("q") ?? undefined,
    sort: (search.get("sort") as InvoiceSortField | null) ?? DEFAULT_INVOICE_LIST_PARAMS.sort,
    order: search.get("order") === "desc" ? "desc" : "asc",
    page: Number.isInteger(page) && page > 0 ? page : 1,
  };
}
