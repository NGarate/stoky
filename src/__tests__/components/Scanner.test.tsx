import "../setup/matchers";
import {
  describe,
  it,
  expect,
  afterEach,
  beforeEach,
  mock,
  spyOn,
} from "bun:test";
import { screen, cleanup, act, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithIntl } from "../utils/render";
import { minimumHeight } from "../setup/tailwind";

type DecodeCallback = (
  result: { getText: () => string } | undefined,
  error: Error | undefined,
  controls: { stop: () => void },
) => void;

/**
 * Handles onto the decode zxing was asked for, so a test can simulate a scan,
 * a camera failure, or the feed becoming ready.
 */
let decode:
  | {
      constraints: MediaStreamConstraints;
      callback: DecodeCallback;
      reject: (error?: Error) => void;
      open: () => void;
      stop: ReturnType<typeof mock>;
    }
  | undefined;
let decodeCalls = 0;

/** The stream zxing hangs off the <video>, as a browser would. */
let currentStream: unknown;

/**
 * zxing opens the camera into the component's own <video> and sets its
 * `srcObject`, which is where the torch is read from — so the mock does the
 * same with a real `MediaStream`; a bare object would let every torch
 * assertion pass vacuously.
 */
mock.module("@zxing/browser", () => ({
  BrowserMultiFormatReader: class {
    decodeFromConstraints(
      constraints: MediaStreamConstraints,
      video: HTMLVideoElement,
      callback: DecodeCallback,
    ) {
      decodeCalls += 1;
      video.srcObject = currentStream as MediaStream | null;
      const stop = mock(() => {});
      // Pending until a test opens or refuses the camera, as the permission
      // prompt holds it in a browser.
      return new Promise((resolve, reject) => {
        decode = {
          constraints,
          callback,
          reject,
          open: () => resolve({ stop }),
          stop,
        };
      });
    }
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

/** No camera at all — the feed never arrives, so `loadeddata` never fires. */
function stubNoCamera() {
  currentStream = null;
}

/** What the <video> does once the feed has data. */
function feedReady() {
  fireEvent.loadedData(screen.getByTestId("barcode-scanner"));
}

/** zxing finding a barcode in a frame. */
function scan(barcode: string) {
  act(() => {
    decode?.callback({ getText: () => barcode }, undefined, decode);
  });
}

/** The camera opening — the decode promise resolves with its controls. */
async function cameraOpens() {
  await act(async () => {
    decode?.open();
  });
}

/** The camera refusing to open — the decode promise rejects. */
async function cameraRefuses(error?: Error) {
  await act(async () => {
    decode?.reject(error);
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
  decode = undefined;
  decodeCalls = 0;
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
    expect(screen.queryByTestId("barcode-scanner")).toBeAbsent();
  });

  it("mounts the camera view and framing hint while scanning", () => {
    renderWithIntl(<BarcodeScanner onScan={() => {}} />);

    expect(screen.getByTestId("barcode-scanner")).toBeInTheDocument();
    expect(
      screen.getByText("Coloca el código de barras dentro del recuadro"),
    ).toBeInTheDocument();
  });

  it("asks for the rear camera, without the microphone", () => {
    renderWithIntl(<BarcodeScanner onScan={() => {}} />);

    expect(decode?.constraints).toEqual({
      audio: false,
      video: { facingMode: "environment" },
    });
  });

  it("reports a scanned barcode to onScan", () => {
    const onScan = mock((_barcode: string) => {});
    renderWithIntl(<BarcodeScanner onScan={onScan} />);

    scan("8410000000123");

    expect(onScan).toHaveBeenCalledWith("8410000000123");
  });

  it("reports one barcode and lets go of the camera, not one per frame", () => {
    const onScan = mock((_barcode: string) => {});
    renderWithIntl(<BarcodeScanner onScan={onScan} />);

    // zxing calls back on every frame; frames without a barcode carry an error.
    act(() => {
      decode?.callback(undefined, new Error("NotFoundException"), decode);
    });
    scan("8410000000123");
    scan("8410000000123");

    expect(onScan).toHaveBeenCalledTimes(1);
    expect(decode?.stop).toHaveBeenCalled();
  });

  it("does not reopen the camera when the page re-renders", () => {
    const { rerender } = renderWithIntl(<BarcodeScanner onScan={() => {}} />);
    // The scan page hands a fresh handler on every render.
    rerender(<BarcodeScanner onScan={() => {}} />);

    expect(decodeCalls).toBe(1);
  });

  it("releases the camera when scanning stops", async () => {
    const { rerender } = renderWithIntl(<BarcodeScanner onScan={() => {}} />);
    await cameraOpens();

    rerender(<BarcodeScanner isScanning={false} onScan={() => {}} />);

    expect(decode?.stop).toHaveBeenCalled();
  });

  it("releases a camera that opens only after the scanner has gone", async () => {
    // Left on the permission prompt, then navigated away: the stream arrives
    // with nobody to stop it.
    const { unmount } = renderWithIntl(<BarcodeScanner onScan={() => {}} />);
    unmount();
    await cameraOpens();

    expect(decode?.stop).toHaveBeenCalled();
  });

  it("surfaces a camera error and forwards it to onError", async () => {
    const onError = mock((_error: Error) => {});
    const consoleError = spyOn(console, "error").mockImplementation(() => {});
    renderWithIntl(<BarcodeScanner onScan={() => {}} onError={onError} />);

    const failure = new DOMException("Permission denied", "NotAllowedError");
    await cameraRefuses(failure);

    expect(
      screen.getByText("No se ha podido usar la cámara"),
    ).toBeInTheDocument();
    expect(onError).toHaveBeenCalledWith(failure);

    consoleError.mockRestore();
  });

  /**
   * The browser's message is English whatever the catalogue says, and written
   * for developers. It was shown verbatim: "Permission denied" in the middle
   * of a Spanish screen, with no word on how to give the permission back.
   */
  it("says what a denied permission means, in the catalogue's words", async () => {
    const consoleError = spyOn(console, "error").mockImplementation(() => {});
    renderWithIntl(<BarcodeScanner onScan={() => {}} />);

    await cameraRefuses(
      new DOMException("Permission denied", "NotAllowedError"),
    );

    expect(
      screen.getByText(/Permite el acceso a la cámara para este sitio/),
    ).toBeInTheDocument();
    expect(screen.queryByText("Permission denied")).toBeAbsent();

    consoleError.mockRestore();
  });

  it("says when there is no camera at all", async () => {
    const consoleError = spyOn(console, "error").mockImplementation(() => {});
    renderWithIntl(<BarcodeScanner onScan={() => {}} />, { locale: "en" });

    await cameraRefuses(
      new DOMException("Requested device not found", "NotFoundError"),
    );

    expect(
      screen.getByText(/No camera was found on this device/),
    ).toBeInTheDocument();
    expect(screen.queryByText("Requested device not found")).toBeAbsent();

    consoleError.mockRestore();
  });

  it("keeps the explanation once the page stops scanning because of it", async () => {
    // The scan page answers a camera error by turning scanning off, and this
    // component's "off" branch returned before the error panel — so the
    // explanation was set and never seen.
    const consoleError = spyOn(console, "error").mockImplementation(() => {});
    const { rerender } = renderWithIntl(<BarcodeScanner onScan={() => {}} />);

    await cameraRefuses(
      new DOMException("Permission denied", "NotAllowedError"),
    );
    rerender(<BarcodeScanner isScanning={false} onScan={() => {}} />);

    expect(
      screen.getByText("No se ha podido usar la cámara"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Permite el acceso a la cámara para este sitio/),
    ).toBeInTheDocument();

    consoleError.mockRestore();
  });

  it("shows a fallback message when the error carries no detail", async () => {
    const onError = mock((_error: Error) => {});
    const consoleError = spyOn(console, "error").mockImplementation(() => {});
    renderWithIntl(<BarcodeScanner onScan={() => {}} onError={onError} />);

    await cameraRefuses(undefined);

    expect(
      screen.getByText("El navegador no ha dicho por qué."),
    ).toBeInTheDocument();
    // What to do, not only that it failed (§7 rule 4): the hint names the
    // setting and the way round it.
    expect(screen.getByText(/escribe el código abajo/)).toBeInTheDocument();
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
    // The camera must not even be asked for: with no `mediaDevices` zxing
    // would fail with its own, unexplained error over this one.
    expect(screen.queryByTestId("barcode-scanner")).toBeAbsent();
    expect(decodeCalls).toBe(0);
  });

  it("hides the error panel until something fails", () => {
    renderWithIntl(<BarcodeScanner onScan={() => {}} />);

    expect(screen.queryByText("No se ha podido usar la cámara")).toBeAbsent();
  });

  it("omits the torch control on a camera that has none", () => {
    stubCamera({ torch: false });
    renderWithIntl(<BarcodeScanner onScan={() => {}} />);
    feedReady();

    expect(screen.queryByRole("button", { name: /linterna/ })).toBeAbsent();
  });

  it("omits the torch control when the feed never arrives", () => {
    stubNoCamera();
    renderWithIntl(<BarcodeScanner onScan={() => {}} />);

    // No camera, so the <video> never reports a loaded feed and the component
    // never learns of a torch. The control is absent rather than inert.
    expect(screen.queryByRole("button", { name: /linterna/ })).toBeAbsent();
  });

  it("offers a torch toggle on a camera that has one", () => {
    stubCamera({ torch: true });
    renderWithIntl(<BarcodeScanner onScan={() => {}} />);
    feedReady();

    expect(
      screen.getByRole("button", { name: "Encender linterna" }),
    ).toBeInTheDocument();
  });

  it("makes the torch a full-size target in the system's colours", async () => {
    // A 40px circle in palette black and white: under the floor, and the one
    // control on the screen whose colours no audit had seen.
    stubCamera({ torch: true });
    renderWithIntl(<BarcodeScanner onScan={() => {}} />);
    feedReady();

    const torch = screen.getByRole("button", { name: "Encender linterna" });
    expect((await minimumHeight(torch.className)) ?? 0).toBeGreaterThanOrEqual(
      48,
    );
    expect(torch.className).not.toMatch(/bg-black|text-white/);
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

  it("previews the action on the icon: a lit bulb to turn on, a slashed one to turn off", async () => {
    stubCamera({ torch: true });
    renderWithIntl(<BarcodeScanner onScan={() => {}} />);
    feedReady();

    // The icon is a button's icon: it says what pressing will do, not what
    // the lamp is doing now. A dark torch offers to light it.
    const turnOn = screen.getByRole("button", { name: "Encender linterna" });
    expect(
      turnOn.querySelector('[data-testid="torch-icon-lit"]'),
    ).not.toBeNull();

    await userEvent.click(turnOn);

    const turnOff = screen.getByRole("button", { name: "Apagar linterna" });
    expect(
      turnOff.querySelector('[data-testid="torch-icon-slashed"]'),
    ).not.toBeNull();
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
