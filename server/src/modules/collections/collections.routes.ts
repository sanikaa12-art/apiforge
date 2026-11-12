import { Router } from "express";
import { z } from "zod";
import { currentUserId } from "../../middleware/auth.js";
import { badRequest, notFound } from "../../lib/errors.js";
import { prisma, type Prisma } from "../../lib/prisma.js";
import { httpMethodSchema, keyValueList } from "../../lib/types.js";

const collectionSchema = z.object({ name: z.string().trim().min(1).max(120), description: z.string().max(2000).nullish() });
const folderSchema = z.object({ name: z.string().trim().min(1).max(120), parentId: z.string().max(64).nullish() });
const requestSchema = z.object({
  name: z.string().trim().min(1).max(200),
  method: httpMethodSchema.default("GET"),
  url: z.string().max(8192).default(""),
  headers: keyValueList,
  queryParams: keyValueList,
  body: z.string().max(1_000_000).nullish(),
  bodyType: z.enum(["none", "json", "text", "form"]).default("none"),
  description: z.string().max(5000).nullish(),
  folderId: z.string().max(64).nullish(),
});

export const collectionsRouter = Router();

async function ownedCollection(userId: string, id: string) {
  const c = await prisma.collection.findFirst({ where: { id, userId } });
  if (!c) throw notFound("Collection");
  return c;
}
async function ownedFolder(userId: string, id: string) {
  const f = await prisma.folder.findFirst({ where: { id, collection: { userId } } });
  if (!f) throw notFound("Folder");
  return f;
}
async function ownedRequest(userId: string, id: string) {
  const r = await prisma.savedRequest.findFirst({ where: { id, collection: { userId } } });
  if (!r) throw notFound("Request");
  return r;
}
async function assertFolderInCollection(folderId: string | null | undefined, collectionId: string) {
  if (!folderId) return;
  const f = await prisma.folder.findFirst({ where: { id: folderId, collectionId } });
  if (!f) throw badRequest("Folder does not belong to this collection");
}

const requestSummary = { id: true, name: true, method: true, url: true, folderId: true, sortOrder: true, updatedAt: true } as const;

collectionsRouter.get("/collections", async (req, res) => {
  const collections = await prisma.collection.findMany({
    where: { userId: currentUserId(req) },
    orderBy: { createdAt: "asc" },
    include: {
      folders: { orderBy: { createdAt: "asc" } },
      requests: { select: requestSummary, orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] },
    },
  });
  res.json(collections);
});

collectionsRouter.post("/collections", async (req, res) => {
  const data = collectionSchema.parse(req.body);
  const c = await prisma.collection.create({ data: { ...data, userId: currentUserId(req) } });
  res.status(201).json({ ...c, folders: [], requests: [] });
});

collectionsRouter.patch("/collections/:id", async (req, res) => {
  const userId = currentUserId(req);
  await ownedCollection(userId, req.params.id);
  const data = collectionSchema.partial().parse(req.body);
  res.json(await prisma.collection.update({ where: { id: req.params.id }, data }));
});

collectionsRouter.delete("/collections/:id", async (req, res) => {
  await ownedCollection(currentUserId(req), req.params.id);
  await prisma.collection.delete({ where: { id: req.params.id } });
  res.status(204).end();
});

collectionsRouter.post("/collections/:id/folders", async (req, res) => {
  const c = await ownedCollection(currentUserId(req), req.params.id);
  const data = folderSchema.parse(req.body);
  if (data.parentId) {
    const parent = await prisma.folder.findFirst({ where: { id: data.parentId, collectionId: c.id } });
    if (!parent) throw badRequest("Parent folder does not belong to this collection");
  }
  res.status(201).json(await prisma.folder.create({ data: { name: data.name, parentId: data.parentId ?? null, collectionId: c.id } }));
});

collectionsRouter.patch("/folders/:id", async (req, res) => {
  await ownedFolder(currentUserId(req), req.params.id);
  const data = z.object({ name: z.string().trim().min(1).max(120) }).parse(req.body);
  res.json(await prisma.folder.update({ where: { id: req.params.id }, data }));
});

collectionsRouter.delete("/folders/:id", async (req, res) => {
  await ownedFolder(currentUserId(req), req.params.id);
  await prisma.folder.delete({ where: { id: req.params.id } });
  res.status(204).end();
});

collectionsRouter.post("/collections/:id/requests", async (req, res) => {
  const c = await ownedCollection(currentUserId(req), req.params.id);
  const data = requestSchema.parse(req.body);
  await assertFolderInCollection(data.folderId, c.id);
  const created = await prisma.savedRequest.create({
    data: {
      ...data,
      folderId: data.folderId ?? null,
      collectionId: c.id,
      headers: data.headers as Prisma.InputJsonValue,
      queryParams: data.queryParams as Prisma.InputJsonValue,
    },
  });
  res.status(201).json(created);
});

collectionsRouter.get("/requests/:id", async (req, res) => {
  res.json(await ownedRequest(currentUserId(req), req.params.id));
});

collectionsRouter.patch("/requests/:id", async (req, res) => {
  const existing = await ownedRequest(currentUserId(req), req.params.id);
  const data = requestSchema.partial().parse(req.body);
  await assertFolderInCollection(data.folderId, existing.collectionId);
  const updated = await prisma.savedRequest.update({
    where: { id: existing.id },
    data: {
      ...data,
      headers: data.headers as Prisma.InputJsonValue | undefined,
      queryParams: data.queryParams as Prisma.InputJsonValue | undefined,
    },
  });
  res.json(updated);
});

collectionsRouter.post("/requests/:id/duplicate", async (req, res) => {
  const r = await ownedRequest(currentUserId(req), req.params.id);
  const { id: _id, createdAt: _c, updatedAt: _u, ...rest } = r;
  const copy = await prisma.savedRequest.create({
    data: { ...rest, name: `${r.name} (copy)`, headers: r.headers as Prisma.InputJsonValue, queryParams: r.queryParams as Prisma.InputJsonValue },
  });
  res.status(201).json(copy);
});

collectionsRouter.delete("/requests/:id", async (req, res) => {
  await ownedRequest(currentUserId(req), req.params.id);
  await prisma.savedRequest.delete({ where: { id: req.params.id } });
  res.status(204).end();
});
