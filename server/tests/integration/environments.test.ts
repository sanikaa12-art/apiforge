import { describe, expect, it } from "vitest";
import { registerUser } from "../helpers.js";
import { prisma } from "../../src/lib/prisma.js";

describe("environments", () => {
  it("encrypts secrets at rest and never returns them", async () => {
    const u = await registerUser();
    const res = await u.post("/api/environments", {
      name: "Staging",
      kind: "STAGING",
      variables: [
        { key: "baseUrl", value: "https://staging.example.com" },
        { key: "apiKey", value: "sk_live_super_secret", isSecret: true },
      ],
    });
    expect(res.status).toBe(201);
    expect(JSON.stringify(res.body)).not.toContain("sk_live_super_secret");
    const secret = res.body.variables.find((v: { key: string }) => v.key === "apiKey");
    expect(secret).toMatchObject({ isSecret: true, value: "", hasValue: true });

    const row = await prisma.environmentVariable.findFirst({ where: { environmentId: res.body.id, key: "apiKey" } });
    expect(row!.value.startsWith("v1:")).toBe(true);
    expect(row!.value).not.toContain("super_secret");

    // Updating other variables without resending the secret keeps it.
    const updated = await u.put(`/api/environments/${res.body.id}/variables`, {
      variables: [
        { key: "baseUrl", value: "https://staging2.example.com" },
        { key: "apiKey", isSecret: true },
      ],
    });
    expect(updated.status).toBe(200);
    const kept = await prisma.environmentVariable.findFirst({ where: { environmentId: res.body.id, key: "apiKey" } });
    expect(kept!.value).toBe(row!.value);
  });

  it("rejects duplicate keys and invalid names", async () => {
    const u = await registerUser();
    const e = await u.post("/api/environments", { name: "Dev" });
    expect((await u.put(`/api/environments/${e.body.id}/variables`, { variables: [{ key: "a", value: "1" }, { key: "a", value: "2" }] })).status).toBe(400);
    expect((await u.put(`/api/environments/${e.body.id}/variables`, { variables: [{ key: "bad key!", value: "1" }] })).status).toBe(400);
    expect((await u.post("/api/environments", { name: "Dev" })).status).toBe(409);
  });
});
