-- "Session"."deviceId": the stoky_device cookie a sign-in carried (PROGRESS
-- D143), so a person's list of sessions can name the device by the screen it
-- opens on (ScreenChoice) rather than by its User-Agent alone. Personal data:
-- it is listed in SECURITY.md's table and never returned to a client.
--
-- Nullable: every row written before this migration, and every native
-- client's, has none.

-- AlterTable
ALTER TABLE "Session" ADD COLUMN     "deviceId" TEXT;
