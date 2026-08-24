-- How long a confirmation stays on screen, per account.
--
-- WCAG 2.2.1 asks that a time limit be adjustable, and the adjustment belongs
-- to the person rather than to the browser: somebody who needs longer to read
-- a message needs longer on the phone in the shop as well as on the tablet in
-- the kitchen. It was in `localStorage`, so it was neither.
--
-- NOT NULL with a default, so the column is backfilled in place and every
-- existing account keeps exactly the behaviour it has now.
ALTER TABLE "User" ADD COLUMN "snackbarDuration" TEXT NOT NULL DEFAULT 'default';
