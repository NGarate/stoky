-- "Session"."persistent": whether the person asked to stay signed in
-- ("Mantener la sesión iniciada", PROGRESS D141).
--
-- A browser session ends fifteen idle minutes after it was last used and a
-- day after the sign-in at most; a remembered one ends ninety idle days after
-- it was last used and a year after the sign-in at most
-- (src/lib/auth/session-policy.ts). The row has to say which it is, because
-- Better Auth's own signal for it, the dont_remember cookie, is the browser's
-- to keep or lose.
--
-- Default false: every row written before this migration was a browser
-- session, and still is.

-- AlterTable
ALTER TABLE "Session" ADD COLUMN     "persistent" BOOLEAN NOT NULL DEFAULT false;
