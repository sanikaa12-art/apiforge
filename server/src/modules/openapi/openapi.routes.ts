import { Router } from "express";
import { z } from "zod";
import { currentUserId } from "../../middleware/auth.js";
import { executeLimiter } from "../../middleware/rateLimit.js";
import { AppError, badRequest, notFound } from "../../lib/errors.js";
import { prisma, type Prisma } from "../../lib/prisma.js";
import { getExecutor } from "../executor/executor.js";
import { exampleFromSchema, fillPath, normaliseSpec, parseSpecText, type ParsedSpec } from "./parser.js";

const sourceSchema = z
  .object({ content: z.string().max(5 * 1024 * 1024).optional(), url: z.url().max(2000).optional() })
  .refine((v) => !!v.content || !!v.url, "Provide the specification text or a URL");

/** Fetching a spec by URL goes through the same SSRF-protected engine as every other request. */
async function loadSpec(input: z.infer<typeof sourceSchema>): Promise<{ parsed: ParsedSpec; raw: unknown }> {
  let text = input.content;
  if (!text && input.url) {
    const res = await getExecutor().execute({ method: "GET", url: input.url, headers: [{ key: "Accept", value: "application/json, application/yaml, text/yaml, */*", enabled: true }] });
    if (res.status >= 400) throw new AppError(502, "SPEC_FETCH_FAILED", `Fetching the specification returned HTTP ${res.status}`);
    if (res.truncated) throw badRequest("Specification is too large");
    text = res.body;
  }
  const raw = parseSpecText(text!);
  return { parsed: normaliseSpec(raw), raw };
}

export const openapiRouter = Router();

openapiRouter.post("/openapi/preview", executeLimiter, async (req, res) => {
  const { parsed } = await loadSpec(sourceSchema.parse(req.body));
  res.json(parsed);
});

openapiRouter.post("/openapi/import", executeLimiter, async (req, res) => {
  const userId = currentUserId(req);
  const body = sourceSchema
    .and(z.object({ createCollection: z.boolean().default(true), createEnvironment: z.boolean().default(true), name: z.string().trim().min(1).max(120).optional() }))
    .parse(req.body);
  const { parsed, raw } = await loadSpec(body);
  if (parsed.endpoints.length === 0) throw badRequest("The specification contains no operations");
  if (parsed.endpoints.length > 500) throw badRequest("Specifications with more than 500 operations are not supported");
  const name = body.name ?? parsed.title;

  const result = await prisma.$transaction(async (tx) => {
    let collectionId: string | null = null;
    if (body.createCollection) {
      const collection = await tx.collection.create({ data: { userId, name, description: `Imported from OpenAPI ${parsed.specVersion}${parsed.version ? ` · API version ${parsed.version}` : ""}` } });
      collectionId = collection.id;
      const folderIds = new Map<string, string>();
      for (const tag of [...new Set(parsed.endpoints.map((e) => e.tags[0] ?? "General"))]) {
        const f = await tx.folder.create({ data: { collectionId, name: tag } });
        folderIds.set(tag, f.id);
      }
      let order = 0;
      for (const ep of parsed.endpoints) {
        const example = ep.requestBody ? exampleFromSchema(ep.requestBody.schema) : undefined;
        const headers = [
          ...(ep.requestBody?.contentType.includes("json") ? [{ key: "Content-Type", value: "application/json", enabled: true }] : []),
          ...(ep.secured ? [{ key: "Authorization", value: "Bearer {{authToken}}", enabled: true }] : []),
        ];
        const queryParams = ep.parameters.filter((p) => p.in === "query").map((p) => ({ key: p.name, value: String(exampleFromSchema(p.schema, p.name) ?? ""), enabled: p.required }));
        await tx.savedRequest.create({
          data: {
            collectionId,
            folderId: folderIds.get(ep.tags[0] ?? "General")!,
            name: ep.summary ?? ep.operationId ?? ep.id,
            description: ep.description,
            method: ep.method,
            url: `{{baseUrl}}${fillPath(ep)}`,
            headers: headers as Prisma.InputJsonValue,
            queryParams: queryParams as Prisma.InputJsonValue,
            body: example !== undefined && example !== null ? JSON.stringify(example, null, 2) : null,
            bodyType: example !== undefined && example !== null ? "json" : "none",
            sortOrder: order++,
          },
        });
      }
    }
    let environmentId: string | null = null;
    if (body.createEnvironment) {
      let envName = `${name} — Development`.slice(0, 100);
      if (await tx.environment.findFirst({ where: { userId, name: envName } })) envName = `${envName.slice(0, 90)} ${Date.now() % 10000}`;
      const environment = await tx.environment.create({
        data: { userId, name: envName, kind: "DEVELOPMENT", variables: { create: [{ key: "baseUrl", value: parsed.baseUrl ?? "https://api.example.com", isSecret: false }] } },
      });
      environmentId = environment.id;
    }
    const spec = await tx.apiSpec.create({
      data: { userId, title: parsed.title, version: parsed.version, baseUrl: parsed.baseUrl, endpoints: parsed.endpoints as unknown as Prisma.InputJsonValue, raw: raw as Prisma.InputJsonValue, collectionId },
    });
    return { specId: spec.id, collectionId, environmentId };
  });
  res.status(201).json({ ...result, title: parsed.title, endpointCount: parsed.endpoints.length });
});

openapiRouter.get("/openapi/specs", async (req, res) => {
  const specs = await prisma.apiSpec.findMany({
    where: { userId: currentUserId(req) },
    orderBy: { createdAt: "desc" },
    select: { id: true, title: true, version: true, baseUrl: true, collectionId: true, createdAt: true, endpoints: true },
  });
  res.json(specs.map((s) => ({ ...s, endpointCount: Array.isArray(s.endpoints) ? s.endpoints.length : 0 })));
});

openapiRouter.get("/openapi/specs/:id", async (req, res) => {
  const spec = await prisma.apiSpec.findFirst({ where: { id: req.params.id, userId: currentUserId(req) }, omit: { raw: true } });
  if (!spec) throw notFound("API specification");
  res.json(spec);
});

openapiRouter.delete("/openapi/specs/:id", async (req, res) => {
  const spec = await prisma.apiSpec.findFirst({ where: { id: req.params.id, userId: currentUserId(req) } });
  if (!spec) throw notFound("API specification");
  await prisma.apiSpec.delete({ where: { id: spec.id } });
  res.status(204).end();
});
