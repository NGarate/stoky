-- CreateTable
CREATE TABLE "MutationReplay" (
    "key" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "householdId" TEXT NOT NULL,
    "procedure" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "resultIds" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MutationReplay_pkey" PRIMARY KEY ("userId","key")
);

-- CreateIndex
CREATE INDEX "MutationReplay_expiresAt_idx" ON "MutationReplay"("expiresAt");
