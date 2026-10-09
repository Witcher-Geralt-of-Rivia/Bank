import "server-only";
import { revalidatePath } from "next/cache";
import type { z } from "zod";
import { type Database, getDb } from "@/db/client";
import type { Role } from "@/lib/domain";
import { type ActionResult, ValidationError, toActionError } from "@/lib/errors";
import { fieldErrorsOf } from "@/lib/validation";
import { type SessionUser, requestContext, requireActionUser } from "../auth/session";
import type { RequestContext } from "../context";
import { type RateLimiter, enforceRateLimit, limiters } from "../rate-limit";

type Scope = {
  db: Database;
  user: SessionUser;
  ctx: RequestContext;
};

type Options<Schema extends z.ZodType> = {
  /** Roles allowed to call the action. Omit to allow any signed-in user. */
  roles?: readonly Role[];
  schema: Schema;
  limiter?: RateLimiter;
};

/**
 * Wraps a Server Action with the checks every mutation needs, in a fixed
 * order: authenticate → authorise → rate-limit → validate → run → refresh.
 *
 * Server Actions are public HTTP endpoints, so none of this is delegated to
 * the UI that calls them. Failures come back as a typed, client-safe result;
 * unexpected errors are logged server-side and never leak detail.
 */
export function defineAction<Schema extends z.ZodType, Output>(
  options: Options<Schema>,
  handler: (input: z.output<Schema>, scope: Scope) => Promise<Output>,
): (input: z.input<Schema>) => Promise<ActionResult<Output>> {
  return async (input) => {
    try {
      const user = await requireActionUser(options.roles);
      enforceRateLimit(options.limiter ?? limiters.mutation, user.id);

      const parsed = options.schema.safeParse(input);
      if (!parsed.success) {
        throw new ValidationError("Revisa los campos marcados.", fieldErrorsOf(parsed.error));
      }

      const scope: Scope = { db: await getDb(), user, ctx: await requestContext(user) };
      const data = await handler(parsed.data, scope);

      // Balances and activity appear across the whole shell.
      revalidatePath("/", "layout");
      return { ok: true, data };
    } catch (error) {
      return toActionError(error);
    }
  };
}
