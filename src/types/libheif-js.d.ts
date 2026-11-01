/**
 * The part of `libheif-js` that `src/server/services/image.ts` uses.
 *
 * The package ships the Emscripten module's own declarations, which cover
 * the C functions and not `HeifDecoder`/`HeifImage`, the JavaScript wrapper
 * around them that every caller actually goes through.
 */
declare module "libheif-js/wasm-bundle" {
  interface HeifImage {
    get_width(): number;
    get_height(): number;
    is_primary(): boolean;
    /** Decodes to RGBA in `target.data`; calls back with `null` on failure. */
    display(
      target: { data: Uint8ClampedArray; width: number; height: number },
      callback: (result: { data: Uint8ClampedArray } | null) => void,
    ): void;
    free(): void;
  }

  interface HeifDecoder {
    /** The top-level images, or `[]` when the file cannot be parsed. */
    decode(buffer: Uint8Array): HeifImage[];
    /** The context `decode` allocated; freed only by the next `decode`. */
    decoder: unknown;
  }

  const libheif: {
    HeifDecoder: new () => HeifDecoder;
    heif_context_free(context: unknown): void;
  };
  export default libheif;
}
