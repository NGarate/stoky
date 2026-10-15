-- Passwords move from "User"."passwordHash" to a credential "Account" row.
--
-- Better Auth, which replaces next-auth later on this branch, reads a password
-- hash from the "Account" row whose "providerId" is 'credential' and whose
-- "accountId" is the user's id. Moving it now, while next-auth still signs
-- people in through src/lib/auth/credentials.ts, means the switch itself
-- carries no data move and this one can be checked on its own: every account
-- signs in with the password it had before (PROGRESS D134).
--
-- The hashes are copied unchanged. They are Argon2id strings, which carry their
-- own parameters, so nothing about them depends on which column holds them.
--
-- ON DELETE CASCADE is deliberate and is the schema's one exception to its
-- no-cascades rule: a deleted account must not leave its password hash behind
-- (ASVS 7.4.2), and Better Auth's adapter never deletes these rows itself.
--
-- One way: the column is dropped. Going back to a release before this one
-- needs the database dump taken before upgrading (docs/INSTALL.md).

-- CreateTable
CREATE TABLE "Account" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "accessToken" TEXT,
    "refreshToken" TEXT,
    "idToken" TEXT,
    "accessTokenExpiresAt" TIMESTAMP(3),
    "refreshTokenExpiresAt" TIMESTAMP(3),
    "scope" TEXT,
    "password" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Account_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Account_userId_idx" ON "Account"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Account_providerId_accountId_key" ON "Account"("providerId", "accountId");

-- AddForeignKey
ALTER TABLE "Account" ADD CONSTRAINT "Account_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Copy every hash. Ids are uuids rather than cuids, which is visible and
-- harmless: nothing parses an Account id, and Prisma's cuid() default only
-- applies to rows it creates itself.
INSERT INTO "Account" ("id", "accountId", "providerId", "userId", "password", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, u."id", 'credential', u."id", u."passwordHash", now(), now()
  FROM "User" u;

-- AlterTable
ALTER TABLE "User" DROP COLUMN "passwordHash";
