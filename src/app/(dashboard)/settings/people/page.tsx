"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { useId, useState } from "react";
import { TRPCClientError } from "@trpc/client";
import { api } from "@/lib/trpc/client";
import { RouteState } from "@/components/household/RouteState";
import type { FormEvent, JSX } from "react";

/**
 * Who is in the household, and how a kitchen account comes to exist.
 *
 * The `KITCHEN` role has been enforced on the server since Phase 3 and
 * unprovisionable ever since — the value was in the enum and in the middleware,
 * and the only way to get one was a database write. This is the interface that
 * makes it real, and without it the kitchen screen cannot be tested honestly:
 * a week-long run on a tablet under an owner's account proves nothing about
 * what a kitchen account can reach.
 *
 * There is no email in this application, so the admin sets the first password
 * and hands the device over. That is the honest shape for a self-hosted
 * household rather than a placeholder for an invitation flow that does not
 * exist.
 */
export default function PeoplePage(): JSX.Element {
  const t = useTranslations("household");
  const fieldId = useId();
  const utils = api.useUtils();

  const members = api.household.members.useQuery();

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<"MEMBER" | "KITCHEN">("KITCHEN");
  const [created, setCreated] = useState<string | null>(null);
  const [failure, setFailure] = useState<"taken" | "other" | null>(null);

  const addMember = api.household.addMember.useMutation({
    onSuccess: (member) => {
      setCreated(member.name);
      setFailure(null);
      setName("");
      setEmail("");
      setPassword("");
      void utils.household.members.invalidate();
    },
    onError: (error) => {
      setCreated(null);
      // The database's own unique constraint, translated. Checking first and
      // then inserting would race with itself.
      const conflict =
        error instanceof TRPCClientError && error.data?.code === "CONFLICT";
      setFailure(conflict ? "taken" : "other");
    },
  });

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (!name.trim() || !email.trim() || password.length < 8) return;
    addMember.mutate({ name: name.trim(), email: email.trim(), password, role });
  }

  if (!members.data) {
    return (
      <RouteState
        error={members.error}
        fetchStatus={members.fetchStatus}
        isLoading={members.isPending}
        onRetry={() => void members.refetch()}
        title={t("peopleTitle")}
      />
    );
  }

  return (
    <div className="mx-auto max-w-2xl">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold text-heading md:text-4xl">
          {t("peopleTitle")}
        </h1>
        <Link
          className="inline-flex min-h-[48px] items-center text-primary hover:underline"
          href="/settings"
        >
          {t("backToSettings")}
        </Link>
      </div>

      <p className="text-muted-foreground">{t("peopleIntro")}</p>

      <ul className="mt-6 space-y-3">
        {members.data.map((member) => (
          <li
            key={member.id}
            className="rounded-lg border border-border bg-card p-4"
          >
            <p className="font-medium text-foreground">{member.name}</p>
            <p className="text-sm text-muted-foreground">{member.email}</p>
            {/* The role in words. Never a colour or a letter. */}
            <p className="mt-1 text-sm font-medium text-foreground">
              {t(`role${member.role}`)}
            </p>
          </li>
        ))}
      </ul>

      <section className="mt-8 rounded-lg border border-border bg-card p-4">
        <h2 className="text-lg font-semibold text-heading">{t("addTitle")}</h2>

        <form className="mt-4 space-y-4" onSubmit={handleSubmit}>
          <div>
            <label
              className="block text-sm font-medium text-foreground"
              htmlFor={`${fieldId}-name`}
            >
              {t("addName")}
            </label>
            <input
              autoComplete="off"
              className="mt-1 min-h-[48px] w-full rounded-md border border-input bg-card px-3 py-2 text-foreground"
              id={`${fieldId}-name`}
              onChange={(event) => setName(event.target.value)}
              required
              value={name}
            />
          </div>

          <div>
            <label
              className="block text-sm font-medium text-foreground"
              htmlFor={`${fieldId}-email`}
            >
              {t("addEmail")}
            </label>
            <input
              autoComplete="off"
              className="mt-1 min-h-[48px] w-full rounded-md border border-input bg-card px-3 py-2 text-foreground"
              id={`${fieldId}-email`}
              onChange={(event) => setEmail(event.target.value)}
              required
              type="email"
              value={email}
            />
          </div>

          <div>
            <label
              className="block text-sm font-medium text-foreground"
              htmlFor={`${fieldId}-password`}
            >
              {t("addPassword")}
            </label>
            <input
              aria-describedby={`${fieldId}-password-hint`}
              autoComplete="new-password"
              className="mt-1 min-h-[48px] w-full rounded-md border border-input bg-card px-3 py-2 text-foreground"
              id={`${fieldId}-password`}
              minLength={8}
              onChange={(event) => setPassword(event.target.value)}
              required
              type="password"
              value={password}
            />
            <p
              className="mt-1 text-sm text-muted-foreground"
              id={`${fieldId}-password-hint`}
            >
              {t("addPasswordHint")}
            </p>
          </div>

          <fieldset>
            <legend className="text-sm font-medium text-foreground">
              {t("addRole")}
            </legend>
            {/* Radios rather than a select: two options, both needing a
                sentence of explanation, and a select hides the one not chosen.

                The input is stretched over the whole row and made invisible,
                with the dot drawn separately — a bare radio is about 13px, and
                the target that has to meet the 48px floor is the *input*, not
                the label around it (DESIGN_AUDIT A4.2, same technique as
                `ThemeControl`). */}
            {(["KITCHEN", "MEMBER"] as const).map((option) => (
              <label
                key={option}
                className="relative mt-2 flex min-h-[48px] items-start gap-3 rounded-md border border-input p-3 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-ring"
                htmlFor={`${fieldId}-role-${option}`}
              >
                <input
                  checked={role === option}
                  className="absolute inset-0 m-0 h-full w-full cursor-pointer appearance-none rounded opacity-0"
                  id={`${fieldId}-role-${option}`}
                  name={`${fieldId}-role`}
                  onChange={() => setRole(option)}
                  type="radio"
                  value={option}
                />
                <span
                  aria-hidden="true"
                  className={`mt-1 h-5 w-5 shrink-0 rounded-full border-2 ${
                    role === option
                      ? "border-primary bg-primary"
                      : "border-input bg-card"
                  }`}
                />
                <span>
                  <span className="block font-medium text-foreground">
                    {t(`role${option}`)}
                  </span>
                  <span className="block text-sm text-muted-foreground">
                    {option === "KITCHEN"
                      ? t("roleKitchenHint")
                      : t("roleMemberHint")}
                  </span>
                </span>
              </label>
            ))}
          </fieldset>

          {created ? (
            <p
              aria-live="polite"
              className="rounded-md border border-ok-foreground bg-ok px-3 py-2 text-sm text-ok-foreground"
            >
              {t("addDone", { name: created })}
            </p>
          ) : null}

          {failure ? (
            <p
              aria-live="polite"
              className="rounded-md border border-danger-foreground bg-danger px-3 py-2 text-sm text-danger-foreground"
            >
              {failure === "taken" ? t("addEmailTaken") : t("addFailed")}
            </p>
          ) : null}

          <button
            className="min-h-[48px] rounded-md bg-primary px-4 py-2 text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            disabled={addMember.isPending}
            type="submit"
          >
            {addMember.isPending ? t("addWorking") : t("addSubmit")}
          </button>
        </form>
      </section>
    </div>
  );
}
