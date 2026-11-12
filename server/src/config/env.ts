import "dotenv/config";
import { z } from "zod";

/**
 * All configuration comes from environment variables and is validated once at
 * startup. If something required is missing the process exits with a clear
 * message instead of failing later in a confusing way.
 */
const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(4000),
  CORS_ORIGIN: z.string().default("http://localhost:5173"),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
  TRUST_PROXY: z.coerce.number().int().min(0).default(0),

  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),

  JWT_ACCESS_SECRET: z.string().min(32, "JWT_ACCESS_SECRET must be at least 32 characters"),
  ACCESS_TOKEN_TTL: z.string().default("15m"),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(14),
  BCRYPT_ROUNDS: z.coerce.number().int().min(4).max(15).default(12),

  ENCRYPTION_KEY: z
    .string()
    .refine((v) => Buffer.from(v, "base64").length === 32, "ENCRYPTION_KEY must be 32 bytes encoded as base64"),

  REDIS_URL: z.string().optional().transform((v) => (v ? v : undefined)),

  // "local" (default) never calls a paid service. "claude" opts in to Anthropic and
  // requires ANTHROPIC_API_KEY; the local generator is still used as a fallback.
  AI_PROVIDER: z.enum(["local", "claude"]).default("local"),
  ANTHROPIC_API_KEY: z.string().optional().transform((v) => (v ? v : undefined)),
  AI_MODEL: z.string().default("claude-opus-5-5"),

  REQUEST_TIMEOUT_MS: z.coerce.number().int().positive().default(30_000),
  MAX_RESPONSE_BYTES: z.coerce.number().int().positive().default(5 * 1024 * 1024),
  MAX_REDIRECTS: z.coerce.number().int().min(0).max(20).default(5),
  SSRF_ALLOWLIST: z
    .string()
    .default("")
    .transform((v) =>
      v
        .split(",")
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean),
    ),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  console.error("❌ Invalid environment configuration:");
  for (const issue of parsed.error.issues) console.error(`  - ${issue.path.join(".")}: ${issue.message}`);
  process.exit(1);
}

export const env = parsed.data;
export const isProd = env.NODE_ENV === "production";
export const isTest = env.NODE_ENV === "test";

if (isProd && env.SSRF_ALLOWLIST.length > 0) {
  console.warn("⚠️  SSRF_ALLOWLIST is set in production. Private network targets are reachable for:", env.SSRF_ALLOWLIST);
}
