import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import { isTest } from "../config/env.js";

const common = {
  standardHeaders: "draft-8" as const,
  legacyHeaders: false,
  skip: () => isTest && process.env.ENABLE_RATE_LIMIT_IN_TESTS !== "1",
  handler: (_req: unknown, res: import("express").Response) =>
    res.status(429).json({ error: { code: "RATE_LIMITED", message: "Too many requests, please slow down" } }),
};

const byUserOrIp = (req: import("express").Request) => req.user?.id ?? ipKeyGenerator(req.ip ?? "unknown");

export const globalLimiter = rateLimit({ ...common, windowMs: 60_000, limit: 600 });
// Only failed attempts count, so brute-forcing is throttled but normal sign-ins are not.
export const authLimiter = rateLimit({ ...common, windowMs: 15 * 60_000, limit: 20, skipSuccessfulRequests: true });
export const executeLimiter = rateLimit({ ...common, windowMs: 60_000, limit: 120, keyGenerator: byUserOrIp });
export const aiLimiter = rateLimit({ ...common, windowMs: 60_000, limit: 20, keyGenerator: byUserOrIp });
