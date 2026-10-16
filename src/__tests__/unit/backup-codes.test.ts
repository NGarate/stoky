import { createHash } from "node:crypto";
import { describe, expect, it } from "bun:test";
import {
  BACKUP_CODE_BITS,
  BACKUP_CODE_COUNT,
  BACKUP_CODE_HASH_PREFIX,
  BACKUP_CODE_LENGTH,
  CROCKFORD_ALPHABET,
  generateBackupCodes,
  hashBackupCode,
  normaliseBackupCode,
  storeBackupCodes,
} from "@/lib/auth/backup-codes";

/**
 * Backup codes as made and stored (PROGRESS D149), without Better Auth. That
 * Better Auth stores, spends and refuses them as these functions say is
 * `integration/two-factor.test.ts`.
 */

const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");

describe("the codes", () => {
  it("carry at least the 112 bits ASVS 6.5.2 asks of a hashed lookup secret", () => {
    expect(CROCKFORD_ALPHABET).toHaveLength(32);
    expect(new Set(CROCKFORD_ALPHABET).size).toBe(32);
    expect(BACKUP_CODE_BITS).toBe(120);
    expect(BACKUP_CODE_BITS).toBeGreaterThanOrEqual(112);
  });

  it("are ten, each 24 Crockford characters in six groups of four", () => {
    const codes = generateBackupCodes();

    expect(codes).toHaveLength(BACKUP_CODE_COUNT);
    expect(BACKUP_CODE_COUNT).toBe(10);
    for (const code of codes) {
      expect(code).toMatch(/^[0-9A-HJKMNP-TV-Z]{4}(-[0-9A-HJKMNP-TV-Z]{4}){5}$/);
      expect(code.replaceAll("-", "")).toHaveLength(BACKUP_CODE_LENGTH);
    }
    expect(new Set(codes).size).toBe(codes.length);
  });

  it("take each character from one random byte's low five bits, so all 32 are reachable", () => {
    // Bytes counting up from 0: the low five bits run through the alphabet
    // in order, so over the 224 characters of seven full turns every
    // character appears seven times, none more often than another.
    let next = 0;
    const counting = (bytes: Uint8Array) => {
      for (let i = 0; i < bytes.length; i += 1) bytes[i] = next++ % 256;
      return bytes;
    };
    const characters = generateBackupCodes(counting).join("").replaceAll("-", "");
    expect(characters.slice(0, 32)).toBe(CROCKFORD_ALPHABET);
    const counts = new Map<string, number>();
    for (const character of characters.slice(0, 224)) {
      counts.set(character, (counts.get(character) ?? 0) + 1);
    }
    expect([...counts.values()]).toEqual(Array.from({ length: 32 }, () => 7));
  });

  it("come from the random source, not a fixed sequence", () => {
    expect(generateBackupCodes()).not.toEqual(generateBackupCodes());
  });
});

describe("normaliseBackupCode", () => {
  it("reads a code typed in lower case, with spaces or dashes, as the one shown", () => {
    expect(normaliseBackupCode("abcd-efgh-jkmn-pqrs-tvwx-yz01")).toBe("ABCDEFGHJKMNPQRSTVWXYZ01");
    expect(normaliseBackupCode("  ab cd\tEF-GH  ")).toBe("ABCDEFGH");
  });

  it("reads the letters Crockford leaves out as the digits they look like", () => {
    expect(normaliseBackupCode("oO iI lL")).toBe("001111");
  });
});

describe("hashBackupCode", () => {
  it("is sha256 of the normalised code, prefixed", () => {
    expect(hashBackupCode("ab cd-o1")).toBe(`${BACKUP_CODE_HASH_PREFIX}${sha256("ABCD01")}`);
    expect(hashBackupCode("ABCD-0I")).toBe(hashBackupCode("abcd 0l"));
  });

  it("hashes a stored hash again rather than passing it through", () => {
    const stored = hashBackupCode("ABCD");
    expect(hashBackupCode(stored)).not.toBe(stored);
  });
});

describe("storeBackupCodes", () => {
  it("stores hashes, none of the codes", async () => {
    const codes = generateBackupCodes();
    const stored = await storeBackupCodes.encrypt(JSON.stringify(codes));

    const list = JSON.parse(stored) as string[];
    expect(list).toEqual(codes.map(hashBackupCode));
    for (const code of codes) {
      expect(stored).not.toContain(code);
      expect(stored).not.toContain(normaliseBackupCode(code));
    }
  });

  it("leaves codes already hashed as they are, so spending one keeps the rest", async () => {
    const once = await storeBackupCodes.encrypt(JSON.stringify(["AAAA-BBBB", "CCCC-DDDD"]));
    expect(await storeBackupCodes.encrypt(once)).toBe(once);
  });

  it("hands back what it stored", async () => {
    const stored = await storeBackupCodes.encrypt(JSON.stringify(["AAAA"]));
    expect(await storeBackupCodes.decrypt(stored)).toBe(stored);
  });

  it("refuses anything but a list of strings", async () => {
    // Said in words, not as whatever TypeError the first `.map` would raise.
    await expect(storeBackupCodes.encrypt(JSON.stringify({ code: "AAAA" }))).rejects.toThrow(
      "not a list of strings",
    );
    await expect(storeBackupCodes.encrypt(JSON.stringify([1, 2]))).rejects.toThrow("not a list of strings");
  });
});
