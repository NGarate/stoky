import { connection } from "next/server";
import { RegisterForm } from "@/components/session/RegisterForm";
import { RegistrationClosed } from "@/components/session/RegistrationClosed";
import { registrationMode, registrationOpen } from "@/lib/auth/registration";
import { prisma } from "@/lib/prisma";
import type { JSX } from "react";

/**
 * `/register`: the form while registration is open, and a page that says it is
 * closed when it is not (`STOKY_REGISTRATION`, `src/lib/auth/registration.ts`).
 *
 * This was a client component that always rendered the form, so on a closed
 * instance a visitor found out only after filling it in and submitting — and
 * only with JavaScript. Deciding here puts the answer in the first response.
 *
 * A server component reading the database directly, like `src/app/page.tsx`:
 * one of the start screens CLAUDE.md allows outside tRPC, and no server-side
 * tRPC caller. It decides what to show and guards nothing; `auth.register`
 * refuses on its own, under a lock, whatever this rendered.
 *
 * `connection()` first, because both inputs belong to the request rather than
 * the build: the setting is the running container's environment, and in
 * `first-user` the answer changes the moment the first account exists. A
 * prerender would bake in whatever `next build` saw. For the same reason the
 * page blocks rather than offering a shell, as `/start` and `/` do.
 */
export const instant = false;

export default async function RegisterPage(): Promise<JSX.Element> {
  await connection();

  const open = await registrationOpen(registrationMode(), () =>
    prisma.user.count(),
  );

  return open ? <RegisterForm /> : <RegistrationClosed />;
}
