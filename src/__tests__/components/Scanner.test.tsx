import "../setup/matchers";
import { describe, it, expect, afterEach, beforeEach, mock, spyOn } from "bun:test";
import { screen, cleanup, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithIntl } from "../utils/render";

type ScannerProps = {
  doScan: boolean;
  onSuccess: (barcode: string) => void;
  onError: (error?: Error) => void;
  onLoad?: () => void;
};

// Handles onto the props the component hands the third-party scanner, so a
// test can simulate a scan, a camera failure, or the feed becoming ready.
let lastScannerProps: ScannerProps | undefined;

/** The stream the mocked library hangs off its <video>, as a browser would. */
let currentStream: unknown;

/**
 * The library renders `<video ref={...} {...videoProps} />` and hands the
 * element to zxing, which sets `srcObject`. The component reaches that element
 * through its own wrapper, so the mock has to be a real <video> carrying a real
 * `srcObject` — a bare div would let every torch assertion pass vacuously.
 */
mock.module("@thewirv/react-barcode-scanner", () => ({
  BarcodeScanner: (props: ScannerProps) => {
    lastScannerProps = props;
    return (
      <video
        data-testid="barcode-scanner"
        ref={(node: HTMLVideoElement | null) => {
          if (node) node.srcObject = currentStream as MediaStream;
        }}
      >
        <track kind="captions" />
      </video>
    );
  },
}));

/** A camera track, optionally reporting a torch and optionally refusing it. */
function stubCamera({
  torch,
  applyRejects,
}: { torch?: boolean; applyRejects?: boolean } = {}) {
  const applyConstraints = mock(async (_constraints: MediaTrackConstraints) => {
    if (applyRejects) throw new Error("Torch unavailable");
  });
  const track = {
    getCapabilities: () => (torch ? { torch: true } : {}),
    applyConstraints,
    stop: mock(() => {}),
  };

  // A real MediaStream, because happy-dom's <video> refuses an `srcObject`
  // that is not one — the same check a browser makes. Its track list is
  // overridden rather than populated, since constructing a live
  // MediaStreamTrack outside a browser is not possible.
  const stream = new MediaStream();
  Object.defineProperty(stream, "getVideoTracks", {
    value: () => [track],
    configurable: true,
  });
  Object.defineProperty(stream, "getTracks", {
    value: () => [track],
    configurable: true,
  });
  currentStream = stream;

  return { applyConstraints, track };
}

/** No camera at all — the feed never arrives, so `onLoad` never fires. */
function stubNoCamera() {
  currentStream = null;
}

/** What the library does once the feed has data. */
function feedReady() {
  act(() => {
    lastScannerProps?.onLoad?.();
  });
}

/**
 * An insecure context, as Chrome presents one: `isSecureContext` is false and
 * `navigator.mediaDevices` does not exist at all. Browsers remove the API
 * entirely over plain HTTP away from localhost, which is exactly the state the
 * scanner has to explain instead of letting the library blame the browser.
 */
function stubInsecureContext() {
  Object.defineProperty(window, "isSecureContext", {
    value: false,
    configurable: true,
  });
}

const { BarcodeScanner } = await import("@/components/barcode/Scanner");

beforeEach(() => {
  lastScannerProps = undefined;
  stubCamera({ torch: false });
  Object.defineProperty(window, "isSecureContext", {
    value: true,
    configurable: true,
  });
});

afterEach(cleanup);

describe("BarcodeScanner", () => {
  it("shows a disabled placeholder when scanning is off", () => {
    renderWithIntl(<BarcodeScanner onScan={() => {}} isScanning={false} />);

    expect(screen.getByText("Escáner desactivado")).toBeInTheDocument();
    expect(screen.queryByTestId("barcode-scanner")).toBeNull();
  });

  it("mounts the camera view and framing hint while scanning", () => {
    renderWithIntl(<BarcodeScanner onScan={() => {}} />);

    expect(screen.getByTestId("barcode-scanner")).toBeInTheDocument();
    expect(
      screen.getByText("Coloca el código de barras dentro del rectángulo verde"),
    ).toBeInTheDocument();
  });

  it("tells the underlying scanner to scan", () => {
    renderWithIntl(<BarcodeScanner onScan={() => {}} />);

    expect(lastScannerProps?.doScan).toBe(true);
  });

  it("reports a scanned barcode to onScan", () => {
    const onScan = mock((_barcode: string) => {});
    renderWithIntl(<BarcodeScanner onScan={onScan} />);

    act(() => {
      lastScannerProps?.onSuccess("8410000000123");
    });

    expect(onScan).toHaveBeenCalledWith("8410000000123");
  });

  it("surfaces a camera error and forwards it to onError", () => {
    const onError = mock((_error: Error) => {});
    const consoleError = spyOn(console, "error").mockImplementation(() => {});
    renderWithIntl(<BarcodeScanner onScan={() => {}} onError={onError} />);

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
    renderWithIntl(<BarcodeScanner onScan={() => {}} onError={onError} />);

    act(() => {
      lastScannerProps?.onError(undefined);
    });

    expect(screen.getByText("Error desconocido")).toBeInTheDocument();
    // No Error instance means nothing to forward to the caller.
    expect(onError).not.toHaveBeenCalled();

    consoleError.mockRestore();
  });

  it("explains the HTTPS requirement over plain HTTP instead of blaming the browser", () => {
    stubInsecureContext();
    renderWithIntl(<BarcodeScanner onScan={() => {}} />);

    expect(
      screen.getByText(
        "La cámara solo funciona con una conexión segura. Abre la aplicación con una dirección https:// (o localhost) e inténtalo de nuevo.",
      ),
    ).toBeInTheDocument();
    // The scanner itself must not mount: the library would fire its own
    // misleading "your browser has no support" error over this one.
    expect(screen.queryByTestId("barcode-scanner")).toBeNull();
  });

  it("hides the error panel until something fails", () => {
    renderWithIntl(<BarcodeScanner onScan={() => {}} />);

    expect(screen.queryByText("Error al acceder a la cámara")).toBeNull();
  });

  it("omits the torch control on a camera that has none", () => {
    stubCamera({ torch: false });
    renderWithIntl(<BarcodeScanner onScan={() => {}} />);
    feedReady();

    expect(screen.queryByRole("button", { name: /linterna/ })).toBeNull();
  });

  it("omits the torch control when the feed never arrives", () => {
    stubNoCamera();
    renderWithIntl(<BarcodeScanner onScan={() => {}} />);

    // No camera, so the library never reports a loaded feed and the component
    // never learns of a torch. The control is absent rather than inert.
    expect(screen.queryByRole("button", { name: /linterna/ })).toBeNull();
  });

  it("offers a torch toggle on a camera that has one", () => {
    stubCamera({ torch: true });
    renderWithIntl(<BarcodeScanner onScan={() => {}} />);
    feedReady();

    expect(
      screen.getByRole("button", { name: "Encender linterna" }),
    ).toBeInTheDocument();
  });

  it("turns the torch on at the camera, not just in the label", async () => {
    const { applyConstraints } = stubCamera({ torch: true });
    renderWithIntl(<BarcodeScanner onScan={() => {}} />);
    feedReady();

    await userEvent.click(
      screen.getByRole("button", { name: "Encender linterna" }),
    );

    // ISSUES.md DEBT-2: the toggle was local state and reached nothing.
    expect(applyConstraints).toHaveBeenCalledWith({
      advanced: [{ torch: true }],
    });
    expect(
      screen.getByRole("button", { name: "Apagar linterna" }),
    ).toBeInTheDocument();
  });

  it("turns the torch off again", async () => {
    const { applyConstraints } = stubCamera({ torch: true });
    renderWithIntl(<BarcodeScanner onScan={() => {}} />);
    feedReady();

    await userEvent.click(
      screen.getByRole("button", { name: "Encender linterna" }),
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Apagar linterna" }),
    );

    expect(applyConstraints).toHaveBeenLastCalledWith({
      advanced: [{ torch: false }],
    });
  });

  it("reports the pressed state, so it is not colour alone", async () => {
    stubCamera({ torch: true });
    renderWithIntl(<BarcodeScanner onScan={() => {}} />);
    feedReady();

    const toggle = screen.getByRole("button", { name: "Encender linterna" });
    expect(toggle).toHaveAttribute("aria-pressed", "false");

    await userEvent.click(toggle);

    expect(
      screen.getByRole("button", { name: "Apagar linterna" }),
    ).toHaveAttribute("aria-pressed", "true");
  });

  it("says so when the camera refuses the torch, and keeps the label honest", async () => {
    stubCamera({ torch: true, applyRejects: true });
    renderWithIntl(<BarcodeScanner onScan={() => {}} />);
    feedReady();

    await userEvent.click(
      screen.getByRole("button", { name: "Encender linterna" }),
    );

    expect(
      screen.getByText(
        "La linterna no se ha podido encender. Puede que otra aplicación esté usando la cámara: ciérrala y vuelve a intentarlo.",
      ),
    ).toBeInTheDocument();
    // The lamp did not come on, so the button must not claim it can be turned
    // off. This is the assertion that would catch an optimistic setState.
    expect(
      screen.getByRole("button", { name: "Encender linterna" }),
    ).toBeInTheDocument();
  });

  it("does not open a camera stream of its own", () => {
    const getUserMedia = mock(async () => currentStream);
    Object.defineProperty(globalThis.navigator, "mediaDevices", {
      value: { getUserMedia },
      configurable: true,
      writable: true,
    });

    stubCamera({ torch: true });
    renderWithIntl(<BarcodeScanner onScan={() => {}} />);
    feedReady();

    // The capability probe used to call getUserMedia itself, competing with
    // the scanner's own stream on devices that allow only one.
    expect(getUserMedia).not.toHaveBeenCalled();
  });

  it("forgets a lit torch when the feed is re-acquired", async () => {
    stubCamera({ torch: true });
    renderWithIntl(<BarcodeScanner onScan={() => {}} />);
    feedReady();

    await userEvent.click(
      screen.getByRole("button", { name: "Encender linterna" }),
    );
    expect(
      screen.getByRole("button", { name: "Apagar linterna" }),
    ).toBeInTheDocument();

    // A new track always starts dark, so the label has to start there too.
    feedReady();

    expect(
      screen.getByRole("button", { name: "Encender linterna" }),
    ).toBeInTheDocument();
  });
});
