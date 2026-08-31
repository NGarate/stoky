# Upstream report draft — TEST-5

**File this against Bun** (https://github.com/oven-sh/bun), against **1.4.0**,
noting it reproduces on 1.3.14 too. The self-contained reproduction is
`docs/reproductions/test-5.test.ts`.

Ready to paste; trim the internal cross-references the maintainer cannot follow.

---

## Title

`bun test` abandons a test body at a rejecting `await` under load: the `catch` never runs, the assertion never executes, and the test is reported as failed at the rejection's origin

## What happens

A test that wraps a call in `try`/`catch` and asserts afterward is, about one run
in seven **under concurrent load**, abandoned at the `await` that rejects:

- the `catch` block does not run;
- the assertion after it does not run (a passing run makes N `expect()` calls, a
  failing run makes N−1);
- the test is reported as **failed**, with the rejection rendered at its origin
  inside the code under test rather than as an assertion diff.

The code under test is correct — it is *supposed* to reject there, and the
`catch` is there to assert on it. On a passing run the same rejection is caught
and asserted. The runner does not consistently hand the rejection to the
`catch`.

## Reproduction

Reproduces only **under load** — a quiet run passes 90/90 and proves nothing.
Run another suite against the same resource while looping the reproduction:

```bash
# shell 1: sustained load
bun test src/__tests__/integration

# shell 2: loop the reproduction
for i in $(seq 1 24); do bun test docs/reproductions/test-5.test.ts; done
```

~3 failures in 24 under that load; 0 in 90 on a quiet machine. The attached
`test-5.test.ts` is self-contained (it needs a reachable PostgreSQL, as the
original does, because the load matters).

Measured across both binaries, **alternated inside one continuous load run**
(sequential measurement is dominated by machine drift and is not reliable):
1.3.14 failed 10/40, 1.4.0 failed 14/40 — i.e. 1.4.0 **still reproduces**; the
sample cannot distinguish whether its rate is better, equal or worse.

## The evidence that it is abandonment, not misreporting

Instrumented on a failing run:

- a marker on the test's final line never prints (`COMPLETED: []`);
- the test makes exactly one fewer `expect()` call than a passing run — the
  assertion in the `catch` never executed;
- the rejected value is the one the test deliberately provokes (verified by
  printing it): same identity, differing only in the field the code under test
  exists to reject on.

So execution stops *at the rejecting `await`*: neither the `catch` nor the
assertion runs, and the runner surfaces the rejection as a test failure at its
throw site.

## Environment

- bun 1.3.14 and 1.4.0 — reproduces on both
- Linux
- Concurrency: a second `bun test` process against the same PostgreSQL provides
  the load; the defect is a race, which is why load brings it out.

## Impact

The affected suite is a CI gate. ~1 run in 7 goes red with this signature on a
codebase with no actual regression; `retry: 2` fixes the pass/fail tally but the
abandoned attempt's late assertion still lands as an *unhandled error between
tests*, so `bun test` exits 1 on a run where nothing failed. There is no
application-side workaround — the code and its tests are correct — and pinning
Bun forward does not help (measured on 1.4.0).
