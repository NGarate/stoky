import { NotFoundError } from "./errors";

interface ParsedItem {
  rawText: string;
  parsedName: string;
  parsedPrice: number;
  parsedQuantity?: number;
}

interface ParsedReceipt {
  storeName?: string;
  purchaseDate?: Date;
  totalAmount?: number;
  items: ParsedItem[];
  /** What the discount lines took off, in euros: never items, but part of the sum. */
  discountAmount?: number;
}

const KNOWN_STORES = [
  "mercadona",
  "carrefour",
  "dia",
  "lidl",
  "aldi",
  "costco",
  "el corte ingles",
  "hipercor",
  "supercor",
  "alcampo",
  "eroski",
  "caprabo",
  "consum",
  "ahorramas",
  "gadis",
  "froiz",
  "bonpreu",
  "condis",
  "masymas",
  "coviran",
  "hiperdino",
  "bonarea",
  "makro",
  "spar",
  "lupa",
  "leclerc",
];

/**
 * Every name a known chain is printed under, and the chain it is: the
 * company behind the shop's name heads some tickets — Semark runs Lupa,
 * Dinosol HiperDino — and Eurospar is a Spar.
 */
const STORE_ALIASES: Record<string, string> = {
  ...Object.fromEntries(KNOWN_STORES.map((store) => [store, store])),
  semark: "lupa",
  dinosol: "hiperdino",
  eurospar: "spar",
};

/**
 * What names the chain anywhere on the ticket when its logo did not survive
 * the OCR: its tax number (NIF) or its web address. A logo is a picture, and
 * the header line it sits on is the line a crumpled ticket loses first; the
 * NIF and the address are printed in the till's own font.
 */
const STORE_MARKS: [RegExp, string][] = [
  [/a-?46103834/, "mercadona"],
  [/a-?60195278|lidl\.es/, "lidl"],
  [/b-?86509460|costco\.es/, "costco"],
  [/mercadona\.es/, "mercadona"],
  [/carrefour\.es/, "carrefour"],
  [/\bdia\.es/, "dia"],
  [/aldi\.es/, "aldi"],
  [/eroski\.es/, "eroski"],
  [/alcampo\.es/, "alcampo"],
  [/consum\.es/, "consum"],
  // DIA's legal name and loyalty card: `LA PLAZA DE DIA`, `GRUPO DIA`,
  // `ClubDIA`, however much of the name survives.
  [/la\W*plaza\W*de\W*d(?:i[ae])?\b|grupo\W*di[ae]\b|clubdia/, "dia"],
  // Only Lidl prints its whole-ticket discount this way — also when the OCR
  // splits the word, `Desc. total en c mpra 1,62` — and its returns notice,
  // `Devoluciones artículos de bazar`.
  // (`\s?` optional between two `\w*` let a long word split every way.)
  [/desc\.?\s*total\s+en\s+c\w*(?:\s\w*)?mpra|\bart\w*\s+de\s+bazar/, "lidl"],
  // The column headers over the articles, which survive a header the crop
  // cut or the OCR lost: DIA's `CANTIDAD PVP/UNIT` (read `PVR/UNIT`, `PYR/UNIT`),
  // Mercadona's `Descripción P. Unit Imp.(€)`, Eroski's `EUROS/UD
  // EUROS/TOT` (read `EUROS/ GU`) — never `EUROS/KG`, which any till prints
  // under a weighed article.
  [/\bp[vy][pr]\s*\/\s*unit/, "dia"],
  [/\bp\W{0,2}\s*unit\b/, "mercadona"],
  [/\beuros\s*\/\s*(?:ud|tot|gu)/, "eroski"],
  // Carrefour's tax numbers, printed in the till's font at the foot.
  [/a-?28090108|a-?28425270/, "carrefour"],
];

/**
 * The digits of a chain's tax number, matched on a `C.I.F.` / `N.I.F.` line
 * without the letter — the OCR loses or misreads it (`C.I.F. 139050349` for
 * Semark's B39050349).
 */
const TAX_IDS: [string, string][] = [
  ["61742565", "hiperdino"],
  ["39050349", "lupa"],
  ["08115032", "caprabo"],
  ["20033361", "eroski"],
  ["48231351", "eroski"],
];
const TAX_ID_LINE = /\b[cn]\W?\s?i\W?\s?f\b/;

/**
 * Dotted, as Lidl prints it on a ticket paid in cash — only before a time,
 * since `1.25` is a price and `0308.61` a reference. The last resort: on
 * the same Lidl ticket the slashed `19/01/2026` is the reliable copy of
 * `19.01.26`, which the OCR read as `19.01.20`.
 */
const DOTTED_DATE = /\b(\d{1,2})\.(\d{1,2})\.(\d{4}|\d{2})(?=\s+\d{2}:\d{2})/;

const DATE_PATTERNS = [
  /\b(\d{4})[/](\d{1,2})[/](\d{1,2})\b/,
  // Two digits or four, never three: `05/10/202` (a year the OCR cut short)
  // was read as the year 2202.
  /\b(\d{1,2})[/-](\d{1,2})[/-](\d{4}|\d{2})\b/,
  /\b(\d{2})(\d{2})(\d{4})\b/,
  DOTTED_DATE,
];

/**
 * Lines whose date is not the purchase: a loyalty balance (`Saldo acumulado
 * a 25/09/2012`), a coupon's expiry, a best-before.
 */
const NOT_THE_PURCHASE_DATE = /saldo|acumulad|caduc|valid|hasta|vence|consumir/;

/** The time of day the till prints beside the purchase date. */
const TIME_OF_DAY = /\b\d{1,2}:\d{2}\b/;
const CLOCK_TIME = /(?<![\d:])(?:[01]\d|2[0-3]):[0-5]\d(?![\d:])/;

/**
 * The purchase date: the first valid date on a line that also prints the
 * time, as tills print the purchase; failing that, the first valid date;
 * failing that, a dotted one.
 */
function extractDate(lines: string[], now: Date): Date | undefined {
  let first: Date | undefined;
  let dotted: Date | undefined;
  for (const raw of lines) {
    if (NOT_THE_PURCHASE_DATE.test(normalizeText(raw))) continue;
    const line = digitsInDate(raw);
    const date = dateOn(line, now);
    if (!date) continue;
    if (
      DATE_PATTERNS.some(
        (pattern) => pattern !== DOTTED_DATE && pattern.test(line),
      )
    ) {
      if (TIME_OF_DAY.test(line)) return date;
      first ??= date;
    } else {
      dotted ??= date;
    }
  }
  return first ?? dotted ?? yearOneDigitOff(lines, now);
}

/**
 * The last resort: a date printed with the time whose four-digit year is
 * ahead of now and one digit from a year of the last ten — `19/11/2095
 * 18:21` is 2025. The latest such year, since a ticket is scanned soon after
 * the purchase. Not a two-digit year, where the digit could be anywhere
 * (`02.12.75`), nor a date in this year, which is a whole date ahead.
 */
function yearOneDigitOff(lines: string[], now: Date): Date | undefined {
  const thisYear = now.getFullYear();
  for (const raw of lines) {
    const line = digitsInDate(raw);
    if (
      !TIME_OF_DAY.test(line) ||
      NOT_THE_PURCHASE_DATE.test(normalizeText(raw))
    ) {
      continue;
    }
    const match = line.match(/\b(\d{1,2})([/.-])(\d{1,2})\2(\d{4})\b/);
    if (!match || Number(match[4]) <= thisYear) continue;
    for (let year = thisYear; year > thisYear - 10; year--) {
      if (!oneDigitApart(year, Number(match[4]))) continue;
      const date = dateOn(`${match[1]}/${match[3]}/${year}`, now);
      if (date) return date;
    }
  }
  return undefined;
}

/** Glyphs the OCR reads in place of a digit inside a date. */
const DATE_GLYPHS: Record<string, string> = {
  O: "0",
  o: "0",
  C: "0",
  D: "0",
  Q: "0",
  I: "1",
  l: "1",
  Z: "2",
};

/**
 * `FEZH HDR C6/11/25 17:27`, Lidl's dotted `0Z.12.25`: a date-shaped token
 * with a letter for a digit — and a digit in it, so `C.I.F` stays a word.
 */
function digitsInDate(line: string): string {
  return line.replace(
    /(?<![\p{L}\d])[\dOoCDQIlZ]{1,2}([/.-])[\dOoCDQIlZ]{1,2}\1[\dOoCDQIlZ]{2,4}(?![\p{L}\d])/gu,
    (token) =>
      /\d/.test(token)
        ? token.replace(/[OoCDQIlZ]/g, (glyph) => DATE_GLYPHS[glyph] ?? glyph)
        : token,
  );
}

/** The first valid date `line` prints, by the order of `DATE_PATTERNS`. */
function dateOn(line: string, now: Date): Date | undefined {
  for (const [patternIndex, pattern] of DATE_PATTERNS.entries()) {
    const match = line.match(pattern);
    if (!match) continue;
    let day: number;
    let month: number;
    let year: number;

    if (patternIndex === 0) {
      // YYYY/MM/DD format
      year = Number.parseInt(match[1], 10);
      month = Number.parseInt(match[2], 10) - 1;
      day = Number.parseInt(match[3], 10);
    } else if (patternIndex === 2) {
      // DDMMYYYY format
      day = Number.parseInt(match[1], 10);
      month = Number.parseInt(match[2], 10) - 1;
      year = Number.parseInt(match[3], 10);
    } else if (match[3].length === 4) {
      // DD/MM/YYYY or similar
      day = Number.parseInt(match[1], 10);
      month = Number.parseInt(match[2], 10) - 1;
      year = Number.parseInt(match[3], 10);
    } else {
      // Assume YY format
      day = Number.parseInt(match[1], 10);
      month = Number.parseInt(match[2], 10) - 1;
      year = 2000 + Number.parseInt(match[3], 10);
    }

    const date = new Date(year, month, day);
    const isValidDate =
      !Number.isNaN(date.getTime()) &&
      date.getFullYear() === year &&
      date.getMonth() === month &&
      date.getDate() === day &&
      // A receipt is printed when the purchase happens, so a date ahead
      // of now is a misread — a barcode or a reference number that
      // happened to fit the pattern — and the next candidate is tried.
      date.getTime() <= now.getTime() + FUTURE_DATE_TOLERANCE_MS;

    if (isValidDate) return date;
  }
  return undefined;
}

/**
 * One printed amount, as a Spanish till prints it: `0,89`, `1.234,56`, and the
 * dot-decimal `1.25` some tills and most OCR slips produce.
 *
 * Written once, because there used to be four `\d+[,.]\d{2}` patterns and
 * none of them knew about the thousands separator: `1.234,56` read as `1.23`
 * followed by `4,56`, so a 1.234,56 € line was booked at 4,56 € and a total of
 * the same at 1,23 €. Bounded on both sides so a number is taken whole or not
 * at all — `0,345` (a weight) is not the price `0,34`, and the `234,56` inside
 * `1.234,56` is never a match of its own.
 */
const AMOUNT_SOURCE = String.raw`(?<![\d.,])(?:\d{1,3}(?:\.\d{3})+,\d{2}|\d+[.,]\d{2})(?![\d])`;

function amountPattern(): RegExp {
  return new RegExp(AMOUNT_SOURCE, "g");
}

/**
 * The value of one amount `AMOUNT_SOURCE` matched — the only place a printed
 * amount becomes a number, so the separator rules cannot drift between the
 * total, the lines and the no-newline fallback again.
 */
export function parseEsAmount(text: string): number {
  const trimmed = text.trim();
  // `1.234,56`: the dots group thousands and the comma is the decimal point.
  const normalised = /^\d{1,3}(?:\.\d{3})+,\d{2}$/.test(trimmed)
    ? trimmed.replace(/\./g, "").replace(",", ".")
    : trimmed.replace(",", ".");
  return Number.parseFloat(normalised);
}

/**
 * The words a till labels a total with, written once: they were spelled out
 * three times — the total, the end of the articles and the strip below — and
 * the three had drifted apart (`TOTAL PROMOCIONES` ended the articles and was
 * still read as the charge).
 */
const TOTAL_WORDS = String.raw`total|importe|suma`;

/**
 * Not after a discount or a subtotal: a subtotal is the amount *before* the
 * discounts the total is after, and Lidl closes with `Desc. total en compra
 * 0,20`, which is a discount, not a 0,20 € ticket.
 */
const NOT_AFTER = String.raw`(?<!(?:sub|desc\.?|dto\.?|dcto\.?|descuento|ahorro|puntos)[\s.:-]{0,3})`;

/**
 * Not followed by what makes the same word count rather than charge —
 * `TOTAL AHORRO 0,50`, `IMPORTE ENTREGADO 10,00`, `TOTAL ARTÍCULOS`, `TOTAL
 * IVA` (but `TOTAL IVA INCL.` is the charge).
 */
const NOT_BEFORE = String.raw`(?!\s*(?:ahorr|descuento|dto|puntos|entregad|devol|cambio|promo|ofert|ventaj|art|uds|unid|unit|en\s+c\w*mpra|(?:[(c]\s*)?iva(?!\s*incl)))`;

/**
 * The labels that close the list of articles: `TOTAL`, Costco's run-together
 * `TOTALCIVA INCL`, `A PAGAR` / `RESTO A PAGAR`, and Alcampo's `TOT 8,07` —
 * `TOT` only with nothing but an amount after it, so `TOT 3 EN 1` and
 * `TOTOPOS` stay products. Each run of spaces has one place to go: three
 * optional `\s*` in a row shared a run of spaces every way there is.
 */
const CLOSING_LABEL = String.raw`total(?:(?![a-z])|c(?=iva\s*incl))|(?:resto\s+)?a\s+pagar\b|tot(?=\s*(?:compra\s*)?(?:[:.]+\s*)?${AMOUNT_SOURCE}\W{0,3}$)`;

/**
 * Any label a total is printed under. `IMPORTE` and `SUMA` alone label a
 * total but do not close the articles: a column header says `Importe`, and
 * Lidl's `Suma` heads the tax table after the total.
 */
const TOTAL_LABEL = new RegExp(
  String.raw`${NOT_AFTER}\b(?:${CLOSING_LABEL}|importe\b|suma\b)${NOT_BEFORE}`,
  "gi",
);

const CLOSES_THE_ITEMS = new RegExp(
  String.raw`${NOT_AFTER}\b(?:${CLOSING_LABEL}|importe\s+total)${NOT_BEFORE}`,
  "i",
);

/**
 * A total label the OCR damaged, alone at the start of its line with only an
 * amount after it: `; OTAL (€) — 82,04 |`, `* TOJAL`, `fotal 3,04`,
 * `T0TAL`, `N JUIAL 10,94`, `IUTAL (€ 35,00`, and Alcampo's `TOT` read as
 * `es Tor 6,42`.
 */
const DAMAGED_TOTAL =
  /^\W*(?:\p{L}{1,2}\s+)?(?:[tji1l]?[o0u][tji]a[l1i|[(]|f[o0]tal|t[o0]r)(?!\p{L})[^\p{L}]*$/iu;

/**
 * The same label with its amount on the line below — `Tota[ a` over `res
 * 1,95`. Only with its `T`: without it, a word as short as `ojal` is no
 * label.
 */
const DAMAGED_TOTAL_ALONE = /^\W*t[o0][tj]a[l1i|[(](?:\s+\p{L})?[^\p{L}\d]*$/iu;

/** A day of slack for a till clock or a timezone ahead of the server's. */
const FUTURE_DATE_TOLERANCE_MS = 24 * 60 * 60 * 1000;

/**
 * Bounds no receipt reaches, so that no input makes the parser slow: it runs
 * on the server's one thread, up to three times an upload (each OCR reading,
 * then the one kept), and the photograph allows 50 MP of text. A thermal
 * till prints 32 to 56 columns, and the longest tickets read so far — a
 * Costco trolley — run to a few hundred lines; four times the widest line
 * and several times the longest ticket leave room for a wide photograph's
 * noise and for an OCR reading that put a whole short ticket on one line.
 */
const MAX_LINE_LENGTH = 256;
const MAX_LINES = 2000;

/**
 * @param now When "today" is, for refusing a purchase date in the future.
 *   A parameter so a test can pin it; callers leave it out.
 */
export function parseReceiptText(
  ocrText: string,
  now: Date = new Date(),
): ParsedReceipt {
  // Each line as cleaned, and as the OCR read it.
  const lines: string[] = [];
  const read: string[] = [];
  for (const whole of ocrText.split("\n")) {
    if (lines.length === MAX_LINES) break;
    const raw = whole.slice(0, MAX_LINE_LENGTH);
    const line = cleanOcrLine(raw);
    if (line.length === 0) continue;
    lines.push(line);
    read.push(raw.trim());
  }

  const result: ParsedReceipt = {
    items: [],
  };

  result.storeName = extractStoreName(lines);

  result.purchaseDate = extractDate(lines, now);

  const labelled = extractTotal(lines);

  // Extract items
  // A name printed on a line of its own, waiting for the line with its price:
  // Costco prints the article code and price under the name, Mercadona a
  // weighed article's kilos under it.
  let pendingName: string | undefined;
  // Alcampo prints `2 x 1,49` above the article it counts.
  let countAbove: CountLine | undefined;
  // The article read from the line before this one, if any.
  let above: ParsedItem | undefined;
  // Where the articles end, and what came off them before that.
  let end = lines.length;
  let discounts = 0;
  // Lines left in a block of offers (`OFERTAS`), whose amounts come off,
  // and whether its first amount carried a minus.
  let offers = 0;
  let signedOffers: boolean | undefined;
  for (let i = 0; i < lines.length; i++) {
    // Nothing after the total is a purchase: what follows is the payment, the
    // tax breakdown and the footer, and each of them has amounts in it. A tax
    // table never comes before the articles, so its header ends them even
    // when none has been read yet.
    if (
      (result.items.length > 0 &&
        endsTheItems(lines[i], result.items, discounts)) ||
      TAX_TABLE_HEADER.test(normalizeText(lines[i]))
    ) {
      end = i;
      break;
    }

    if (offers > 0) {
      offers = SEPARATOR.test(lines[i]) ? 0 : offers - 1;
      const amount = amountsIn(lines[i]).at(-1);
      // A block whose offers are signed (`DESCUENTO` over `-0,20`) ends at
      // the first line that is not: that is the next article, and `PAN
      // 0,80` and everything after it were taken off rather than bought.
      // The sign as read, since the paper's edge takes a leading dash.
      const asRead = [...read[i].matchAll(amountPattern())].at(-1);
      const signed = asRead !== undefined && isMinus(read[i], asRead);
      signedOffers ??= amount === undefined ? undefined : signed;
      if (amount !== undefined && signedOffers && !signed) {
        offers = 0;
      } else if (amount !== undefined) {
        discounts += parseEsAmount(amount);
        continue;
      }
    }
    if (
      result.items.length > 0 &&
      OFFERS_HEADER.test(normalizeText(lines[i]))
    ) {
      offers = OFFER_LINES;
      signedOffers = undefined;
      continue;
    }
    discounts += discountOn(lines[i]);

    // Before the first article, a time of day with its two-digit hour is the
    // header's, not a price whose comma the OCR read as a colon: `OPERADOR
    // MARIA 12:30` was booked at 12,30 €.
    const unrepaired = withoutTotal(lines[i]);
    const repaired =
      result.items.length === 0 && CLOCK_TIME.test(unrepaired)
        ? unrepaired
        : repairAmounts(unrepaired);
    const line =
      result.items.length > 0
        ? (withLostComma(repaired, lines[i], lines[i + 1]) ?? repaired)
        : repaired;
    const name = pendingName;
    pendingName = undefined;
    const previous = above;
    above = undefined;
    const counting = countAbove;
    countAbove = undefined;

    if (PER_KILO_LINE.test(normalizeText(line))) {
      checkAgainstPerKilo(previous, line);
      continue;
    }
    // Skip lines that are likely headers, footers, or irrelevant
    if (
      isNotAPurchase(line) ||
      (result.items.length === 0 && HEADER_FIELD.test(normalizeText(line))) ||
      line.match(/^\d{1,2}[/]\d{1,2}[/]\d{2,4}$/) ||
      line.match(/^\d{2}:\d{2}/) ||
      line.length < 3
    ) {
      continue;
    }

    const weighed = parseWeightLine(line);
    if (weighed) {
      const kilos = weighed.kilos ?? kilosFromPrice(previous, weighed);
      const product =
        kilos !== undefined && weighed.perKilo !== undefined
          ? Math.round(kilos * weighed.perKilo * 100) / 100
          : undefined;
      const price = weighed.price ?? product;
      if (name && price !== undefined && kilos !== undefined) {
        above = {
          rawText: `${name}\n${line}`,
          // Mercadona's count column says `1` for a weighed article.
          parsedName: cleanProductName(name.replace(/^1\s+(?=\p{L})/u, "")),
          parsedPrice: price,
          parsedQuantity: kilos,
        };
        // `0,784 kg x 6,15 EUR/kg 0.23`: three numbers on one line, and the
        // two that multiply out outvote the one that does not.
        if (
          product !== undefined &&
          Math.abs(cents(product) - cents(price)) > 1
        ) {
          above.parsedPrice = product;
          OTHER_READING.set(above, price);
        }
        result.items.push(above);
      } else if (
        weighed.price === undefined &&
        previous &&
        previous.parsedQuantity === undefined &&
        kilos !== undefined
      ) {
        // Lidl prints the kilos under the article line that carries its
        // price — the line directly above, and only one not already counted.
        previous.parsedQuantity = kilos;
        previous.rawText += `\n${line}`;
        // A price on another line is held to less: only a product one digit
        // from it — `COGOMBRE BIO 1,00` over `0,540kg x 2,59 €/kg` is 1,40.
        if (
          product !== undefined &&
          Math.abs(cents(product) - cents(previous.parsedPrice)) > 2 &&
          oneDigitApart(cents(product), cents(previous.parsedPrice))
        ) {
          if (!OTHER_READING.has(previous)) {
            OTHER_READING.set(previous, previous.parsedPrice);
          }
          previous.parsedPrice = product;
        }
      }
      continue;
    }

    const counted = parseCountLine(line);
    if (counted) {
      const settled = name
        ? settleCount(
            counted.count,
            counted.unitPrice,
            counted.total ?? 0,
            true,
          )
        : undefined;
      if (name && settled) {
        above = {
          rawText: `${name}\n${line}`,
          parsedName: cleanProductName(name),
          parsedPrice: settled.price,
          parsedQuantity: settled.quantity,
        };
        result.items.push(above);
      } else if (!countsFor(counted, previous, line)) {
        countAbove = counted;
      }
      continue;
    }

    const item =
      parseWeighedArticle(line) ??
      (name ? perUnitLine(line, name) : null) ??
      parseLineItem(line, name, discountOn(lines[i + 1] ?? "") > 0);

    if (item) {
      const glued = gluedDigitReading(read[i], item.parsedPrice);
      if (glued !== undefined && !OTHER_READING.has(item)) {
        OTHER_READING.set(item, glued);
      }
      if (counting && countsFor(counting, item, undefined)) {
        item.rawText = `${lines[i - 1]}\n${item.rawText}`;
      }
      result.items.push(item);
      above = item;
    } else if (!amountPattern().test(line) && hasAWord(line)) {
      pendingName = stripTrailingNoise(line);
    }
  }

  countLostTotals(result.items);

  // Fallback for OCR text without line breaks: each amount, named by the
  // words, digits, `/` and `-` running up to it. Walked back from each amount
  // rather than matched by a lazy pattern, which tried every start and every
  // length on the one line, and took seconds on a long one.
  if (result.items.length === 0 && lines.length === 1) {
    const inlineText = withoutTotal(lines[0]);
    let from = 0;
    for (const amount of inlineText.matchAll(amountPattern())) {
      const at = amount.index ?? 0;
      let start = at;
      while (start > from && /[A-Za-zÀ-ÿ0-9\s/-]/.test(inlineText[start - 1]))
        start--;
      const run = inlineText.slice(start, at);
      const first = run.search(/[A-Za-zÀ-ÿ0-9]/);
      const words = first < 0 ? "" : run.slice(first).trimEnd();
      if (words.length < 2 || !/\s$/.test(run)) continue;
      from = at + amount[0].length;
      const name = cleanProductName(words);
      const price = parseEsAmount(amount[0]);
      if (name && !Number.isNaN(price) && price > 0 && price < 10000) {
        result.items.push({
          rawText: `${words} ${amount[0]}`,
          parsedName: name,
          parsedPrice: price,
        });
      }
    }
  }

  const below = lines.slice(end);
  result.totalAmount = chooseTotal(
    labelled.total,
    witnesses(below, result.items, discounts),
    labelled.alternatives,
  );
  // The article list's last line priced at the whole total is the total
  // itself under a label the OCR mangled past reading — `JUIAL 10,94` for
  // `TOTAL 10,94`. A real article cannot cost the total while others cost
  // something too, unless a discount evens it out — nor while the others
  // alone come to more than it, when it is the total that was misread:
  // `BANDAS CORPO. BE 1,40` over `TOTAL A PAGAR 1,40`, after 6,84 € of
  // articles. And a last line that is exactly the others less their
  // discounts is the total too (`E X TUI 9,58`), labelled or not — unless
  // the total counts it: `PAN 1,00 / LECHE 2,00 / ACEITE 3,00 / TOTAL 6,00`
  // lost its oil.
  const last = result.items.at(-1);
  const others =
    result.items
      .slice(0, -1)
      .reduce((sum, item) => sum + cents(item.parsedPrice), 0) -
    cents(discounts);
  const countedByTheTotal =
    last !== undefined &&
    result.totalAmount !== undefined &&
    others + cents(last.parsedPrice) === cents(result.totalAmount);
  if (
    result.items.length > 1 &&
    discounts === 0 &&
    last !== undefined &&
    result.totalAmount !== undefined &&
    cents(last.parsedPrice) === cents(result.totalAmount) &&
    others <= cents(result.totalAmount)
  ) {
    result.items.pop();
  } else if (
    result.items.length >= 3 &&
    last !== undefined &&
    !countedByTheTotal &&
    cents(last.parsedPrice) === others
  ) {
    result.items.pop();
    result.totalAmount ??= last.parsedPrice;
  }
  reconcile(
    result.items,
    discounts,
    [
      result.totalAmount === undefined ? undefined : cents(result.totalAmount),
      taxTableTotal(below),
      ...labelledBelow(below),
    ].filter((target) => target !== undefined),
  );

  if (discounts > 0) result.discountAmount = Math.round(discounts * 100) / 100;
  return result;
}

function cents(amount: number): number {
  return Math.round(amount * 100);
}

/**
 * What else on the ticket says how much was paid, in cents, to hold the
 * labelled total against. Read below the articles, where the payment, the
 * tax table and the old peseta line are.
 *
 * - `card`: the amount on the card line or the card slip, when they all
 *   agree on one.
 * - `cash`: what was handed over less the change. Lidl prints two `ENTREGA`
 *   lines when the customer paid twice; Aldi prints the cash and the change
 *   and no total at all. Lines of one label add up; of different labels,
 *   the largest is what was handed over — Consum's `EFECTIVO 4,25` is the
 *   cash paid, `ENTREGADO 20,00` the note, and the two added made 8,50. Without a change line it is only what was handed
 *   over, which says nothing alone — `cashIsFinal` says whether it can.
 * - `pesetas`: Eroski still prints the total in pesetas, `1284 Ptas.`.
 * - `taxTable`: the tax table's sum (`taxTableTotal`).
 * - `articles`: the articles less their discounts — a witness, never the
 *   total itself, or "do the articles add up?" would always say yes.
 * - `saved`: the same less the savings printed below the articles, DIA's
 *   `TOTAL COMPRA 3,33 / AHORRO CLUB DIA 0,40 / TOTAL A PAGAR 2,93`: without
 *   it the articles agreed only with the 3,33 before the saving, and that
 *   was taken for the charge.
 */
interface Witnesses {
  card?: number;
  cash?: number;
  cashIsFinal: boolean;
  pesetas?: number;
  taxTable?: number;
  articles?: number;
  saved?: number;
}

/**
 * The card line or slip — also Carrefour's `| VENTA 3.83` and `PAGO
 * DIFERIDO 6,42`, but not a `PAGO EFECTIVO`, which is cash.
 */
const CARD_LINE =
  /^\W*(?:\p{L}{1,2}\s+)?(?:(?:pago\W+(?:con\s+)?)?tar[jg]eta|tar[jg]et\.|visa|master[\s-]?card|maestro|imp\.?\s*[:.,]|venta\b|pago\b(?!\W*(?:en\s+)?(?:efectivo|metal)))/u;
/**
 * An amount in euros on the card slip with no label the OCR kept —
 * Mercadona's `12037 4 MOVICA 7,44 / eur` — but not a price a kilo, `€/kg`.
 */
const AMOUNT_IN_EUROS = new RegExp(
  String.raw`${AMOUNT_SOURCE}\W{0,3}eur\b(?!\s*\/)`,
);
const CASH_LINE =
  /^\W*(?:\p{L}{1,2}\s+)?(entregad[oa]|entrega|efectivo|pagado)\b/u;
const CHANGE_LINE =
  /^\W*(?:\p{L}{1,2}\s+)?(?:[cl]ambio|devolucion|a\s+devolver)\b/u;
const PESETAS = /(?<![\d.,])(\d{3,6})\s*(?:ptas?|pesetas)\b/;
const PESETAS_A_EURO = 166.386;

function witnesses(
  below: string[],
  items: ParsedItem[],
  discounts: number,
): Witnesses {
  const card = new Set<number>();
  const handed = new Map<string, number>();
  let change: number | undefined;
  let pesetas: number | undefined;
  const euros = new Set<number>();

  for (const line of below) {
    const normalised = normalizeText(line);
    const amount = amountsIn(line).at(-1);
    const pts = normalised.match(PESETAS);
    if (pts) pesetas = Math.round((Number(pts[1]) / PESETAS_A_EURO) * 100);
    if (amount === undefined) continue;
    const value = cents(parseEsAmount(amount));
    const cash = normalised.match(CASH_LINE);
    if (CARD_LINE.test(normalised)) card.add(value);
    else if (cash) handed.set(cash[1], (handed.get(cash[1]) ?? 0) + value);
    else if (CHANGE_LINE.test(normalised)) change = (change ?? 0) + value;
    else if (
      AMOUNT_IN_EUROS.test(normalised) &&
      afterTotalLabel(line) === undefined
    ) {
      euros.add(value);
    }
  }

  // With cash handed over, an unlabelled amount on a slip may be the part of
  // a split payment the card paid: Lidl's `ENTREGA 5,00`, `ENTREGA 5,94`
  // and a slip for 5,94 of a 10,94 ticket.
  const handedOver =
    handed.size === 0 ? undefined : Math.max(...handed.values());
  if (handedOver === undefined) for (const value of euros) card.add(value);
  const sum = items.reduce((total, item) => total + cents(item.parsedPrice), 0);
  const savings = below.reduce(
    (total, line) => total + cents(discountOn(line)),
    0,
  );
  return {
    card: card.size === 1 ? [...card][0] : undefined,
    cash: handedOver === undefined ? undefined : handedOver - (change ?? 0),
    cashIsFinal: change !== undefined,
    pesetas,
    taxTable: taxTableTotal(below),
    articles: items.length > 0 ? sum - cents(discounts) : undefined,
    saved:
      items.length > 0 && savings > 0
        ? sum - cents(discounts) - savings
        : undefined,
  };
}

/**
 * The total the tax table adds up to, in cents.
 *
 * Carrefour, Eroski, Lidl and Aldi print `base cuota PVP` rows, where the
 * first two make the third; the `Suma`/`TOTAL` row's third is the total —
 * or, with no such row, the one row there is (a ticket with two tax classes
 * has two rows, and either alone is only part of it). Some print the
 * `Suma`/`TOTAL` row as base and cuota alone, `TOTAL 5,39 0,33`, `Suma 0.27
 * 1,28`: the two make the total, when the smaller is a tax on the larger
 * (at most 27%). Mercadona prints `rate% base cuota` rows without the sum,
 * so their bases and cuotas add up to it — but only a whole table: a row
 * whose cuota is not its rate of its base (`A 4% 0,272 5,48 9,70`), a rate
 * with an amount lost (`10% 19 0,19`) or an `IVA` row the rate of which the
 * OCR lost (`1n 7 TIVA DE 3,17 0,32`) leaves a sum that is part of the total
 * at best.
 */
function taxTableTotal(lines: string[]): number | undefined {
  const sums: { labelled: boolean; total: number }[] = [];
  let rated = 0;
  let ratedRows = 0;
  let partial = false;
  let baseAndCuota: number | undefined;
  for (const line of lines) {
    const values = rowAmounts(line).map(cents);
    const [a, b, c] = values.slice(-3);
    const labelled = /\b(?:suma|total)\b/i.test(line);
    if (values.length >= 3 && Math.abs(a + b - c) <= 1) {
      sums.push({ labelled, total: c });
    } else if (RATE_ROW.test(line)) {
      if (values.length === 2 && isTaxOn(line, values[0], values[1])) {
        rated += values[0] + values[1];
        ratedRows += 1;
      } else {
        partial = true;
      }
    } else if (labelled && values.length === 2) {
      const [small, large] = [...values].sort((x, y) => x - y);
      if (small > 0 && small <= large * 0.27) baseAndCuota = small + large;
    } else if (values.length >= 2 && /iva/i.test(line)) {
      partial = true;
    }
  }
  const labelled = sums.filter((row) => row.labelled).at(-1);
  if (labelled) return labelled.total;
  if (sums.length === 1) return sums[0].total;
  if (sums.length > 0) return undefined;
  if (baseAndCuota !== undefined) return baseAndCuota;
  if (ratedRows > 0 && !partial) return rated;
  return undefined;
}

/** Whether `cuota` cents are the rate the row prints of `base` cents, to a cent. */
function isTaxOn(line: string, base: number, cuota: number): boolean {
  const rate = line.match(/(\d{1,2}(?:[.,]\d{1,2})?)\s*%/)?.[1];
  return (
    rate !== undefined &&
    Math.abs((base * parseDecimal(rate)) / 100 - cuota) <= 1
  );
}

/** A row of the tax table that starts with its rate: `10% 7,14 0,71`. */
const RATE_ROW = /^\W*(?:\p{L}\s+)?\d{1,2}(?:[.,]\d{1,2})?\s*%/u;

/** The amounts on a line that are not a rate (`21,00%`). */
function rowAmounts(line: string): number[] {
  return [...line.matchAll(amountPattern())]
    .filter(
      (match) =>
        !/^\s*%/.test(line.slice((match.index ?? 0) + match[0].length)),
    )
    .map((match) => parseEsAmount(match[0]));
}

/**
 * The total, chosen by agreement between what the ticket says in different
 * places, because no single one is right on every ticket: the labelled total
 * is the till's word for it, and the OCR misreads it as readily as anything
 * else (Mercadona's `TOTAL 21529 2,31`).
 *
 * 1. The label the payment agrees with — the card, or the cash less the
 *    change — including one below the tax table: DIA prints `TOTAL COMPRA
 *    2,93`, its tax table, then `TOTAL A PAGAR 2,98`, and charged 2,98.
 * 2. The labelled total, when anything else agrees with it.
 * 3. A label below the tax table (`extractTotal`), when anything agrees.
 * 4. A value two of the others agree on.
 * 5. Otherwise the labelled total, the card, the cash less its change, the
 *    tax table — in that order of trust.
 *
 * Not "the payment, when the total is one confusable digit away from it":
 * DIA's two readings of one ticket were `TOTAL 20.47` / `EFECTIVO 28.47` and
 * `TOTAL 28.47` / `EFECTIVO 20.47` — the OCR misreads either line, so that
 * rule was a coin toss, and over the 77 photographs it scored lower.
 */
function chooseTotal(
  labelled: number | undefined,
  w: Witnesses,
  alternatives: number[] = [],
): number | undefined {
  const label = labelled === undefined ? undefined : cents(labelled);
  const others = [
    w.card,
    w.cash,
    w.pesetas,
    w.taxTable,
    w.articles,
    w.saved,
  ].filter((value): value is number => value !== undefined && value > 0);
  const agree = (a: number, b: number) => Math.abs(a - b) <= 1;

  const corroborated = alternatives
    .map(cents)
    .findLast((alternative) =>
      others.some((other) => agree(other, alternative)),
    );

  // What was paid is what was charged: of the labels, the one the card or the
  // cash-less-change agrees with, before any other agreement.
  const paid = [w.card, w.cashIsFinal ? w.cash : undefined].filter(
    (value): value is number => value !== undefined && value > 0,
  );
  const labels = [label, ...alternatives.map(cents)].filter(
    (value): value is number => value !== undefined,
  );
  const settled = labels.findLast((value) => paid.some((p) => agree(p, value)));

  let chosen: number | undefined;
  if (settled !== undefined) {
    chosen = settled;
  } else if (
    label !== undefined &&
    others.some((other) => agree(other, label))
  ) {
    chosen = label;
  } else if (corroborated !== undefined) {
    chosen = corroborated;
  } else {
    chosen =
      others.find((a, i) => others.some((b, j) => j !== i && agree(a, b))) ??
      label ??
      w.card ??
      (w.cashIsFinal && (w.cash ?? 0) > 0 ? w.cash : undefined) ??
      w.taxTable;
  }
  return chosen === undefined || chosen < 0 ? undefined : chosen / 100;
}

const TOTAL_WORD = new RegExp(String.raw`\b(?:${TOTAL_WORDS})\b`, "i");

/**
 * The line up to where a total word starts — unless a name comes before the
 * word and the price after it: `DENTIFRICO COLGATE TOTAL 2,99` is Colgate
 * Total, and was booked as "dentifrico colgate" with no price, so not at all.
 */
function withoutTotal(line: string): string {
  const word = line.match(TOTAL_WORD);
  if (word?.index === undefined) return line.trim();
  const before = line.slice(0, word.index);
  return hasAWord(before) &&
    amountsIn(before).length === 0 &&
    amountsIn(line.slice(word.index)).length > 0
    ? line.trim()
    : before.trim();
}

/**
 * One OCR line without what the photograph added to it.
 *
 * - **The paper's edge.** A photographed ticket's left edge, a fold or the
 *   table beside it comes back as a `|`, a quote or a lone letter before the
 *   text (`| PATATAS GAJO 1,65`, `E ARROZ CON LECHE 1,27`, `u 1 BACON
 *   1,39` before Mercadona's count column), and the lone letter used to
 *   become the start of the article's name.
 * - **A tax letter run into the price.** Lidl prints the IVA class after each
 *   price, `2,09 B`, and when the gap closes the OCR reads `2,098` — three
 *   decimals, which is no amount at all, so the article was lost. A price
 *   with a digit or two too many at the very end of a line keeps its first
 *   two decimals — also when the tax letter after it was read as a digit,
 *   `ALITAS DE POLLO 4.958 4`. Not on a line that says `kg`, where three
 *   decimals are a weight.
 *
 * Not the `A` of `A pagar 63,89`: it is a word, and without it the line
 * neither closed the articles nor gave the total — it was booked as a
 * product called "pagar". Nor a one-letter word before a word in lower case,
 * as Lidl prints names: `A la pimienta salsa`, `Y griego`. And a label the till printed letter-spaced,
 * `T O T A L ....... 815,64`, is put back together, since nothing reads a
 * total from five one-letter words.
 */
/**
 * Single letters spaced out into a word, when dots or an amount follow —
 * tried only from a run's first letter, since a later one fails the same way
 * after walking the same run (`i l i l …`, OCR noise, was quadratic).
 */
const LETTER_SPACED =
  /(?<!\S)(?<!(?<!\S)\p{L} )(?:\p{L} ){3,}\p{L}(?!\S)(?=[\s.·:…]*\d+[.,]\d{2})/gu;

/**
 * What the paper's edge leaves before Mercadona's count column `1`: two
 * letters (`Ne 1 A.RELLENAS`), a `1` and a mark (`1" 1 COPA`), or a second
 * `1` before a name that starts with a number (`1 1 12 HUEVOS`) — not `1
 * 1/2 POLLO`, which is one half chicken.
 */
const COUNT_COLUMN_NOISE =
  /^(?:[^\s\d]{1,2}|1[^\s\p{L}\d])\s+(?=1\s+(?:\S*\p{L}|\d+\s+\p{L}))|^1\s+(?=1\s+\d+\s+\p{L})/u;

function cleanOcrLine(raw: string): string {
  let line = raw
    .trim()
    .replace(
      /^(?:[|!¡'"“”‘’*:;,.~_—–[\]-]+\s*|(?![Aa]\s+(?:pagar|devolver)\b|[AaYyOoEeUu]\s+\p{Ll})[^\s\d]\s+(?=\S{2}|\d{1,3}\s+\S*\p{L}))+/u,
      "",
    )
    .replace(COUNT_COLUMN_NOISE, "")
    .replace(LETTER_SPACED, (word) => word.replace(/ /g, ""))
    .trim();
  // Not before a unit: `VINO RIOJA 0,750 L` is a size, not 0,75 €.
  if (!/kg/i.test(line)) {
    line = line.replace(
      /(?<![\d.,])(\d+[.,]\d{2})\d{1,2}((?:\s+(?:[^\s\d]{1,2}|\d))*)$/u,
      (whole, amount: string, tail: string) =>
        SIZE_UNIT.test(tail) ? whole : `${amount}${tail}`,
    );
  }
  return line;
}

/**
 * What may follow a line's price: a tax letter glued to it or apart, a `€`,
 * the `|` of the paper's edge — up to three tokens of one or two characters.
 */
const PRICE_TAIL = String.raw`(?=[^\s\d]{0,2}(?:\s*[€|:;]|\s+\S{1,2}){0,3}\s*$)`;

/** Glyphs the OCR reads in place of a digit, in a price's decimals. */
const GLYPH_DIGITS: Record<string, string> = {
  O: "0",
  o: "0",
  D: "0",
  I: "1",
  "|": "1",
  S: "5",
  Z: "2",
  "/": "7",
};

/**
 * Repairs to the price at the end of an article line, each measured on real
 * tickets the OCR misread:
 *
 * - a colon, semicolon or apostrophe for the decimal comma — `Zanahoria
 *   ecológica 1:49 E`, `Berenjena 1:28: E` (Lidl), `QUESO GOUDA 2:15`;
 * - the amount split by a space — `VAL YOGUR ISA 300 1, 16`;
 * - the leading zero lost — `| ENSALADA 2506 ,82 6`;
 * - a third decimal before a `€` or another amount — `AGUA DESTILADA 1.006€`;
 * - a letter in the decimals — `PISTO 1,/9B` is 1,79, `T.49` is 1,49 — when
 *   one decimal is a real digit. Not `B`, which Lidl and Carrefour print
 *   after the price as the tax class;
 * - the comma read as a digit, `MINI BISCOTE EROSKI 0755`, when the line
 *   has no other amount.
 *
 * - a `1` read as a letter in the unit price before a count, `0,9ix 2`;
 * - a count line's total that lost its comma, `PEN 8 COLA 0,39 312`, when
 *   the count times the unit price says so (`countedTotal`).
 *
 * Only the price at the end of the line, and only on a line with a word and
 * no date or time on it: `23/08/2024 16:21` is not 16,21 €. Not part of
 * `cleanOcrLine`, which also feeds the date.
 */
function repairAmounts(line: string): string {
  if (
    !hasAWord(line) ||
    /\d{1,2}[/-]\d{1,2}|\bhora\b|\d{1,2}:\d{2}:\d{2}/i.test(line)
  ) {
    return line;
  }
  const counted = countedTotal(line);
  if (counted !== undefined) return counted;
  const repaired = line
    // Lidl's unit price before its count, `0,9ix 2 1,02 B`: a 1 read as a letter.
    .replace(/(?<![\d.,])(\d+[.,]\d)[iIl|](?=\s*[x×]\s*\d)/u, "$11")
    .replace(
      new RegExp(
        String.raw`(?<![\d:.,])(\d{1,3})[:;'’´](\d{2})(?!\d|:\d)${PRICE_TAIL}`,
        "u",
      ),
      "$1,$2",
    )
    .replace(
      new RegExp(
        String.raw`(?<![\d.,])(\d{1,3})\s?([.,])\s(\d{2})(?!\d)${PRICE_TAIL}`,
        "u",
      ),
      "$1$2$3",
    )
    .replace(
      new RegExp(String.raw`(?<=^|\s)[.,](\d{2})(?!\d)${PRICE_TAIL}`, "u"),
      "0,$1",
    )
    .replace(
      new RegExp(
        String.raw`(?<![\d.,\p{L}])(\d{1,3}|[TI])([.,])([\dOoDI|SZ/]{2})${PRICE_TAIL}`,
        "u",
      ),
      (whole, units: string, comma: string, decimals: string) => {
        const digits = [...decimals].map((c) => GLYPH_DIGITS[c] ?? c).join("");
        if (
          /^[TI]$/.test(units)
            ? !/^\d{2}$/.test(decimals)
            : !/\d/.test(decimals)
        ) {
          return whole;
        }
        return `${/^[TI]$/.test(units) ? "1" : units}${comma}${digits}`;
      },
    );
  // Before another amount, only when the line's count makes that amount of
  // it — `4 PECHUGA EROSKI A 2,551 10,20` — since a third decimal there is
  // as often a size in the name: `QUESO CURADO 0,250 3,50` was fourteen
  // cheeses at 0,25.
  const glued = /kg|kilo/i.test(repaired)
    ? repaired
    : repaired.replace(
        new RegExp(
          String.raw`(?<![\d.,])(\d+[.,]\d{2})\d(?=[€|]|\s+(${AMOUNT_SOURCE}))`,
          "u",
        ),
        (whole, amount: string, next: string | undefined) => {
          const count = Number(repaired.match(/^(\d{1,3})\s/)?.[1] ?? 0);
          return next === undefined ||
            cents(count * parseEsAmount(amount)) === cents(parseEsAmount(next))
            ? amount
            : whole;
        },
      );
  return amountsIn(glued).length > 0
    ? glued
    : glued.replace(
        new RegExp(String.raw`(?<![\d.,])0\d(\d{2})(?!\d)${PRICE_TAIL}`, "u"),
        "0,$1",
      );
}

/**
 * What may follow a price that lost its comma: a `€`, a glued `e`, `|`, `.`,
 * one-character tokens. Not a `%`: `POLLASTRE 410 318%` is the price 3,19
 * misread, and any number before a `%` is a rate.
 */
const LOST_COMMA_TAIL = String.raw`(?:€|e(?!\p{L}))?[^\s\p{L}\d%]*(?:\s+\S)*\s*$`;

/**
 * The price at the end of an article line that lost its decimal comma, put
 * back — on a line with a word and no amount, once an article has been read:
 *
 * - a slash for the comma before `€`/`e`: `PAN MOLDE … BLAN A 2/15 e`;
 * - three digits: `ARROZ 3 DELICIAS 279 |`, `ACEITE OLIVA INT 369€`,
 *   `NATILLA … —199e`, `1 PACK 3X500 COLA 540`;
 * - four digits whose last is the tax letter A or B read as a 4 or an 8:
 *   `ACEITU MANZ VERD S/ 1798 E`;
 * - a space for the comma after one digit: `LIIMACAIL OR 317 1MM 3 79` —
 *   not after two, `TORTILLA DE PATATAS BLI 50 39` being a size and a
 *   price the OCR cut short, not 50,39 €.
 *
 * Not on the header (no article yet: `C/ BERLÍN, 486`), a weight, a total or
 * an article count (`Jotal 9 Artículos 947`), a payment, nor a name whose
 * price is on the next line (`LECHE ENTERA 250` over `1,25`). A name that
 * ends in a number still becomes the price — the risk this takes.
 */
function withLostComma(
  line: string,
  raw: string,
  next: string | undefined,
): string | undefined {
  const normalised = normalizeText(raw);
  if (
    !hasAWord(line) ||
    amountsIn(line).length > 0 ||
    /kg|kilo/.test(normalised) ||
    afterTotalLabel(raw) !== undefined ||
    /^\W*\p{L}?[o0u][tj]a[l1i|[(]/u.test(normalised) ||
    /\d\s*art(?:s|\.|iculos)?\b/.test(normalised) ||
    isNotAPurchase(line) ||
    (next !== undefined && pricesTheNameAbove(next))
  ) {
    return undefined;
  }
  for (const [pattern, replacement] of [
    [String.raw`(?<![\d.,/])(\d)\/(\d{2})(?=\s*(?:€|e(?!\p{L})))`, "$1,$2"],
    [
      String.raw`(?<![\d.,\p{L}])(\d)(\d{2})[48](?=(?:\s+[^\s%]{1,2})*\s*$)`,
      "$1,$2",
    ],
    [String.raw`(?<![\d.,\p{L}])(\d)(\d{2})(?=${LOST_COMMA_TAIL})`, "$1,$2"],
    [String.raw`(?<=\s)(\d)\s(\d{2})(?=[^\s\p{L}\d%]*\s*$)`, "$1,$2"],
  ] as const) {
    const rewritten = line.replace(new RegExp(pattern, "u"), replacement);
    if (rewritten !== line && amountsIn(rewritten).length === 1)
      return rewritten;
  }
  return undefined;
}

/**
 * Whether `line` prices the name on the line above it: a bare amount, a code
 * line with no word before its amounts, a weight or a count.
 */
function pricesTheNameAbove(line: string): boolean {
  const first = line.search(new RegExp(AMOUNT_SOURCE));
  return (
    (first >= 0 && !hasAWord(line.slice(0, first))) ||
    parseWeightLine(line) !== null ||
    COUNT_LINE.test(line)
  );
}

/**
 * `<noise> N NAME <unit price> <total without its comma>`, Mercadona's count
 * line. The name ends where a space starts (`(?<=\S)`): the lazy name tried
 * `\s+` again from every space of a long run, and 20.000 spaces took seconds.
 */
const COUNT_LINE_COMMA_LOST = new RegExp(
  String.raw`^(?:\S{1,3}\s+)?(\d{1,2})\s+(\p{L}.*?)(?<=\S)\s+(${AMOUNT_SOURCE})[.,]?\s+(\d{3,4})[^\d]{0,3}$`,
  "u",
);

/**
 * A count line whose total lost its comma — `PEN 8 COLA 0,39 312`, `2 LECHE
 * SEMIDESNATA 0.97. 1944` (the tax letter read as a 4) — written out with
 * the total put back and the noise before the count dropped, when the
 * digits are exactly the count times the unit price: three numbers agree,
 * so none was guessed.
 */
function countedTotal(line: string): string | undefined {
  const match = line.match(COUNT_LINE_COMMA_LOST);
  if (!match || Number(match[1]) < 2) return undefined;
  const total = cents(Number(match[1]) * parseEsAmount(match[3]));
  const digits = match[4];
  if (digits !== String(total) && digits.slice(0, -1) !== String(total)) {
    return undefined;
  }
  return `${match[1]} ${match[2]} ${match[3]} ${(total / 100).toFixed(2).replace(".", ",")}`;
}

/**
 * Words that mark a line as money changing hands rather than a thing bought:
 * tax, discounts, the payment and the change. Matched anywhere on the line and
 * whatever else is on it.
 *
 * This used to apply only to lines with at most one amount, which let through
 * exactly the lines that carry more: a tax row (`IVA 10% 8,00 0,80`), and a
 * payment line printed with its running total. And the list stopped at
 * `cambio`, so `ENTREGADO 5,00` and `A DEVOLVER 4,11` were booked as products
 * called "entregado" and "a devolver".
 *
 * `PRECIO KILO 6.95` is DIA's price a kilo under a weighed article, and
 * `IMP.: 5,94 EUR` the amount on Lidl's card slip — neither is bought.
 *
 * The words of a discount or a voucher (`DISCOUNT_LABEL`) only head their
 * line: in a name they are a product's — `LECHE PACK AHORRO 6`, `CAFE
 * MOLIDO DESC.` (decaf), `DETERGENTE ARIEL PROMO` were all lost.
 */
const NOT_A_PURCHASE =
  /\b(?:sub\s*total|iva|i\.v\.a|imponible|cuota|saldo|acumulado|redondeo|cambio|efectivo|metal\s?ico|entregado|entrega|pagado|devolver|devolucion|tarjeta|targeta|visa|mastercard|maestro|pago|quota|imposable|precio\s*(?:kilo|kg))\b|^\W*imp(?:orte)?\.?\s*[:.,]/;

/** A line headed by a discount or a voucher, after the paper's edge: `Dto. Pisto 0,40`. */
const DISCOUNT_LABEL =
  /^\W*(?:\p{L}{1,2}\s+)?(?:descuentos?|desc|dto|dcto|ahorro|cupon|cupones|cupons|vales?|rebaja|promo|promocion|oferta)\b/u;

/**
 * Words that only head a line: the till's own header fields. Anchored to the
 * start because `caja` and `hora` are also words a product name can contain
 * — and, once an article has been read, only before a number or a mark
 * (`CAJA: 3`, `HORA 12:30`), since a name can start with one too: `CAJA
 * BOMBONES 3,50` was lost.
 */
const HEADER_FIELD =
  /^(?:factura|ticket|caja|hora|fecha|nif|cif|tel(?:efono)?)\b/;
const FIELD_THEN_WORD = /^\S+\s+\p{L}{3}/u;

function isNotAPurchase(line: string): boolean {
  const normalised = normalizeText(line);
  return (
    NOT_A_PURCHASE.test(normalised) ||
    DISCOUNT_LABEL.test(normalised) ||
    (HEADER_FIELD.test(normalised) && !FIELD_THEN_WORD.test(normalised))
  );
}

/**
 * What the receipt says was paid.
 *
 * Read a line at a time, and from the last line that carries a total. It used
 * to be one pattern over the whole text, which went wrong two ways: `total`
 * matched inside `SUBTOTAL`, so `SUBTOTAL 2,09 / DESCUENTO 0,50 / TOTAL 1,59`
 * came out at 2,09; and its `\s` crossed newlines, so a column header ending in
 * `Importe` ran on into the first item line and took that item's price.
 *
 * The last total line rather than the first because what a till prints after
 * its subtotal and discounts is the amount charged. Only a line with a single
 * amount after its label counts: the tax summary at the foot of a Mercadona
 * ticket closes with `TOTAL 8,00 0,80` — base and tax, not the charge — and
 * would otherwise be the last total line on the receipt.
 *
 * A label with no amount of its own takes the one below it (`amountBelow`),
 * once an article has been read — before that, a label is a column header.
 */
function extractTotal(lines: string[]): {
  total: number | undefined;
  alternatives: number[];
} {
  let total: number | undefined;
  let stopped = false;
  const alternatives: number[] = [];
  let afterAnArticle = false;

  for (const [i, line] of lines.entries()) {
    // Below the tax table or the loyalty block a label is usually theirs, not
    // the charge: Mercadona's tax table closes with `TOTAL 21529 2,31`. Not
    // always — DIA prints its tax table between `TOTAL COMPRA` and `TOTAL A
    // PAGAR` — so what is labelled there is kept as an alternative, for
    // `chooseTotal` to take when something else on the ticket agrees with it.
    if (total !== undefined && STOPS_THE_TOTAL.test(normalizeText(line))) {
      stopped = true;
    }
    const after = afterTotalLabel(repairAmounts(line));
    if (after !== undefined) {
      const amounts = amountsIn(after);
      let found: number | undefined;
      if (amounts.length === 1) {
        found = parseEsAmount(amounts[0]);
      } else if (amounts.length === 0 && afterAnArticle) {
        found = amountBelow(lines, i);
      }
      if (found !== undefined) {
        // Every label is a candidate; the last one above the tax table is
        // the one trusted when nothing else on the ticket decides.
        if (!stopped && total !== undefined) alternatives.push(total);
        if (stopped) alternatives.push(found);
        else total = found;
      }
    }
    if (hasAWord(line) && amountsIn(line).length > 0) afterAnArticle = true;
  }

  return { total, alternatives };
}

/** Every amount printed on `text`, as written. */
function amountsIn(text: string): string[] {
  return text.match(amountPattern()) ?? [];
}

/**
 * What follows the line's total label — its last one, so `TOTAL A PAGAR
 * EUROS 20.47` reads from `A PAGAR` — or `undefined` when it carries none.
 */
function afterTotalLabel(line: string): string | undefined {
  const label = [...line.matchAll(TOTAL_LABEL)].at(-1);
  if (label?.index !== undefined) {
    return line.slice(label.index + label[0].length);
  }
  return isDamagedTotal(line) ? line : undefined;
}

function isDamagedTotal(line: string): boolean {
  return (
    (DAMAGED_TOTAL.test(line) && amountsIn(line).length === 1) ||
    DAMAGED_TOTAL_ALONE.test(line)
  );
}

/**
 * The amount a total label left for the next line: Eroski prints `NUEVO
 * TOTAL` over `GUZTIRA BERRIA 121,88`, the same label in Basque. The first
 * line below with an amount decides — taken when it is the only amount on it
 * and the line is not a payment, which is a different question (what was
 * handed over, not what was charged).
 */
function amountBelow(lines: string[], index: number): number | undefined {
  for (const line of lines.slice(index + 1, index + 3)) {
    const amounts = amountsIn(line);
    if (amounts.length === 0) continue;
    if (
      amounts.length > 1 ||
      afterTotalLabel(line) !== undefined ||
      isNotAPurchase(line)
    ) {
      return undefined;
    }
    return parseEsAmount(amounts[0]);
  }
  return undefined;
}

/**
 * Whether `quantity` units at `unitPrice` come to `lineTotal`, to the cent the
 * till rounded to. A weighed line (`1,234 kg × 1,99 = 2,46`) rounds, so the
 * tolerance is a cent rather than zero.
 */
function multipliesOut(
  quantity: number,
  unitPrice: number | undefined,
  lineTotal: number,
): boolean {
  return (
    unitPrice !== undefined &&
    Math.abs(quantity * unitPrice - lineTotal) <= 0.011
  );
}

function parseDecimal(text: string): number {
  return Number.parseFloat(text.replace(",", "."));
}

/**
 * One receipt line as a purchase: name, line total and, where the line says
 * so, how many.
 *
 * **`parsedPrice` is the line total** — the last amount on the line — and the
 * quantity is how many units it paid for; apply books the stock and the price
 * record from that pair.
 *
 * A number beside the name is only taken as a quantity when the line itself
 * proves it is one, because a number in a name is just as often a pack size:
 * `PAPEL HIGIENICO 12 3,50` is twelve rolls for 3,50 €, not twelve packs. So:
 *
 * - `2x LECHE 2,50` / `2 x LECHE` — the `x` says it is a quantity.
 * - `2 LECHE ENTERA 0,89 1,78` (Mercadona) or `LECHE ENTERA 2 1,25 2,50`
 *   (Carrefour) — a leading or trailing number is a quantity when the line
 *   also prints a unit price and the two multiply out to the line total.
 * - `1 PAN DE MOLDE 0,95` — a leading `1` is the quantity column of a
 *   one-unit line; it is not part of the name, whatever follows — `1 12
 *   HUEVOS` is one box of twelve, `1 1/2 POLLO` one half chicken. Only a
 *   `1`: `2 6 HUEVOS 1,20` may be two of six or one of 26.
 *
 * - `0,65x 3 1,95` (Lidl) — a count between the unit price and the line
 *   total, when the two multiply out.
 *
 * - `LECHE ENTERA DIA 6X 0.56 3.36` (DIA) — a count with an `x` just before
 *   the unit price.
 *
 * A count is held against the unit price and the total (`settleCount`), and
 * with none stated a total that is a whole number of unit prices gives one
 * (`countFromRatio`). Anything else stays in the name, and the line is one
 * unit.
 *
 * @param nameAbove A name printed alone on the line before. It names this
 *   line when this line has no word of its own — Costco's
 *   `1000003V 1x 10,49 10,49 A` under `Costco Bolsa Cong`.
 * @param discounted Whether a discount line follows, which takes the total
 *   off what a count of unit prices makes.
 */
function parseLineItem(
  line: string,
  nameAbove?: string,
  discounted = false,
): ParsedItem | null {
  // An amount followed by a unit, and by the price after it, is a size —
  // part of the name: `COCA COLA 1,25L 2,50 B` is one bottle, and was booked
  // as two at 1,25. Not the last amount: Alcampo's `RUCULA 1,58 G` is the
  // price and its tax class.
  const found = [...line.matchAll(amountPattern())];
  const amounts = found.filter(
    (amount, k) =>
      k === found.length - 1 ||
      !SIZE_UNIT.test(line.slice((amount.index ?? 0) + amount[0].length)),
  );
  const first = amounts[0];
  if (first?.index === undefined) return null;

  const last = amounts[amounts.length - 1];
  if (isMinus(line, last)) return null;

  let price = parseEsAmount(last[0]);
  if (Number.isNaN(price) || price <= 0 || price >= 10000) return null;

  let unitPrice =
    amounts.length >= 2
      ? parseEsAmount(amounts[amounts.length - 2][0])
      : undefined;

  let namePart = line.slice(0, first.index).trim();
  let parsedQuantity: number | undefined;

  // `2x LECHE`, `2 x LECHE`, `2xLECHE` — but not `5 XL CAMISETA`.
  const explicit =
    namePart.match(/^(\d+(?:[.,]\d+)?)\s*[x×]\s+(\S.*)$/iu) ??
    namePart.match(/^(\d+(?:[.,]\d+)?)[x×](\p{L}.*)$/iu);
  // `(P)JAMON`: Mercadona marks some names with a bracket.
  const leading =
    namePart.match(/^(\d{1,3})\s+([\p{L}(].*)$/u) ??
    namePart.match(/^(1)\s+(\d[\d/.,]*\s+\p{L}.*|\d+\p{L}.*)$/u);
  const trailing = namePart.match(/\s(\d+(?:[.,]\d+)?)$/);
  // DIA: `LECHE ENTERA DIA 6X 0.56 3.36`, the count before the unit price.
  const countAtEnd = namePart.match(/\s(\d{1,3})\s*[x×]$/iu);

  const between =
    amounts.length >= 2
      ? line
          .slice(
            (amounts.at(-2)?.index ?? 0) +
              amounts[amounts.length - 2][0].length,
            last.index,
          )
          .match(/^\s*([x×])?\s*(\d{1,3})\s*$/iu)
      : null;

  // `PIPAS GIGANTES TOSTA 1,05x 2 2. 1UB` (Lidl): the only amount is the unit
  // price, the count follows its `x`, and the line total is unreadable.
  const countAfter =
    amounts.length === 1
      ? line
          .slice(first.index + first[0].length)
          .match(/^\s*[x×][\s\-—–]*(\d{1,2})(?![\d.,])/u)
      : null;

  // `6X 0.56 006`: the count is right before the only amount, so that amount
  // is the unit price and the total after it is unreadable.
  if (
    countAtEnd &&
    amounts.length === 1 &&
    /^\s*(?:\S*\d|\S{2,})/u.test(line.slice(first.index + first[0].length))
  ) {
    unitPrice = price;
    price = 0;
  }

  // `TURRON DURO C.S.` over `TeX 1,99 5,97`: one short token where Eroski
  // prints the count is noise, not a name, when the prices make a count.
  const countNoise =
    /^\S{1,3}$/.test(namePart) &&
    unitPrice !== undefined &&
    countFromRatio(line, unitPrice, price) !== undefined;
  let settled: Settled | undefined;
  if (nameAbove && (!isAName(namePart) || countNoise)) {
    // A code line: the code, then the count as `1x` (`4 Y` at Eroski), then
    // the prices.
    const count = namePart.match(CODE_LINE_COUNT);
    if (count) {
      settled = settleCount(countOf(count[1]), unitPrice, price, true);
    }
    namePart = nameAbove;
  } else if (countAfter && Number(countAfter[1]) >= 2) {
    const count = Number(countAfter[1]);
    settled = { quantity: count, price: Math.round(count * price * 100) / 100 };
  } else if (between) {
    settled = settleCount(Number(between[2]), unitPrice, price, !!between[1]);
  } else if (explicit) {
    settled = settleCount(parseDecimal(explicit[1]), unitPrice, price, true);
    namePart = explicit[2];
  } else if (countAtEnd?.index !== undefined && unitPrice !== undefined) {
    // With no unit price, `AGUA … PRIMAVERA 6X 2,98` is a pack of six.
    settled = settleCount(Number(countAtEnd[1]), unitPrice, price, true);
    namePart = namePart.slice(0, countAtEnd.index);
  } else if (leading) {
    settled =
      leading[1] === "1"
        ? { quantity: 1, price }
        : settleCount(Number(leading[1]), unitPrice, price, false);
    if (settled) namePart = leading[2];
  } else if (trailing?.index !== undefined) {
    settled = settleCount(parseDecimal(trailing[1]), unitPrice, price, false);
    if (settled) namePart = namePart.slice(0, trailing.index);
  }
  if (!settled && unitPrice !== undefined && price > 0 && !discounted) {
    settled = countFromRatio(line, unitPrice, price);
    // From a run's first space only, or each space of the run walks to its end.
    if (settled) namePart = namePart.replace(/(?<!\s)\s+[\dxX×yY|]{1,3}$/u, "");
  }
  if (settled) {
    parsedQuantity = settled.quantity;
    price = settled.price;
  }
  if (price <= 0) return null;

  if (
    parsedQuantity !== undefined &&
    (Number.isNaN(parsedQuantity) ||
      parsedQuantity <= 0 ||
      parsedQuantity >= 1000)
  ) {
    return null;
  }

  // A name with no letter in it is not a product: it is the rate column of a
  // tax breakdown (`10% 8,00 0,80` became a product called "10").
  const name = cleanProductName(namePart);
  if (!isAName(name)) return null;

  const item = {
    rawText: namePart === nameAbove ? `${nameAbove}\n${line}` : line,
    parsedName: name,
    parsedPrice: price,
    parsedQuantity,
  };
  if (settled?.misread !== undefined) OTHER_READING.set(item, settled.misread);
  return item;
}

/** What follows an amount that is a size: `1,25L`, `1,50 L`, `0,33 cl`, `0,50 kg`. */
const SIZE_UNIT = /^\s?(?:[cm]?l|k?g|gr)\b/i;

/**
 * Mercadona's count column on lines that lost their line total: `2 QUALLADA
 * 1,20 Ea` is two at 1,20, and the junk after the amount is where 2,40 was.
 * Only on a ticket where another `N NAME unit total` line multiplies out,
 * which shows the leading numbers are a count column; and only with that
 * junk, since `2 LEMON CAKE 1,70` may as well be one pack of two. The amount
 * as read stays the other reading, for `reconcile`.
 */
function countLostTotals(items: ParsedItem[]): void {
  const counted = items.some(
    (item) =>
      (item.parsedQuantity ?? 0) >= 2 &&
      item.rawText.startsWith(`${item.parsedQuantity} `) &&
      amountsIn(item.rawText).length >= 2,
  );
  if (!counted) return;
  const junkAfterTheAmount = new RegExp(
    String.raw`${AMOUNT_SOURCE}\s+[^\s\d]+\s*$`,
    "u",
  );
  for (const item of items) {
    const count = item.parsedName.match(/^(\d{1,2})\s+(?=\p{L})/u);
    if (
      !count ||
      Number(count[1]) < 2 ||
      item.parsedQuantity !== undefined ||
      amountsIn(item.rawText).length !== 1 ||
      !junkAfterTheAmount.test(item.rawText)
    ) {
      continue;
    }
    const quantity = Number(count[1]);
    OTHER_READING.set(item, item.parsedPrice);
    UNCOUNTED.set(item, item.parsedName);
    item.parsedQuantity = quantity;
    item.parsedPrice = Math.round(quantity * item.parsedPrice * 100) / 100;
    item.parsedName = item.parsedName.slice(count[0].length);
  }
}

/** A count and the line total it books. */
interface Settled {
  quantity: number;
  price: number;
  /** The printed total, when the count and unit price overruled it. */
  misread?: number;
}

/**
 * The other price an article's line could be read as — the printed total a
 * count and unit price overruled, or the price with the digit the OCR ran
 * into it — for `reconcile` to choose between against the ticket's total.
 * Kept beside the item rather than on it: it is the parser's doubt, not
 * part of a line.
 */
const OTHER_READING = new WeakMap<ParsedItem, number>();

/**
 * The name an article had before `countLostTotals` read a count out of it:
 * when `reconcile` puts the price as read back, the count was no count —
 * `4 YOGURES NATURALES 1,20 A` kept a quantity of 4 at 1,20.
 */
const UNCOUNTED = new WeakMap<ParsedItem, string>();

/**
 * `BOQUERON SILVIA 2,939`: `cleanOcrLine` keeps 2,93, but the extra digit
 * may as well be the second decimal and the `3` the noise — 2,99.
 */
function gluedDigitReading(raw: string, price: number): number | undefined {
  const match = raw.match(
    /(?<![\d.,])(\d+[.,]\d)(\d)(\d)(?:\s+(?:[^\s\d]{1,2}|\d))*\s*$/u,
  );
  if (!match || cents(parseEsAmount(match[1] + match[2])) !== cents(price)) {
    return undefined;
  }
  return parseEsAmount(match[1] + match[3]);
}

/**
 * Settles the articles the OCR left in doubt (`OTHER_READING`) against what
 * the ticket says they come to: the total, the totals printed below the
 * articles (`TOTAL IVA INCLUIDO` before Eroski's discounts, a subtotal) and
 * the tax table's sum.
 *
 * When the articles as read already make one of them, nothing changes.
 * Otherwise every choice between the readings of up to eight doubtful lines
 * is tried, and one is applied only if it is the only one that adds up — a
 * digit is never changed on the arithmetic alone, only to a reading the
 * line itself offered.
 */
function reconcile(
  items: ParsedItem[],
  discounts: number,
  targets: number[],
): void {
  const doubtful = items.filter((item) => OTHER_READING.has(item)).slice(0, 8);
  if (doubtful.length === 0 || targets.length === 0) return;
  const off = cents(discounts);
  const fits = (sum: number) =>
    targets.some(
      (target) =>
        Math.abs(sum - target) <= 1 || Math.abs(sum - off - target) <= 1,
    );
  const sum = items.reduce((total, item) => total + cents(item.parsedPrice), 0);
  if (fits(sum)) return;

  let found: number | undefined;
  for (let choice = 1; choice < 1 << doubtful.length; choice++) {
    const changed = doubtful.reduce(
      (total, item, k) =>
        choice & (1 << k)
          ? total +
            cents(OTHER_READING.get(item) ?? 0) -
            cents(item.parsedPrice)
          : total,
      sum,
    );
    if (!fits(changed)) continue;
    if (found !== undefined) return;
    found = choice;
  }
  if (found === undefined) return;
  for (const [k, item] of doubtful.entries()) {
    if (!(found & (1 << k))) continue;
    item.parsedPrice = OTHER_READING.get(item) ?? item.parsedPrice;
    const name = UNCOUNTED.get(item);
    if (name !== undefined) {
      item.parsedName = name;
      item.parsedQuantity = undefined;
    }
  }
}

/** The single amount on each total or subtotal line, in cents. */
function labelledBelow(lines: string[]): number[] {
  return lines.flatMap((line) => {
    const after =
      afterTotalLabel(line) ?? line.match(/\bsub\s*-?total\b(.*)$/i)?.[1];
    const amounts = after === undefined ? [] : amountsIn(after);
    return amounts.length === 1 ? [cents(parseEsAmount(amounts[0]))] : [];
  });
}

/**
 * A count on a code line: `1x`, `1 x`, `6X`, the `1` read as `I`, `l` or `|`,
 * and Eroski's `4 Y` / `4 K`.
 */
const CODE_LINE_COUNT =
  /(?<![\d.,])(\d{1,3}|[Il|i!])\s*(?:[xX×]|[yYkK](?=\s))/u;

function countOf(token: string): number {
  return /^\d+$/.test(token) ? Number(token) : 1;
}

/**
 * How many, and the line total, when a line prints a count and a unit price
 * and the OCR may have misread either the unit price or the total — neither
 * column is right more often than the other on its own.
 *
 * - The count times the unit price is the total: as printed.
 * - `stated` (an `x`, Eroski's `Y`) and the unit price but no total, or a
 *   total below the unit price — `6X 0.56 006`, `v1x 7,99 1,239`: the count
 *   times the unit price — unless the total is the unit price with a digit
 *   lost. Stated with no unit price: the count, as printed.
 * - The product and the printed total one digit apart, or the unit price and
 *   the total's share — `0,91x 2 1,62`, Mercadona's `2 GASPATAO 1,68 3,20`:
 *   the product, with the printed total kept as what it may have been.
 * - The unit price or the total with one leading digit too many.
 *
 * Otherwise the count is no count: a number in the name.
 */
function settleCount(
  count: number,
  unitPrice: number | undefined,
  printed: number,
  stated: boolean,
): Settled | undefined {
  if (unitPrice === undefined) {
    return stated && printed > 0
      ? { quantity: count, price: printed }
      : undefined;
  }
  const product = Math.round(count * unitPrice * 100) / 100;
  // A whole count makes an exact total; the cent of slack is for kilos.
  if (
    Number.isInteger(count)
      ? cents(product) === cents(printed)
      : multipliesOut(count, unitPrice, printed)
  ) {
    return { quantity: count, price: printed };
  }
  if (
    stated &&
    printed < unitPrice &&
    // `ix 115,99 15,99` is a 15,99 € article with a digit too many in its
    // unit price, not a total the OCR lost. With no total printed there is
    // nothing to look for: "50".includes("0") lost `3 ud 0,50 €/ud`.
    !(printed > 0 && String(cents(unitPrice)).includes(String(cents(printed))))
  ) {
    return { quantity: count, price: product };
  }
  const share = (printed / count) * 100;
  if (
    oneDigitApart(cents(product), cents(printed)) ||
    (Math.abs(share - Math.round(share)) < 0.01 &&
      oneDigitApart(cents(unitPrice), Math.round(share)))
  ) {
    return { quantity: count, price: product, misread: printed };
  }
  // One leading digit too many in either: `2 ELFRESC VACA LIGHT 12,20 4,40`
  // is two at 2,20; `2 BOSSA PLASTIC 0,15. 10,30` two at 0,15. Exact to the
  // cent, and never for one unit, where unit price and total are one amount.
  if (Number.isInteger(count) && count > 1) {
    if (cents(withoutFirstDigit(unitPrice) * count) === cents(printed)) {
      return { quantity: count, price: printed };
    }
    if (cents(withoutFirstDigit(printed)) === cents(product)) {
      return { quantity: count, price: product, misread: printed };
    }
  }
  return undefined;
}

/** `12,20` as `2,20`: an amount of 10 or more without its first digit, else NaN. */
function withoutFirstDigit(amount: number): number {
  const digits = String(cents(amount));
  return digits.length >= 4 ? Number(digits.slice(1)) / 100 : Number.NaN;
}

/**
 * A count no token states, from the arithmetic alone: a total that is a
 * whole number of unit prices, 2 to 99 of them (`TURRON DURO C.S.` over `3
 * 1,99 5,97`). Not on a promotion — `3X2 YOGUR 1,20 2,40` is three for the
 * price of two — nor when a discount follows, which makes the total no
 * longer what the count costs.
 */
function countFromRatio(
  line: string,
  unitPrice: number,
  total: number,
): Settled | undefined {
  if (/\d\s*x\s*\d/i.test(line)) return undefined;
  const count = Math.round(total / unitPrice);
  return count >= 2 && count <= 99 && multipliesOut(count, unitPrice, total)
    ? { quantity: count, price: total }
    : undefined;
}

/** Whether two amounts in cents, as long as each other, differ in one digit. */
function oneDigitApart(a: number, b: number): boolean {
  const x = String(a);
  const y = String(b);
  return (
    x.length === y.length &&
    [...x].filter((digit, i) => digit !== y[i]).length === 1
  );
}

/**
 * The heading of a block of offers: DIA prints `OFERTAS` and under it each
 * offer's name and what it took off, unsigned — `GALLETA M* DORAD DIA 1.65`
 * was booked as a second packet of biscuits. The block runs to a separator,
 * the total, or `OFFER_LINES` lines, whichever comes first, so a heading
 * misread among the articles cannot swallow the rest of them.
 */
const OFFERS_HEADER =
  /^\W*(?:ofertas?|ofertes|promociones|promocions|descuentos?|descomptes|cupones|cupons)\W*$/;
const OFFER_LINES = 6;
const SEPARATOR = /^[\s*=_\-.·xXkK]{6,}$/;

/**
 * Whether the amount `match` found on `line` carries a minus on either side —
 * `CUPON -0,50`, `0,50-` — and so is money coming off, not a purchase. The
 * amount pattern does not take the sign, so without this a discount was
 * booked as a 0,50 € purchase of a product called "cupon".
 */
function isMinus(line: string, match: RegExpMatchArray): boolean {
  const start = match.index ?? 0;
  return (
    // Not a dash glued to a word: `SANGRIA.PET 1,5 L- 2,65` is a size and
    // a dash, not 2,65 € off.
    /(?<!\p{L})[-−]\s?$/u.test(line.slice(0, start)) ||
    /^[-−]/.test(line.slice(start + match[0].length))
  );
}

/**
 * What a line among the articles takes off them: a signed amount, or the
 * amount on a discount line (`Dto. Pisto 0,40`). For the articles' sum the
 * total is checked against.
 */
function discountOn(line: string): number {
  // `6 x 0,55 € **OFERTA**` counts an article; it takes nothing off.
  if (COUNT_LINE.test(line)) return 0;
  const last = [...line.matchAll(amountPattern())].at(-1);
  if (last === undefined) return 0;
  return isMinus(line, last) || DISCOUNT_LABEL.test(normalizeText(line))
    ? parseEsAmount(last[0])
    : 0;
}

/** Whether `text` has a word in it — three letters running — not just a code. */
function hasAWord(text: string): boolean {
  return /\p{L}{3}/u.test(text);
}

/**
 * Whether `text` can name an article: a word, or a token of two letters and
 * a digit — `7UP`, `H2O`, `KH7`, which `hasAWord` dropped, or named with the
 * line above (`CONDIS` for a 7UP). Not a count, `v1x`, nor a code with a
 * letter in it, `1946954V`. Not two letters alone: `TE` is tea, but the OCR
 * makes `EN 9,99`, `Le 11,99` and `py 1 9,99` (under the name it prices) of
 * a ticket's noise far more often than a till prints a name that short.
 */
function isAName(text: string): boolean {
  return (
    hasAWord(text) ||
    /(?<!\S)(?=\S*\d)(?=[^\s\p{L}]*\p{L}[^\s\p{L}]*\p{L})[\p{L}\d]+(?!\S)/u.test(
      text.replace(new RegExp(CODE_LINE_COUNT.source, "gu"), " "),
    )
  );
}

/**
 * A name line without what the paper's edge and the OCR leave after it: a
 * lone `E`, `Fl` or `=` that is no part of any name. Tokens with a digit stay —
 * `1L` and `6x` are.
 */
function stripTrailingNoise(line: string): string {
  // Started only after a token that is not itself noise, and not inside a
  // run of spaces: from every token of `- - - - …` it walked to the end.
  return line
    .replace(/(?<!\s|\s[^\s\d]{1,2})(?:\s+[^\s\d]{1,2})+$/u, "")
    .trim();
}

const KILOS = /(?<![\d.,])(\d+[.,]\d{3})\s*(?:kgs?|kilos?|k[g9o0q])\b/i;

/** The price a kilo's unit, as the OCR reads `€/kg`: `EUR/kg`, `€/KO`. */
const PER_KILO = /\/\s*k[g9o0q]\b/i;

/**
 * A weight line whose kilos the OCR did not read as a weight — `|, 196 kg Xx
 * 1,79 + EUR/kg`, `087 k9 Xx 2,69 EUR/KO`, `0.7205 Ka X 77.49 €£/K` — but
 * which is still no article.
 */
const LOOSE_WEIGHT =
  /(?:eur|€)[^\s\w]{0,2}\s*\/\s*(?:k[g9o0q]?(?!\p{L})|\)|$)|\bk[g9o0q]\s*[x×]/iu;

/** Where a weight line's `€/kg` starts. */
const PER_KILO_MARKER = /(?:eur|€)[^\s\w]{0,2}\s*\//i;

interface WeightLine {
  /** The kilos, when they read as a weight. */
  kilos?: number;
  /** The digits printed before `kg` when they did not. */
  fragment?: string;
  perKilo?: number;
  price?: number;
}

/**
 * A weighed line: `0,462 kg x 1,19 EUR/kg` (Lidl, under the line that carries
 * the price) or `1,234 kg 1,99 €/kg 2,46` (Mercadona, under the name). The
 * kilos, the price a kilo, and the line total when the line prints one after
 * the price a kilo.
 */
function parseWeightLine(line: string): WeightLine | null {
  const kilos = line.match(KILOS);
  if (kilos?.index !== undefined) {
    const rest = line.slice(kilos.index + kilos[0].length);
    const perKilo = rest.match(PER_KILO);
    if (perKilo?.index !== undefined) {
      const price = amountsIn(rest.slice(perKilo.index)).at(-1);
      const unit = amountsIn(rest.slice(0, perKilo.index)).at(-1);
      return {
        kilos: parseDecimal(kilos[1]),
        perKilo: unit === undefined ? undefined : parseEsAmount(unit),
        price: price === undefined ? undefined : parseEsAmount(price),
      };
    }
  }
  if (!LOOSE_WEIGHT.test(line)) return null;
  const marker = line.search(PER_KILO_MARKER);
  const unit = amountsIn(marker < 0 ? line : line.slice(0, marker)).at(-1);
  return {
    fragment: line.match(/(\d+)\s*k[g9o0q]/i)?.[1],
    perKilo: unit === undefined ? undefined : parseEsAmount(unit),
  };
}

/**
 * The kilos of a weight line the OCR mangled, from the article above it:
 * its price over the price a kilo — taken only when it ends in the digits
 * the OCR did read (`2,14 € ÷ 1,79 €/kg` is 1,196 kg, and the line said
 * `196 kg`).
 */
function kilosFromPrice(
  article: ParsedItem | undefined,
  weight: WeightLine,
): number | undefined {
  if (!article || !weight.perKilo || !weight.fragment) return undefined;
  const kilos =
    Math.round((article.parsedPrice / weight.perKilo) * 1000) / 1000;
  const grams = String(Math.round(kilos * 1000));
  return weight.fragment.length >= 2 &&
    grams.endsWith(weight.fragment.slice(-2))
    ? kilos
    : undefined;
}

/**
 * DIA prints the kilos on the article's own line, `COSTILLA TRASERO ÁN 0.545
 * KILOS 3.79`, with the price a kilo on the line below — and the OCR may run
 * noise into the gap, `FILETES DE AÑOJO 14-:0.715 KILOS!`.
 *
 * Not a whole number of kilos, `ARROZ 1.000 KG 1,20`, `PATATAS 5,000 KG`:
 * that is a packet's net weight, and a scale never lands on it.
 *
 * Found in steps rather than by one pattern: `^(.*\p{L}{3}.*?)[\s:;-]+…`
 * walked the line from every point of it, and a line of separators took
 * seconds.
 */
function parseWeighedArticle(line: string): ParsedItem | null {
  const weight = line.match(KILOS);
  if (
    weight?.index === undefined ||
    !/[\s:;-]/.test(line[weight.index - 1] ?? "")
  ) {
    return null;
  }
  const rest = line.slice(weight.index + weight[0].length);
  if (PER_KILO.test(rest) || /[.,]000$/.test(weight[1])) return null;
  let end = weight.index;
  while (end > 0 && /[\s:;-]/.test(line[end - 1])) end--;
  const price = amountsIn(rest).at(-1);
  const name = cleanProductName(line.slice(0, end));
  if (price === undefined || !hasAWord(name)) return null;
  return {
    rawText: line,
    parsedName: name,
    parsedPrice: parseEsAmount(price),
    parsedQuantity: parseDecimal(weight[1]),
  };
}

/**
 * DIA's price a unit under the name it prices, `0,90 €/U 2,70 B` — read
 * `eLo 90 €/U0 2,70 B`, whose garbled start would otherwise name the
 * article. The amount after the `€/U` is the line total; a count only when
 * an amount before it multiplies out to that.
 */
function perUnitLine(line: string, name: string): ParsedItem | null {
  const marker = line.search(/(?:€|eur)\s*\/\s*u/i);
  if (marker < 0) return null;
  const total = amountsIn(line.slice(marker)).at(-1);
  if (total === undefined) return null;
  const price = parseEsAmount(total);
  const unit = amountsIn(line.slice(0, marker)).at(-1);
  const settled =
    unit === undefined
      ? undefined
      : countFromRatio(line, parseEsAmount(unit), price);
  const parsedName = cleanProductName(name);
  if (!hasAWord(parsedName) || price <= 0) return null;
  return {
    rawText: `${name}\n${line}`,
    parsedName,
    parsedPrice: price,
    parsedQuantity: settled?.quantity,
  };
}

/** DIA's `PRECIO KILO 6.95` under a weighed article. */
const PER_KILO_LINE = /^\W*precio\s*(?:kilo|kg|ud)\b/;

/**
 * The price a kilo checks the weighed article above it: when the kilos
 * times it is one digit away from the price read, the price was misread.
 */
function checkAgainstPerKilo(article: ParsedItem | undefined, line: string) {
  const perKilo = amountsIn(line).at(0);
  if (!article?.parsedQuantity || perKilo === undefined) return;
  const price =
    Math.round(article.parsedQuantity * parseEsAmount(perKilo) * 100) / 100;
  if (oneDigitApart(cents(price), cents(article.parsedPrice))) {
    article.parsedPrice = price;
  }
  article.rawText += `\n${line}`;
}

interface CountLine {
  count: number;
  unitPrice: number;
  total?: number;
}

/**
 * A line that only counts: `3 ud 0,19 €/ud` (Bonpreu), `6 x 0,55 €` (Spar),
 * `8X 0,48 3,84` (Eroski), `2 Uni. x 2,50 Euro/Uni. 5,00` — under the name
 * it counts, or, at Alcampo, above it (`2 x 1,49` over `AGUA AUCHAN X6
 * 2,98`).
 */
const COUNT_LINE = new RegExp(
  String.raw`^(\d{1,3})\s*(?:[x×]|(?:uds?|unid?t?s?)\.?(?:\s*[,.]?\s*[x×*])?)\s*(${AMOUNT_SOURCE})(?:\s*(?:€|eur|euro)?\s*\/\s*(?:uni|uds?|unid)\b)?(?:[^\d]*?(${AMOUNT_SOURCE}))?`,
  "iu",
);

function parseCountLine(line: string): CountLine | null {
  const match = line.match(COUNT_LINE);
  if (!match) return null;
  return {
    count: Number(match[1]),
    unitPrice: parseEsAmount(match[2]),
    total: match[3] === undefined ? undefined : parseEsAmount(match[3]),
  };
}

/**
 * Gives `article` the count of a count line beside it when the count and
 * its unit price make the article's price. Whether it did.
 */
function countsFor(
  counted: CountLine,
  article: ParsedItem | undefined,
  line: string | undefined,
): boolean {
  if (
    !article ||
    article.parsedQuantity !== undefined ||
    cents(article.parsedPrice) !== cents(counted.count * counted.unitPrice)
  ) {
    return false;
  }
  article.parsedQuantity = counted.count;
  if (line) article.rawText += `\n${line}`;
  return true;
}

/**
 * A line that closes the list of articles: the total, however the till
 * labels it, the payment or the article count. Not a subtotal, and not the
 * totals that count rather than charge — `TOTAL ARTÍCULOS`, `TOTAL
 * PROMOCIONES`, `TOTAL AHORRO`.
 */
function endsTheItems(
  line: string,
  items: ParsedItem[],
  discounts: number,
): boolean {
  const normalised = normalizeText(line);
  return (
    closesTheItems(normalised, items, discounts) ||
    isDamagedTotal(line) ||
    PAYMENT_LINE.test(normalised) ||
    ARTICLE_COUNT.test(normalised)
  );
}

/**
 * Whether the line's total label closes the articles. A label after a word
 * may be part of a name — `DENTIFRICO COLGATE TOTAL 2,99`, `YOGUR FAGE TOTAL
 * 0% 2,15` closed the articles, and every line below the toothpaste was lost
 * — so there it closes them only when its amount is what the articles come
 * to (`IVA INCLOS TOTAL) 3,29`), when the line has no number at all (Eroski's
 * `NUEVO TOTAL`, its amount on the line below), or when it says `A PAGAR`
 * (`5 ART. TOTAL A PAGAR: 1425`), which no article is called.
 */
function closesTheItems(
  normalised: string,
  items: ParsedItem[],
  discounts: number,
): boolean {
  const label = normalised.match(CLOSES_THE_ITEMS);
  if (label?.index === undefined) return false;
  const after = normalised.slice(label.index + label[0].length);
  if (
    !hasAWord(normalised.slice(0, label.index)) ||
    /\bpagar\b/.test(label[0] + after)
  ) {
    return true;
  }
  const amount = amountsIn(after).at(-1);
  if (amount === undefined) return !/\d/.test(after);
  const sum = items.reduce((total, item) => total + cents(item.parsedPrice), 0);
  const charged = cents(parseEsAmount(amount));
  return [sum, sum - cents(discounts)].some(
    (articles) => Math.abs(articles - charged) <= 1,
  );
}

/**
 * A line that pays: cash, card, the change. It ends the articles even when
 * the total above it was lost — `N TARJETA 7,4"` on a Mercadona ticket whose
 * `TOTAL` the OCR never read. A bare `TARJETA` only with nothing but a number
 * after it, since `TARJETA REGALO 25,00` is a gift card bought and `TARJETA
 * CLUB DIA ****1234` heads the loyalty block, not the payment. The number
 * starts with a digit: written `[\d.,]+` between two `\W*`, a dot leader
 * (`TARJETA ......`) could be split between them every way there is, and
 * 2000 dots took seconds.
 */
const PAYMENT_LINE =
  /^\W*(?:\p{L}{1,2}\s+)?(?:efectivo|entregad[oa]|entrega|pagado|pago\b|visa|master[\s-]?card|[cl]ambio|a\s+devolver|tar[jg]eta\s+(?:bancari|cred|deb|contactless)|tar[jg]eta\W*\d(?:[.,]?\d)*\W*$)/u;

/**
 * The header of the tax table: `BASE IMPONIBLE CUOTA`, Catalan `BASE
 * IMPOSABLE QUOTA`, `IVA% 10%`, Lidl's `IVA% IVA + P Neto = PVP` (also read
 * `TVA%`). Mercadona's rows under it — `Peal 2:08 0,10`, `Miras 72 7,0%
 * 0.63` — have a word and an amount, and were booked as articles.
 */
const TAX_TABLE_HEADER =
  /\b(?:base\s+i[mn]p\w*|imposable|imponible|cuota|quota)\b|^\W*[i1lt][vy]a\s*%|\bneto\b.*\b(?:bruto|pvp)\b/;

/**
 * Below the tax table or the loyalty block no label is the charge. Not a
 * saving: DIA prints `AHORRO CLUB DIA 0,40` between `TOTAL COMPRA` and the
 * `TOTAL A PAGAR` that is the charge (`saved` in `witnesses`).
 */
const STOPS_THE_TOTAL = new RegExp(
  String.raw`${TAX_TABLE_HEADER.source}|\b(?:ventajas|puntos|saldo|cupones\s+obtenidos)`,
);

/**
 * `12 ARTICULOS 25,30`: the count of articles, printed with their sum — also
 * after the paper's edge, `mea 2 ART TOT COMPRA: 69,80`, whose label comes
 * after a word and whose amount the misread articles did not make.
 */
const ARTICLE_COUNT =
  /^\W*(?:\p{L}{1,3}\s+)?\d+\s+art(?:s|\.|iculos)?\b.*\d[.,]\d{2}/u;

/**
 * The chain the ticket is from, trying the surest reading first:
 *
 * 1. A known name in the header, as a word, on a line with no amount —
 *    Caprabo sells `CAFE MOLIDO MEZCLA EROSKI 0,99`, and an article is not
 *    the shop.
 * 2. The same with the logo's glyphs folded (`glyphFolded`), or one letter
 *    off for names of seven letters or more — the logo's font reads
 *    `CARREFQURI`; a shorter name one letter off is another word
 *    (`CONSUMO`).
 * 3. The chain's marks anywhere on the ticket (`STORE_MARKS`, `TAX_IDS`),
 *    or its name two letters off on the card slip's `ESTABLECIMIENTO` line.
 * 4. A known name of seven letters or more anywhere, on a line with no
 *    amount.
 */
function extractStoreName(lines: string[]): string | undefined {
  const words = lines.map((line) =>
    amountsIn(line).length > 0
      ? []
      : normalizeText(line)
          .replace(/[^a-z0-9\s]/g, " ")
          .split(/\s+/)
          .filter(Boolean),
  );
  // A logo printed letter-spaced, `A L D I`, is one word.
  const header = words
    .slice(0, 8)
    .map((line) =>
      line.length >= 3 && line.every((word) => word.length === 1)
        ? [line.join("")]
        : line,
    );

  for (const line of header) {
    const store = storeNamed(line);
    if (store) return store;
    // `SUPERMERCADO EL CORTE INGLES` matched above; this names the rest.
    if (
      /^(?:supermercado|tienda|comercio)$/.test(line[0] ?? "") &&
      line.length > 1
    ) {
      return line.slice(1).join(" ");
    }
  }
  for (const line of header) {
    for (const word of line) {
      const read = word.replace(/[q0]/g, "o").replace(/1/g, "i");
      const folded = glyphFolded(word);
      const store = Object.keys(STORE_ALIASES).find(
        (name, k) =>
          folded === FOLDED_ALIASES[k] ||
          (name.length >= 7 && withinOneEdit(read, name)),
      );
      if (store) return STORE_ALIASES[store];
    }
  }

  const whole = normalizeText(lines.join("\n"));
  const marked = STORE_MARKS.find(([mark]) => mark.test(whole))?.[1];
  if (marked) return marked;
  for (const line of lines) {
    if (!TAX_ID_LINE.test(normalizeText(line))) continue;
    const digits = line.replace(/\D/g, "");
    const owner = TAX_IDS.find(([body]) => digits.includes(body))?.[1];
    if (owner) return owner;
  }
  // The card slip names the shop, `ESTABLECIMIENTO: ALCEPPO C.MEDINACELI`:
  // a line that says it is the shop's name may be two letters off.
  for (const line of lines) {
    const normalised = normalizeText(line);
    if (!/establecimiento|comercio/.test(normalised)) continue;
    for (const word of normalised.match(/[a-z]{6,}/g) ?? []) {
      const store = Object.keys(STORE_ALIASES).find(
        (name) => /^[a-z]{6,}$/.test(name) && editDistance(word, name) <= 2,
      );
      if (store) return STORE_ALIASES[store];
    }
  }
  for (const line of words) {
    const store = storeNamed(line.filter((word) => word.length >= 7));
    if (store) return store;
  }
  return undefined;
}

/**
 * The known chain `words` name, as whole words. A substring test found "dia"
 * in "AVDA. DIAGONAL" and "MEDIA MARKT", "consum" in "CONSUMIDOR" and "spar"
 * in "ESPARRAGO", and the receipt was filed against a shop it never came
 * from.
 */
function storeNamed(words: string[]): string | undefined {
  const text = ` ${words.join(" ")} `;
  const name = Object.keys(STORE_ALIASES).find((store) =>
    text.includes(` ${store} `),
  );
  return name === undefined ? undefined : STORE_ALIASES[name];
}

/**
 * A word with the glyphs a logo's font is read as folded together — `AIDI`
 * for `ALDI`, `CADIS` for `GADIS` — so a name of any length matches its
 * misreading exactly, where one edit off is only safe for long names.
 */
function glyphFolded(word: string): string {
  return word.replace(/[0q]/g, "o").replace(/[1l|]/g, "i").replace(/c/g, "g");
}

/** `STORE_ALIASES`' names folded, in its order: folded per header word, they cost 60 replaces a word. */
const FOLDED_ALIASES = Object.keys(STORE_ALIASES).map(glyphFolded);

/** How many letters must change, be added or be removed to make `a` into `b`. */
function editDistance(a: string, b: string): number {
  let row = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const next = [i];
    for (let j = 1; j <= b.length; j++) {
      next[j] = Math.min(
        row[j] + 1,
        next[j - 1] + 1,
        row[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    row = next;
  }
  return row[b.length];
}

/** Whether `a` becomes `b` by changing, adding or removing one letter. */
function withinOneEdit(a: string, b: string): boolean {
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  while (i < a.length && a[i] === b[i]) i++;
  return (
    a.slice(i + 1) === b.slice(i + 1) ||
    a.slice(i) === b.slice(i + 1) ||
    a.slice(i + 1) === b.slice(i)
  );
}

function cleanProductName(name: string): string {
  return (
    normalizeText(name)
      // A boxed tax mark after the name, `SCOTTEX MEGA 6=12R [0]`.
      // Each pattern starts at the start of its run (`(?<!…)`), or a run that
      // does not end the name is walked again from each character of it.
      .replace(/(?<!\s)\s*\[[^\]]{0,3}\]?\s*$/, "")
      .replace(/\s+/g, " ")
      .replace(/^[^a-z0-9]+/, "")
      .replace(/(?<![^a-z0-9\s])[^a-z0-9\s]+$/, "")
      .trim()
      .toLowerCase()
  );
}

function normalizeText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

export async function saveParsedItems(
  receiptId: string,
  parsed: ParsedReceipt,
): Promise<void> {
  // Imported here, not at the top: the parser also runs on the image thread
  // (`prepare-worker.ts`), which must not load a database client.
  const [{ prisma }, { ReceiptStatus, MatchStatus }] = await Promise.all([
    import("@/lib/prisma"),
    import("@/generated/prisma/client"),
  ]);
  const receipt = await prisma.receipt.findUnique({
    where: { id: receiptId },
    select: { householdId: true, storeId: true },
  });
  if (!receipt) {
    throw new NotFoundError("Receipt not found");
  }

  await prisma.$transaction(async (tx) => {
    // Replace, never append: this ran once per upload until the 2026-08-29
    // review asked what a second run does — it doubled every line, and a
    // doubled line double-books stock on apply.
    await tx.receiptItem.deleteMany({ where: { receiptId } });

    // Update receipt with parsed metadata
    await tx.receipt.update({
      where: { id: receiptId },
      data: {
        purchaseDate: parsed.purchaseDate,
        totalAmount: parsed.totalAmount,
        status: ReceiptStatus.PARSED,
      },
    });

    // Find or create the store the header names — only when the receipt has
    // none. A store chosen at upload is the person's answer and the header
    // is a guess at it: this used to overwrite the one with the other, so
    // choosing "Mercadona" and scanning a ticket whose header read as
    // something else filed its prices under the something else.
    if (parsed.storeName && receipt.storeId === null) {
      const existingStore = await tx.store.findFirst({
        where: {
          name: { equals: parsed.storeName, mode: "insensitive" },
          householdId: receipt.householdId,
        },
      });

      const store =
        existingStore ??
        (await tx.store.create({
          data: {
            name: parsed.storeName,
            householdId: receipt.householdId,
          },
        }));

      await tx.receipt.update({
        where: { id: receiptId },
        data: { storeId: store.id },
      });
    }

    // Create receipt items
    for (const item of parsed.items) {
      await tx.receiptItem.create({
        data: {
          receiptId,
          rawText: item.rawText,
          parsedName: item.parsedName,
          parsedPrice: item.parsedPrice,
          parsedQuantity: item.parsedQuantity ?? 1,
          matchStatus: MatchStatus.PENDING,
        },
      });
    }
  });
}
