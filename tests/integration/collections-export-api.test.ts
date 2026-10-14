import { beforeAll, describe, expect, it } from "vitest";
import { GET as getCollections } from "@/app/api/collections/route";
import { GET as exportCollections } from "@/app/api/collections/export/route";
import { db } from "@/lib/db";
import { COLLECTIONS_ACTION_LABELS, type CollectionsQueue } from "@/lib/domain/aging";
import { asCurrency, toDecimalString } from "@/lib/money";
import { callRoute, callRouteText, NOW, resetDatabase, viewer } from "./helpers";

const HEADER = "Customer,Invoice,Currency,Balance,Due date,Days late,Bucket,Next step";
const asOf = NOW.toISOString().slice(0, 10);

async function queue() {
  const { body } = await callRoute<Record<string, never>, { data: CollectionsQueue }>(getCollections, {
    path: "/api/collections",
    query: { asOf },
  });
  return body.data;
}

function lines(text: string) {
  expect(text.endsWith("\r\n")).toBe(true);
  return text.slice(0, -2).split("\r\n");
}

beforeAll(resetDatabase);

describe("GET /api/collections/export", () => {
  it("returns a CSV attachment named after the as-of date", async () => {
    const { status, headers } = await callRouteText(exportCollections, { path: "/api/collections/export", query: { asOf } });
    expect(status).toBe(200);
    expect(headers.get("content-type")).toMatch(/^text\/csv/);
    expect(headers.get("content-disposition")).toBe(`attachment; filename="collections-${asOf}.csv"`);
  });

  it("writes a header row and one row per queue item, in queue order", async () => {
    const { items } = await queue();
    expect(items.length).toBeGreaterThan(0);

    const { text } = await callRouteText(exportCollections, { path: "/api/collections/export", query: { asOf } });
    const [header, ...rows] = lines(text);
    expect(header).toBe(HEADER);
    expect(rows).toHaveLength(items.length);

    items.forEach((item, index) => {
      const balance = toDecimalString(item.balanceMinor, asCurrency(item.currency));
      expect(balance).toMatch(/^\d+(\.\d+)?$/);
      expect(rows[index]).toBe(
        [
          item.customerName,
          item.invoiceNumber,
          item.currency,
          balance,
          item.dueDate.slice(0, 10),
          item.daysPastDue,
          item.bucket,
          COLLECTIONS_ACTION_LABELS[item.suggestedAction],
        ].join(","),
      );
    });
  });

  it("escapes commas and quotes and neutralises formulas in customer names", async () => {
    const [first] = (await queue()).items;
    const nasty = '=HYPERLINK("http://evil.test"), "Big" Co';
    await db.customer.update({ where: { id: first.customerId }, data: { name: nasty } });

    const { text } = await callRouteText(exportCollections, { path: "/api/collections/export", query: { asOf } });
    const escaped = `"'=HYPERLINK(""http://evil.test""), ""Big"" Co"`;
    const rows = lines(text).slice(1);
    const row = rows.find((line) => line.includes(`,${first.invoiceNumber},`));
    expect(row?.startsWith(`${escaped},${first.invoiceNumber},${first.currency},`)).toBe(true);
    expect(rows.filter((row) => row.startsWith(`${escaped},`))).toHaveLength(
      (await queue()).items.filter((item) => item.customerId === first.customerId).length,
    );
  });

  it("lets viewers export", async () => {
    const { status, text } = await callRouteText(exportCollections, { path: "/api/collections/export", as: viewer });
    expect(status).toBe(200);
    expect(lines(text)[0]).toBe(HEADER);
  });

  it("keeps errors as JSON", async () => {
    const { status, body, headers } = await callRoute<Record<string, never>, { error: { code: string } }>(exportCollections, {
      path: "/api/collections/export",
      query: { asOf: "not-a-date" },
    });
    expect(status).toBe(400);
    expect(headers.get("content-type")).toMatch(/application\/json/);
    expect(body.error.code).toBe("VALIDATION_FAILED");
  });
});
