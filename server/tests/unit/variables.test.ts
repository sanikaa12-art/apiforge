import { describe, expect, it } from "vitest";
import { redactSecrets, substitute } from "../../src/modules/environments/variables.js";
import { decrypt, encrypt } from "../../src/lib/crypto.js";

describe("substitute", () => {
  it("replaces known variables and reports unknown ones", () => {
    const unresolved = new Set<string>();
    expect(substitute("{{baseUrl}}/users/{{ id }}?k={{missing}}", { baseUrl: "https://x.io", id: "5" }, unresolved)).toBe("https://x.io/users/5?k={{missing}}");
    expect([...unresolved]).toEqual(["missing"]);
  });
  it("supports dynamic variables", () => {
    expect(substitute("{{$randomUUID}}", {})).toMatch(/^[0-9a-f-]{36}$/);
    expect(Number(substitute("{{$timestamp}}", {}))).toBeGreaterThan(1_700_000_000);
  });
  it("does not treat user values as templates (no recursive expansion)", () => {
    expect(substitute("{{a}}", { a: "{{b}}", b: "secret" })).toBe("{{b}}");
  });
});

describe("redactSecrets", () => {
  it("masks raw and URL-encoded secret values", () => {
    expect(redactSecrets("token=abc def&x=abc%20def", ["abc def"])).toBe("token=••••••&x=••••••");
  });
});

describe("encryption", () => {
  it("round-trips and uses a random IV", () => {
    const a = encrypt("s3cr3t");
    expect(a).not.toBe(encrypt("s3cr3t"));
    expect(decrypt(a)).toBe("s3cr3t");
  });
  it("detects tampering", () => {
    const parts = encrypt("s3cr3t").split(":");
    parts[3] = Buffer.from("tampered").toString("base64");
    expect(() => decrypt(parts.join(":"))).toThrow();
  });
});
