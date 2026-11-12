import { Router } from "express";
import { z } from "zod";
import { currentUserId } from "../../middleware/auth.js";
import { notFound, badRequest } from "../../lib/errors.js";
import { prisma } from "../../lib/prisma.js";
import { encrypt } from "../../lib/crypto.js";

const kind = z.enum(["DEVELOPMENT", "STAGING", "PRODUCTION", "CUSTOM"]);
const variableInput = z.object({
  id: z.string().max(64).optional(),
  key: z
    .string()
    .trim()
    .min(1)
    .max(128)
    .regex(/^[A-Za-z0-9_.-]+$/, "Variable names may only contain letters, numbers, _ . and -"),
  /** For secrets, omit `value` to keep the currently stored value. */
  value: z.string().max(10_000).optional(),
  isSecret: z.boolean().default(false),
});
const envSchema = z.object({
  name: z.string().trim().min(1).max(100),
  kind: kind.default("CUSTOM"),
  variables: z.array(variableInput).max(200).optional(),
});

type VariableRow = { id: string; key: string; value: string; isSecret: boolean };

/** Secrets never leave the server: the client only learns that a value exists. */
export function serialiseVariable(v: VariableRow) {
  return v.isSecret
    ? { id: v.id, key: v.key, value: "", isSecret: true, hasValue: v.value.length > 0 }
    : { id: v.id, key: v.key, value: v.value, isSecret: false, hasValue: v.value.length > 0 };
}

function serialiseEnv<T extends { variables: VariableRow[] }>(e: T) {
  return { ...e, variables: e.variables.map(serialiseVariable) };
}

async function ownedEnv(userId: string, id: string) {
  const e = await prisma.environment.findFirst({ where: { id, userId }, include: { variables: true } });
  if (!e) throw notFound("Environment");
  return e;
}

async function replaceVariables(environmentId: string, existing: VariableRow[], incoming: z.infer<typeof variableInput>[]) {
  const keys = incoming.map((v) => v.key);
  if (new Set(keys).size !== keys.length) throw badRequest("Variable names must be unique within an environment");
  const byKey = new Map(existing.map((v) => [v.key, v]));
  const byId = new Map(existing.map((v) => [v.id, v]));
  const rows = incoming.map((v) => {
    const prev = (v.id && byId.get(v.id)) || byKey.get(v.key);
    let stored: string;
    if (v.isSecret) {
      if (v.value !== undefined && v.value !== "") stored = encrypt(v.value);
      else if (prev?.isSecret) stored = prev.value; // keep existing encrypted value
      else if (prev && !prev.isSecret && prev.value) stored = encrypt(prev.value); // converting plain → secret
      else stored = "";
    } else {
      stored = v.value ?? (prev && !prev.isSecret ? prev.value : "");
    }
    return { environmentId, key: v.key, value: stored, isSecret: v.isSecret };
  });
  await prisma.$transaction([
    prisma.environmentVariable.deleteMany({ where: { environmentId } }),
    prisma.environmentVariable.createMany({ data: rows }),
  ]);
}

export const environmentsRouter = Router();

environmentsRouter.get("/environments", async (req, res) => {
  const envs = await prisma.environment.findMany({
    where: { userId: currentUserId(req) },
    include: { variables: { orderBy: { key: "asc" } } },
    orderBy: { createdAt: "asc" },
  });
  res.json(envs.map(serialiseEnv));
});

environmentsRouter.post("/environments", async (req, res) => {
  const userId = currentUserId(req);
  const data = envSchema.parse(req.body);
  const created = await prisma.environment.create({ data: { userId, name: data.name, kind: data.kind } });
  if (data.variables?.length) await replaceVariables(created.id, [], data.variables);
  res.status(201).json(serialiseEnv(await ownedEnv(userId, created.id)));
});

environmentsRouter.patch("/environments/:id", async (req, res) => {
  const userId = currentUserId(req);
  await ownedEnv(userId, req.params.id);
  const data = envSchema.omit({ variables: true }).partial().parse(req.body);
  await prisma.environment.update({ where: { id: req.params.id }, data });
  res.json(serialiseEnv(await ownedEnv(userId, req.params.id)));
});

environmentsRouter.put("/environments/:id/variables", async (req, res) => {
  const userId = currentUserId(req);
  const env = await ownedEnv(userId, req.params.id);
  const variables = z.array(variableInput).max(200).parse(req.body?.variables ?? req.body);
  await replaceVariables(env.id, env.variables, variables);
  res.json(serialiseEnv(await ownedEnv(userId, env.id)));
});

environmentsRouter.delete("/environments/:id", async (req, res) => {
  await ownedEnv(currentUserId(req), req.params.id);
  await prisma.environment.delete({ where: { id: req.params.id } });
  res.status(204).end();
});
