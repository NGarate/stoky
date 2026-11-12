# Long receipts: several photographs, and fixing what the reading doubts — 2026-11-06

Status: **plan for the owner, not a decision.** `REDESIGN_PLAN.md` owns what
comes next; nothing here is scheduled until it is moved there.

What the owner asked for, on 2026-11-06:

1. **Offer both**: one photograph, or several overlapping ones, recommending
   several for very long tickets.
2. **A visual guide** while taking them.
3. **A larger limit per photograph.**
4. **After reading, point at what it doubts**, and let the person re-photograph
   that part or type the lines in.

Several photos are read one by one and their texts merged (option A). The
owner chose that over stitching the images (B) and over a live video "scroll"
(C).

---

## 0. Evidence, and how to check it again

**Re-check all of this when there are more tickets.** Ten tickets choose
settings; they do not prove them. Everything below was measured with the
bench in `test-tickets/bench/`, which is kept beside the photos. Its
`README.md` says how to add a ticket and what each script answers. The photos
and the bench are not in git: they are the owner's receipts.

### Everything tried, 2026-11-06

| # | Tried | Measured on | Result | Kept? |
|---|---|---|---|---|
| 1 | Image pipeline: rectify (trust-gated) → flatten light → orient by proportions and text → dewarp → two readings at 300 dpi (`pipeline/final.json`) | 9 real + 30 degraded photos | 89% against 27% for the application before it; real tickets 44% → 90%, rotated 0% → 87–90%, shadowed 28% → 90% | Yes, as a plan: not in the application yet |
| 2 | Removing blobs that cannot be text (`clean`) | same | Erased real text touching a shadow | No |
| 3 | Closing the background before dividing it out | same | Helped two validation tickets, cost 8586 0.65 points | Off by default |
| 4 | Running steps only when the ticket seems to need them | same | Saves ~0.2 s a step; only the safety gates (rectify trust, dewarp ≥ ½ line) help | Only the gates |
| 5 | `tessdata_best` instead of `tessdata_fast` | new Costco photo | 0.64 against 0.77 | No |
| 6 | Pipeline at 2000 px instead of 1400 | new Costco photo | 0.60 against 0.77 | No |
| 7 | Costco in four overlapping photos, merged | Costco | Merge right in any order; 0.56–0.68 against 0.77 whole | Plan only (§3–§4) |
| 8 | Ink thickened (3 × 3 min) | Costco | 0.40 against 0.77 | No |
| 9 | Ink thinned (3 × 3 max) and smaller scales | Costco | Thinned 0.68; 0.5 × scale 0.82; one pass at 0.7 × 0.87 | Led to #11 |
| 10 | Tesseract's alternative symbols (`lstm_choice_mode`) | Costco | No second choice offered for the misread digits | No |
| 11 | 24 readings per ticket, three ways to choose | 10 tickets | Consensus 0.901, `readingScore` 0.861, two readings 0.871 | Led to #12 |
| 12 | Every subset of the 24, leave-one-out | 10 tickets | **6 readings 0.945**; 2 0.82, 4 0.92, 8 0.93 | **Yes, in the application** |
| 13 | 1, 2, 3, 6 workers in parallel | Costco, 6 readings | 37.8, 20.7, 16.1, 14.0 s; identical text | **2 by default, `OCR_WORKERS`** |
| 14 | Flagging a line by `qty × unit ≠ amount` or word confidence < 70 | Costco | Catches 1–2 of 3 wrong lines, flags 5 right ones | As a pointer in review (§5) |
| 15 | Choosing digits so the lines add up to the total | Costco | No combination, or four | No |
| 16 | Voting line by line across the 24 readings | Costco | Too few article lines found to judge | Inconclusive |
| 17 | Six readings on the application's own preparation (no image pipeline), against the application's two passes | 10 real + 30 degraded | **Worse: 0.294 against 0.350.** Upside-down copies 0.21 → 0.03, the pharmacy 0.85 → 0.10, 8586 dark 0.70 → 0.05; turned 90° 0.23 → 0.35; 21 s against 33 s a ticket | **No, not without #1** |
| 18 | #1's pipeline ported into the application (`image.ts`, `ocr.ts`) | 39 photos | Prepared image **identical pixel for pixel** to the bench's on 39 of 39 (`port-check.ts`) | Yes |
| 19 | The application with #18 + #12, 2 workers, against the application before | 10 real + 30 degraded | **0.350 → 0.929**, 33 s → 16 s a ticket; real 0.48 → 0.94, validation 0.83 → 0.97, rotated 0.22 → 0.92, dark 0.34 → 0.94, small 0.36 → 0.92, shadowed 0.28 → 0.92; **no ticket worse** (`prod6.ts`, `app-final.log`) | **Yes** |
| 20 | The six readings interleaved (ink 0.4, thin 0.4, …) instead of in the measured order | same | 0.918: the pharmacy 0.95 → 0.65, because `bestReading` keeps the first of equals | Measured order kept; **fragile**, see below |
| 22 | The same, with the model the production image bakes (`tessdata_fast` 4.1.0) instead of the development one (`@tesseract.js-data/spa` 4.0.0 `best_int`, which every row above used) | 10 real + 30 degraded | Before 0.321 (23 s) → now **0.891** (12 s). Worse than before on two: the pharmacy 0.50 → 0.05 (reads `16,05` as `16,03` in all six), new Costco 0.95 → 0.86 | Yes; see "the model" below |
| 24 | A new pharmacy ticket on a light floral cloth (`test-tickets/1794088010070.HEIC`, bench id `0070`) | 1 photo | 0.65 with `best_int` and with `tessdata_fast`. The article lines read nearly right, but the corners were not trusted and the crop kept the cloth, whose flowers read as junk beside every line and swallowed the large-print total; the junk also made the card payment (13,01) and the phone number (0,04) parse as articles. The returned item's negative line (−6,15) is taken as a discount, rightly, when the text is clean | Open: ISSUES.md OCR-8 |
| 21 | How long preparing blocks the server's event loop (`block-time.ts`, `block-old.ts`) | 4 photos | Longest stall 0.73–2.46 s, 1.0–3.1 s in all per photo; before, 0.02–0.64 s and 0–1.3 s | Led to #23 |
| 23 | The preparation's pixel work on a thread of its own (`prepare-worker.ts`); orientation stays on the server's thread | 4 photos | Longest stall **0.06–0.09 s**. The bundled worker chunk ran under Bun in a production build's standalone output | **Yes** |

### Options still open

| Option | Where it stands | Next step |
|---|---|---|
| Image pipeline into the application (#1) | Measured, not integrated | Its own commits, before §6 step 2 (line boxes) |
| Fine-tuning Tesseract on receipt lines | Recommended for the Costco digits (§1b) | A trial in the bench; needs a pinned training image and ~300 corrected lines |
| PaddleOCR as a second voter | Unmeasured; ~258 MB of native binaries | Only if fine-tuning fails |
| Several photos per ticket | Merge works; the reading of the parts did not beat the whole | More long tickets, whole and in parts |
| The ticket's own arithmetic (VAT subtotals, printed count, repeated codes, price history) | Sound as a pointer, not as a corrector | §5 |
| Re-reading a doubtful part | Done 2026-11-12 on the stored photo, not a new one: in review the person frames one article's lines (`receipt.readRegion`) and they are read alone. On the owner's Costco ticket (`1793995353694.HEIC`), three framed articles, about 3 s each: Moras and LEGO read their prices right (5,49, 39,99); Flor de Vetu read 6,93 for 6,99 and took its code line for its name, and Moras's «340g» read «3409» — OCR-9's digits | Re-photographing a part stays open |

### Six readings need the image pipeline

#12 was measured on images the pipeline of #1 had prepared: rectified,
flattened, turned upright and dewarped. On what the application prepares today
(a crop and grey), the same six readings score lower than the two passes they
replace (#17). Two causes are visible in the per-ticket results:

- **The upside-down retry stops firing.** It runs only when no reading yields
  an article. Of six readings of a ticket upside down, one usually yields some
  garbage "article", so the retry never happens. The pipeline orients by text,
  so it never needed the retry.
- **Small readings of an unflattened photo lose the faint and shadowed
  text** (the pharmacy, the dark copies) that flattening had restored.

So the six readings come **after** the image pipeline is integrated, not
before. #12's 0.876 for "two readings" and the application's 0.35 are not the
same baseline: the first is two readings of the pipeline's image, the second
is the application as it is.

### Implemented on 2026-11-06 and 07 (uncommitted)

- **The image pipeline** (#1), in `src/server/services/image.ts`:
  `straightenedTicket` (corners, trust gates, perspective), `croppedTicket`,
  `flattenedLight`, `dewarped`, `thinned`, and the turns. `prepareForOcr` in
  `ocr.ts` runs them, with `upright` turning the ticket by proportions and
  then by Tesseract's confidence. The upside-down retry is gone: orientation
  replaces it.
- **Six readings** (`OCR_READINGS`): Sauvola at 0.4, 0.6 and 0.7 of the
  prepared width, ink as it is then thinned, in that order. The reading the
  others agree with is kept (`bestReading`).
- **`OCR_WORKERS`**: the readings and the orientation judgements run in
  parallel over that many workers, 2 unless `.env` says otherwise
  (`deploy/docker-compose.yml`, `deploy/example.env`, `docs/INSTALL.md`).
  Each worker keeps its own queue and time limit.

### Known weaknesses of what is implemented

- ~~The event loop stalls while a photo is prepared~~ (#21): fixed by #23.
  Not checked under `next dev`, only with `bun test` and a production build.
- **Ties decide some tickets** (#20). Re-check the order whenever readings
  change, and prefer a tie-break that does not depend on order, such as the
  higher Tesseract confidence, once there are tickets to measure it on.
- **A dark area touching the crop's edge is blanked as table**: shadowed text
  in the first or last two blocks of the ticket can be lost. This was a
  measured trade, and it is pinned in `ocr-prepare.test.ts`.
- **A light or patterned background** (#24, and the first pharmacy ticket
  before the six readings): the paper is not told apart from it, so the crop
  keeps it and it reads as junk. Cropping to the text's extent instead of the
  paper's is the idea not yet tried.
- **Costco's `4` read as `9`** remains (§1b): Costco 0.73 and 0.87, the rest
  0.95–1.
- ~~**The model.**~~ Resolved 2026-11-07: the image bakes `best_int`.
  Development reads with `@tesseract.js-data/spa` 4.0.0
  `best_int`, which tesseract.js downloads by default and is the
  `spa.traineddata` at the repository root (SHA-256 `00623777…`). The
  production image bakes `tessdata_fast` 4.1.0 (`6f2e04d0…`). Every setting
  was chosen with the first. On the 40 photos, the new reading scores 0.929
  with it and 0.891 with the second, and the two models misread different
  digits (`4`→`9` with one, `5`→`3` with the other). Baking `best_int` would
  give production what was measured, at 3.4 MB against 2.3 MB and somewhat
  slower readings. That is the owner's call, and a `Dockerfile` change of its
  own. Every Spanish model there is, measured on 2026-11-07 (the application
  as committed, 40 photos; seconds for six readings of the long Costco photo
  on an idle 8-core host; memory is RSS):

  | Model | File | Score (40) | Real / validation / degraded | Six readings, 1 → 2 workers | Memory per worker |
  |---|---|---|---|---|---|
  | `tessdata_fast` 4.1.0 (baked until 2026-11-07) | 2.3 MB | 0.891 | 0.91 / 0.53 / 0.91 | 26 → 14 s | ~120 MB |
  | `@tesseract.js-data/spa` 4.0.0 `best_int` (**baked since 2026-11-07**) | 3.4 MB | **0.929** | 0.94 / 0.97 / 0.92 | 41 → 22 s | ~125 MB |
  | `tessdata_best` (float) | 13.6 MB | 0.919 | 0.89 / 0.97 / 0.92 | 60 → 32 s | ~150 MB |
  | `tessdata` 4.0.0, LSTM engine | 18.3 MB | 0.929 | 0.94 / 0.97 / 0.92 | 40 → 22 s | ~135 MB |
  | `tessdata` 4.0.0, legacy engine | 18.3 MB | 0.811 | 0.82 / 0.59 / 0.82 | 72 → 41 s | ~160 MB |
  | `tessdata` 4.0.0, both engines | 18.3 MB | 0.920 | 0.92 / 0.97 / 0.92 | 42 → 23 s | ~150 MB |

  `tessdata`'s LSTM engine scores exactly as `best_int` does, at five times
  the file: it is the same network (the weights are identical; `best_int`
  stores its scale factors at single precision), plus the legacy engine's
  data. The legacy engine is worse, slower, and **not deterministic**: two
  workers gave different text for the same images, because it adapts to what
  it has already read. By ticket, `best_int` against `fast`: better on the
  pharmacy (0.05 → 0.95) and on 8875 and its copies (0.65 → 1); worse on the
  old Costco crop and most of its copies (0.87 → 0.73, its small and
  shadowed copies 0.83 → 0.60); the rest within 0.05.

---

## 1. What was measured first

The owner photographed the Costco ticket again, once whole and once in four
overlapping parts (`test-tickets/1793995353694.HEIC`,
`test-tickets/overlapped-costco/`). Each reading went through the
bench's image pipeline (`test-tickets/bench/pipeline/`: rectify with trust gates, flatten, orient by text,
dewarp, two Tesseract passes) and was graded against the ticket's 15 prices,
total and date.

| Reading | Ticket width in the photo | Score |
|---|---|---|
| Old photo, cropped in the phone's gallery | 875 px | 0.60 |
| **New photo, whole** | **~700 px** | **0.77** |
| Four parts, merged, pipeline at 1400 px | ~2000 px | 0.56 |
| Four parts, merged, pipeline at 2000 px | ~2000 px | 0.68 |
| New whole photo, Tesseract `tessdata_best` model | ~700 px | 0.64 |
| New whole photo, pipeline at 2000 px | ~700 px | 0.60 |

What follows from it:

- **Resolution is not what fails.** The whole photo has the narrowest ticket
  and reads best. The misreads are the same in every version: this Costco
  font's `4` is read as `9` (`7,49` → `7,99`, `8515604V` → `8515609V`), and
  `9`/`3` are confused. The prepared image is perfectly legible to a person.
  Neither a larger model nor a larger scale fixes it.
- **The merge works.** Given the four parts in any order — reversed, or
  shuffled — it found the right order and kept every article line once.
  The lower scores come from reading the parts, not from joining them: the
  two middle parts lie at 10–12° on a wood table, where the corner detection is not
  trusted, and the top part reads worse than the same lines in the whole photo.
- **Several photos are therefore not shown to help yet**, for this ticket.
  They are still needed for a ticket that does not fit in one frame at all.
  The recommendation in the interface is worded for that case (§4) until more
  long tickets say otherwise.
- **What reliably says "this reading is wrong" is the ticket itself**
  (`test-tickets/bench/parts/`: `doubts.ts`, `fixsum.ts`, `conf.ts`). All three
  Costco readings add up to the wrong amount (180.29, 178.89 and 172.99
  against a printed 170.30), and have 16 lines against the printed
  `TOTAL ARTS: 15`.
- **Per line the signals are weaker.** On the whole photo, flagging a line
  whose `qty × unit ≠ amount`, or whose amount Tesseract is less than ~70%
  sure of, catches one or two of the three wrong lines. It also flags five
  that are right. Picking automatically the digits that make the sum match
  found no combination, or four different ones. **So the reading should point
  and the person decides**; it should not correct anything automatically.

### 1b. The font, and what can be done about it

The owner allows ten minutes or more per ticket, so spending time on OCR is
not a constraint. Measured on the ten tickets (`test-tickets/bench/many.ts`): each
ticket is prepared once and then read **24 times**. The readings cover 6
scales (0.4–1 of the pipeline's 1400 px), the ink as it is and thinned by a
3×3 max filter, and both Tesseract thresholds (Otsu and Sauvola). The
question is how to pick the result.

| Ticket | Today's 2 readings | Best of 24 by `readingScore` | **Consensus of 24** | Best of 24 in hindsight |
|---|---|---|---|---|
| 7791, 8586, 8875 | 1 | 1 | 1 | 1 |
| 8343 | 0.8 | 0.9 | **1** | 1 |
| 9179, 9199 | 0.95 | 0.8 | 0.95 | 0.95 |
| merc1 (validation) | 0.94 | 1 | **1** | 1 |
| mine1, pharmacy (validation) | 0.70 | 0.95 | **0.95** | 0.95 |
| 9498, old Costco | 0.60 | 0.60 | 0.60 | 0.73 |
| Costco, new whole photo | 0.77 | 0.56 | 0.56 | 0.87 |
| **Mean** | **0.871** | 0.861 | **0.901** | 0.945 |

**Consensus** takes the readings whose articles add up to the total, if any
do, and among them the one whose prices agree most with all the others. It
improves 3 tickets, including the pharmacy that no image step had fixed, and
makes none worse except the Costco. Small scales (0.4–0.7, i.e. ~560–980 px
across the ticket) are where most tickets' best readings are, which says the
pipeline's 1400 px is too large for Tesseract.

**24 readings are too many: fewer, chosen well, do better.** Every subset
the grid allows was scored from the saved readings (`subsets.ts`, 567
subsets). To keep that from fitting these ten tickets, each size was also
chosen on nine tickets and scored on the tenth (leave-one-out):

| Readings | Best subset, all 10 tickets | Leave-one-out |
|---|---|---|
| 2 (today: Otsu + Sauvola at 1×) | 0.876 | — |
| 2 | 0.904 | 0.822 |
| 4 | 0.931 | 0.918 |
| **6** | **0.945** | **0.945** |
| 8 | 0.945 | 0.932 |
| 24 | 0.901 | — |

The six are all Sauvola, at 0.4, 0.6 and 0.7 of the prepared width, with the
ink as it is and thinned. Against today's two, no ticket gets worse and four
get better: 8343 goes from 0.80 to 1, merc1 from 0.94 to 1, the pharmacy
from 0.70 to 0.95, and the Costco from 0.77 to 0.87 (the old crop from 0.60
to 0.73). More readings let more wrong readings agree with one another.
Otsu adds nothing once Sauvola is read at several scales. Ten tickets are
still ten tickets: the subset is re-checked when more tickets arrive.

**In parallel.** `tesseract.js`'s `createScheduler` spreads the readings over
several workers, each in its own thread (`par.ts`). Bun runs them as
`worker_threads`. Six readings of the Costco photo on this 8-core machine:

| Workers | Six readings | Memory (RSS) |
|---|---|---|
| 1 | 37.8 s | 277 MB |
| 2 | 20.7 s | 406 MB |
| **3** | **16.1 s** | 499 MB |
| 6 | 14.0 s | 889 MB |

The text is identical in every case, so parallelism changes nothing but the
time. Past three workers the slowest single reading is what is left. The
production `sharedWorker` (`ocr.ts:88`) becomes a scheduler of
`OCR_WORKERS` workers, defaulting to 3 and capped at the CPU count less one.
A small household server sets it lower, at about 120 MB per worker. The
orientation step's two band readings run in parallel the same way.

**Costco improves but is not right**, because its error is systematic: most
readings mistake the same `4` for a `9`. A line-by-line vote across the 24
readings, counting a line double when `qty × unit = amount`, was tried and
found too few article lines to say anything (`vote.ts`). What remains for a
font the model reads wrongly:

| Option | What | Cost | Risk |
|---|---|---|---|
| **Fine-tune Tesseract** | `tesstrain`, starting from `tessdata_best` `spa`, on line images cut from these tickets with their corrected text (~300 article lines from 10 tickets), exported as a `fast` model in place of `spa.traineddata` (baked, pinned and checksummed as OCR-1 left it). Published fine-tunes report large gains on digits in a difficult font. | A training image (pinned, in Docker, project-managed); a few hours of correcting line text | Overfitting to ten tickets: needs tickets held out, as the bench already does |
| **Second engine** | PaddleOCR (PP-OCRv5) through `ppu-paddle-ocr` and `onnxruntime-node`, as another voter in the consensus, not a replacement | A large dependency (~258 MB native binaries per its docs). Bun compatibility not verified. | A new dependency in the image; its supply chain |
| **The ticket's own arithmetic** | VAT-class subtotals (`A 21% base + IVA` = the sum of the `A` lines), the printed article count, repeated article codes sharing a price, and the household's own price history for that product | Parser work, no dependency | Measured on Costco as a *corrector*, it found no or several answers. As a **pointer for review** (§5) it is sound. |

Recommended order: consensus first, since it is measured and has no
dependency. Then a fine-tuning trial in `test-tickets/bench`, measured on the
held-out tickets before anything enters the image. The second engine only if
fine-tuning does not fix the Costco digits.

## 2. What others do

| Product | Long receipts |
|---|---|
| Dext | *Combine* mode: up to 50 photos, merged into one item |
| Taggun (API) | One image per request; overlap the photos and merge on your side |
| Veryfi Lens (SDK) | Stitches while capturing; asks for the paper *closer* than usual |
| Pleo, QuickBooks | Several photos, overlapping so nothing at the seam is lost |

Every source repeats the overlap. Merging OCR text from overlapping captures
is a known technique: align lines by edit distance, drop the duplicated run,
keep the rest (US 5434932; EP 4080469; the `merge_region_texts` routine of the
*historical-ocr* project).

## 3. How it fits

| Piece | Today | Change |
|---|---|---|
| Data model, `prisma/schema.prisma:359` | `Receipt.imagePath String` | `imagePaths String[]` (in reading order once merged) and `photoCount Int @default(1)`. Before the beta, regenerate the single init migration and keep its hand-written tail. |
| Request size, `src/server/http/body-limit.ts:36` | 15 MiB for every tRPC body | **Chosen by procedure.** The route sees the procedure names in the URL before reading the body. The photo procedures (`receipt.upload`, `receipt.addPhoto`) get the larger ceiling, and only when every procedure in a batched request is one of them. Everything else gets 1 MiB. The photo limit rises while every other procedure's ceiling falls (see `SECURITY_REVIEW.md` §8 for why this ceiling exists). `upload-body-limit.test.ts` moves with it. |
| Per-photo limit, `src/lib/validations/receipt.ts` | `MAX_RECEIPT_BYTES` 10 MB | 25 MB, so a 48–50 MP JPEG is accepted. `MAX_LONG_EDGE` (`image.ts:63`) still keeps 4000 px, so what is *stored* does not grow. The kept-file cap stays at 10 MB, since a 4000 px JPEG is far below it. `MAX_PIXELS` (50 M) already admits 48 MP. |
| `receipt.upload`, `receipt.ts:272` | validates, re-encodes, writes, creates the receipt, starts OCR | Takes an optional `photoCount` (1–8). With more than one, the receipt waits at `UPLOADING` and OCR does not start. |
| *(new)* `receipt.addPhoto` | — | `{ receiptId, position, fileBase64, mimeType }`. The checks are shared with `upload` in one function, so a check added to one cannot miss the other. It is refused unless the receipt is the household's, still `UPLOADING`, and `position === imagePaths.length`, so a retry cannot add a photo twice. It appends with a conditional update, and the last photo starts OCR. It is rate-limited like `upload`, because each photo is a decode and a Tesseract run. |
| OCR job, `ocr.ts:417` | reads one photo | Reads each photo, then `mergeReadings`, which also finds the order. A photo that fails to read fails the receipt. |
| `readReceiptPhoto`, `ocr.ts:374` | retries upside down when `readingScore` is 0 | **Wrong for a part**: a part without the total always scores 0. Replaced by the text-confidence orientation of the image work first. |
| Parser | — | Also reads the printed article count (`TOTAL ARTS: 15` and its equivalents) into a new `Receipt.printedItemCount Int?`. |
| Lines, `ReceiptItem` | text, name, price, quantity | Adds `doubt` (null, or why: `unitMismatch`, `lowConfidence`) and, for the photo beside it, `photo Int` plus a box `x y w h` in the prepared image. Tesseract gives line boxes when asked (`blocks: true`). |
| Prepared image | not kept | Kept beside each photo as a greyscale JPEG (~300 KB). Line boxes are in its coordinates, because it is rectified, turned and dewarped. Mapping the boxes back to the original photo would mean inverting all three transforms. |
| `receipt.getImage`, `receipt.ts:476` | the one photo | Takes `position` and `prepared: boolean`. Same procedure tier. |
| Export, `data.ts:136` | `imagePath` | `imagePaths`. |
| Offline queue | `receipt.upload` is deliberately not replayable (`src/lib/offline/storage.ts`) | Same for `addPhoto`, with `replayable.test.ts` updated to include it. |
| Disk | nothing is ever deleted (SECURITY_REVIEW #16) | Up to 8 stored photos plus their prepared images per receipt. Recorded in that review. |

### The merge (prototype: `test-tickets/bench/parts/merge.ts`)

1. **Pairwise overlap**: Smith–Waterman over lines, with an edit-distance
   similarity per line (accents folded, punctuation collapsed). An alignment
   counts only if it ends near the end of one text and starts near the start
   of the other.
2. **Order**: the chain of photos whose overlaps score highest. Up to 8
   photos, all orders can be tried. Measured: right with the four Costco parts
   in reversed and in shuffled order.
3. **Cut in the middle of each overlap**: the upper photo's lines up to the
   middle, the lower photo's from there. This drops the half-cut line at each
   photo's edge.
4. **Repeated lines** (Costco prints identical ones in a row): the middle cut
   and its two neighbours are each tried, and the merge whose lines add up to
   the total wins. That is the rule `bestReading` already applies
   (`readingScore`).
5. **No overlap found**: the texts are joined as they are. A duplicated line is
   seen in review; a lost one is not.

## 4. Capture

The first screen offers both ways:

- **Una foto** — today's flow.
- **Varias fotos** — *"Para tickets que no caben enteros en una foto."*
  This wording is deliberately not "better for long tickets": §1 did not show
  that, and it changes only if more tickets do.

**With the in-app camera** (`getUserMedia`, back camera), when the browser
allows it:

- A **frame guide**: two vertical bands to put the ticket's edges against,
  with nothing on the paper itself.
- From the second photo on, an **onion skin**: the bottom ~15% of the previous
  photo, translucent, at the top of the viewfinder, with *"Encaja estas
  líneas"*. That is how panorama capture guides overlap. It makes the overlap
  the merge needs the natural way to hold the phone.
- A part counter, **"Hacer otra"** and **"Listo"**, and a thumbnail strip to
  delete a part.
- **The capture**: `ImageCapture.takePhoto()` gives a full-resolution still
  where it exists (Chrome on Android; Safari's support is recent and should be
  checked on the device). Elsewhere, a video frame at the track's largest
  size. §1 says a ~700 px-wide ticket reads well, so a 1080p frame is enough.
- The camera handling of `src/components/barcode/Scanner.tsx` is reused:
  `cameraProblem` for permission, no camera and insecure context, the device
  choice, and stopping the stream on unmount. It is not duplicated.

**Fallback**, when the camera is refused, absent, or the page is not a secure
context: the native camera (`capture="environment"`) once per part. Before each
one, a **static hint** shows the bottom strip of the previous photo: *"Que la
siguiente empiece con estas líneas."* Choosing several images from the
gallery also works; the merge orders them.

Sending: one request per photo, with progress (*"Enviando 2 de 4"*) in the
existing `aria-live` region. A photo that fails to send can be retried, and
`position` makes the retry safe. Strings go in `messages/es.json` first, then
`en.json`.

## 5. Review: point at the doubts

On the existing review screen, with the existing components:

- **A sum check at the top**: *"Las líneas suman 180,29 € y el ticket dice
  170,30 €"*, or *"Hay 16 líneas y el ticket dice 15 artículos"*. It uses the
  `warn` tone with the words, never the colour alone. This works for every
  ticket, from one photo or several, and is the cheapest and most reliable
  signal of §1. It goes away when the numbers match.
- **Doubtful lines**: `<ItemRow>` with a `warn` badge *"Dudosa"* and the reason
  in its meta. Beside each one, **the strip of the prepared image that line was
  read from**, so the person compares it with the paper without leaving the
  row.
- **Actions** on a doubtful line, or on the receipt when the sum does not match:
  - **Corregir**, which is `receipt.updateItem`, existing.
  - **Añadir línea**, which is `receipt.addItem`, existing.
  - **Volver a fotografiar esta parte**: a close photo of that part of the
    ticket, read and aligned into the existing text with the same overlap
    alignment. The lines it reads **differently** are offered as suggestions
    next to the current ones; nothing is replaced without a tap. Whether a
    second reading fixes this font's digits is not measured, so this action
    comes last.

## 6. Steps

Each step is one commit that builds and passes its gates on its own. **The
order puts first what helps every ticket.**

0. ~~Measure~~ — done (§1). Still worth doing: two or three more long tickets
   (Lidl, Mercadona), whole and in parts, before step 7 decides how strongly
   the interface recommends several photos.
0b. `feat(ocr): read a receipt six ways and keep the reading the others agree
   with` — §1b's six readings and consensus, inside `readReceiptPhoto`, after
   the image pipeline integration it depends on. A separate commit before it,
   `perf(ocr): read with several Tesseract workers at once`, adds the
   scheduler and `OCR_WORKERS`, documented where `OCR_TIMEOUT_MS` is. `SECURITY.md`
   (~line 1273) describes one worker held for `OCR_TIMEOUT_MS`, and is
   updated to say there are `OCR_WORKERS` of them.
1. `feat(receipts): say when a receipt's lines do not add up to its total` —
   the parser's printed count, the review banner.
2. `feat(ocr): mark the lines the reading is unsure of` — `doubt`, the line
   boxes, the kept prepared image, the badge and the strip in review. This
   comes after the image pipeline is integrated, because the boxes are in its
   coordinates.
3. `feat(ocr): read a receipt from several overlapping photos' text` —
   `mergeReadings` and its tests. Nothing calls it yet.
4. `refactor(receipts): keep a receipt's photographs as an ordered list` —
   schema, migration, seed, OCR job, `getImage`, export, and the tests that name
   `imagePath`. Behaviour is unchanged.
5. `feat(receipts): accept larger receipt photographs` — the body ceiling chosen
   by procedure, 25 MB per photo.
6. `feat(receipts): accept a receipt in several photographs` — `photoCount`,
   `addPhoto`, the shared validation, the OCR job merging.
7. `feat(receipts): photograph a long receipt in parts` — the choice, the
   in-app camera with its guides, the fallback, and `docs/releases/NEXT.md`.
8. `feat(receipts): re-photograph the part of a receipt that read wrong` —
   only if step 0's extra tickets show a second reading helps.

This is a new task. It goes on its own branch from `master` after PR #19, not
onto that branch.

## 7. Tests, each checked to fail when the code is broken

- **Merge**: exact overlap; overlap with OCR differences; the half-cut line at
  a seam dropped; three identical lines at a seam resolved by the total; parts
  in reversed and in shuffled order; no overlap → joined; one text → itself.
  The Costco parts' readings become a fixture.
- **Body ceiling**: a photo procedure accepts more than 15 MiB; the same size
  to any other procedure, or batched with one, is a 413; a 2 MiB body to an
  ordinary procedure is a 413.
- **`addPhoto`**: refused for another household's receipt (NOT_FOUND), past
  `UPLOADING`, at a wrong `position`, past `photoCount`, and on bytes failing
  the magic check, which proves the validation is shared. With a fake
  `recognise`, OCR waits for the last photo and sees all of them.
- **Doubts**: the banner shows when the sum or the count is off and not when
  both match; a line with `qty × unit ≠ amount` is marked.
- **Capture**: one-photo path unchanged; the onion skin shows from the second
  photo; the fallback appears when the camera is refused; a failed send can be
  retried.
- `SMOKE_JOURNEYS.md` gains the several-photo upload and a review with a
  doubt.

## 8. Decided, and still open

- **Decided 2026-11-06: an abandoned several-photo upload is discarded.**
  "Cancelar" on the capture screen calls a new `receipt.discard`, which is
  allowed only at `UPLOADING`. A receipt left at `UPLOADING` with fewer photos
  than announced for over an hour is deleted, row and files, by a sweep beside
  `failInterruptedReceipts` (`src/server/services/receipt-recovery.ts`) and
  again at each upload. There is no scheduler to hang it on. It is the first
  thing that deletes receipt files, so SECURITY_REVIEW #16 gains the line. A
  restart already moves a waiting upload to FAILED (`INTERRUPTIBLE_STATUSES`),
  and that stays.
- **Decided 2026-11-06: time is not a constraint** — ten minutes per ticket or
  more is acceptable, and so is overnight. §1b's six readings take ~16 s with
  three workers, so they are taken on every ticket. Several photos multiply
  that. An
  overnight pass needs a scheduler the server does not have. It is worth
  building only for something that costs far more than the consensus, such as
  a second engine. A restart during a long read leaves the receipt FAILED, as
  it does today.
- **Open: 25 MB per photo and 8 photos** are proposals, not measurements of
  anyone's phone. The owner's photos are 0.3–1.2 MB HEIC.
- **Open: fine-tuning or a second engine** (§1b), each a trial in the
  bench first. Fine-tuning needs a pinned training image and the owner's
  corrected text for the line images. A second engine needs a dependency
  decision.
