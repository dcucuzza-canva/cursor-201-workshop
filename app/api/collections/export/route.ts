import { csv, handle, parseQuery } from "@/lib/http/route";
import { collectionsQueueCsv } from "@/lib/services/reports";
import { asOfQuerySchema } from "@/lib/validation/misc";

// GET /api/collections/export?asOf=2026-10-13  -> the collections queue as a CSV download
export const GET = handle(async (request) => {
  const { asOf } = parseQuery(request, asOfQuerySchema);
  const { content, filename } = await collectionsQueueCsv(asOf);
  return csv(content, filename);
});
