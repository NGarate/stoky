/**
 * Which browser on which system a session was signed in from, read off its
 * `User-Agent` — what the list of a person's sessions shows beside each one
 * (`auth.listSessions`, ASVS 5.0.0 7.5.2).
 *
 * **Names, never the string.** A User-Agent is long, partly made up and
 * written by the client, so the screen gets one of a short list of product
 * names or `null`, which it shows as "unknown". Nothing here is translated:
 * these are names, and the screen words the unknown case itself.
 *
 * **Coarse on purpose.** No versions, no device models. The question the list
 * answers is "is that one mine?", and "Firefox on Android" is enough to
 * answer it; a version number would only make two sessions of one browser
 * look like two browsers after an update. What tells the household's two
 * Android tablets apart is not here but the screen the device opens on
 * (`ScreenChoice`, joined by the session's `deviceId`): the kitchen tablet
 * reads as the kitchen screen.
 *
 * The order of the checks is the point: Edge and Opera say "Chrome", Chrome
 * says "Safari", and every Android browser says "Linux".
 */

export interface DeviceLabel {
  browser: string | null;
  os: string | null;
}

/** Longer than any real User-Agent; the rest is never read. */
const MAX_READ = 512;

const BROWSERS: readonly [RegExp, string][] = [
  // The native client, before anything it might also claim to be.
  [/\bStoky\//, "Stoky"],
  [/\bEdg(?:e|A|iOS)?\//, "Edge"],
  [/\b(?:OPR|Opera)\//, "Opera"],
  [/\bSamsungBrowser\//, "Samsung Internet"],
  [/\b(?:Firefox|FxiOS)\//, "Firefox"],
  [/\b(?:Chrome|CriOS|Chromium)\//, "Chrome"],
  [/\bVersion\/[\d.]+.*\bSafari\//, "Safari"],
];

const SYSTEMS: readonly [RegExp, string][] = [
  [/\biPad\b/, "iPadOS"],
  [/\b(?:iPhone|iPod)\b/, "iOS"],
  [/\bAndroid\b/, "Android"],
  [/\bCrOS\b/, "ChromeOS"],
  [/\bWindows\b/, "Windows"],
  [/\b(?:Macintosh|Mac OS X)\b/, "macOS"],
  [/\bLinux\b/, "Linux"],
];

function firstMatch(
  text: string,
  table: readonly [RegExp, string][],
): string | null {
  for (const [pattern, name] of table) {
    if (pattern.test(text)) return name;
  }
  return null;
}

export function deviceLabel(userAgent: string | null | undefined): DeviceLabel {
  if (!userAgent) return { browser: null, os: null };
  const text = userAgent.slice(0, MAX_READ);
  return { browser: firstMatch(text, BROWSERS), os: firstMatch(text, SYSTEMS) };
}
