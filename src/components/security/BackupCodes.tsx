"use client";

import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import type { JSX } from "react";

/**
 * The backup codes, the one time they can be seen (D149): just after two-step
 * verification is turned on, or after a new set is made.
 *
 * The server stores them only as hashes and has no way to show them again,
 * so this says so, and offers the two ways to keep them that need nothing
 * else: a copy to paste into a password manager, and a plain text file to
 * print or store. The file is made here, from the codes on the screen; it
 * never goes through the server.
 *
 * The codes are props, not state: they belong to the step that shows them,
 * and `onDone` is the way out of it — after which nothing holds them.
 */
export function BackupCodes({
  codes,
  onDone,
}: {
  codes: string[];
  onDone: () => void;
}): JSX.Element {
  const t = useTranslations("twoFactorSettings");
  const heading = useRef<HTMLHeadingElement>(null);
  const [copied, setCopied] = useState<"copied" | "failed" | null>(null);

  useEffect(() => {
    heading.current?.focus();
  }, []);

  const text = `${t("fileHeading")}\n\n${codes.join("\n")}\n`;

  function copy(): void {
    void navigator.clipboard.writeText(text).then(
      () => setCopied("copied"),
      () => setCopied("failed"),
    );
  }

  function download(): void {
    const url = URL.createObjectURL(
      new Blob([text], { type: "text/plain;charset=utf-8" }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = t("fileName");
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-4">
      <h3
        className="text-base font-semibold text-heading"
        ref={heading}
        tabIndex={-1}
      >
        {t("codesTitle")}
      </h3>
      <p className="text-foreground">{t("codesIntro")}</p>
      <ol
        aria-label={t("codesListLabel")}
        className="grid gap-2 rounded bg-muted p-3 font-mono text-foreground sm:grid-cols-2"
      >
        {codes.map((code) => (
          <li className="select-all break-all" key={code}>
            {code}
          </li>
        ))}
      </ol>
      <div className="flex flex-wrap gap-3">
        <Button onClick={copy} type="button" variant="outline">
          {t("copy")}
        </Button>
        <Button onClick={download} type="button" variant="outline">
          {t("download")}
        </Button>
      </div>
      <p
        aria-live="polite"
        className="text-sm text-muted-foreground"
        role="status"
      >
        {copied === "copied"
          ? t("copied")
          : copied === "failed"
            ? t("copyFailed")
            : null}
      </p>
      <Button onClick={onDone} type="button">
        {t("codesDone")}
      </Button>
    </div>
  );
}
