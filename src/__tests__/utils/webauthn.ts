import {
  createHash,
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  randomBytes,
  sign,
  type KeyObject,
} from "node:crypto";
import { GET, POST } from "@/app/api/auth/[...all]/route";
import { DEVICE_ID_COOKIE } from "@/lib/device";
import { cookieHeaderFrom, freshTestAddress, testOrigin } from "./authorize";

/**
 * A passkey in software: an ES256 authenticator that answers WebAuthn
 * ceremonies the way a phone or a password manager does, so the real auth
 * route and Better Auth's real verification (`@simplewebauthn/server`) can be
 * driven without a browser (PROGRESS D151).
 *
 * - **"none" attestation**, which is what Better Auth asks for: the
 *   registration proves nothing about the make of the authenticator, only
 *   the key.
 * - **The user-verification flag is the test's to set** (`uv`), because what
 *   the server does with an authenticator that skipped the check is the
 *   point of several tests.
 * - **The counter goes up by one per signature**, as a real authenticator's
 *   does; a clone would repeat it.
 *
 * Serialisable (`toJSON` / `fromJSON`), so a child process built with another
 * `STOKY_URLS` can sign with a passkey this process registered.
 */

const FLAG_USER_PRESENT = 0x01;
const FLAG_USER_VERIFIED = 0x04;
const FLAG_ATTESTED_DATA = 0x40;

const b64url = (bytes: Uint8Array | Buffer): string =>
  Buffer.from(bytes).toString("base64url");
const sha256 = (data: Uint8Array | Buffer | string): Buffer =>
  createHash("sha256").update(data).digest();

/** Just enough CBOR (RFC 8949) for an attestation object and a COSE key. */
function cbor(value: unknown): Buffer {
  const head = (major: number, length: number): Buffer => {
    if (length < 24) return Buffer.from([(major << 5) | length]);
    if (length < 0x100) return Buffer.from([(major << 5) | 24, length]);
    const out = Buffer.alloc(3);
    out[0] = (major << 5) | 25;
    out.writeUInt16BE(length, 1);
    return out;
  };
  if (typeof value === "number") {
    return value >= 0 ? head(0, value) : head(1, -1 - value);
  }
  if (typeof value === "string") {
    const bytes = Buffer.from(value, "utf8");
    return Buffer.concat([head(3, bytes.length), bytes]);
  }
  if (value instanceof Uint8Array) {
    return Buffer.concat([head(2, value.length), Buffer.from(value)]);
  }
  if (value instanceof Map) {
    const parts: Buffer[] = [head(5, value.size)];
    for (const [key, entry] of value) parts.push(cbor(key), cbor(entry));
    return Buffer.concat(parts);
  }
  throw new Error(`cbor: cannot encode ${typeof value}`);
}

export interface SoftAuthenticatorJSON {
  credentialId: string;
  privateKey: Record<string, unknown>;
  counter: number;
}

/** The options Better Auth hands the browser, as far as an authenticator reads them. */
interface CeremonyOptions {
  challenge: string;
  rp?: { id?: string };
  rpId?: string;
}

export interface CeremonyAnswer {
  /** The origin `clientDataJSON` names; the page's own, unless a test lies. */
  origin: string;
  /** Whether the authenticator says it verified the person. */
  uv?: boolean;
}

export class SoftAuthenticator {
  readonly credentialId: Buffer;
  private readonly privateKey: KeyObject;
  private counter: number;

  private constructor(
    credentialId: Buffer,
    privateKey: KeyObject,
    counter: number,
  ) {
    this.credentialId = credentialId;
    this.privateKey = privateKey;
    this.counter = counter;
  }

  static create(): SoftAuthenticator {
    const { privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
    return new SoftAuthenticator(randomBytes(32), privateKey, 0);
  }

  static fromJSON(json: SoftAuthenticatorJSON): SoftAuthenticator {
    return new SoftAuthenticator(
      Buffer.from(json.credentialId, "base64url"),
      createPrivateKey({ key: json.privateKey as never, format: "jwk" }),
      json.counter,
    );
  }

  toJSON(): SoftAuthenticatorJSON {
    return {
      credentialId: b64url(this.credentialId),
      privateKey: this.privateKey.export({ format: "jwk" }) as Record<
        string,
        unknown
      >,
      counter: this.counter,
    };
  }

  /** The id the browser and the `Passkey` row name this credential by. */
  get id(): string {
    return b64url(this.credentialId);
  }

  private authenticatorData(
    rpId: string,
    flags: number,
    attested?: Buffer,
  ): Buffer {
    const counter = Buffer.alloc(4);
    counter.writeUInt32BE(this.counter);
    return Buffer.concat([
      sha256(rpId),
      Buffer.from([flags]),
      counter,
      ...(attested ? [attested] : []),
    ]);
  }

  private clientData(type: string, challenge: string, origin: string): Buffer {
    return Buffer.from(
      JSON.stringify({ type, challenge, origin, crossOrigin: false }),
    );
  }

  /** `navigator.credentials.create()`'s answer to registration options. */
  register(
    options: CeremonyOptions,
    { origin, uv = true }: CeremonyAnswer,
  ): Record<string, unknown> {
    const rpId = options.rp?.id ?? new URL(origin).hostname;
    const jwk = createPublicKey(this.privateKey).export({ format: "jwk" }) as {
      x: string;
      y: string;
    };
    const coseKey = cbor(
      new Map<number, unknown>([
        [1, 2], // kty: EC2
        [3, -7], // alg: ES256
        [-1, 1], // crv: P-256
        [-2, Buffer.from(jwk.x, "base64url")],
        [-3, Buffer.from(jwk.y, "base64url")],
      ]),
    );
    const idLength = Buffer.alloc(2);
    idLength.writeUInt16BE(this.credentialId.length);
    const attested = Buffer.concat([
      Buffer.alloc(16),
      idLength,
      this.credentialId,
      coseKey,
    ]);
    const flags =
      FLAG_USER_PRESENT | FLAG_ATTESTED_DATA | (uv ? FLAG_USER_VERIFIED : 0);
    const attestationObject = cbor(
      new Map<string, unknown>([
        ["fmt", "none"],
        ["attStmt", new Map()],
        ["authData", this.authenticatorData(rpId, flags, attested)],
      ]),
    );
    return {
      id: this.id,
      rawId: this.id,
      type: "public-key",
      response: {
        clientDataJSON: b64url(
          this.clientData("webauthn.create", options.challenge, origin),
        ),
        attestationObject: b64url(attestationObject),
        transports: ["internal"],
      },
      clientExtensionResults: {},
      authenticatorAttachment: "platform",
    };
  }

  /** `navigator.credentials.get()`'s answer to authentication options. */
  assert(
    options: CeremonyOptions,
    { origin, uv = true }: CeremonyAnswer,
  ): Record<string, unknown> {
    this.counter += 1;
    const rpId = options.rpId ?? new URL(origin).hostname;
    const flags = FLAG_USER_PRESENT | (uv ? FLAG_USER_VERIFIED : 0);
    const authenticatorData = this.authenticatorData(rpId, flags);
    const clientDataJSON = this.clientData(
      "webauthn.get",
      options.challenge,
      origin,
    );
    const signature = sign(
      "sha256",
      Buffer.concat([authenticatorData, sha256(clientDataJSON)]),
      this.privateKey,
    );
    return {
      id: this.id,
      rawId: this.id,
      type: "public-key",
      response: {
        clientDataJSON: b64url(clientDataJSON),
        authenticatorData: b64url(authenticatorData),
        signature: b64url(signature),
      },
      clientExtensionResults: {},
      authenticatorAttachment: "platform",
    };
  }
}

/** What the auth route answered, as a test reads it. */
export interface RouteAnswer {
  status: number;
  code: string | undefined;
  body: Record<string, unknown> | unknown[] | null;
  setCookie: string[];
  /** The cookies the answer set, as the `Cookie` header a browser would send next. */
  cookieHeader: string;
}

async function read(response: Response): Promise<RouteAnswer> {
  let body: RouteAnswer["body"] = null;
  try {
    body = (await response.json()) as RouteAnswer["body"];
  } catch {
    body = null;
  }
  const setCookie = response.headers.getSetCookie();
  const code =
    body && !Array.isArray(body) && typeof body.code === "string"
      ? body.code
      : undefined;
  return {
    status: response.status,
    code,
    body,
    setCookie,
    cookieHeader: cookieHeaderFrom(setCookie),
  };
}

export interface BrowserState {
  /** The browser's `Cookie` header, without the passkey challenge cookie. */
  cookie?: string;
  /** The page's origin; the instance's own unless a test says otherwise. */
  origin?: string;
  address?: string;
}

function headersFor(
  { cookie, origin, address }: BrowserState,
  extra = "",
): Headers {
  const headers = new Headers({
    "x-forwarded-for": address ?? freshTestAddress(),
  });
  const jar = [cookie ?? "", extra].filter(Boolean).join("; ");
  if (jar) headers.set("cookie", jar);
  headers.set("origin", origin ?? testOrigin());
  return headers;
}

/** A GET to the auth route, as the page's `fetch` sends it. */
export async function authGet(
  path: string,
  state: BrowserState = {},
): Promise<RouteAnswer> {
  return read(
    await GET(
      new Request(`${testOrigin()}/api/auth${path}`, {
        headers: headersFor(state),
      }),
    ),
  );
}

/** A JSON POST to the auth route, as the page's `fetch` sends it. */
export async function authPost(
  path: string,
  body: unknown,
  state: BrowserState = {},
  extraCookie = "",
): Promise<RouteAnswer> {
  const headers = headersFor(state, extraCookie);
  headers.set("content-type", "application/json");
  return read(
    await POST(
      new Request(`${testOrigin()}/api/auth${path}`, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
      }),
    ),
  );
}

export interface PasskeyRegistration {
  options: RouteAnswer;
  verified: RouteAnswer | null;
}

/**
 * Adds `authenticator` to the account signed in as `state.cookie`, through
 * the route: the options, the authenticator's answer, the verification. Stops
 * after the options when they were refused.
 */
export async function registerPasskey(
  authenticator: SoftAuthenticator,
  state: BrowserState,
  { uv = true, extraBody = {} as Record<string, unknown> } = {},
): Promise<PasskeyRegistration> {
  const options = await authGet("/passkey/generate-register-options", state);
  if (options.status !== 200) return { options, verified: null };
  const response = authenticator.register(
    options.body as unknown as CeremonyOptions,
    {
      origin: state.origin ?? testOrigin(),
      uv,
    },
  );
  const verified = await authPost(
    "/passkey/verify-registration",
    { response, name: "Probe", ...extraBody },
    state,
    options.cookieHeader,
  );
  return { options, verified };
}

export interface PasskeySignIn {
  options: RouteAnswer;
  verified: RouteAnswer;
}

/**
 * Signs in with `authenticator` through the route, as the login page will:
 * the options, the authenticator's answer, the verification with the box.
 * `clientOrigin` is the origin the authenticator writes into its answer,
 * which a real browser makes the page's own.
 */
export async function signInWithPasskey(
  authenticator: SoftAuthenticator,
  state: BrowserState & { deviceId?: string } = {},
  {
    uv = true,
    rememberMe,
    clientOrigin,
  }: { uv?: boolean; rememberMe?: unknown; clientOrigin?: string } = {},
): Promise<PasskeySignIn> {
  const browser: BrowserState = {
    ...state,
    address: state.address ?? freshTestAddress(),
    cookie: [
      state.deviceId ? `${DEVICE_ID_COOKIE}=${state.deviceId}` : "",
      state.cookie ?? "",
    ]
      .filter(Boolean)
      .join("; "),
  };
  const options = await authGet(
    "/passkey/generate-authenticate-options",
    browser,
  );
  if (options.status !== 200)
    throw new Error(`options refused: ${options.status} ${options.code}`);
  const response = authenticator.assert(
    options.body as unknown as CeremonyOptions,
    {
      origin: clientOrigin ?? state.origin ?? testOrigin(),
      uv,
    },
  );
  const verified = await authPost(
    "/passkey/verify-authentication",
    rememberMe === undefined ? { response } : { response, rememberMe },
    browser,
    options.cookieHeader,
  );
  return { options, verified };
}
