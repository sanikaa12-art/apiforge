import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { env } from "../config/env.js";
import { unauthorized } from "../lib/errors.js";

export interface AuthUser {
  id: string;
  email: string;
}

declare module "express-serve-static-core" {
  interface Request {
    user?: AuthUser;
  }
}

export const JWT_OPTIONS = { issuer: "apiforge", audience: "apiforge-web" } as const;

export function signAccessToken(user: AuthUser): string {
  return jwt.sign({ email: user.email }, env.JWT_ACCESS_SECRET, {
    ...JWT_OPTIONS,
    subject: user.id,
    algorithm: "HS256",
    expiresIn: env.ACCESS_TOKEN_TTL as jwt.SignOptions["expiresIn"],
  });
}

/** Requires a valid `Authorization: Bearer <access token>` header. */
export function requireAuth(req: Request, _res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) return next(unauthorized());
  try {
    const payload = jwt.verify(header.slice(7), env.JWT_ACCESS_SECRET, {
      ...JWT_OPTIONS,
      algorithms: ["HS256"],
    }) as jwt.JwtPayload;
    if (!payload.sub || typeof payload.email !== "string") return next(unauthorized("Invalid token"));
    req.user = { id: payload.sub, email: payload.email };
    next();
  } catch {
    next(unauthorized("Invalid or expired token"));
  }
}

export function currentUserId(req: Request): string {
  if (!req.user) throw unauthorized();
  return req.user.id;
}
