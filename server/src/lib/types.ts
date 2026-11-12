import { z } from "zod";

export const keyValueSchema = z.object({
  key: z.string().max(256),
  value: z.string().max(10_000).default(""),
  enabled: z.boolean().default(true),
});
export const keyValueList = z.array(keyValueSchema).max(100).default([]);
export type KeyValue = z.infer<typeof keyValueSchema>;

export const httpMethods = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"] as const;
export const httpMethodSchema = z.enum(httpMethods);
export type HttpMethodName = (typeof httpMethods)[number];

export const idParam = z.object({ id: z.string().min(1).max(64) });

export function asKeyValues(json: unknown): KeyValue[] {
  const parsed = z.array(keyValueSchema).safeParse(json);
  return parsed.success ? parsed.data : [];
}
