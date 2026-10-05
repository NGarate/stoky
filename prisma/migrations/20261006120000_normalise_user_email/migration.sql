-- One account per address, whatever case it was typed in.
--
-- Until now `auth.register` stored the address exactly as typed and sign-in
-- looked it up exactly as typed, while `household.addMember` lowercased it. So
-- "Noel@Example.com" registered and then could not sign in as
-- "noel@example.com", and the two spellings could be registered as two
-- separate accounts. The schemas now trim and lowercase on the way in; this
-- brings the rows already stored into line and makes the database refuse a
-- second spelling of an address however it arrives.
--
-- Refuses to run, rather than guessing, if two existing accounts are the same
-- address in different case. Merging them would mean choosing whose password,
-- household and stock survive, which is the owner's decision and not a
-- migration's. Resolve it by hand (rename or delete one of the accounts named
-- in the error) and run the migration again.
DO $$
DECLARE
  collisions TEXT;
BEGIN
  SELECT string_agg(normalised || ' (' || accounts || ' accounts)', ', ')
    INTO collisions
    FROM (
      SELECT lower(trim(email)) AS normalised, count(*) AS accounts
        FROM "User"
       GROUP BY lower(trim(email))
      HAVING count(*) > 1
    ) AS duplicated;

  IF collisions IS NOT NULL THEN
    RAISE EXCEPTION 'Cannot normalise User.email: these addresses belong to more than one account when case and surrounding spaces are ignored: %. Rename or remove the extra accounts, then re-run the migration.', collisions;
  END IF;
END $$;

UPDATE "User" SET email = lower(trim(email)) WHERE email <> lower(trim(email));

-- Belt and braces under the schema's own normalisation: a write that bypasses
-- it (a script, a seed, a future procedure that forgets) still cannot create a
-- second spelling of an existing address. Not expressible in schema.prisma,
-- which has no expression indexes; `User_email_key` remains the one Prisma
-- knows about and the one `findUnique` uses.
CREATE UNIQUE INDEX "User_email_lower_key" ON "User" (lower(email));
