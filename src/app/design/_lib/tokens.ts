/**
 * Design-lab tokens.
 *
 * One source of truth: every proposal declares its palette here, the page
 * renders it as CSS custom properties, and `scripts/check-contrast.ts` asserts
 * the same values against WCAG AAA. Nothing can drift between the design and
 * the audit because there is only one copy of the numbers.
 *
 * AAA means 7:1 for body text and 4.5:1 for large text (>=24px, or >=18.66px
 * bold). `pairs` lists every foreground/background combination that actually
 * occurs in the layout, so the checker measures the real design rather than a
 * theoretical palette.
 */

export type Scale = "body" | "large";

export interface Pair {
  fg: string;
  bg: string;
  scale: Scale;
  /** Where this combination appears, for the audit report. */
  where: string;
}

export interface Theme {
  tokens: Record<string, string>;
  pairs: Pair[];
}

export interface Design {
  slug: string;
  name: string;
  /** The organising idea — what changes about the page, not how it is painted. */
  thesis: string;
  /** The one element the page is meant to be remembered by. */
  signature: string;
  fonts: string;
  light: Theme;
  dark: Theme;
}

/** Pairs shared by every design, expressed against that design's token names. */
function commonPairs(): Pair[] {
  return [
    { fg: "text", bg: "bg", scale: "body", where: "body copy on page background" },
    { fg: "text", bg: "surface", scale: "body", where: "body copy on cards" },
    { fg: "muted", bg: "bg", scale: "body", where: "secondary copy on page background" },
    { fg: "muted", bg: "surface", scale: "body", where: "secondary copy on cards" },
    { fg: "heading", bg: "bg", scale: "large", where: "page heading" },
    { fg: "accentInk", bg: "accent", scale: "body", where: "text on primary action" },
    { fg: "accentOnBg", bg: "bg", scale: "body", where: "links on page background" },
    { fg: "accentOnBg", bg: "surface", scale: "body", where: "links on cards" },
    { fg: "okInk", bg: "okBg", scale: "body", where: "healthy status pill" },
    { fg: "warnInk", bg: "warnBg", scale: "body", where: "low-stock status pill" },
    { fg: "dangerInk", bg: "dangerBg", scale: "body", where: "expiring/out status pill" },
  ];
}

export const DESIGNS: Design[] = [
  {
    slug: "estante",
    name: "Estante",
    thesis:
      "Stock is grouped by where it physically lives — Nevera, Despensa, Trastero — because that is how someone actually looks for it. Each location is a shelf band; each item shows a fill gauge against its minimum.",
    signature:
      "The fill gauge: a horizontal bar with a notch marking the minimum stock, so 'below the line' is legible at a glance and never depends on colour alone.",
    fonts: "Bricolage Grotesque (display) · Source Sans 3 (body)",
    light: {
      tokens: {
        bg: "#F4F6F4",
        surface: "#FFFFFF",
        surfaceAlt: "#EAEEEB",
        border: "#5C6B63",
        hairline: "#C9D3CD",
        text: "#12201A",
        heading: "#0B1712",
        muted: "#3D4E46",
        accent: "#0E4F42",
        accentInk: "#FFFFFF",
        accentOnBg: "#0C463B",
        okBg: "#DCEDE4",
        okInk: "#0B4A32",
        warnBg: "#FBEBD2",
        warnInk: "#6A4300",
        dangerBg: "#FBE3E3",
        dangerInk: "#8A1220",
        gauge: "#0E4F42",
        gaugeTrack: "#D3DBD6",
      },
      pairs: commonPairs(),
    },
    dark: {
      tokens: {
        bg: "#0D1411",
        surface: "#151E1A",
        surfaceAlt: "#1D2823",
        border: "#8CA096",
        hairline: "#2C3A33",
        text: "#E7EFE9",
        heading: "#F4F9F5",
        muted: "#AFC0B6",
        accent: "#8DDCC5",
        accentInk: "#04211A",
        accentOnBg: "#8DDCC5",
        okBg: "#12312A",
        okInk: "#8FE0C0",
        warnBg: "#33260C",
        warnInk: "#F1C97A",
        dangerBg: "#3A1B1E",
        dangerInk: "#F5A8A8",
        gauge: "#8DDCC5",
        gaugeTrack: "#2A3831",
      },
      pairs: commonPairs(),
    },
  },

  {
    slug: "horizonte",
    name: "Horizonte",
    thesis:
      "Ordered by time, not alphabet. Items sit on a freshness rail — hoy, esta semana, este mes, estable — so the page answers 'what do I cook before it goes off?' Quantity is secondary to urgency.",
    signature:
      "The horizon rail: a single continuous vertical axis with day markers, where an item's position encodes how long it has left. Distance is the data.",
    fonts: "Manrope (display + body) · JetBrains Mono (dates and quantities)",
    light: {
      tokens: {
        bg: "#FCFCFB",
        surface: "#FFFFFF",
        surfaceAlt: "#F0F1EE",
        border: "#5B5F58",
        hairline: "#D9DCD5",
        text: "#171A15",
        heading: "#0C0E0A",
        muted: "#454A41",
        accent: "#3D4C1F",
        accentInk: "#FFFFFF",
        accentOnBg: "#37451B",
        okBg: "#E6EDDD",
        okInk: "#33471C",
        warnBg: "#F9EACD",
        warnInk: "#674200",
        dangerBg: "#F9E3E1",
        dangerInk: "#8A1E14",
        gauge: "#3D4C1F",
        gaugeTrack: "#DEE0DA",
      },
      pairs: commonPairs(),
    },
    dark: {
      tokens: {
        bg: "#0E0F0C",
        surface: "#161814",
        surfaceAlt: "#1F221C",
        border: "#909588",
        hairline: "#2C302A",
        text: "#EAEDE5",
        heading: "#F6F8F2",
        muted: "#B2B8A9",
        accent: "#C2D89A",
        accentInk: "#161B0B",
        accentOnBg: "#C2D89A",
        okBg: "#1D2717",
        okInk: "#BAD69B",
        warnBg: "#32260D",
        warnInk: "#EFC87E",
        dangerBg: "#381B18",
        dangerInk: "#F3A79B",
        gauge: "#C2D89A",
        gaugeTrack: "#282C24",
      },
      pairs: commonPairs(),
    },
  },

];

export function designBySlug(slug: string): Design | undefined {
  return DESIGNS.find((d) => d.slug === slug);
}

/** Render a theme's tokens as a CSS custom-property block. */
export function themeCss(design: Design): string {
  const vars = (theme: Theme) =>
    Object.entries(theme.tokens)
      .map(([k, v]) => `--${k}: ${v};`)
      .join("");

  // Light is the default. Dark applies when the document opts in explicitly,
  // or by system preference when the user has left the choice on auto.
  // `data-theme` lives on <html> so a pre-paint script can set it without a
  // flash of the wrong theme.
  const scope = `[data-design="${design.slug}"]`;
  return [
    `${scope}{${vars(design.light)}}`,
    `:root[data-theme="dark"] ${scope}{${vars(design.dark)}}`,
    `@media (prefers-color-scheme: dark){`,
    `:root:not([data-theme="light"]) ${scope}{${vars(design.dark)}}`,
    `}`,
  ].join("");
}
