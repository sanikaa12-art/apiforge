import crypto from "node:crypto";
import type { KeyValue } from "../../lib/types.js";
import { decrypt } from "../../lib/crypto.js";
import { prisma } from "../../lib/prisma.js";
import { notFound } from "../../lib/errors.js";

export interface ResolvedVariables {
  values: Record<string, string>;
  /** Plain-text secret values, used only to redact them from anything we store. */
  secrets: string[];
}

const VAR_PATTERN = /\{\{\s*([$A-Za-z0-9_.-]+)\s*\}\}/g;

function dynamicValue(name: string): string | undefined {
  switch (name) {
    case "$timestamp":
      return String(Math.floor(Date.now() / 1000));
    case "$isoTimestamp":
      return new Date().toISOString();
    case "$randomUUID":
    case "$guid":
      return crypto.randomUUID();
    case "$randomInt":
      return String(Math.floor(Math.random() * 1000));
    case "$randomEmail":
      return `user_${crypto.randomBytes(4).toString("hex")}@example.com`;
    default:
      return undefined;
  }
}

/** Replaces {{name}} placeholders. Unknown names are left untouched and reported. */
export function substitute(input: string, vars: Record<string, string>, unresolved?: Set<string>): string {
  return input.replace(VAR_PATTERN, (match, name: string) => {
    if (Object.prototype.hasOwnProperty.call(vars, name)) return vars[name]!;
    const dyn = dynamicValue(name);
    if (dyn !== undefined) return dyn;
    unresolved?.add(name);
    return match;
  });
}

export function substituteKeyValues(list: KeyValue[], vars: Record<string, string>, unresolved?: Set<string>): KeyValue[] {
  return list.map((kv) => ({ ...kv, key: substitute(kv.key, vars, unresolved), value: substitute(kv.value, vars, unresolved) }));
}

/** Replaces every occurrence of a secret value with a mask before persisting/logging. */
export function redactSecrets(text: string, secrets: string[]): string {
  let out = text;
  for (const s of secrets) {
    if (s.length < 3) continue;
    out = out.split(s).join("••••••");
    const encoded = encodeURIComponent(s);
    if (encoded !== s) out = out.split(encoded).join("••••••");
  }
  return out;
}

export async function loadEnvironmentVariables(userId: string, environmentId?: string | null): Promise<ResolvedVariables> {
  if (!environmentId) return { values: {}, secrets: [] };
  const envRecord = await prisma.environment.findFirst({ where: { id: environmentId, userId }, include: { variables: true } });
  if (!envRecord) throw notFound("Environment");
  const values: Record<string, string> = {};
  const secrets: string[] = [];
  for (const v of envRecord.variables) {
    const value = v.isSecret && v.value ? decrypt(v.value) : v.value;
    values[v.key] = value;
    if (v.isSecret && value) secrets.push(value);
  }
  return { values, secrets };
}
