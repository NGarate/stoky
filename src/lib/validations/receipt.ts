import { z } from "zod";

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
