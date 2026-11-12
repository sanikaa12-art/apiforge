import { describe, expect, it } from "vitest";
import { api, registerUser } from "../helpers.js";

const cookieFrom = (res: { headers: Record<string, unknown> }) => {
  const raw = ([] as string[]).concat((res.headers["set-cookie"] as string[]) ?? []);
  return raw.find((c) => c.startsWith("apiforge_rt="))!;
};

describe("auth", () => {
  it("registers, never returns the password hash, and sets a secure refresh cookie", async () => {
    const res = await api().post("/api/auth/register").send({ email: "Alice@Example.com", name: "Alice", password: "Passw0rd!x" });
    expect(res.status).toBe(201);
    expect(res.body.user.email).toBe("alice@example.com");
    expect(JSON.stringify(res.body)).not.toContain("passwordHash");
    const cookie = cookieFrom(res);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Strict/i);
    expect(cookie).toMatch(/Path=\/api\/auth/);
  });

  it("rejects duplicate emails and weak passwords", async () => {
    await api().post("/api/auth/register").send({ email: "dup@example.com", name: "A", password: "Passw0rd!x" });
    expect((await api().post("/api/auth/register").send({ email: "dup@example.com", name: "B", password: "Passw0rd!x" })).status).toBe(409);
    const weak = await api().post("/api/auth/register").send({ email: "weak@example.com", name: "W", password: "short" });
    expect(weak.status).toBe(400);
    expect(weak.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("uses the same error for unknown email and wrong password", async () => {
    const u = await registerUser();
    const a = await api().post("/api/auth/login").send({ email: u.email, password: "wrong-pass1" });
    const b = await api().post("/api/auth/login").send({ email: "nobody@example.com", password: "wrong-pass1" });
    expect(a.status).toBe(401);
    expect(b.status).toBe(401);
    expect(a.body.error.message).toBe(b.body.error.message);
  });

  it("protects routes and rejects tampered tokens", async () => {
    expect((await api().get("/api/collections")).status).toBe(401);
    const u = await registerUser();
    expect((await api().get("/api/collections").set("Authorization", `Bearer ${u.token}x`)).status).toBe(401);
    expect((await u.get("/api/auth/me")).body.user.email).toBe(u.email);
  });

  it("rotates refresh tokens and revokes the family when an old token is reused", async () => {
    const reg = await api().post("/api/auth/register").send({ email: "rotate@example.com", name: "R", password: "Passw0rd!x" });
    const first = cookieFrom(reg).split(";")[0]!;

    const r1 = await api().post("/api/auth/refresh").set("Cookie", first);
    expect(r1.status).toBe(200);
    expect(r1.body.accessToken).toBeTruthy();
    const second = cookieFrom(r1).split(";")[0]!;
    expect(second).not.toBe(first);

    // Replaying the first token = theft signal → everything in the family is revoked.
    expect((await api().post("/api/auth/refresh").set("Cookie", first)).status).toBe(401);
    expect((await api().post("/api/auth/refresh").set("Cookie", second)).status).toBe(401);
  });

  it("logout revokes the refresh token", async () => {
    const login = await api().post("/api/auth/register").send({ email: "logout@example.com", name: "L", password: "Passw0rd!x" });
    const cookie = cookieFrom(login).split(";")[0]!;
    expect((await api().post("/api/auth/logout").set("Cookie", cookie)).status).toBe(204);
    expect((await api().post("/api/auth/refresh").set("Cookie", cookie)).status).toBe(401);
  });
});
