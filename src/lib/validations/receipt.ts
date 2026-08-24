import { z } from "zod";

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

export const receiptStatusSchema = z.enum([
  "UPLOADING",
  "PROCESSING",
  "PARSED",
  "NEEDS_REVIEW",
  "CONFIRMED",
  "APPLIED",
  "FAILED",
]);

export const receiptUploadSchema = z.object({
  storeId: z.string().optional(),
  purchaseDate: z.date().optional(),
});

export const receiptItemMatchSchema = z.object({
  receiptItemId: z.string(),
  productId: z.string().optional(),
  customName: z.string().optional(),
  action: z.enum(["MATCH", "CREATE", "SKIP"]),
});

export const receiptConfirmSchema = z.object({
  receiptId: z.string(),
  items: z.array(receiptItemMatchSchema),
  applyToInventory: z.boolean().default(true),
});

export const receiptQuerySchema = z.object({
  status: receiptStatusSchema.optional(),
  limit: z.number().default(20),
  cursor: z.string().optional(),
});

export type ReceiptUploadInput = z.infer<typeof receiptUploadSchema>;
export type ReceiptItemMatchInput = z.infer<typeof receiptItemMatchSchema>;
export type ReceiptConfirmInput = z.infer<typeof receiptConfirmSchema>;
export type ReceiptQueryInput = z.infer<typeof receiptQuerySchema>;
