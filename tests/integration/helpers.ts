import { NextRequest } from "next/server";
import { SESSION_COOKIE } from "@/lib/auth/demo-users";
import { db } from "@/lib/db";
import type { Actor } from "@/lib/domain/permissions";
import { clearDatabase, seedDemoData } from "@/prisma/demo-data";

// Seed data is scripted relative to "now", and route handlers use the real clock,
// so tests seed relative to the moment the suite starts.
export const NOW = new Date();

export const viewer: Actor = { id: "user_priya", name: "Priya Shah", role: "viewer" };
export const agent: Actor = { id: "user_marcus", name: "Marcus Lee", role: "agent" };
export const admin: Actor = { id: "user_dana", name: "Dana Okafor", role: "admin" };

export async function resetDatabase(): Promise<void> {
  await clearDatabase();
  await seedDemoData(NOW);
}

type Handler<P extends Record<string, string>> = (
  request: NextRequest,
  context: { params: Promise<P> },
) => Promise<Response>;

export interface CallOptions<P extends Record<string, string>> {
  method?: "GET" | "POST" | "PUT";
  path: string;
  query?: URLSearchParams | Record<string, string>;
  body?: unknown;
  as?: Actor;
  params?: P;
}

function invoke<P extends Record<string, string>>(handler: Handler<P>, options: CallOptions<P>): Promise<Response> {
  const search = options.query ? `?${new URLSearchParams(options.query).toString()}` : "";
  const request = new NextRequest(`http://tally.test${options.path}${search}`, {
    method: options.method ?? "GET",
    headers: {
      ...(options.body === undefined ? {} : { "content-type": "application/json" }),
      cookie: `${SESSION_COOKIE}=${(options.as ?? agent).id}`,
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  return handler(request, { params: Promise.resolve((options.params ?? {}) as P) });
}

/** Invokes an App Router route handler directly, the way Next.js would. */
export async function callRoute<P extends Record<string, string> = Record<string, never>, T = unknown>(
  handler: Handler<P>,
  options: CallOptions<P>,
): Promise<{ status: number; body: T; headers: Headers }> {
  const response = await invoke(handler, options);
  return { status: response.status, body: (await response.json()) as T, headers: response.headers };
}

/** Like callRoute, for handlers that respond with something other than JSON (e.g. CSV). */
export async function callRouteText<P extends Record<string, string> = Record<string, never>>(
  handler: Handler<P>,
  options: CallOptions<P>,
): Promise<{ status: number; text: string; headers: Headers }> {
  const response = await invoke(handler, options);
  return { status: response.status, text: await response.text(), headers: response.headers };
}

export async function findInvoice(where: { status?: string; customerId?: string }) {
  const invoice = await db.invoice.findFirst({ where, orderBy: { number: "asc" } });
  if (!invoice) throw new Error(`No invoice matching ${JSON.stringify(where)}`);
  return invoice;
}

export async function auditFor(entityId: string) {
  return db.auditEntry.findMany({ where: { entityId }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
}
