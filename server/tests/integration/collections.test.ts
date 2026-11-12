import { describe, expect, it } from "vitest";
import { registerUser } from "../helpers.js";

describe("collections", () => {
  it("supports full CRUD with folders and saved requests", async () => {
    const u = await registerUser();
    const c = await u.post("/api/collections", { name: "Payments API" });
    expect(c.status).toBe(201);
    const folder = await u.post(`/api/collections/${c.body.id}/folders`, { name: "Charges" });
    const req = await u.post(`/api/collections/${c.body.id}/requests`, {
      name: "Create charge",
      method: "POST",
      url: "{{baseUrl}}/charges",
      folderId: folder.body.id,
      headers: [{ key: "Content-Type", value: "application/json" }],
      body: '{"amount": 1000}',
      bodyType: "json",
    });
    expect(req.status).toBe(201);
    expect(req.body.headers[0]).toEqual({ key: "Content-Type", value: "application/json", enabled: true });

    expect((await u.patch(`/api/collections/${c.body.id}`, { name: "Payments API v2" })).body.name).toBe("Payments API v2");
    expect((await u.patch(`/api/requests/${req.body.id}`, { name: "Create charge (EUR)" })).body.name).toBe("Create charge (EUR)");
    expect((await u.post(`/api/requests/${req.body.id}/duplicate`)).body.name).toBe("Create charge (EUR) (copy)");

    const list = await u.get("/api/collections");
    expect(list.body[0].requests).toHaveLength(2);
    expect(list.body[0].folders).toHaveLength(1);

    expect((await u.del(`/api/folders/${folder.body.id}`)).status).toBe(204);
    expect((await u.get(`/api/requests/${req.body.id}`)).body.folderId).toBeNull(); // requests survive folder deletion
    expect((await u.del(`/api/collections/${c.body.id}`)).status).toBe(204);
    expect((await u.get(`/api/requests/${req.body.id}`)).status).toBe(404);
  });

  it("isolates data between users", async () => {
    const alice = await registerUser("Alice");
    const bob = await registerUser("Bob");
    const c = await alice.post("/api/collections", { name: "Private" });
    const r = await alice.post(`/api/collections/${c.body.id}/requests`, { name: "Secret", url: "https://x.io" });
    expect((await bob.get(`/api/requests/${r.body.id}`)).status).toBe(404);
    expect((await bob.patch(`/api/collections/${c.body.id}`, { name: "pwned" })).status).toBe(404);
    expect((await bob.del(`/api/collections/${c.body.id}`)).status).toBe(404);
    expect((await bob.post(`/api/collections/${c.body.id}/requests`, { name: "x", url: "https://x.io" })).status).toBe(404);
    expect((await bob.get("/api/collections")).body).toHaveLength(0);
  });

  it("validates input", async () => {
    const u = await registerUser();
    const res = await u.post("/api/collections", { name: "" });
    expect(res.status).toBe(400);
    expect(res.body.error.details[0].path).toBe("name");
  });
});
