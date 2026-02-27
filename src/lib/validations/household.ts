import { z } from "zod";

export const householdSchema = z.object({
  name: z.string().trim().min(1),
});

export const updateHouseholdSchema = householdSchema.partial().extend({
  id: z.string().trim().min(1),
});

export const householdMemberSchema = z.object({
  userId: z.string().trim().min(1),
  role: z.enum(["OWNER", "ADMIN", "MEMBER"]),
});

export type HouseholdInput = z.infer<typeof householdSchema>;
export type UpdateHouseholdInput = z.infer<typeof updateHouseholdSchema>;
export type HouseholdMemberInput = z.infer<typeof householdMemberSchema>;
