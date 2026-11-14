"use client";

import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Section } from "@/components/ui/section";
import { useSnackbar } from "@/components/ui/snackbar";
import { api } from "@/lib/trpc/client";
import { MAX_NAME_LENGTH } from "@/lib/validations/bounds";
import type { FormEvent, JSX } from "react";

/**
 * The household's own settings: today, its name.
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
 * Uncontrolled, read from the form on submit, and keyed by the saved name so
 * the field shows what the server now holds once `household.current` refetches.
 */
export function HouseholdSettings(): JSX.Element | null {
  const t = useTranslations("household");
  const tCommon = useTranslations("common");
  const snackbar = useSnackbar();
  const utils = api.useUtils();
  const current = api.household.current.useQuery();
  const update = api.household.update.useMutation({
    onSuccess: async (household) => {
      await utils.household.current.invalidate();
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
    update.mutate({ name: String(form.get("name")) });
  }

  return (
    <Section className="mt-8" title={t("settingsTitle")}>
      <form
        className="rounded border border-border bg-card p-4"
        key={household.name}
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
        <Button className="mt-4" disabled={update.isPending} type="submit">
          {tCommon("save")}
        </Button>
      </form>
    </Section>
  );
}
