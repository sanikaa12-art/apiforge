/**
 * Demo data: one user with collections pointing at public sandbox APIs
 * (JSONPlaceholder, httpbin), three environments, a test suite with runs, and
 * request history spread over the past two weeks so the dashboard has content.
 *
 * Login: demo@apiforge.dev / DemoPass123
 */
import bcrypt from "bcryptjs";
import { prisma, type Prisma } from "../src/lib/prisma.js";
import { encrypt } from "../src/lib/crypto.js";

const DEMO_EMAIL = "demo@apiforge.dev";
const json = (v: unknown) => v as Prisma.InputJsonValue;
const kv = (key: string, value: string, enabled = true) => ({ key, value, enabled });

async function main() {
  await prisma.user.deleteMany({ where: { email: DEMO_EMAIL } });
  const user = await prisma.user.create({
    data: { email: DEMO_EMAIL, name: "Demo Developer", passwordHash: await bcrypt.hash("DemoPass123", 10) },
  });

  // ---- Environments ---------------------------------------------------------
  const dev = await prisma.environment.create({
    data: {
      userId: user.id,
      name: "Development",
      kind: "DEVELOPMENT",
      variables: {
        create: [
          { key: "baseUrl", value: "https://jsonplaceholder.typicode.com" },
          { key: "httpbin", value: "https://httpbin.org" },
          { key: "userId", value: "1" },
          { key: "authToken", value: encrypt("dev-token-3f9a2c71b8"), isSecret: true },
        ],
      },
    },
  });
  await prisma.environment.create({
    data: {
      userId: user.id,
      name: "Staging",
      kind: "STAGING",
      variables: {
        create: [
          { key: "baseUrl", value: "https://jsonplaceholder.typicode.com" },
          { key: "httpbin", value: "https://httpbin.org" },
          { key: "userId", value: "2" },
          { key: "authToken", value: encrypt("stg-token-81be0d44aa"), isSecret: true },
        ],
      },
    },
  });
  await prisma.environment.create({
    data: {
      userId: user.id,
      name: "Production",
      kind: "PRODUCTION",
      variables: {
        create: [
          { key: "baseUrl", value: "https://jsonplaceholder.typicode.com" },
          { key: "httpbin", value: "https://httpbin.org" },
          { key: "userId", value: "3" },
          { key: "authToken", value: encrypt("prod-token-redacted-example"), isSecret: true },
        ],
      },
    },
  });

  // ---- Collections ----------------------------------------------------------
  const blog = await prisma.collection.create({ data: { userId: user.id, name: "Blog Platform API", description: "Posts, comments and users (JSONPlaceholder sandbox)." } });
  const posts = await prisma.folder.create({ data: { collectionId: blog.id, name: "Posts" } });
  const users = await prisma.folder.create({ data: { collectionId: blog.id, name: "Users" } });
  const blogRequests = [
    { folderId: posts.id, name: "List posts", method: "GET", url: "{{baseUrl}}/posts", queryParams: [kv("_limit", "10"), kv("userId", "{{userId}}", false)] },
    { folderId: posts.id, name: "Get post", method: "GET", url: "{{baseUrl}}/posts/1" },
    {
      folderId: posts.id,
      name: "Create post",
      method: "POST",
      url: "{{baseUrl}}/posts",
      headers: [kv("Content-Type", "application/json"), kv("Authorization", "Bearer {{authToken}}")],
      body: JSON.stringify({ title: "Shipping APIForge", body: "Notes from building an API testing platform.", userId: 1 }, null, 2),
      bodyType: "json",
    },
    {
      folderId: posts.id,
      name: "Update post",
      method: "PATCH",
      url: "{{baseUrl}}/posts/1",
      headers: [kv("Content-Type", "application/json")],
      body: JSON.stringify({ title: "Updated title" }, null, 2),
      bodyType: "json",
    },
    { folderId: posts.id, name: "Delete post", method: "DELETE", url: "{{baseUrl}}/posts/1" },
    { folderId: posts.id, name: "Comments for post", method: "GET", url: "{{baseUrl}}/posts/1/comments" },
    { folderId: users.id, name: "List users", method: "GET", url: "{{baseUrl}}/users" },
    { folderId: users.id, name: "Get user", method: "GET", url: "{{baseUrl}}/users/{{userId}}" },
  ] as const;
  let order = 0;
  for (const r of blogRequests) {
    await prisma.savedRequest.create({
      data: {
        collectionId: blog.id,
        folderId: r.folderId,
        name: r.name,
        method: r.method,
        url: r.url,
        headers: json("headers" in r ? r.headers : []),
        queryParams: json("queryParams" in r ? r.queryParams : []),
        body: "body" in r ? r.body : null,
        bodyType: "bodyType" in r ? r.bodyType : "none",
        sortOrder: order++,
      },
    });
  }

  const http = await prisma.collection.create({ data: { userId: user.id, name: "HTTP Diagnostics", description: "httpbin.org utilities for inspecting requests." } });
  for (const [i, r] of [
    { name: "Echo request headers", method: "GET", url: "{{httpbin}}/headers", headers: [kv("X-Trace-Id", "{{$randomUUID}}")] },
    { name: "Bearer auth check", method: "GET", url: "{{httpbin}}/bearer", headers: [kv("Authorization", "Bearer {{authToken}}")] },
    { name: "Simulate 500 error", method: "GET", url: "{{httpbin}}/status/500" },
    { name: "Delayed response (2s)", method: "GET", url: "{{httpbin}}/delay/2" },
    { name: "Echo JSON body", method: "POST", url: "{{httpbin}}/anything", headers: [kv("Content-Type", "application/json")], body: '{\n  "event": "signup",\n  "at": "{{$isoTimestamp}}"\n}', bodyType: "json" },
  ].entries()) {
    await prisma.savedRequest.create({
      data: { collectionId: http.id, name: r.name, method: r.method as "GET", url: r.url, headers: json(r.headers ?? []), body: r.body ?? null, bodyType: r.bodyType ?? "none", sortOrder: i },
    });
  }

  // ---- Test suite with two runs (second one introduces a regression) --------
  const suite = await prisma.testSuite.create({ data: { userId: user.id, name: "Posts API — smoke tests", description: "Core CRUD checks for the posts resource.", environmentId: dev.id } });
  const caseDefs = [
    { name: "List posts returns 200 and an array", method: "GET", url: "{{baseUrl}}/posts", assertions: [{ type: "status", operator: "equals", expected: 200 }, { type: "jsonPath", operator: "type", path: "$", expected: "array" }, { type: "responseTime", operator: "lessThan", expected: 2000 }] },
    { name: "Get post has id, title and body", method: "GET", url: "{{baseUrl}}/posts/1", assertions: [{ type: "status", operator: "equals", expected: 200 }, { type: "jsonPath", operator: "equals", path: "id", expected: 1 }, { type: "jsonPath", operator: "exists", path: "title" }, { type: "header", operator: "contains", path: "content-type", expected: "json" }] },
    { name: "Create post returns 201", method: "POST", url: "{{baseUrl}}/posts", headers: [kv("Content-Type", "application/json")], body: '{"title":"Hello","body":"World","userId":1}', assertions: [{ type: "status", operator: "equals", expected: 201 }, { type: "jsonPath", operator: "exists", path: "id" }] },
    { name: "Unknown post returns 404", method: "GET", url: "{{baseUrl}}/posts/999999", category: "negative", assertions: [{ type: "status", operator: "equals", expected: 404 }] },
    { name: "Create post rejects empty body", method: "POST", url: "{{baseUrl}}/posts", headers: [kv("Content-Type", "application/json")], body: "{}", category: "validation", assertions: [{ type: "status", operator: "in", expected: [400, 422] }] },
  ];
  const cases: Awaited<ReturnType<typeof prisma.testCase.create>>[] = [];
  for (const [i, c] of caseDefs.entries()) {
    cases.push(
      await prisma.testCase.create({
        data: { suiteId: suite.id, name: c.name, method: c.method as "GET", url: c.url, category: c.category ?? "positive", headers: json(c.headers ?? []), body: c.body ?? null, assertions: json(c.assertions), sortOrder: i, status: "APPROVED", source: i === 4 ? "HEURISTIC" : "MANUAL" },
      }),
    );
  }
  const now = Date.now();
  const mkRun = async (daysAgo: number, failingIdx: number[]) => {
    const createdAt = new Date(now - daysAgo * 86_400_000);
    const failed = failingIdx.length;
    const run = await prisma.testRun.create({
      data: { suiteId: suite.id, status: "COMPLETED", total: cases.length, passed: cases.length - failed, failed, durationMs: 1800 + failed * 120, createdAt, startedAt: createdAt, finishedAt: new Date(createdAt.getTime() + 1900) },
    });
    for (const [i, c] of cases.entries()) {
      const fails = failingIdx.includes(i);
      const assertions = (c.assertions as { type: string; operator: string; path?: string; expected?: unknown }[]).map((a, j) => ({
        assertion: a,
        passed: !(fails && j === 0),
        actual: a.type === "status" ? (fails ? 201 : c.method === "POST" ? 201 : i === 3 ? 404 : 200) : null,
        message: fails && j === 0 ? `✗ Expected status ${a.operator} ${JSON.stringify(a.expected)}, got 201` : `✓ ${a.type} ${a.operator}`,
      }));
      await prisma.testResult.create({
        data: { runId: run.id, testCaseId: c.id, name: c.name, method: c.method, url: c.url.replace("{{baseUrl}}", "https://jsonplaceholder.typicode.com"), passed: !fails, status: fails ? 201 : c.method === "POST" ? 201 : i === 3 ? 404 : 200, durationMs: 120 + i * 37, assertions: json(assertions), createdAt },
      });
    }
    return run;
  };
  await mkRun(6, [4]);
  const latest = await mkRun(1, [4]);
  await prisma.testRun.update({
    where: { id: latest.id },
    data: {
      summary:
        '**1 of 5** tests in "Posts API — smoke tests" failed.\n\n**Invalid input was accepted** (1)\n_The API returned success for data that should be rejected. Add server-side validation (required fields, types, lengths, ranges)._\n- **Create post rejects empty body** (POST https://jsonplaceholder.typicode.com/posts) — ✗ Expected status in [400, 422], got 201',
      summarySource: "heuristic",
    },
  });

  // ---- Request history over 14 days ----------------------------------------
  const samples = [
    { method: "GET", url: "https://jsonplaceholder.typicode.com/posts?_limit=10", status: 200, ms: [90, 260] },
    { method: "GET", url: "https://jsonplaceholder.typicode.com/posts/1", status: 200, ms: [70, 180] },
    { method: "POST", url: "https://jsonplaceholder.typicode.com/posts", status: 201, ms: [140, 380] },
    { method: "GET", url: "https://jsonplaceholder.typicode.com/users/1", status: 200, ms: [80, 210] },
    { method: "GET", url: "https://httpbin.org/status/500", status: 500, ms: [300, 700] },
    { method: "GET", url: "https://httpbin.org/delay/2", status: 200, ms: [2050, 2600] },
    { method: "GET", url: "https://httpbin.org/bearer", status: 401, ms: [250, 500] },
    { method: "PATCH", url: "https://jsonplaceholder.typicode.com/posts/1", status: 200, ms: [120, 300] },
  ];
  const history: Prisma.RequestHistoryCreateManyInput[] = [];
  let seed = 42;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let day = 13; day >= 0; day--) {
    const count = 6 + Math.floor(rand() * 14);
    for (let i = 0; i < count; i++) {
      const s = samples[Math.floor(rand() * (rand() < 0.75 ? 4 : samples.length))]!;
      const createdAt = new Date(now - day * 86_400_000 - Math.floor(rand() * 8 * 3_600_000));
      history.push({
        userId: user.id,
        method: s.method,
        url: s.url,
        status: s.status,
        durationMs: Math.round(s.ms[0]! + rand() * (s.ms[1]! - s.ms[0]!)),
        sizeBytes: 200 + Math.floor(rand() * 6000),
        requestHeaders: json({ "user-agent": "APIForge/1.0", accept: "*/*" }),
        responseHeaders: json({ "content-type": "application/json; charset=utf-8" }),
        responseBody: s.status < 400 ? '{"id":1,"title":"sunt aut facere repellat provident"}' : '{"error":"Request failed"}',
        environmentId: dev.id,
        createdAt,
      });
    }
  }
  history.push({ userId: user.id, method: "GET", url: "http://169.254.169.254/latest/meta-data/", error: "Requests to private, loopback or reserved addresses (169.254.169.254) are blocked.", createdAt: new Date(now - 3 * 3_600_000) });
  await prisma.requestHistory.createMany({ data: history });

  console.log(`Seeded demo user ${DEMO_EMAIL} / DemoPass123 with ${history.length} history entries.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
