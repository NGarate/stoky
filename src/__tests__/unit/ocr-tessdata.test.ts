import { describe, it, expect, afterEach } from "bun:test";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { tessdataDirectory, workerOptions } from "@/server/services/ocr";

/**
 * ISSUES.md OCR-1 — OCR must not go to the internet to read a receipt.
 *
 * `createWorker("spa")` with no `langPath` fetches the model from jsdelivr on
 * first use and caches it in the working directory. The production image
 * carries neither: its root filesystem is read-only, so that is a download
 * *and* a write that cannot happen. On an air-gapped self-hosted install the
 * first scan simply fails.
 *
 * These are unit tests because the decision is a directory lookup, and standing
 * up a worker to check one would spawn a thread and load megabytes of model.
 * That the file is actually *in* the image is asserted against the Dockerfile
 * below, and was verified by building it.
 */

const created: string[] = [];

function directoryWithModel(): string {
  const path = mkdtempSync(join(tmpdir(), "stoky-tessdata-"));
  writeFileSync(join(path, "spa.traineddata"), "not a real model");
  created.push(path);
  return path;
}

function directoryWithout(): string {
  const path = mkdtempSync(join(tmpdir(), "stoky-tessdata-"));
  created.push(path);
  return path;
}

afterEach(() => {
  delete process.env.TESSDATA_PATH;
  while (created.length > 0) {
    rmSync(created.pop() as string, { recursive: true, force: true });
  }
});

describe("when the model is where it should be", () => {
  it("reads it from disk instead of fetching it", () => {
    process.env.TESSDATA_PATH = directoryWithModel();

    const options = workerOptions();

    expect(options.langPath).toBe(process.env.TESSDATA_PATH);
  });

  it("says the file is uncompressed", () => {
    // Left at its default of `true`, tesseract.js looks for
    // `spa.traineddata.gz`, does not find it, and falls through to the network
    // — which is the whole defect, reintroduced by an omission.
    process.env.TESSDATA_PATH = directoryWithModel();

    expect(workerOptions().gzip).toBe(false);
  });

  it("points its write path somewhere it is allowed to write", () => {
    // The production filesystem is read-only apart from tmpfs. A download
    // tesseract.js decided to make anyway would fail on the write, silently,
    // on every scan.
    process.env.TESSDATA_PATH = directoryWithModel();

    expect(workerOptions().cachePath).toBe(process.env.TESSDATA_PATH);
  });
});

describe("when there is no model", () => {
  it("says so rather than naming a directory that has none", () => {
    process.env.TESSDATA_PATH = directoryWithout();

    expect(tessdataDirectory()).toBeNull();
  });

  it("leaves tesseract.js to its own devices", () => {
    // This is the development case, and it is deliberate. Pointing `langPath`
    // at a directory with no model does not make tesseract.js fall back to the
    // CDN — it throws. A developer who has never run OCR has no file, and
    // turning "downloads once" into "OCR is broken" trades a production defect
    // for a local one.
    process.env.TESSDATA_PATH = directoryWithout();

    expect(workerOptions()).toEqual({});
  });
});

describe("the image carries one", () => {
  const dockerfile = readFileSync(
    join(import.meta.dir, "../../../Dockerfile"),
    "utf8",
  );

  it("bakes the model in at build time", () => {
    expect(dockerfile).toContain("/app/tessdata/spa.traineddata");
    expect(dockerfile).toContain("COPY --from=builder /app/tessdata ./tessdata");
  });

  it("tells the application where it put it", () => {
    // Without this the lookup falls back to `process.cwd()`, finds nothing, and
    // the worker is back on the network with every test still green.
    expect(dockerfile).toContain("ENV TESSDATA_PATH=/app/tessdata");
  });

  it("pins and verifies what it downloaded", () => {
    // 2.3 MB of model data entering the image from the internet. This project
    // scans with Trivy and attests provenance; an unpinned fetch would be the
    // weakest link in a chain it otherwise takes seriously.
    expect(dockerfile).toMatch(/tessdata_fast\/raw\/\d+\.\d+\.\d+\//);
    expect(dockerfile).toContain("sha256sum -c -");
  });
});
