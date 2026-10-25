"use client";

import { useTranslations } from "next-intl";
import { useEffect, useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { FormErrorSummary } from "@/components/ui/form-error-summary";
import { Input } from "@/components/ui/input";
import { TotpQr } from "@/components/security/TotpQr";
import { verifyTotp, type SecondStepRefusalCode } from "@/lib/auth/client";
import type { FormEvent, JSX } from "react";

/** The authenticator's key, as the `otpauth:` address carries it: base32, unpadded. */
function keyOf(totpUri: string): string {
  try {
    return new URL(totpUri).searchParams.get("secret") ?? "";
  } catch {
    return "";
  }
}

/** The key in groups of four, which is how a person reads and types it. */
function grouped(key: string): string {
  return key.replace(/(.{4})(?=.)/g, "$1 ");
}

/**
 * The middle of turning two-step verification on (D148): the new
 * authenticator, three ways, and its first code.
 *
 * - **A QR code** for an app on another device (`TotpQr`);
 * - **the key**, in groups of four and selectable, for somebody who cannot
 *   scan — a screen reader, a camera that will not focus;
 * - **an `otpauth:` link**, for an app on this same device, which the
 *   operating system hands the address to.
 *
 * All three are the one secret, handed back once by the password step and
 * never asked for again: the auth route keeps `get-totp-uri` closed. Leaving
 * here (`onCancel`) drops it, and two-step verification stays off; the next
 * attempt starts with a new secret.
 *
 * **The first code turns it on.** It goes to the same check a sign-in's code
 * does (`verifyTotp`), from this signed-in session, and is used up by it: the
 * next code this authenticator gives is a new one. Only an accepted code
 * calls `onVerified`; a refusal stays here, worded beside the field.
 */
export function TotpSetup({
  totpUri,
  onVerified,
  onCancel,
}: {
  totpUri: string;
  onVerified: () => Promise<void> | void;
  onCancel: () => void;
}): JSX.Element {
  const t = useTranslations("twoFactorSettings");
  const tAuth = useTranslations("auth");
  const tCommon = useTranslations("common");
  const id = useId();
  const heading = useRef<HTMLHeadingElement>(null);
  const field = useRef<HTMLInputElement>(null);
  const [refusal, setRefusal] = useState<string | null>(null);
  const [focusSignal, setFocusSignal] = useState(0);
  const [working, setWorking] = useState(false);
  const key = keyOf(totpUri);

  // On arrival the password dialog that led here has just closed: say where
  // the person now is.
  useEffect(() => {
    heading.current?.focus();
  }, []);

  function refuse(message: string): void {
    setRefusal(message);
    setFocusSignal((signal) => signal + 1);
  }

  function sentence(code: SecondStepRefusalCode): string {
    switch (code) {
      case "invalid_code":
        return tAuth("twoFactorInvalidCode");
      case "two_factor_locked":
        return tAuth("twoFactorLocked");
      case "rate_limited":
        return tAuth("tooManyAttempts");
      default:
        return t("verifyFailed");
    }
  }

  async function check(): Promise<void> {
    const code = (field.current?.value ?? "").replace(/\s+/g, "");
    if (!/^\d{6}$/.test(code)) {
      refuse(t("codeMissing"));
      return;
    }
    setRefusal(null);
    setWorking(true);
    const result = await verifyTotp(code)
      .catch(() => ({ ok: false as const, code: "unknown" as const }))
      .finally(() => setWorking(false));
    if (result.ok) {
      await onVerified();
      return;
    }
    refuse(sentence(result.code));
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    void check();
  }

  return (
    <div className="space-y-4">
      <h3
        className="text-base font-semibold text-heading"
        ref={heading}
        tabIndex={-1}
      >
        {t("scanTitle")}
      </h3>
      <p className="text-muted-foreground">{t("scanIntro")}</p>
      <TotpQr label={t("qrLabel")} value={totpUri} />

      <div className="space-y-1">
        {/* The sentence before it says what it is: ARIA prohibits naming a
            `code` element, so it is not given an accessible name of its own. */}
        <p className="text-foreground">{t("keyLabel")}</p>
        <code className="block select-all break-all rounded bg-muted px-3 py-2 font-mono text-foreground">
          {grouped(key)}
        </code>
      </div>

      <p className="text-muted-foreground">
        {t("openInAppHint")}{" "}
        <a
          className="text-primary underline underline-offset-4 hover:decoration-2"
          href={totpUri}
        >
          {t("openInApp")}
        </a>
      </p>

      <FormErrorSummary
        focusSignal={focusSignal}
        messages={refusal ? [refusal] : []}
        title={t("verifyRefusedTitle")}
      />
      {/* `method="post"` so a submit before hydration cannot put the code
          in the query string. */}
      <form
        className="space-y-2"
        method="post"
        noValidate
        onSubmit={handleSubmit}
      >
        <label
          className="text-sm font-medium text-foreground"
          htmlFor={`${id}-code`}
        >
          {t("codeLabel")}
        </label>
        <Input
          aria-describedby={`${id}-code-hint`}
          aria-invalid={refusal ? true : undefined}
          autoComplete="one-time-code"
          id={`${id}-code`}
          inputMode="numeric"
          maxLength={6}
          name="code"
          ref={field}
          required
          type="text"
        />
        <p className="text-sm text-muted-foreground" id={`${id}-code-hint`}>
          {t("codeHint")}
        </p>
        <div className="flex flex-wrap gap-3 pt-2">
          <Button disabled={working} type="submit">
            {working ? t("verifying") : t("verify")}
          </Button>
          <Button onClick={onCancel} type="button" variant="outline">
            {tCommon("cancel")}
          </Button>
        </div>
      </form>
    </div>
  );
}
