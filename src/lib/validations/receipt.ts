import { z } from "zod";
import { MAX_ID_LENGTH, MAX_NAME_LENGTH } from "./bounds";

/**
 * The image types a receipt photograph may be.
 *
 * Here rather than in the router because both ends need the same answer and
 * they need it to be the *same* answer: the server refuses anything else, and
 * the upload zone turns this list into the `accept` attribute, which on
 * Android decides which of the phone's photos can be chosen at all. Offering
 * a type the server refuses is a failure after the choosing rather than
 * before it, and the two lists drifting apart is how that happens.
 *
 * **HEIC is deliberately absent**, and it is the format both Android and iOS
 * save camera photos in, so its absence is what someone notices. The reason
 * is that `sharp`'s bundled libvips cannot decode one: measured against four
 * real phone photographs, two from each platform, all four refused before
 * reaching the codec — libheif's own security limits, `iloc box contains 50
 * items` on the Android pair and `Number of references` on the iPhone pair —
 * and the binary carries no `de265` decoder either. Alpine's packaged
 * `vips-heif` converts the same files without complaint, so the way in is a
 * libvips built with libheif rather than the one npm ships; that is a change
 * to the image and to every developer's machine, and it has not been made.
 */
export const RECEIPT_IMAGE_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
] as const;

/**
 * The largest receipt photograph the server will accept, in bytes.
 *
 * Here for the same reason the type list is: both ends need the same answer,
 * and the number is quoted at the person in a message.
 */
export const MAX_RECEIPT_BYTES = 10 * 1024 * 1024;

/**
 * What that becomes on the wire, and the number that actually constrains
 * things.
 *
 * The photograph is base64'd into a JSON body — `readAsDataURL` in the upload
 * page, `fileBase64` in the router — so four bytes leave for every three that
 * go in. Ten megabytes of image is **13.98 MB of request**.
 *
 * That matters because Next caps a request body at
 * `experimental.proxyClientMaxBodySize` whenever a middleware is configured,
 * and this application's matcher covers every route including `/api/trpc`. At
 * the 10 MiB default the cap sat *below* the inflated size of the file this
 * module says is allowed, which had two consequences, both measured against a
 * running server:
 *
 * - a photograph over about 7.5 MiB — well inside the documented limit — came
 *   back as `JSON Parse error: Unterminated string`, because the body was
 *   truncated before anything read it. A person with a phone photograph got a
 *   parser's opinion of it;
 * - and the router's own size check could never fire at all. To exceed
 *   `MAX_RECEIPT_BYTES` after decoding, a body has to be larger than this
 *   constant, and such a body was cut off first. A size limit no request can
 *   reach is not a limit.
 *
 * The ceiling is now set explicitly, once, in `src/server/http/body-limit.ts`
 * — the bound the API routes enforce themselves, and the number
 * `next.config.ts` imports for the proxy's cap — and
 * `src/__tests__/unit/upload-body-limit.test.ts` asserts it still clears this
 * number, because they are in different files and nothing else would say so.
 */
export const MAX_RECEIPT_BASE64_LENGTH = Math.ceil(MAX_RECEIPT_BYTES / 3) * 4;

/**
 * One line of a receipt review, decided.
 *
 * **A union rather than a flat object with two optional fields**, because the
 * flat shape let one action carry another's field and the router read it. A
 * `CREATE` with a `productId` and no `customName` missed the ownership check —
 * which only ran for `MATCH` — *and* the create branch — which only ran when a
 * `customName` was there — and the caller's unchecked id went straight into
 * `ReceiptItem.matchedProductId`. Applying the receipt afterwards books stock
 * and a price against whatever product that was, in whatever household
 * (`ISSUES.md` SEC-1's shape). A `MATCH` with no `productId` was the mirror
 * image: nothing to check, so the line was marked reviewed against nothing.
 *
 * Discriminating on `action` makes both unrepresentable rather than guarded:
 * there is no `productId` field on the CREATE branch for a caller to fill, and
 * the MATCH branch does not parse without one. The router narrows on `action`
 * and TypeScript gives it exactly the fields that action has.
 */
export const receiptItemMatchSchema = z.discriminatedUnion("action", [
  z.object({
    receiptItemId: z.string().min(1).max(MAX_ID_LENGTH),
    action: z.literal("MATCH"),
    productId: z.string().min(1).max(MAX_ID_LENGTH),
  }),
  z.object({
    receiptItemId: z.string().min(1).max(MAX_ID_LENGTH),
    action: z.literal("CREATE"),
    // A product name, and the same bound: it becomes `Product.name`.
    customName: z.string().trim().min(1).max(MAX_NAME_LENGTH),
  }),
  z.object({
    receiptItemId: z.string().min(1).max(MAX_ID_LENGTH),
    action: z.literal("SKIP"),
  }),
]);
