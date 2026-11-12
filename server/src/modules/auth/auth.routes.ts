import { Router, type Response } from "express";
import { z } from "zod";
import { env, isProd } from "../../config/env.js";
import { authLimiter } from "../../middleware/rateLimit.js";
import { currentUserId, requireAuth } from "../../middleware/auth.js";
import * as auth from "./auth.service.js";

export const REFRESH_COOKIE = "apiforge_rt";

const password = z
  .string()
  .min(8, "Password must be at least 8 characters")
  .max(128)
  .regex(/[A-Za-z]/, "Password must contain a letter")
  .regex(/[0-9]/, "Password must contain a number");

const registerSchema = z.object({
  email: z.email().max(254),
  name: z.string().trim().min(1).max(100),
  password,
});
const loginSchema = z.object({ email: z.email().max(254), password: z.string().min(1).max(128) });

function setRefreshCookie(res: Response, token: string) {
  res.cookie(REFRESH_COOKIE, token, {
    httpOnly: true, // not readable from JavaScript → safe from XSS token theft
    secure: isProd,
    sameSite: "strict", // not sent on cross-site requests → CSRF protection
    path: "/api/auth",
    maxAge: env.REFRESH_TOKEN_TTL_DAYS * 86_400_000,
  });
}

export const authRouter = Router();

authRouter.post("/register", authLimiter, async (req, res) => {
  const body = registerSchema.parse(req.body);
  const session = await auth.register(body, req.get("user-agent"));
  setRefreshCookie(res, session.refreshToken);
  res.status(201).json({ user: session.user, accessToken: session.accessToken });
});

authRouter.post("/login", authLimiter, async (req, res) => {
  const body = loginSchema.parse(req.body);
  const session = await auth.login(body, req.get("user-agent"));
  setRefreshCookie(res, session.refreshToken);
  res.json({ user: session.user, accessToken: session.accessToken });
});

authRouter.post("/refresh", async (req, res) => {
  try {
    const session = await auth.refresh(req.cookies?.[REFRESH_COOKIE], req.get("user-agent"));
    setRefreshCookie(res, session.refreshToken);
    res.json({ user: session.user, accessToken: session.accessToken });
  } catch (err) {
    res.clearCookie(REFRESH_COOKIE, { path: "/api/auth" });
    throw err;
  }
});

authRouter.post("/logout", async (req, res) => {
  await auth.logout(req.cookies?.[REFRESH_COOKIE]);
  res.clearCookie(REFRESH_COOKIE, { path: "/api/auth" });
  res.status(204).end();
});

authRouter.get("/me", requireAuth, async (req, res) => {
  res.json({ user: await auth.getUser(currentUserId(req)) });
});
