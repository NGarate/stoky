/**
 * Which of a photograph's readings is kept. Apart from the OCR service so
 * that the image thread (`prepare-worker.ts`) can run it without loading
 * Tesseract or the database.
 */
import { parseReceiptText } from "./receiptParser";

/** How many of `a`'s values `b` has too, each counted once. */
function shared(a: readonly number[], b: readonly number[]): number {
  const left = [...b];
  let count = 0;
  for (const value of a) {
    const at = left.indexOf(value);
    if (at >= 0) {
      count++;
      left.splice(at, 1);
    }
  }
  return count;
}

/**
 * The reading the others agree with.
 *
 * **The readings whose articles add up to their total, if any do**, less the
 * discounts they found: a misread digit or a lost line breaks that sum.
 * **Among those, the one whose prices the other readings share most**, every
 * reading counting, so that six readings outvote one that went wrong in its
 * own way. Measured on the bench of `OCR_READINGS`: picking instead the
 * reading with the most articles, counted thrice when they added up, scored
 * 0.861 of 24 readings, against 0.901 for this, because that rewards a
 * reading for finding more lines, including lines that are not articles.
 * The first of equals.
 *
 * **With a date from another reading when it has none.** The date is one
 * short line, and which pass reads it is close to chance; the score cannot
 * weigh it — a date bonus in that article score chose worse readings. So the
 * first line of another reading that parses to a date on its own is added to
 * the end of the one kept. Measured over 111 photographs: two tickets gained
 * their date and no score fell.
 */
export function bestReading(readings: readonly string[]): string {
  const parsed = readings.map((reading) => parseReceiptText(reading));
  const prices = parsed.map(({ items }) =>
    items.map((item) => Math.round(item.parsedPrice * 100)),
  );
  const addsUp = parsed.map(({ items, totalAmount, discountAmount = 0 }) => {
    if (!totalAmount) return false;
    const sum =
      items.reduce((total, item) => total + item.parsedPrice, 0) -
      discountAmount;
    return Math.abs(sum - totalAmount) / totalAmount < 0.005;
  });
  const candidates = readings
    .map((_, index) => index)
    .filter((index) => addsUp[index] || !addsUp.includes(true));
  // Prices both readings have, less the ones only one of them has: two
  // readings that agree on everything score their length twice.
  const agreement = (index: number) =>
    prices.reduce(
      (total, other, at) =>
        at === index
          ? total
          : total +
            2 * shared(prices[index]!, other) -
            other.length -
            prices[index]!.length,
      0,
    );
  let bestIndex = candidates[0] ?? 0;
  for (const index of candidates.slice(1)) {
    if (agreement(index) > agreement(bestIndex)) bestIndex = index;
  }
  const best = readings[bestIndex] ?? "";
  if (parsed[bestIndex]?.purchaseDate) return best;
  for (const reading of readings) {
    if (reading === best) continue;
    const dated = reading
      .split("\n")
      .find((line) => parseReceiptText(line).purchaseDate);
    if (dated) return `${best}\n${dated}`;
  }
  return best;
}
