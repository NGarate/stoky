import "../setup/matchers";
import { describe, it, expect, afterEach, mock } from "bun:test";
import { screen, cleanup, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithIntl } from "../utils/render";
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

describe("UploadZone", () => {
  it("prompts for a receipt image", () => {
    renderWithIntl(<UploadZone onUpload={() => {}} />);

    expect(
      screen.getByText(
        "Arrastra una foto del recibo o haz clic para seleccionar",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("JPG, PNG o WebP (máx. 10 MB)")).toBeInTheDocument();
  });

  it("accepts only the supported image types", () => {
    const { container } = renderWithIntl(<UploadZone onUpload={() => {}} />);

    const accept = fileInput(container).getAttribute("accept") ?? "";
    for (const type of ["image/jpeg", "image/png", "image/webp"]) {
      expect(accept).toContain(type);
    }
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

  it("shows a preview of the chosen receipt", async () => {
    const { container } = renderWithIntl(<UploadZone onUpload={() => {}} />);

    await userEvent.upload(fileInput(container), jpeg());

    const preview = await screen.findByAltText("Vista previa del recibo");
    expect(preview).toBeInTheDocument();
    // The dropzone prompt is replaced by the preview.
    expect(
      screen.queryByText(
        "Arrastra una foto del recibo o haz clic para seleccionar",
      ),
    ).toBeNull();
  });

  it("lets the user clear the preview and choose again", async () => {
    const { container } = renderWithIntl(<UploadZone onUpload={() => {}} />);

    await userEvent.upload(fileInput(container), jpeg());
    await screen.findByAltText("Vista previa del recibo");

    // The clear control is the only button besides the camera action.
    const clear = screen
      .getAllByRole("button")
      .find((button) => button.className.includes("bg-destructive"));
    await userEvent.click(clear as HTMLElement);

    expect(screen.queryByAltText("Vista previa del recibo")).toBeNull();
    expect(
      screen.getByText("Arrastra una foto del recibo o haz clic para seleccionar"),
    ).toBeInTheDocument();
  });

  it("offers a camera capture action", () => {
    renderWithIntl(<UploadZone onUpload={() => {}} />);

    expect(
      screen.getByRole("button", { name: /Hacer foto con la cámara/ }),
    ).toBeInTheDocument();
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
