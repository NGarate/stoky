"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { PreferencesCluster } from "@/components/ui/PreferencesCluster";
import { useWebAuthnSupport } from "@/components/session/webauthn-support";
import {
  signInWithPasskey,
  signInWithPassword,
  verifyBackupCode,
  verifyTotp,
} from "@/lib/auth/client";
import { getAuthErrorKey } from "@/lib/auth/error-messages";
import type { FormEvent, JSX } from "react";
import type { AuthErrorKey } from "@/lib/auth/error-messages";

/**
 * The sign-in form: the whole of `/login` but for the shell guard beside it.
 *
 * It was the page itself, as `RegisterForm` was, until the page needed to be a
 * server component: the server is what knows whether this host can offer a
 * passkey (`passkeyOffered`), and a client component cannot ask it before it
 * renders.
 *
 * **"Mantener la sesión iniciada" starts unticked** (D141): a browser session
 * — fifteen idle minutes, a day at most — is the default anybody gets without
 * deciding. The hint says who should tick it: a home device used every day,
 * the kitchen screen above all, which would otherwise ask for the password
 * every time somebody walks up to it.
 *
 * **The second step** (D148, D149) is this form's own state, not a page: an
 * account with two-step verification answers a right password with a
 * challenge, and the same form then asks for the authenticator code — or, one
 * button away, a backup code. Nothing about it is a place to go back to or
 * share, and a URL for it would be a page that is wrong whenever the
 * challenge has expired. Step 1's fields, their order and their names are
 * untouched; the status region and the one submit button stay mounted across
 * the steps, so what the region says when a step changes is said by a region
 * that was already there (WCAG 4.1.3).
 *
 * - Entering a code step moves focus to its heading: the field that had it is
 *   gone, and focus left on `<body>` would leave a screen reader saying
 *   nothing about the question now being asked.
 * - A challenge that has gone — ten minutes, or five wrong codes — sends the
 *   form back to the password with the sentence that says why, and the
 *   address still filled in and the box as it was ticked, as "Volver" does.
 * - An authenticator secret the server can no longer read keeps the form on
 *   the step, and the sentence points at the backup-code button beside it.
 *
 * **"Iniciar sesión con una llave de acceso"** (D151) sits after the submit,
 * as the other way in rather than the first: every account has a password,
 * few have a passkey. It is offered only where one can work, which two
 * parties decide:
 *
 * - the server (`passkeyOffered`): the page was served at the first
 *   `STOKY_URLS` address, the only one a passkey belongs to
 *   (`passkeyOfferedAt`). Anywhere else nothing is said — a LAN address
 *   signs in with the password, and a sentence about passkeys on every
 *   sign-in there would be noise about a feature it cannot have;
 * - the browser (`useWebAuthnSupport`): a secure context with WebAuthn. At
 *   the right address in a browser that cannot, one muted sentence says so,
 *   because the person may well have a passkey and wonder where it went.
 *
 * A `type="button"` inside the form, so Enter in the password field still
 * submits the password. It reads the same "Mantener la sesión iniciada" box,
 * and never leads to the code step: the passkey is already the second thing.
 */
type Step = "password" | "totp" | "backup";

export function LoginForm({
  passkeyOffered = false,
}: {
  passkeyOffered?: boolean;
}): JSX.Element {
  const t = useTranslations("auth");
  const router = useRouter();
  const [errorKey, setErrorKey] = useState<AuthErrorKey | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isAskingPasskey, setIsAskingPasskey] = useState(false);
  const [isNavigating, startTransition] = useTransition();
  const [step, setStep] = useState<Step>("password");
  // Kept so that coming back from a code step does not ask for it again.
  const [email, setEmail] = useState("");
  // The box, kept for the same return: it is unmounted with the password
  // step, and coming back to it unticked would quietly make the next sign-in
  // a browser session the person had said no to.
  const [remember, setRemember] = useState(false);
  const stepHeading = useRef<HTMLHeadingElement>(null);
  const passwordField = useRef<HTMLInputElement>(null);
  const leftPassword = useRef(false);
  const form = useRef<HTMLFormElement>(null);
  const webAuthn = useWebAuthnSupport();

  const isBusy = isSubmitting || isAskingPasskey || isNavigating;

  useEffect(() => {
    if (step !== "password") {
      leftPassword.current = true;
      stepHeading.current?.focus();
    } else if (leftPassword.current) {
      // Back from a code step: the password is what is asked next.
      passwordField.current?.focus();
    }
  }, [step]);

  function goHome(): void {
    startTransition(() => {
      // `/`, not a screen: it is where this device's screen choice is
      // honoured (`src/app/page.tsx`, Journey 8). Naming `/dashboard` here
      // walked the kitchen tablet past the kitchen and never asked anyone.
      router.replace("/");
      router.refresh();
    });
  }

  function goTo(next: Step): void {
    setErrorKey(null);
    setStep(next);
  }

  /** The password step. True when it signed somebody in. */
  async function submitPassword(formData: FormData): Promise<boolean> {
    const typedEmail = String(formData.get("email") ?? "").trim();
    const password = String(formData.get("password") ?? "");
    // Uncontrolled: a ticked box submits "on", an unticked one nothing.
    const rememberMe = formData.get("rememberMe") === "on";
    setEmail(typedEmail);
    setRemember(rememberMe);

    const result = await signInWithPassword({
      email: typedEmail,
      password,
      rememberMe,
    });
    if (result.ok) return true;
    if (result.twoFactor) {
      setStep("totp");
      return false;
    }
    setErrorKey(getAuthErrorKey(undefined, "login", result.code));
    return false;
  }

  /** A code step. True when it signed somebody in. */
  async function submitCode(formData: FormData): Promise<boolean> {
    const code = String(formData.get("code") ?? "").trim();
    const result =
      step === "backup" ? await verifyBackupCode(code) : await verifyTotp(code);
    if (result.ok) return true;
    // Only the password step makes a new challenge.
    if (result.code === "two_factor_expired") setStep("password");
    setErrorKey(getAuthErrorKey(undefined, "login", result.code));
    return false;
  }

  async function handleSubmit(
    event: FormEvent<HTMLFormElement>,
  ): Promise<void> {
    event.preventDefault();
    setErrorKey(null);
    setIsSubmitting(true);

    const formData = new FormData(event.currentTarget);

    // The React Compiler cannot yet memoise a component containing this
    // `try`/`catch` around an await, so it declines to optimise the whole
    // component. A tool limitation rather than a defect: the handler is
    // correct, and the cost is a missed memoisation on a screen that renders a
    // form. Revisit when babel-plugin-react-compiler supports it.
    // react-doctor-disable-next-line react-hooks-js/todo
    try {
      const signedIn =
        step === "password"
          ? await submitPassword(formData)
          : await submitCode(formData);
      if (!signedIn) return;
      goHome();
    } catch (error: unknown) {
      setErrorKey(
        getAuthErrorKey(
          error instanceof Error ? error.message : undefined,
          "login",
        ),
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  /** The passkey button: the browser's prompt, then the server's check. */
  function signInWithAPasskey(): void {
    setErrorKey(null);
    setIsAskingPasskey(true);
    // The same box the password reads, as a person ticked it.
    const rememberMe =
      form.current !== null &&
      new FormData(form.current).get("rememberMe") === "on";
    signInWithPasskey({ rememberMe })
      .then((result) => {
        if (result.ok) goHome();
        else setErrorKey(getAuthErrorKey(undefined, "login", result.code));
      })
      .catch(() => setErrorKey("loginError"))
      .finally(() => setIsAskingPasskey(false));
  }

  return (
    <main className="flex min-h-screen flex-col bg-background px-4 py-10">
      {/* Theme and language before sign-in: someone whose system is light but
          who needs dark for a visual reason must not have to log in first
          (DESIGN_AUDIT A1.3, A2.2). */}
      <div className="mx-auto flex w-full max-w-5xl justify-end">
        <PreferencesCluster />
      </div>

      {/* `flex-1` rather than a min-height calculation: the cluster above has
          a height, and hardcoding 100vh minus the padding would push the card
          off the bottom by exactly that much. */}
      <div className="mx-auto flex w-full max-w-5xl flex-1 items-center justify-center pt-6">
        <div className="grid w-full overflow-hidden rounded-3xl border border-border bg-card shadow-xl lg:grid-cols-[1.05fr_0.95fr]">
          {/* The ink here is the ink the narrow-screen copy below already uses
              — heading, muted-foreground — so the two renderings of the same
              words finally agree and only the surface differs. The seam is a
              real hairline now that the fill no longer draws it (UI-10). */}
          <section className="hidden bg-hero p-10 text-foreground lg:flex lg:flex-col lg:justify-between lg:border-r lg:border-border">
            <div className="space-y-4">
              <p className="text-sm uppercase tracking-[0.3em] text-muted-foreground">
                Stoky
              </p>
              <h1 className="max-w-sm text-4xl font-semibold leading-tight text-heading">
                {t("login")}
              </h1>
              <p className="max-w-md text-sm leading-6 text-muted-foreground">
                {t("loginSubtitle")}
              </p>
            </div>
            {/* Solid, not a translucent wash of the foreground: an opacity
                modifier at the point of use is how contrast breaks without the
                token audit noticing (DESIGN_AUDIT §4). */}
            <div className="rounded-2xl border border-border bg-card p-5 text-sm text-foreground">
              <p className="font-medium text-heading">{t("loginAsideTitle")}</p>
              <p className="mt-2 leading-6 text-muted-foreground">
                {t("loginAsideBody")}
              </p>
            </div>
          </section>

          <section className="p-6 sm:p-10">
            <div className="mx-auto max-w-md space-y-8">
              <div className="space-y-3">
                <p className="text-sm font-medium uppercase tracking-[0.2em] text-muted-foreground lg:hidden">
                  Stoky
                </p>
                <h1 className="text-3xl font-semibold text-heading lg:hidden">
                  {t("login")}
                </h1>
                <p className="text-sm leading-6 text-muted-foreground lg:hidden">
                  {t("loginSubtitle")}
                </p>
              </div>

              {/* method="post" so that if JavaScript has not loaded, the
                  browser falls back to a POST instead of a GET, which would
                  put the password in the URL and therefore in history and
                  server logs. The JS path calls preventDefault and never
                  reaches it. */}
              <form
                className="space-y-5"
                method="post"
                onSubmit={handleSubmit}
                ref={form}
              >
                {step === "password" ? (
                  <>
                    <div className="space-y-2">
                      <label
                        className="text-sm font-medium text-foreground"
                        htmlFor="email"
                      >
                        {t("email")}
                      </label>
                      {/* WCAG 3.3.5 (AAA). The hint is attached with
                          `aria-describedby` rather than merely placed underneath,
                          because otherwise a screen reader announces "Correo
                          electrónico, editable" and stops — the help exists for
                          sighted mouse users and for nobody else. */}
                      <Input
                        aria-describedby="email-hint"
                        autoComplete="email"
                        defaultValue={email}
                        id="email"
                        name="email"
                        required
                        type="email"
                      />
                      <p
                        className="text-sm text-muted-foreground"
                        id="email-hint"
                      >
                        {t("emailHint")}
                      </p>
                    </div>

                    <div className="space-y-2">
                      <label
                        className="text-sm font-medium text-foreground"
                        htmlFor="password"
                      >
                        {t("password")}
                      </label>
                      <Input
                        aria-describedby="password-hint"
                        autoComplete="current-password"
                        id="password"
                        name="password"
                        ref={passwordField}
                        required
                        type="password"
                      />
                      <p
                        className="text-sm text-muted-foreground"
                        id="password-hint"
                      >
                        {t("passwordHintLogin")}
                      </p>
                    </div>

                    <Checkbox
                      defaultChecked={remember}
                      hint={t("rememberMeHint")}
                      id="rememberMe"
                      label={t("rememberMe")}
                      name="rememberMe"
                    />
                  </>
                ) : (
                  <div className="space-y-2">
                    <h2
                      className="text-xl font-semibold text-heading"
                      ref={stepHeading}
                      tabIndex={-1}
                    >
                      {step === "totp"
                        ? t("twoFactorTitle")
                        : t("backupCodeTitle")}
                    </h2>
                    <label
                      className="text-sm font-medium text-foreground"
                      htmlFor="code"
                    >
                      {step === "totp" ? t("totpLabel") : t("backupCodeLabel")}
                    </label>
                    {/* Keyed by the step, so switching between the two kinds
                        of code empties the field rather than carrying six
                        digits into a backup code. `one-time-code` lets a phone
                        offer the code from its own authenticator; a backup
                        code is read off paper, and its own autofill would
                        only offer a stale one. */}
                    {step === "totp" ? (
                      <Input
                        aria-describedby="code-hint"
                        autoComplete="one-time-code"
                        id="code"
                        inputMode="numeric"
                        key="totp"
                        maxLength={6}
                        name="code"
                        required
                        type="text"
                      />
                    ) : (
                      <Input
                        aria-describedby="code-hint"
                        autoCapitalize="characters"
                        autoComplete="off"
                        id="code"
                        key="backup"
                        maxLength={40}
                        name="code"
                        required
                        spellCheck={false}
                        type="text"
                      />
                    )}
                    <p className="text-sm text-muted-foreground" id="code-hint">
                      {step === "totp" ? t("totpHint") : t("backupCodeHint")}
                    </p>
                    <Button
                      onClick={() => goTo(step === "totp" ? "backup" : "totp")}
                      type="button"
                      variant="link"
                    >
                      {step === "totp" ? t("useBackupCode") : t("useTotp")}
                    </Button>
                  </div>
                )}

                {/* Present from the first render, empty until it has
                    something to say.
                    It was inserted together with its text, so the polite
                    region was created at the moment it spoke — the case
                    screen readers may skip, and the reason someone who
                    mistyped a password could be left with a form that looked
                    unchanged and said nothing (WCAG 4.1.3). It carried no
                    `role` either, so there was no fallback role to fall back
                    on. `SyncStatus` owns the one assertive region in this
                    application, so this stays polite. */}
                <p
                  aria-live="polite"
                  className={
                    errorKey
                      ? "rounded-xl border border-danger-foreground bg-danger px-4 py-3 text-sm text-danger-foreground"
                      : "sr-only"
                  }
                  role="status"
                >
                  {errorKey ? t(errorKey) : ""}
                </p>

                <Button className="w-full" disabled={isBusy} type="submit">
                  {step === "password"
                    ? isSubmitting || isNavigating
                      ? t("loggingIn")
                      : t("login")
                    : isBusy
                      ? t("twoFactorVerifying")
                      : t("twoFactorVerify")}
                </Button>

                {step === "password" && passkeyOffered ? (
                  webAuthn === "ready" ? (
                    <Button
                      className="w-full"
                      disabled={isBusy}
                      onClick={signInWithAPasskey}
                      type="button"
                      variant="outline"
                    >
                      {isAskingPasskey
                        ? t("passkeySigningIn")
                        : t("passkeySignIn")}
                    </Button>
                  ) : webAuthn === "pending" ? null : (
                    <p className="text-sm text-muted-foreground">
                      {t("passkeyUnavailableInsecure")}
                    </p>
                  )
                ) : null}

                {/* Back to the password, not out of the page: a person who
                    cannot reach their authenticator or their codes may want
                    another account. The challenge is left to expire; the next
                    password makes a new one. */}
                {step !== "password" && (
                  <Button
                    className="w-full"
                    disabled={isBusy}
                    onClick={() => goTo("password")}
                    type="button"
                    variant="outline"
                  >
                    {t("twoFactorBack")}
                  </Button>
                )}
              </form>

              <p className="text-sm text-muted-foreground">
                {t("noAccount")}{" "}
                <Link
                  className="font-medium text-primary underline underline-offset-4"
                  href="/register"
                >
                  {t("register")}
                </Link>
              </p>
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}
