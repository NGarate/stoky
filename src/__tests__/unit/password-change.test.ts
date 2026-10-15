import { describe, it, expect } from "bun:test";
import { TRPCError } from "@trpc/server";
import { APIError } from "better-auth/api";
import { changeOwnPassword, type ChangePasswordCall } from "@/lib/auth/password-change";
import { isWrongCurrentPasswordRefusal } from "@/lib/validations/password";

/**
 * The seam between `auth.changePassword` and Better Auth (PROGRESS D144),
 * with Better Auth's endpoint replaced by a recording.
 *
 * `integration/auth.flow.test.ts` drives the real endpoint. What it cannot
 * reach is the refusal Better Auth gives only in a race — the current password
 * changed between the router's check and its own — so the mapping of that
 * refusal is proved here, along with what is asked of Better Auth.
 */

const INPUT = { currentPassword: "cocina despensa nevera", newPassword: "tarro de garbanzos azul" };

function recording(answer: () => Promise<unknown> = async () => ({ token: "t" })) {
  const sent: Parameters<ChangePasswordCall>[0][] = [];
  const call: ChangePasswordCall = async (request) => {
    sent.push(request);
    return answer();
  };
  return { call, sent };
}

async function refusalOf(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error("expected a refusal, and the call succeeded");
}

describe("changing a password through Better Auth", () => {
  it("asks for the other sessions to end and this one to rotate, for a browser", async () => {
    const { call, sent } = recording();
    const headers = new Headers({ cookie: "stoky.session_token=abc.def" });

    const outcome = await changeOwnPassword(headers, INPUT, call);

    expect(outcome).toEqual({ rotated: true });
    expect(sent).toHaveLength(1);
    expect(sent[0]?.body).toEqual({ ...INPUT, revokeOtherSessions: true });
    expect(sent[0]?.headers).toBe(headers);
  });

  it("asks for the hash alone when the request carried no cookie", async () => {
    // A native client keeps no cookies: a rotated session would be a row
    // nobody can present. The caller ends every session instead (D142).
    const { call, sent } = recording();

    const outcome = await changeOwnPassword(
      new Headers({ authorization: "Bearer abc.def" }),
      INPUT,
      call,
    );

    expect(outcome).toEqual({ rotated: false });
    expect(sent[0]?.body.revokeOtherSessions).toBe(false);
  });

  it("answers Better Auth's wrong-password refusal as the router's own", async () => {
    const { call } = recording(async () => {
      throw new APIError("BAD_REQUEST", { code: "INVALID_PASSWORD", message: "Invalid password" });
    });

    const refusal = await refusalOf(
      changeOwnPassword(new Headers({ cookie: "a=b" }), INPUT, call),
    );

    expect(refusal).toBeInstanceOf(TRPCError);
    expect((refusal as TRPCError).code).toBe("BAD_REQUEST");
    expect(isWrongCurrentPasswordRefusal((refusal as TRPCError).message)).toBe(true);
  });

  it("answers a session that ended in between as UNAUTHORIZED", async () => {
    const { call } = recording(async () => {
      throw new APIError("UNAUTHORIZED");
    });

    const refusal = await refusalOf(
      changeOwnPassword(new Headers({ cookie: "a=b" }), INPUT, call),
    );

    expect((refusal as TRPCError).code).toBe("UNAUTHORIZED");
  });

  it("lets anything else through as it came", async () => {
    // A database that does not answer is a 500, not a wrong password.
    const failure = new Error("connection refused");
    const { call } = recording(async () => {
      throw failure;
    });

    expect(await refusalOf(changeOwnPassword(new Headers({ cookie: "a=b" }), INPUT, call))).toBe(
      failure,
    );
  });
});
