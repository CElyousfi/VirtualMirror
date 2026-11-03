/**
 * Minimal typed wrapper over the Admin GraphQL client that
 * `authenticate.admin()` returns. Services depend on `AdminGraphql`, not on
 * the Shopify library, so they can be unit-tested with a fake.
 */

export interface AdminGraphql {
  graphql(
    query: string,
    options?: { variables?: Record<string, unknown> },
  ): Promise<{ json(): Promise<unknown> }>;
}

export class AdminApiError extends Error {
  constructor(
    message: string,
    readonly details: unknown,
  ) {
    super(message);
    this.name = "AdminApiError";
  }
}

export class UserErrors extends Error {
  constructor(
    readonly operation: string,
    readonly errors: { field?: string[] | null; message: string; code?: string | null }[],
  ) {
    super(`${operation}: ${errors.map((e) => e.message).join("; ")}`);
    this.name = "UserErrors";
  }
}

interface GraphqlError {
  message: string;
  extensions?: { code?: string };
}

interface GraphqlEnvelope<T> {
  data?: T;
  errors?: GraphqlError[] | GraphqlError;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Run a GraphQL operation and return `data`. Retries THROTTLED responses with
 * backoff (the Admin API uses a leaky-bucket cost limit).
 */
export async function gql<T>(
  admin: AdminGraphql,
  query: string,
  variables?: Record<string, unknown>,
  { retries = 4, backoffMs = 1000 }: { retries?: number; backoffMs?: number } = {},
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    let body: GraphqlEnvelope<T>;
    try {
      const res = await admin.graphql(query, { variables });
      body = (await res.json()) as GraphqlEnvelope<T>;
    } catch (err) {
      // The Shopify client throws on GraphQL errors in some versions; normalise.
      const e = err as { body?: GraphqlEnvelope<T>; message?: string };
      if (e.body) body = e.body;
      else throw err;
    }
    const errors: GraphqlError[] = Array.isArray(body.errors) ? body.errors : body.errors ? [body.errors] : [];
    const throttled = errors.some((e) => e.extensions?.code === "THROTTLED");
    if (throttled && attempt < retries) {
      await sleep(backoffMs * 2 ** attempt);
      continue;
    }
    if (errors.length) throw new AdminApiError(errors.map((e) => e.message).join("; "), errors);
    if (!body.data) throw new AdminApiError("Empty GraphQL response", body);
    return body.data;
  }
}

export function assertNoUserErrors(
  operation: string,
  errors: { field?: string[] | null; message: string; code?: string | null }[] | null | undefined,
): void {
  if (errors && errors.length) throw new UserErrors(operation, errors);
}
