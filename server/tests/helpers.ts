import http from "node:http";
import type { AddressInfo } from "node:net";
import request from "supertest";
import { createApp } from "../src/app.js";

export const app = createApp();
export const api = () => request(app);

let counter = 0;
export async function registerUser(name = "Test User") {
  const email = `user${Date.now()}${counter++}@example.com`;
  const res = await api().post("/api/auth/register").send({ email, name, password: "Passw0rd!x" });
  if (res.status !== 201) throw new Error(`register failed: ${res.status} ${JSON.stringify(res.body)}`);
  const token: string = res.body.accessToken;
  const auth = (r: request.Test) => r.set("Authorization", `Bearer ${token}`);
  return {
    email,
    token,
    user: res.body.user,
    get: (url: string) => auth(api().get(url)),
    post: (url: string, body?: object) => auth(api().post(url)).send(body),
    patch: (url: string, body?: object) => auth(api().patch(url)).send(body),
    put: (url: string, body?: object) => auth(api().put(url)).send(body),
    del: (url: string) => auth(api().delete(url)),
  };
}

/** A small local HTTP API used as the target for executor and test-runner tests. */
export async function startTargetServer(handler?: http.RequestListener) {
  const state = { postsValidation: true, slowMs: 0 };
  const server = http.createServer(
    handler ??
      (async (req, res) => {
        const url = new URL(req.url!, "http://x");
        let body = "";
        for await (const c of req) body += c;
        const send = (status: number, data: unknown, headers: Record<string, string> = {}) => {
          res.writeHead(status, { "content-type": "application/json", ...headers });
          res.end(JSON.stringify(data));
        };
        if (state.slowMs) await new Promise((r) => setTimeout(r, state.slowMs));
        if (url.pathname === "/echo") return send(200, { method: req.method, headers: req.headers, query: Object.fromEntries(url.searchParams), body });
        if (url.pathname === "/posts" && req.method === "GET") return send(200, [{ id: 1, title: "Hello" }]);
        if (url.pathname === "/posts" && req.method === "POST") {
          let parsed: Record<string, unknown>;
          try {
            parsed = JSON.parse(body || "null");
          } catch {
            return send(400, { error: "invalid json" });
          }
          if (state.postsValidation && (!parsed || typeof parsed.title !== "string" || !parsed.title)) return send(422, { error: "title is required" });
          return send(201, { id: 101, ...parsed });
        }
        if (url.pathname.startsWith("/posts/")) return url.pathname === "/posts/1" ? send(200, { id: 1, title: "Hello" }) : send(404, { error: "not found" });
        if (url.pathname === "/redirect-internal") return send(302, {}, { location: "http://localhost:5432/" });
        if (url.pathname === "/redirect-ok") return send(302, {}, { location: "/posts/1" });
        if (url.pathname === "/big") {
          res.writeHead(200, { "content-type": "text/plain" });
          return res.end("x".repeat(2 * 1024 * 1024));
        }
        if (url.pathname === "/crash") return send(500, { error: "boom" });
        send(404, { error: "no route" });
      }),
  );
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const { port } = server.address() as AddressInfo;
  return { base: `http://127.0.0.1:${port}`, state, close: () => new Promise<void>((r) => server.close(() => r())) };
}
