import "../setup/matchers";
import { describe, it, expect, afterEach, mock } from "bun:test";
import { screen, cleanup, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithIntl } from "../utils/render";
import { minimumHeight } from "../setup/tailwind";
import { RECEIPT_IMAGE_TYPES } from "@/lib/validations/receipt";
import { UploadZone } from "@/components/receipt/UploadZone";

afterEach(cleanup);

function fileInput(container: HTMLElement): HTMLInputElement {
  const input = container.querySelector('input[type="file"]');
  if (!input) throw new Error("UploadZone rendered no file input");
  return input as HTMLInputElement;
}

function jpeg(name = "ticket.jpg"): File {
  return new File(["receipt-bytes"], name, { type: "image/jpeg" });
}

/**
 * A file the component must refuse, at a size a phone really produces.
 *
 * `size` is set rather than allocating twelve megabytes: the component reads
 * that property and nothing else, and a test that allocates the bytes would be
 * slower for no extra assurance.
 */
function tooLarge(name = "enorme.jpg"): File {
  const file = new File(["receipt-bytes"], name, { type: "image/jpeg" });
  Object.defineProperty(file, "size", { value: 12 * 1024 * 1024 });
  return file;
}

describe("UploadZone", () => {
  it("prompts for a receipt image", () => {
    renderWithIntl(<UploadZone onUpload={() => {}} />);

    expect(
      screen.getByText(
        "Arrastra una foto del ticket o pulsa para elegirla",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("JPG, PNG o WebP (máx. 10 MB)")).toBeInTheDocument();
  });

  it("offers exactly the types the server accepts, and nothing else", () => {
    const { container } = renderWithIntl(<UploadZone onUpload={() => {}} />);

    // The whole attribute, not a `toContain` per type. On Android this is
    // what decides which of the phone's photos can be chosen at all, so a
    // type here that the router refuses is a failure after the choosing
    // rather than before it — and one missing is a photo somebody cannot
    // pick. Compared against the router's own list so the two cannot drift.
    const accept = fileInput(container).getAttribute("accept") ?? "";
    expect(accept.split(",")).toEqual([...RECEIPT_IMAGE_TYPES]);
  });

  it("offers no file extensions, which Android does not read", () => {
    const { container } = renderWithIntl(<UploadZone onUpload={() => {}} />);

    // It listed `.jpg`, `.png` and `.webp` beside the same three MIME types.
    // Android builds its picker from types; the extensions said nothing the
    // types did not.
    const accept = fileInput(container).getAttribute("accept") ?? "";
    expect(accept).not.toContain(".");
  });

  it("hands the selected file to onUpload", async () => {
    const onUpload = mock((_file: File) => {});
    const { container } = renderWithIntl(<UploadZone onUpload={onUpload} />);

    await userEvent.upload(fileInput(container), jpeg());

    await waitFor(() => {
      expect(onUpload).toHaveBeenCalledTimes(1);
    });
    expect(onUpload.mock.calls[0]?.[0]?.name).toBe("ticket.jpg");
  });

  it("refuses a photograph larger than the server will take", async () => {
    // Not a size opinion of its own: `MAX_RECEIPT_BYTES` is the server's, and
    // the point of refusing here is that the server is not in a position to
    // explain. The photograph is base64'd into the request body, and a body
    // over Next's ceiling is truncated before any procedure reads it — so
    // letting this through produces `JSON Parse error: Unterminated string` on
    // a screen that should be saying something about a photograph.
    const onUpload = mock((_file: File) => {});
    const { container } = renderWithIntl(<UploadZone onUpload={onUpload} />);

    await userEvent.upload(fileInput(container), tooLarge());

    await screen.findByText(/máximo/);
    // The request is never made and the file is never encoded.
    expect(onUpload).toHaveBeenCalledTimes(0);
  });

  it("says how big it was and what the limit is", async () => {
    // "Too large" alone leaves somebody guessing how much smaller. Both
    // numbers, so the next attempt is informed rather than another try.
    const { container } = renderWithIntl(<UploadZone onUpload={() => {}} />);

    await userEvent.upload(fileInput(container), tooLarge());

    // 12 MB against the 10 MB limit, in the Spanish decimal the catalogue is
    // rendered with.
    const message = await screen.findByText(/máximo/);
    expect(message.textContent).toContain("12");
    expect(message.textContent).toContain("10");
  });

  it("does not preview a photograph it has refused", async () => {
    const { container } = renderWithIntl(<UploadZone onUpload={() => {}} />);

    await userEvent.upload(fileInput(container), tooLarge());
    await screen.findByText(/máximo/);

    expect(screen.queryByAltText("Vista previa del ticket")).toBeAbsent();
  });

  it("keeps the message region on the page before it has anything to say", async () => {
    // WCAG 4.1.3, and the defect the login form already had: a live region
    // created at the moment it speaks is the case a screen reader may skip. So
    // the region is always rendered and empty rather than conditionally
    // inserted — which is only observable by looking for it when there is no
    // error.
    renderWithIntl(<UploadZone onUpload={() => {}} />);

    const region = screen.getByRole("status");
    expect(region).toBeInTheDocument();
    expect(region.textContent).toBe("");
    expect(region.getAttribute("aria-live")).toBe("polite");
  });

  it("recovers when a smaller photograph is chosen next", async () => {
    // A refusal that cannot be undone would leave the screen stuck saying no.
    const onUpload = mock((_file: File) => {});
    const { container } = renderWithIntl(<UploadZone onUpload={onUpload} />);

    await userEvent.upload(fileInput(container), tooLarge());
    await screen.findByText(/máximo/);

    await userEvent.upload(fileInput(container), jpeg());

    await waitFor(() => {
      expect(onUpload).toHaveBeenCalledTimes(1);
    });
    expect(screen.getByRole("status").textContent).toBe("");
  });

  it("shows a preview of the chosen receipt", async () => {
    const { container } = renderWithIntl(<UploadZone onUpload={() => {}} />);

    await userEvent.upload(fileInput(container), jpeg());

    const preview = await screen.findByAltText("Vista previa del ticket");
    expect(preview).toBeInTheDocument();
    // The dropzone prompt is replaced by the preview.
    expect(
      screen.queryByText(
        "Arrastra una foto del ticket o pulsa para elegirla",
      ),
    ).toBeAbsent();
  });

  it("lets the user clear the preview and choose again", async () => {
    const { container } = renderWithIntl(<UploadZone onUpload={() => {}} />);

    await userEvent.upload(fileInput(container), jpeg());
    await screen.findByAltText("Vista previa del ticket");

    // The clear control is the only button besides the camera action.
    const clear = screen
      .getAllByRole("button")
      .find((button) => button.className.includes("bg-destructive"));
    await userEvent.click(clear as HTMLElement);

    expect(screen.queryByAltText("Vista previa del ticket")).toBeAbsent();
    expect(
      screen.getByText("Arrastra una foto del ticket o pulsa para elegirla"),
    ).toBeInTheDocument();
  });

  it("makes the clear control a full-size target", async () => {
    // A 24px circle (p-1 around a 16px icon), half the floor, on the control
    // that throws the photo away.
    const { container } = renderWithIntl(<UploadZone onUpload={() => {}} />);

    await userEvent.upload(fileInput(container), jpeg());
    await screen.findByAltText("Vista previa del ticket");

    const clear = screen.getByRole("button", { name: "Quitar la foto" });
    expect((await minimumHeight(clear.className)) ?? 0).toBeGreaterThanOrEqual(48);
  });

  it("offers a camera capture action", () => {
    renderWithIntl(<UploadZone onUpload={() => {}} />);

    expect(
      screen.getByRole("button", { name: /Hacer foto con la cámara/ }),
    ).toBeInTheDocument();
  });

  it("draws the camera action as the Button primitive, focus outline and all", () => {
    renderWithIntl(<UploadZone onUpload={() => {}} />);

    const camera = screen.getByRole("button", { name: /Hacer foto con la cámara/ });
    expect(camera.className).toContain("focus-visible:outline-ring");
    expect(camera.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");
  });

  it("disables the camera action while uploading", () => {
    renderWithIntl(<UploadZone onUpload={() => {}} isUploading />);

    expect(
      screen.getByRole("button", { name: /Hacer foto con la cámara/ }),
    ).toBeDisabled();
  });

  it("shows the dropzone as unavailable while uploading", () => {
    const { container } = renderWithIntl(<UploadZone onUpload={() => {}} isUploading />);

    // react-dropzone disables at the root rather than on the input element,
    // so the affordance the user sees is the zone's own styling.
    const zone = container.querySelector("div.border-dashed");
    expect(zone).toHaveClass("cursor-not-allowed");
    expect(zone).toHaveClass("opacity-50");
  });

  it("does not call onUpload when nothing is selected", async () => {
    const onUpload = mock((_file: File) => {});
    renderWithIntl(<UploadZone onUpload={onUpload} />);

    expect(onUpload).not.toHaveBeenCalled();
  });
});
