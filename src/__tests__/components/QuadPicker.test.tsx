import "../setup/matchers";
import { describe, it, expect, afterEach } from "bun:test";
import { cleanup, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { renderWithIntl } from "../utils/render";
import { QuadPicker } from "@/components/receipt/QuadPicker";
import { FULL_FRAME, type Quad } from "@/lib/receipt-quad";

afterEach(cleanup);

/** The picker as a screen holds it, the frame it ends with in `last`. */
function Picker({ last }: { last: Quad[] }) {
  const [quad, setQuad] = useState<Quad>(FULL_FRAME);
  return (
    <QuadPicker
      alt="Foto del ticket"
      hint="Encuadra el ticket"
      onChange={(next) => {
        last.push(next);
        setQuad(next);
      }}
      quad={quad}
      src="data:image/jpeg;base64,c3RvcmVk"
    />
  );
}

describe("zooming the photo to frame it precisely", () => {
  it("enlarges up to six times, and comes back to the whole photo", async () => {
    renderWithIntl(<Picker last={[]} />, { locale: "es" });
    const zoomIn = screen.getByRole("button", { name: "Acercar la foto" });
    const zoomOut = screen.getByRole("button", { name: "Alejar la foto" });

    // Nothing to zoom out of at the start.
    expect(zoomOut).toBeDisabled();
    await userEvent.click(zoomIn);
    expect(zoomOut).toBeEnabled();
    // 1.5 a press: the fifth reaches the six-times limit.
    for (let i = 0; i < 4; i++) await userEvent.click(zoomIn);
    expect(zoomIn).toBeDisabled();
    for (let i = 0; i < 5; i++) await userEvent.click(zoomOut);
    expect(zoomOut).toBeDisabled();
  });

  it("moves a corner by finer steps once enlarged, the same on the screen", async () => {
    const last: Quad[] = [];
    renderWithIntl(<Picker last={last} />, { locale: "es" });

    await userEvent.click(
      screen.getByRole("button", { name: "Acercar la foto" }),
    );
    screen.getByRole("button", { name: "Esquina superior izquierda" }).focus();
    await userEvent.keyboard("{ArrowRight}");

    expect(last.at(-1)![0][0]).toBeCloseTo(0.01 / 1.5, 4);
  });
});
