import "../setup/matchers";
import { describe, it, expect, afterEach, beforeEach, mock, spyOn } from "bun:test";
import { render, screen, cleanup, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

type ScannerProps = {
  doScan: boolean;
  onSuccess: (barcode: string) => void;
  onError: (error?: Error) => void;
};

// Handles onto the props the component hands the third-party scanner, so a
// test can simulate a scan or a camera failure.
let lastScannerProps: ScannerProps | undefined;

mock.module("@thewirv/react-barcode-scanner", () => ({
  BarcodeScanner: (props: ScannerProps) => {
    lastScannerProps = props;
    return <div data-testid="barcode-scanner" />;
  },
}));

/** Stub `getUserMedia`, optionally reporting torch capability. */
function stubCamera({ torch, reject }: { torch?: boolean; reject?: boolean }) {
  const stop = mock(() => {});
  const track = {
    getCapabilities: () => (torch ? { torch: true } : {}),
    stop,
  };
  const stream = {
    getVideoTracks: () => [track],
    getTracks: () => [track],
  };

  Object.defineProperty(globalThis.navigator, "mediaDevices", {
    value: {
      getUserMedia: reject
        ? mock(async () => {
            throw new Error("Permission denied");
          })
        : mock(async () => stream),
    },
    configurable: true,
    writable: true,
  });

  return { stop };
}

const { BarcodeScanner } = await import("@/components/barcode/Scanner");

beforeEach(() => {
  lastScannerProps = undefined;
  stubCamera({ torch: false });
});

afterEach(cleanup);

describe("BarcodeScanner", () => {
  it("shows a disabled placeholder when scanning is off", () => {
    render(<BarcodeScanner onScan={() => {}} isScanning={false} />);

    expect(screen.getByText("Escáner desactivado")).toBeInTheDocument();
    expect(screen.queryByTestId("barcode-scanner")).toBeNull();
  });

  it("mounts the camera view and framing hint while scanning", () => {
    render(<BarcodeScanner onScan={() => {}} />);

    expect(screen.getByTestId("barcode-scanner")).toBeInTheDocument();
    expect(
      screen.getByText("Coloca el código de barras dentro del rectángulo verde"),
    ).toBeInTheDocument();
  });

  it("tells the underlying scanner to scan", () => {
    render(<BarcodeScanner onScan={() => {}} />);

    expect(lastScannerProps?.doScan).toBe(true);
  });

  it("reports a scanned barcode to onScan", () => {
    const onScan = mock((_barcode: string) => {});
    render(<BarcodeScanner onScan={onScan} />);

    act(() => {
      lastScannerProps?.onSuccess("8410000000123");
    });

    expect(onScan).toHaveBeenCalledWith("8410000000123");
  });

  it("surfaces a camera error and forwards it to onError", () => {
    const onError = mock((_error: Error) => {});
    const consoleError = spyOn(console, "error").mockImplementation(() => {});
    render(<BarcodeScanner onScan={() => {}} onError={onError} />);

    const failure = new Error("Permission denied");
    act(() => {
      lastScannerProps?.onError(failure);
    });

    expect(screen.getByText("Error al acceder a la cámara")).toBeInTheDocument();
    expect(screen.getByText("Permission denied")).toBeInTheDocument();
    expect(onError).toHaveBeenCalledWith(failure);

    consoleError.mockRestore();
  });

  it("shows a fallback message when the error carries no detail", () => {
    const onError = mock((_error: Error) => {});
    const consoleError = spyOn(console, "error").mockImplementation(() => {});
    render(<BarcodeScanner onScan={() => {}} onError={onError} />);

    act(() => {
      lastScannerProps?.onError(undefined);
    });

    expect(screen.getByText("Error desconocido")).toBeInTheDocument();
    // No Error instance means nothing to forward to the caller.
    expect(onError).not.toHaveBeenCalled();

    consoleError.mockRestore();
  });

  it("hides the error panel until something fails", () => {
    render(<BarcodeScanner onScan={() => {}} />);

    expect(screen.queryByText("Error al acceder a la cámara")).toBeNull();
  });

  it("omits the torch control on devices without a torch", async () => {
    stubCamera({ torch: false });
    render(<BarcodeScanner onScan={() => {}} />);

    await waitFor(() => {
      expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalled();
    });
    expect(screen.queryByRole("button", { name: /linterna/ })).toBeNull();
  });

  it("omits the torch control when camera access is refused", async () => {
    stubCamera({ reject: true });
    render(<BarcodeScanner onScan={() => {}} />);

    await waitFor(() => {
      expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalled();
    });
    expect(screen.queryByRole("button", { name: /linterna/ })).toBeNull();
  });

  it("offers a torch toggle on capable devices", async () => {
    stubCamera({ torch: true });
    render(<BarcodeScanner onScan={() => {}} />);

    expect(
      await screen.findByRole("button", { name: "Encender linterna" }),
    ).toBeInTheDocument();
  });

  it("flips the torch label when toggled", async () => {
    stubCamera({ torch: true });
    render(<BarcodeScanner onScan={() => {}} />);

    const toggle = await screen.findByRole("button", {
      name: "Encender linterna",
    });
    await userEvent.click(toggle);

    expect(
      screen.getByRole("button", { name: "Apagar linterna" }),
    ).toBeInTheDocument();
  });

  it("does not yet drive the camera torch (see ISSUES.md DEBT-2)", async () => {
    stubCamera({ torch: true });
    render(<BarcodeScanner onScan={() => {}} />);

    await userEvent.click(
      await screen.findByRole("button", { name: "Encender linterna" }),
    );

    // Documents current behaviour: the toggle is local state only and is never
    // passed to the scanner, so the torch never actually turns on.
    expect(lastScannerProps).not.toHaveProperty("torch");
    expect(lastScannerProps).not.toHaveProperty("torchEnabled");
  });

  it("releases the camera track used for the capability probe", async () => {
    const { stop } = stubCamera({ torch: true });
    render(<BarcodeScanner onScan={() => {}} />);

    await waitFor(() => {
      expect(stop).toHaveBeenCalled();
    });
  });
});
