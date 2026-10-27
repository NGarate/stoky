import { createTRPCUntypedClient, httpLink } from "@trpc/client";
import SuperJSON from "@/lib/superjson";
import type { SendOperation } from "./queue";

/**
 * How a queued change actually reaches the server.
 *
 * **Its own client, deliberately unbatched.** The interactive client uses
 * `unstable_httpBatchStreamLink`, which merges several calls into one request —
 * exactly the wrong shape here. A dropped stream halfway through a batch leaves
 * no way to tell which of the merged mutations applied, and the queue's whole
 * job is knowing that. One operation, one request, one key, one status it can
 * classify.
 *
 * It also keeps the drain out of the way of whatever the interface is doing:
 * the two clients share nothing but the URL.
 *
 * `createTRPCUntypedClient` because the path is a runtime string from the
 * queue. A typed client would need a cast at the call site to accept it, which
 * is the same amount of unsafety with more ceremony.
 *
 * The transformer goes on the *link*, not on the client options — in tRPC v11
 * the latter is a compile error, and it is the kind that reads as a
 * configuration preference rather than a mistake.
 */

/** A single operation gets this long before it is treated as no answer. */
const OPERATION_TIMEOUT_MS = 15_000;

export function createOperationSender(
  userId: string,
  url = "/api/trpc",
): SendOperation {
  const client = createTRPCUntypedClient({
    links: [
      httpLink({
        transformer: SuperJSON,
        url,
        headers: () => ({ "x-trpc-source": "queue" }),
      }),
    ],
  });

  return async (op) => {
    // Aborting produces a rejection with no HTTP status, which the classifier
    // reads as "never arrived" — a wait rather than a strike. That is the
    // right answer for a request left hanging.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), OPERATION_TIMEOUT_MS);

    try {
      return await client.mutation(
        op.path,
        {
          ...op.input,
          idempotencyKey: op.id,
          composedByUserId: userId,
        },
        { signal: controller.signal },
      );
    } finally {
      clearTimeout(timer);
    }
  };
}
