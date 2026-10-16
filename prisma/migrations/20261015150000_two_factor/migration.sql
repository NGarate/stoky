-- Two-step verification with an authenticator app (PROGRESS D148): Better
-- Auth's two-factor plugin reads "User"."twoFactorEnabled" and one "TwoFactor"
-- row per person.
--
-- - "TwoFactor"."secret" and "backupCodes" are encrypted with STOKY_SECRET.
-- - "lastTotpCounter" is ours: the highest TOTP time step a code has been
--   accepted for, so a code works once (ASVS 5.0.0 6.5.1).
-- - "userId" is unique: one authenticator per person, so the replay guard and
--   Better Auth always read the same secret.
-- - The counter and the flags are NOT NULL, unlike Better Auth's optional
--   fields: a null "failedVerificationCount" plus one is still null, and the
--   account lockout would never fire.
-- - Cascades from "User", the auth tables' exception (D134): a credential
--   goes with its account (ASVS 7.4.2).
--
-- Additive only: every existing account gets twoFactorEnabled = false, which
-- is what it was.

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "twoFactorEnabled" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "TwoFactor" (
    "id" TEXT NOT NULL,
    "secret" TEXT NOT NULL,
    "backupCodes" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "verified" BOOLEAN NOT NULL DEFAULT true,
    "failedVerificationCount" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMP(3),
    "lastTotpCounter" INTEGER,

    CONSTRAINT "TwoFactor_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TwoFactor_userId_key" ON "TwoFactor"("userId");

-- AddForeignKey
ALTER TABLE "TwoFactor" ADD CONSTRAINT "TwoFactor_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

