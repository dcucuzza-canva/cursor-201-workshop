import { NextResponse, type NextRequest } from "next/server";
import type { z } from "zod";
import { ApiError, toErrorResponse } from "@/lib/http/errors";

// Helpers shared by every handler in app/api. A route handler should:
//   1. parse its input with parseJson / parseQuery / parseParams (zod),
//   2. resolve the actor with actorFromRequest,
//   3. call one function in lib/services,
//   4. return ok(...) or okList(...).
// Wrapping it in `handle` turns thrown errors into the standard error shape.

export interface ListMeta {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export type RouteContext<P extends Record<string, string> = Record<string, never>> = {
  params: Promise<P>;
};

export function handle<P extends Record<string, string> = Record<string, never>>(
  handler: (request: NextRequest, context: RouteContext<P>) => Promise<Response>,
) {
  return async (request: NextRequest, context: RouteContext<P>): Promise<Response> => {
    try {
      return await handler(request, context);
    } catch (error) {
      return toErrorResponse(error);
    }
  };
}

export function ok<T>(data: T, init?: ResponseInit) {
  return NextResponse.json({ data }, init);
}

export function created<T>(data: T) {
  return ok(data, { status: 201 });
}

export function okList<T>(data: T[], meta: ListMeta) {
  return NextResponse.json({ data, meta });
}

export function csv(content: string, filename: string) {
  return new Response(content, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${filename}"`,
    },
  });
}

export async function parseJson<S extends z.ZodType>(request: NextRequest, schema: S): Promise<z.infer<S>> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw new ApiError("BAD_REQUEST", "Request body must be valid JSON");
  }
  return schema.parse(body);
}

export function parseQuery<S extends z.ZodType>(request: NextRequest, schema: S): z.infer<S> {
  return schema.parse(Object.fromEntries(request.nextUrl.searchParams));
}

export async function parseParams<S extends z.ZodType>(
  context: RouteContext<Record<string, string>>,
  schema: S,
): Promise<z.infer<S>> {
  return schema.parse(await context.params);
}
