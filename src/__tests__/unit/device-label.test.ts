import { describe, expect, it } from "bun:test";
import { deviceLabel } from "@/lib/auth/device-label";

/**
 * What a session is listed as (`auth.listSessions`, D143): a browser and a
 * system named from the User-Agent, coarse on purpose. The strings are real
 * ones, because the order of the checks is what this file is about: Edge and
 * Opera also say Chrome, Chrome also says Safari, and Android also says
 * Linux.
 */

const UA = {
  chromeWindows:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36",
  edgeWindows:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36 Edg/129.0.2792.79",
  operaMac:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36 OPR/114.0.0.0",
  safariMac:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15",
  safariIphone:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
  chromeIpad:
    "Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/129.0.6668.69 Mobile/15E148 Safari/604.1",
  firefoxAndroid:
    "Mozilla/5.0 (Android 14; Mobile; rv:131.0) Gecko/131.0 Firefox/131.0",
  samsungAndroid:
    "Mozilla/5.0 (Linux; Android 14; SM-X200) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/26.0 Chrome/122.0.0.0 Safari/537.36",
  chromeAndroid:
    "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36",
  firefoxLinux:
    "Mozilla/5.0 (X11; Linux x86_64; rv:131.0) Gecko/20100101 Firefox/131.0",
  chromeOs:
    "Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36",
  native: "Stoky/1.0 (iPhone; iOS 18.0) CFNetwork/1568 Darwin/24.0.0",
};

describe("deviceLabel", () => {
  it.each([
    ["chromeWindows", "Chrome", "Windows"],
    ["edgeWindows", "Edge", "Windows"],
    ["operaMac", "Opera", "macOS"],
    ["safariMac", "Safari", "macOS"],
    ["safariIphone", "Safari", "iOS"],
    ["chromeIpad", "Chrome", "iPadOS"],
    ["firefoxAndroid", "Firefox", "Android"],
    ["samsungAndroid", "Samsung Internet", "Android"],
    ["chromeAndroid", "Chrome", "Android"],
    ["firefoxLinux", "Firefox", "Linux"],
    ["chromeOs", "Chrome", "ChromeOS"],
    ["native", "Stoky", "iOS"],
  ] as const)("names %s as %s on %s", (key, browser, os) => {
    expect(deviceLabel(UA[key])).toEqual({ browser, os });
  });

  it("names nothing it does not recognise, rather than echoing the string", () => {
    expect(deviceLabel("curl/8.9.1")).toEqual({ browser: null, os: null });
    expect(deviceLabel("")).toEqual({ browser: null, os: null });
    expect(deviceLabel(null)).toEqual({ browser: null, os: null });
    expect(deviceLabel(undefined)).toEqual({ browser: null, os: null });
  });

  it("reads only the start of an absurdly long string", () => {
    // Written by the client: a megabyte of padding must not be a megabyte of
    // regular-expression work, nor let a name hidden at the end through.
    const padded = `${"x".repeat(1_000_000)} Firefox/131.0 (Windows NT 10.0)`;
    expect(deviceLabel(padded)).toEqual({ browser: null, os: null });
  });
});
