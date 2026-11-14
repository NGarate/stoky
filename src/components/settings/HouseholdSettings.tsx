"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Section } from "@/components/ui/section";
import { useSnackbar } from "@/components/ui/snackbar";
import { api } from "@/lib/trpc/client";
import { MAX_NAME_LENGTH } from "@/lib/validations/bounds";
import type { FormEvent, JSX } from "react";

/**
 * The household's own settings: its name, and the names of its browser tab
 * and of the installed app, both public (SECURITY.md), as each hint says.
 *
 * Drawn for OWNER and ADMIN only, the roles `household.update` admits, and
 * for nobody else at all — a member has nothing to read here that is not
 * also nothing to change. Courtesy, like the stores screen's `canManage`:
 * the server is the control.
 *
 * Not queued offline: like every write on the settings screens it is a plain
 * mutation, and a failure says so in a snackbar rather than waiting for a
 * signal (`DECISIONS.md` OFFLINE queues ticking off, consuming and adding).
 *
 * Uncontrolled, read from the form on submit, and keyed by the saved names so
 * the fields show what the server now holds once `household.current`
 * refetches. A saved tab name reaches the title through `router.refresh()`:
 * the root layout reads it, and a server render is what re-reads it.
 */
export function HouseholdSettings(): JSX.Element | null {
  const t = useTranslations("household");
  const tCommon = useTranslations("common");
  const snackbar = useSnackbar();
  const router = useRouter();
  const utils = api.useUtils();
  const current = api.household.current.useQuery();
  const update = api.household.update.useMutation({
    onSuccess: async (household) => {
      await utils.household.current.invalidate();
      router.refresh();
      snackbar.show({
        kind: "confirm",
        message: { key: "household.renamed", values: { name: household.name } },
      });
    },
    onError: () =>
      snackbar.show({
        kind: "confirm",
        tone: "danger",
        message: { key: "household.renameFailed" },
      }),
  });

  const household = current.data?.household;
  const role = current.data?.role;
  if (!household || (role !== "OWNER" && role !== "ADMIN")) return null;

  function save(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    update.mutate({
      name: String(form.get("name")),
      tabName: String(form.get("tabName")),
      appName: String(form.get("appName")),
    });
  }

  return (
    <Section className="mt-8" title={t("settingsTitle")}>
      <form
        className="rounded border border-border bg-card p-4"
        key={[household.name, household.tabName, household.appName].join("\n")}
        onSubmit={save}
      >
        <label
          className="mb-1 block text-sm font-medium"
          htmlFor="household-name"
        >
          {t("nameLabel")}
        </label>
        <Input
          defaultValue={household.name}
          id="household-name"
          maxLength={MAX_NAME_LENGTH}
          name="name"
          required
          type="text"
        />
        <NameField
          defaultValue={household.tabName}
          hint={t("tabNameHint")}
          label={t("tabNameLabel")}
          name="tabName"
        />
        <NameField
          defaultValue={household.appName}
          hint={t("appNameHint")}
          label={t("appNameLabel")}
          name="appName"
        />
        <Button className="mt-4" disabled={update.isPending} type="submit">
          {tCommon("save")}
        </Button>
      </form>
    </Section>
  );
}

/** An optional name, its label, and the hint saying what empty means and who sees it. */
function NameField({
  defaultValue,
  hint,
  label,
  name,
}: {
  defaultValue: string | null;
  hint: string;
  label: string;
  name: string;
}): JSX.Element {
  const id = `household-${name}`;
  return (
    <>
      <label className="mt-4 mb-1 block text-sm font-medium" htmlFor={id}>
        {label}
      </label>
      <Input
        aria-describedby={`${id}-hint`}
        defaultValue={defaultValue ?? ""}
        id={id}
        maxLength={MAX_NAME_LENGTH}
        name={name}
        type="text"
      />
      <p className="mt-1 text-sm text-muted-foreground" id={`${id}-hint`}>
        {hint}
      </p>
    </>
  );
}
