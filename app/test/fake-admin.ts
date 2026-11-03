import type { AdminGraphql } from "../lib/admin-client";

/**
 * Fake Admin GraphQL client for unit tests. Each handler receives the
 * operation name (parsed from the query) and variables and returns `data`
 * (or a full envelope via `{ __envelope: ... }`).
 */
export type Handler = (variables: Record<string, unknown>, call: number) => unknown;

export function fakeAdmin(handlers: Record<string, Handler>) {
  const calls: { op: string; variables: Record<string, unknown> }[] = [];
  const counts = new Map<string, number>();
  const admin: AdminGraphql = {
    async graphql(query, options) {
      const op = /\b(?:query|mutation)\s+(\w+)/.exec(query)?.[1] ?? "anonymous";
      const variables = options?.variables ?? {};
      calls.push({ op, variables });
      const n = (counts.get(op) ?? 0) + 1;
      counts.set(op, n);
      const handler = handlers[op];
      if (!handler) throw new Error(`fakeAdmin: no handler for ${op}`);
      const result = handler(variables, n);
      const body =
        result && typeof result === "object" && "__envelope" in result
          ? (result as { __envelope: unknown }).__envelope
          : { data: result };
      return { json: async () => body };
    },
  };
  return { admin, calls };
}
