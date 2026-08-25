-- CreateEnum
CREATE TYPE "LandingScreen" AS ENUM ('DASHBOARD', 'SHOPPING', 'KITCHEN');

-- CreateTable
CREATE TABLE "ScreenChoice" (
    "userId" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "screen" "LandingScreen" NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ScreenChoice_pkey" PRIMARY KEY ("userId","deviceId")
);
