-- "User"."sessionsValidFrom" goes: deleting a "Session" row replaced it.
--
-- next-auth signed a token and kept nothing, so the only way to end a
-- session was a line in time on the account, compared against the token's
-- issue time. Better Auth keeps a row per session, and ending one is deleting
-- it (src/lib/auth/end-sessions.ts, PROGRESS D135); nothing has read or
-- written this column since the switch. A value it holds marks sessions that
-- no longer exist, so nothing is lost with it.
--
-- One way, like 20261015120000_credential_accounts in the same release: a
-- release before this one reads the column, and going back needs the
-- database dump taken before upgrading (docs/INSTALL.md).

-- AlterTable
ALTER TABLE "User" DROP COLUMN "sessionsValidFrom";
