-- Passkeys (PROGRESS D151): one row per WebAuthn credential, in the shape
-- Better Auth's passkey plugin reads.
--
-- - Nothing in it is secret: "publicKey" is a public key, "credentialID" the
--   name the browser gives the credential back, so it is unique.
-- - A passkey works only at the host it was registered for, the first
--   STOKY_URLS entry's (SECURITY.md, Authentication).
-- - Cascades from "User", the auth tables' exception (D134): a credential
--   goes with its account (ASVS 7.4.2).
--
-- Additive only: a new, empty table.

-- CreateTable
CREATE TABLE "Passkey" (
    "id" TEXT NOT NULL,
    "name" TEXT,
    "publicKey" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "credentialID" TEXT NOT NULL,
    "counter" INTEGER NOT NULL,
    "deviceType" TEXT NOT NULL,
    "backedUp" BOOLEAN NOT NULL,
    "transports" TEXT,
    "createdAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
    "aaguid" TEXT,

    CONSTRAINT "Passkey_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Passkey_credentialID_key" ON "Passkey"("credentialID");

-- CreateIndex
CREATE INDEX "Passkey_userId_idx" ON "Passkey"("userId");

-- AddForeignKey
ALTER TABLE "Passkey" ADD CONSTRAINT "Passkey_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
