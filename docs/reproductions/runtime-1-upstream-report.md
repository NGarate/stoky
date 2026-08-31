# Upstream report draft — RUNTIME-1

**File this against Bun** (https://github.com/oven-sh/bun). Next may be a
secondary report; the evidence points at the runtime, since the identical
artefact under Node raises nothing.

Ready to paste; trim the internal cross-references (`ISSUES.md`, `docs/…`) the
maintainer cannot follow. The self-checking reproduction is
`docs/reproductions/runtime-1-abort.sh`.

---

## Title

Serving a Next.js standalone build under `bun` raises one unhandled `AbortError` per completed RSC prefetch request; Node does not

## What happens

A Next.js 16.3 `output: "standalone"` server, run with `bun server.js`, logs one

```
⨯ unhandledRejection: Error [AbortError]: The operation was aborted.
    at abort ([native code])   sourceURL: 'node:async_hooks'
```

for every **completed** request carrying the router-prefetch headers
(`RSC: 1` + `Next-Router-Prefetch: 3`). The same artefact served with
`node server.js` raises none. No response changes and no request fails — the
cost is purely the unhandled-rejection noise, which for a self-hosted app whose
only monitoring is its logs is the whole problem.

## Reproduction

One line against a running standalone server (a dashboard route that renders on
a prefetch):

```
curl -sL -H 'RSC: 1' -H 'Next-Router-Prefetch: 3' http://127.0.0.1:PORT/inventory
```

- under `bun .next/standalone/server.js` → **1** unhandled `AbortError`
- under `node .next/standalone/server.js` → **0**

A self-contained script that serves the same artefact under both runtimes and
asserts the shape (bun > 0, node = 0) is attached as `runtime-1-abort.sh`; a
representative run:

```
bun   : 10 AbortError(s) for 10 prefetch requests
node  :  0 AbortError(s) for 10 prefetch requests
```

## What it is not (measured negative results)

Each of these was a plausible cause that turned out wrong, isolated one request
at a time against the same server:

| Tried | AbortErrors |
|---|---|
| plain page request | 0 |
| `RSC: 1` alone | 0 |
| `RSC: 1` + `Next-Router-Prefetch: 3`, aborted mid-flight after 2ms | 0 |
| `RSC: 1` + `Next-Router-Prefetch: 3`, **completed** | 1 |
| ten completed, bodies drained | 10 |
| ten completed, bodies never read | 10 |
| `RSC: 1` + `Next-Router-Prefetch: 1` | 0 (answers 404 — kind `1` is not accepted) |

So it is **not** a client hanging up — cancelling a request is if anything
protective; it is the requests that *complete* that each leave a rejection. It
is not `experimental.partialPrefetching` either: the defect reproduces with that
option removed. What the option governs is only whether a real browser ever
sends `Next-Router-Prefetch: 3` (with it off the router sends kind `1`, which
the server 404s), so a maintainer needs no config to see it.

The application's own code aborts nothing server-side; its single
`AbortController` is a browser-side offline-queue timeout.

## Environment

- next 16.3.0, react 19.2.8, `output: "standalone"`
- bun 1.3.14 and 1.4.0 (reproduces on both)
- node 24 (0 on both, same artefact)
- Linux

## Why it matters

For a self-hosted deployment the server log is the only observability. ~10–12 of
these per page load (one per navigation link the router prefetches) drowns the
signal. The crypto-side unhandled rejections in the same family were fixable in
application code (a Next `auth()` call declaring itself request data); this one
is not — it is runtime interop, and the identical bytes under Node prove it.
