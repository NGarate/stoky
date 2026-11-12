# One household per installation

**Decided by the owner, 2026-11-12.** An installation is one household. Today
it can quietly become several that nobody can see or manage, and Stoky is
still an MVP: the simplest model wins. Several families means several
installations.

Read `CLAUDE.md` first; everything there holds. This plan is written for an
agent starting with no context from the conversation that produced it.

---

## 1. Why — what is wrong today

There is no role above a household (`OWNER`/`ADMIN`/`MEMBER`/`KITCHEN` are
roles *in* one, `User.householdId` is a single nullable column), yet three
doors make more households:

1. **`STOKY_REGISTRATION=open`** (`src/lib/auth/registration.ts`): every
   registration creates a household of its own. Nobody can list them, block
   an account, delete one, or see what they store. It is also the default
   outside production.
2. **`household.create`** (`src/server/trpc/routers/household.ts`), offered by
   `RouteState`'s `CreateHousehold` form (`src/components/household/RouteState.tsx`)
   to any account without a household — reachable even under the default
   `first-user`.
3. **`household.removeMember`** only sets `householdId: null`. The removed
   person keeps a working account, signs in, is offered the form above, and
   the installation has a second household.

And nothing can delete an account or a household, so whatever those doors
create stays for ever. `auth.register` also accepts no `householdName`
(`src/lib/validations/auth.ts`, `.optional()`), making an account with no
household directly.

## 2. Decisions (the owner's — do not reopen)

- **One household per installation.** Close the doors above. No instance
  administrator role, no household list screen, no multi-household management.
- **A removed member's account is deleted**, not left householdless.
- **The data model does not change.** Every row keeps its `householdId` and
  every procedure stays household-scoped: that scoping is defence in depth,
  and it is what isolates the test suites from each other (integration tests
  create a household per test through Prisma; keep doing that). Making
  `User.householdId` required is *out of scope* (see §6).
- **No upgrade path, no shim** for an installation that set `open`: Stoky is
  pre-beta and the owner is its only user. `open` simply becomes an unknown
  value, which already refuses to start in production with a message.
- **E2E is the basic happy path of real use and nothing more** (owner,
  2026-11-12). Regressions, refusals and edge cases go in unit, component or
  integration tests. Never run the whole browser suite locally; CI's
  End-to-end job runs it. A single spec may be run when a commit changes it.
- **Who administers the installation is the household's OWNER and ADMIN**
  (`adminProcedure`). This is what unblocks `ISSUES.md` PARSE-5 (the
  receipt parser's keywords moving to the database, edited by "the
  administrator"); PARSE-5 itself is not part of this plan.

## 3. Out of scope

- PARSE-5 (receipt keywords in the database).
- Making `User.householdId` non-nullable, or removing `householdId` anywhere.
- An instance-admin role, a households screen, account blocking, quotas
  (`ISSUES.md` UPLOAD-1 stays open; only its severity reasoning may change).
- Rewording every comment that mentions "an account with no household".
  Change a comment only where the code beside it changes, or where it is now
  false in a way that would mislead.

## 4. The commits

Work on a branch cut from `master`, `feat/one-household-2026-11-12`, and open
a pull request (`CLAUDE.md`, Git Workflow: unattended agent work). Each commit
stands alone, passes its own gates, and updates the documents it makes wrong
**in the same commit** (`docs/README.md` says which document owns what). The
order matters: no commit may leave e2e red, which is why the e2e accounts
change first.

Before starting, list every reference yourself — the files named here are
what was found on 2026-11-12, not a promise of completeness:

```
grep -rn "household\.create\|CreateHousehold\|isNoHouseholdError\|noHousehold" src e2e messages
grep -rn "\"open\"\|STOKY_REGISTRATION\|registrationAllows\|registrationOpen" src e2e scripts deploy playwright.config.ts .env.example
grep -rn "removeMember" src e2e messages
```

### Commit 1 — `test(auth): give the browser specs their accounts without registering`

Six specs register a fresh account with a household of its own through
`/register` (`e2e/account.ts` `register()`): `auth`, `password`, `passkeys`,
`two-factor`, `household`, `sessions`. They need an account no other worker
touches, because they change its password, its passkeys, its second factor
and its sessions. Registration will not be open to them once `open` is gone
(the e2e database always has the seeded demo account, so `first-user` refuses).

- Replace `register()` with a helper that creates a fresh household and its
  OWNER **directly in the suite's own database** (`e2e/db-url.ts`), then signs
  in through `/login` as today. Creating a household this way is test
  isolation, not the product — the same thing the integration suites do.
  The seed already writes that database from a child process
  (`e2e/seed.setup.ts` runs `bun run db:seed`); the account must be created
  the way the application creates one — `createCredentialUser`
  (`src/lib/auth/credentials.ts`) with `hashPassword`
  (`src/lib/auth/password-hash.ts`) — or sign-in will not find its password.
  Choose between importing those from the spec process and a small script
  run like the seed; check what the Playwright image can import first.
- `auth.spec.ts` "registers, picks a start screen, signs out and signs back
  in": registration is a once-per-installation step, not a journey a browser
  suite can repeat on a database that already has accounts. Keep the
  journey as *signs in, picks a start screen, signs out, signs back in*;
  registration is already proven against a real database in
  `src/__tests__/integration/registration.test.ts` and in
  `src/__tests__/components/auth-pages.test.tsx`.
- Leave `STOKY_REGISTRATION: "open"` in `playwright.config.ts` for this
  commit; it goes in commit 3.
- Gate: run each changed spec alone in the image (`bash scripts/e2e-in-image.sh
  e2e/<file>.spec.ts` — the script passes its arguments to Playwright). Not
  the whole suite.
- Docs: `docs/TEST_SETUP.md` where it says how the browser specs get their
  accounts, if it does.

### Commit 2 — `feat(auth): require the household's name to register`

`auth.register` makes the household and its OWNER together only when a name
is sent; without one it makes a householdless MEMBER.

- `src/lib/validations/auth.ts`: `householdName` required.
- `src/server/trpc/routers/auth.ts` `register`: always creates the household,
  always `OWNER`. Its doc comment says "The household is optional…
  (HOUSE-1)": rewrite it.
- `src/components/session/RegisterForm.tsx`: the field is required (and says
  so the way the form's other required fields do); stop sending `undefined`.
- Tests: the integration test that registered without a household now
  expects the refusal; the component test sends the name. Break the schema
  back to optional and watch the new assertion go red (CLAUDE.md, rule 2).

### Commit 3 — `feat(auth)!: refuse STOKY_REGISTRATION=open, one household per installation`

- `src/lib/auth/registration.ts`: `REGISTRATION_MODES` is `first-user` and
  `closed`. Unset is `first-user` **everywhere**, not `open` outside
  production. `registrationAllows` and `registrationOpen` lose their `open`
  arm. The module's doc comment explains the modes; say why `open` is gone
  (one household per installation), briefly.
- The refusal message for an unknown value lists the modes from the
  constant already; check `open` reads as "unknown" with a reason an
  operator can act on (`src/lib/auth/startup.ts`).
- `playwright.config.ts`: drop `STOKY_REGISTRATION: "open"` and its comment.
- Every test of `open`: `src/__tests__/unit/registration-mode.test.ts`,
  `auth-environment.test.ts`, `deployment.test.ts`, `auth.error-messages.test.ts`,
  `integration/registration.test.ts` — an `open` case becomes "is refused /
  unknown", not deleted silently. A dev or test default of `first-user` may
  break suites that relied on registering freely; fix them to create
  accounts directly.
- Docs, all in this commit: `docs/INSTALL.md` (the modes table at ~163, the
  paragraph at ~278, ~692, the troubleshooting rows at ~873–874),
  `.env.example` (~115), `deploy/example.env` comment if any, `SECURITY.md`
  (~1199, ~2208–2211, ~2585, and the "under open registration" risk lines
  ~1744, ~1762, ~1801, ~2623 — reword or drop each, do not leave them
  describing a mode that no longer exists), `ISSUES.md` (~769, ~974–976:
  the severity reasoning of those entries), `docs/STATUS.md` (~397–398).
  `docs/releases/NEXT.md`: one line for operators — `open` is no longer
  accepted and an installation is one household. No upgrade instructions
  (pre-beta).

### Commit 4 — `feat(household)!: stop creating a household from an account without one`

- Remove `household.create` from `src/server/trpc/routers/household.ts` and
  its schema if nothing else uses it (`householdSchema`).
- `src/components/household/RouteState.tsx`: remove `CreateHousehold` and the
  no-household branch of `RouteState`. `isNoHouseholdError` goes if nothing
  else uses it; an account without a household can no longer be made, so
  that error now falls to the ordinary "could not load" state with a retry.
- `householdProcedure` (`src/server/trpc/trpc.ts` ~306) **keeps** refusing an
  account with no household — defence against a hand-edited database. Its
  comment says the client resolves it by creating one: reword that, and
  leave the code as it is.
- `messages/es.json` and `messages/en.json`: the keys only the form used
  (`noHouseholdTitle`, `noHouseholdBody`, `createHousehold`, `creating`,
  `createFailed`, `nameHint`, maybe `nameLabel` — check each is unused
  first).
- `src/__tests__/unit/capabilities.test.ts`: drop `create`; the documented
  procedure count goes from 79 to 78 in `SECURITY.md` and `docs/STATUS.md`
  (the test checks those sentences). The matrix comment above `household.ts`
  explains `create`'s tier: rewrite it.
- Tests that call `household.create` (`integration/household.test.ts`,
  `routers.test.ts`, `capabilities.refusals.test.ts`, …): remove those cases
  or, where they used it as setup, create the household through Prisma like
  the other integration tests.
- `ISSUES.md` HOUSE-1 is resolved; add one line to it saying the way out it
  describes was removed and why, rather than rewriting history.
- `docs/releases/NEXT.md` only if a household could notice; probably not.

### Commit 5 — `feat(household): delete a removed member's account`

`removeMember` sets `householdId: null` and ends the member's sessions.
Delete the account instead, in the same transaction, after the same guards
(`withOwnersLocked`, `assertMayActOnOwner`, `assertAnOwnerRemains`).

- Keep `endSessions` before the delete: sessions also live in Valkey
  (Better Auth's secondary storage), which a row cascade does not reach.
  Confirm that is still true before relying on it either way.
- `Account`, `Session`, `Passkey`, `TwoFactor` cascade from `User`
  (`onDelete: Cascade` in `prisma/schema.prisma`). `ScreenChoice` and
  `MutationReplay` key on `userId` with no relation: delete the member's rows
  in the same transaction. `StockEntry.createdBy` and `Receipt.uploadedBy`
  are plain ids with no relation and are never joined for display; leave
  them — the history keeps who did it, as an id.
- Keep the `auth.session.ended` security event; it should still record how
  many sessions ended and that the reason was removal.
- The removal dialog must say the account is deleted, not only removed from
  the household (`messages/*.json`, the members screen in
  `src/components/household/`).
- Tests (integration, `household.test.ts`): after removal the account row and
  its credentials are gone, sign-in with its password fails, its
  `ScreenChoice` rows are gone, and the same e-mail can be added again with
  `addMember`. Each seen red with the delete reverted.
- Docs: `SECURITY.md` where member removal is described; `docs/releases/NEXT.md`
  (a household notices: a removed person's account no longer exists).

## 5. Gates

Per commit (`CLAUDE.md` rule 4, as the owner narrowed it):
`bun run lint`, `bun run typecheck`, and only the test files the change
touches — never the whole suite to find one case, never the whole browser
suite. Component tests need the DOM preload:
`bun test --preload ./src/__tests__/setup/register-dom.ts <file>`.
Integration tests need the local database (`docs/VERIFICATION_SEQUENCE.md`).

Before the push, once: the whole `bun run verify:ci`, read to the end — its
exit status is the last script's, and it stops at the first failing step, so
a failure early hides everything after it. Fold each fix into the commit that
caused it (`git commit --fixup` + `git rebase -i --autosquash`) while the
branch is unpushed. Do **not** run `bun run test:e2e` whole; CI runs it.

Push over HTTPS (`git -c credential.helper= -c credential.helper='!gh auth git-credential' push https://github.com/NGarate/stoky.git <branch>`);
SSH asks for a passphrase nobody can type in an agent session. Open the PR
and stop: the owner reviews and merges.

Known noise, not this work's: the CI job "Scan the bundle's service images"
was red on 2026-11-12 for `postgres:16.15-alpine` HIGH CVEs (`krb5-libs`,
`libxslt`); refreshing the pin is the owner's (`release:refresh-images`).

## 6. Risks and things to check, not assume

- **Data already householdless.** Pre-beta, local databases are reset rather
  than migrated; no data fix is needed. Do not reset anyone's database
  without asking.
- **`first-user` as the development default** changes `bun run dev` for a
  fresh database: the first registration claims it, which is the product's
  behaviour. The seeded demo account already exists on a seeded database.
- **`User.householdId` stays nullable.** After this plan nothing writes null
  except a hand edit. Making it required would let the database hold the
  invariant (`ISSUES.md` DB-1's class), but touches every test that creates a
  user without a household — a separate decision, not this plan.
- **The receipt keywords (PARSE-5)** can follow this plan with
  `adminProcedure` as their editor. Once this merges, update PARSE-5's status
  line to say the question it waited on is settled.
