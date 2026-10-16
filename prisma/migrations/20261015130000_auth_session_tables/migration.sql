-- Better Auth's session and verification tables, ahead of the switch to it.
--
-- Better Auth keeps a row per session, where next-auth signs a token and
-- keeps nothing. These tables are created now, while next-auth still signs
-- people in and neither reads nor writes them, so the switch itself carries
-- no schema change beyond what it must and this one can be checked alone.
--
-- "User" gains the two columns Better Auth's user model requires. Nothing
-- here sends mail or uses a social provider, so "emailVerified" stays false
-- and "image" stays null.
--
-- "Session"."authenticatedAt" is ours, not Better Auth's: when the person
-- last proved who they are. Better Auth resets "createdAt" whenever it
-- re-creates a session (a password change, enabling two-step verification),
-- so the absolute session limit cannot be measured from that.
--
-- ON DELETE CASCADE on "Session" is the same recorded exception as "Account"
-- (PROGRESS D134): a deleted account takes its sessions with it (ASVS 7.4.2),
-- and Better Auth's adapter never deletes them itself. "Verification" has no
-- foreign key: its identifier is not always a user id.
--
-- Additive: a release before this one ignores the new tables and columns.

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "emailVerified" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "image" TEXT;

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "authenticatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "userId" TEXT NOT NULL,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Verification" (
    "id" TEXT NOT NULL,
    "identifier" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Verification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Session_token_key" ON "Session"("token");

-- CreateIndex
CREATE INDEX "Session_userId_idx" ON "Session"("userId");

-- CreateIndex
CREATE INDEX "Session_expiresAt_idx" ON "Session"("expiresAt");

-- CreateIndex
CREATE INDEX "Verification_identifier_idx" ON "Verification"("identifier");

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
