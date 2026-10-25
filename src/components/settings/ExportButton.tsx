"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { useSnackbar } from "@/components/ui/snackbar";
import { api } from "@/components/providers/TRPCProvider";
import type { JSX } from "react";

/**
 * Downloading the household's data as a file.
 *
 * **The download is built in the browser, not served by the server.** A
 * `Content-Disposition` route would mean a second authenticated endpoint
 * outside tRPC, with its own session handling and its own way of getting the
 * household wrong. Fetching through the existing procedure and turning the
 * result into a Blob reuses the authorisation that is already there, and the
 * only thing this component adds is a filename.
 *
 * The object URL is revoked immediately after the click. Left alone it holds
 * the whole export in memory for the life of the document, which on a kitchen
 * tablet that never navigates away is the rest of the day.
 */
export function ExportButton(): JSX.Element {
  const t = useTranslations("settings.hub");
  const snackbar = useSnackbar();
  const [state, setState] = useState<"idle" | "working">("idle");

  // `useUtils().fetch` rather than `useQuery`: this must run when the button is
  // pressed, not when the page renders. A query would download the entire
  // household on every visit to settings.
  const utils = api.useUtils();

  async function download(): Promise<void> {
    setState("working");

    try {
      const data = await utils.data.exportHousehold.fetch();

      // Indented, because a person opening this file should be able to read it.
      // It is their data; a single line of JSON is a machine's answer to a
      // question they asked in their own interest.
      const blob = new Blob([JSON.stringify(data, null, 2)], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);

      const link = document.createElement("a");
      link.href = url;
      // Dated, because the first thing anybody does with an export is make
      // another one later and then need to tell them apart.
      link.download = `stoky-${new Date().toISOString().slice(0, 10)}.json`;
      link.click();

      URL.revokeObjectURL(url);
      setState("idle");
      snackbar.show({
        kind: "confirm",
        message: { key: "settings.hub.exportDone" },
      });
    } catch {
      setState("idle");
      snackbar.show({
        kind: "confirm",
        tone: "danger",
        message: { key: "settings.hub.exportFailed" },
      });
    }
  }

  return (
    <div>
      <h2 className="text-lg font-semibold text-heading">{t("exportTitle")}</h2>
      <p className="mt-1 text-muted-foreground">{t("exportDescription")}</p>
      <p className="mt-2 text-sm text-muted-foreground">
        {t("exportImagesNote")}
      </p>
      {/* A standing fact about the file, not news about this download. It
          used to be the second half of the confirmation sentence, which meant
          the caution left the screen a few seconds after the file arrived and
          was gone entirely when you came back to look for it. */}
      <p className="mt-2 text-sm text-muted-foreground">
        {t("exportPrivacyNote")}
      </p>

      <Button
        disabled={state === "working"}
        onClick={() => void download()}
        type="button"
      >
        {state === "working" ? t("exportWorking") : t("exportAction")}
      </Button>
    </div>
  );
}
