import { Prisma } from "@prisma/client";

/**
 * What a server log may say about an error, without the data it was carrying.
 *
 * Prisma renders a `PrismaClientValidationError` as **the whole call, argument
 * values included** — a `user.create` that fails validation prints the email,
 * the name and the Argon2id hash it was writing — and `errorFormat: "minimal"`
 * does not change that (measured on 6.19.3). Bun's `error.stack` starts with
 * the same message, so logging the stack alone leaks it too, and Bun's
 * `console.error` also prints an error's own properties, which is how a
 * request error's `meta` — a raw query's Postgres message, a rejected value
 * for `P2006` — reaches the line.
 *
 * So a Prisma error is reduced to what identifies the fault without its
 * contents:
 *
 * - its class, its code (`P2025`, or an initialisation error's `P1001`) and
 *   the client version;
 * - the header Prisma puts before the arguments — which call failed and, when
 *   Prisma found it, the file and line that made it;
 * - for a validation error, the last line, which names the argument and what
 *   was expected ("Invalid value for argument `sessionsValidFrom`: Provided
 *   Date object is invalid. Expected Date.") and, in every case measured,
 *   never the value;
 * - for an initialisation error, the whole message: it is the "database is
 *   down" line an operator needs, and it names the host and port but not the
 *   credentials in `DATABASE_URL` (measured);
 * - the *names* of the `meta` keys, and a raw query's SQLSTATE, which is five
 *   characters of class code and nothing else;
 * - the stack frames, without the message the stack starts with.
 *
 * A request error's own text is dropped: its code says what happened, and for
 * a raw query the text is Postgres's, which quotes the input it refused.
 *
 * Anything else is returned as it is. A plain `Error`'s message is whatever
 * the code that threw it wrote, and that is the operator's best clue.
 */
export function describeError(error: unknown): unknown {
  if (!isPrismaError(error)) return error;

  const code = prismaCode(error);
  const lines = error.message.split("\n").map((line) => line.trimEnd());
  const head = header(lines);
  const below = lines.slice(head.end).filter((line) => line.trim() !== "");

  const parts = [
    `${error.name}${code ? ` ${code}` : ""} (Prisma ${error.clientVersion})`,
  ];
  if (head.text) parts.push(head.text);

  if (error instanceof Prisma.PrismaClientValidationError) {
    const reason = below.at(-1);
    if (reason) parts.push(reason.trim());
  } else if (error instanceof Prisma.PrismaClientInitializationError) {
    if (below.length > 0) parts.push(below.map((line) => line.trim()).join(" "));
  }

  if (error instanceof Prisma.PrismaClientKnownRequestError && error.meta) {
    const keys = Object.keys(error.meta);
    if (keys.length > 0) parts.push(`meta keys: ${keys.join(", ")}`);
    const sqlState = error.meta.code;
    if (typeof sqlState === "string" && /^[0-9A-Z]{5}$/.test(sqlState)) {
      parts.push(`SQLSTATE ${sqlState}`);
    }
  }

  return [parts.join(" — "), ...frames(error)].join("\n");
}

/**
 * `describeError` for a log line that holds one line of text and no object:
 * the auth logs, which bound and flatten what they write (`logLine` in
 * `src/lib/auth/instance.ts`, `quietly` in `src/server/http/auth-handler.ts`).
 *
 * A Prisma error gives its first line — class, code, the call that failed and,
 * for a validation error, which argument was wrong — and not the frames, which
 * flattened onto that line would only be cut off by its bound. Anything else
 * gives `name: message`, what those lines wrote before; whitespace runs,
 * newlines included, become one space.
 */
export function describeErrorLine(error: unknown): string {
  const described = describeError(error);
  const text =
    typeof described === "string" && described !== error
      ? described.split("\n")[0]
      : error instanceof Error
        ? `${error.name}: ${error.message}`
        : String(error);
  return text.replace(/\s+/g, " ").trim();
}

/**
 * The stack's "    at …" lines, without any line of the message.
 *
 * Matching "    at " alone is not enough: Bun's stack starts with the
 * message, and a raw query's input that holds a newline followed by "    at "
 * comes back inside Postgres's text and would pass for a frame (measured: a
 * P2010 from `SELECT ${"x\n    at MARKER"}::uuid` on 6.19.3). Dropping every
 * line that is also a line of the message holds whether or not the stack
 * starts with it verbatim.
 */
function frames(error: Error): string[] {
  const message = new Set(error.message.split("\n"));
  return (error.stack ?? "")
    .split("\n")
    .filter((line) => /^\s+at /.test(line) && !message.has(line));
}

type PrismaError =
  | Prisma.PrismaClientValidationError
  | Prisma.PrismaClientKnownRequestError
  | Prisma.PrismaClientUnknownRequestError
  | Prisma.PrismaClientInitializationError
  | Prisma.PrismaClientRustPanicError;

function isPrismaError(error: unknown): error is PrismaError {
  return (
    error instanceof Prisma.PrismaClientValidationError ||
    error instanceof Prisma.PrismaClientKnownRequestError ||
    error instanceof Prisma.PrismaClientUnknownRequestError ||
    error instanceof Prisma.PrismaClientInitializationError ||
    error instanceof Prisma.PrismaClientRustPanicError
  );
}

function prismaCode(error: PrismaError): string | undefined {
  if (error instanceof Prisma.PrismaClientKnownRequestError) return error.code;
  if (error instanceof Prisma.PrismaClientInitializationError) {
    return error.errorCode;
  }
  return undefined;
}

/**
 * "Invalid `prisma.user.create()` invocation:" — or, when Prisma located the
 * call, "Invalid `db.user.create()` invocation in /app/src/….ts:91:24". The
 * first non-empty line, and the location line after it when the first ends in
 * "in", with the index of the line after it. Below it come the code frame,
 * the arguments and, last, Prisma's explanation.
 */
function header(lines: string[]): { text?: string; end: number } {
  const at = lines.findIndex((line) => line.trim() !== "");
  if (at === -1) return { end: lines.length };
  const first = lines[at].trim().replace(/:$/, "");
  const location = lines[at + 1]?.trim();
  if (first.endsWith(" in") && location) {
    return { text: `${first} ${location}`, end: at + 2 };
  }
  return { text: first, end: at + 1 };
}
