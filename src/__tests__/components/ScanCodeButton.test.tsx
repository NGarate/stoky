import "../setup/matchers";
import { describe, it, expect, afterEach, beforeEach, mock } from "bun:test";
import { cleanup, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithIntl } from "../utils/render";

/**
 * The camera beside a barcode field: what it reads goes into the field, and
 * the camera closes.
 */

// The first frame decodes, padded as a reader can hand it.
mock.module("@zxing/browser", () => ({
  BrowserMultiFormatReader: class {
    decodeFromConstraints(
      _constraints: unknown,
      _video: unknown,
      callback: (
        result: { getText: () => string },
        error: undefined,
        controls: { stop: () => void },
      ) => void,
    ) {
      callback({ getText: () => " 8410000000123 " }, undefined, {
        stop: () => {},
      });
      return Promise.resolve({ stop: () => {} });
    }
  },
}));

const { ScanCodeButton } = await import("@/components/barcode/ScanCodeButton");

beforeEach(() => {
  Object.defineProperty(window, "isSecureContext", {
    value: true,
    configurable: true,
  });
});

afterEach(cleanup);

describe("ScanCodeButton", () => {
  it("hands back the code read, trimmed, and closes the camera", async () => {
    const onScan = mock((_code: string) => {});
    renderWithIntl(<ScanCodeButton onScan={onScan} />);

    expect(screen.queryByRole("dialog")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Escanear" }));

    await waitFor(() => {
      expect(onScan).toHaveBeenCalledWith("8410000000123");
    });
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeNull();
    });
  });
});
