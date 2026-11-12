import bcrypt from "bcryptjs";
import { env } from "../../config/env.js";
import { prisma } from "../../lib/prisma.js";
import { randomToken, sha256 } from "../../lib/crypto.js";
import { conflict, unauthorized } from "../../lib/errors.js";
import { logger } from "../../lib/logger.js";
import { signAccessToken } from "../../middleware/auth.js";

export interface PublicUser {
  id: string;
  email: string;
  name: string;
  createdAt: Date;
}

const toPublic = (u: PublicUser): PublicUser => ({ id: u.id, email: u.email, name: u.name, createdAt: u.createdAt });

// Used so that "user not found" takes as long as "wrong password" (prevents user enumeration by timing).
const DUMMY_HASH = bcrypt.hashSync("dummy-password-for-timing", 10);

export async function register(input: { email: string; name: string; password: string }, userAgent?: string) {
  const email = input.email.toLowerCase().trim();
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) throw conflict("An account with this email already exists");
  const passwordHash = await bcrypt.hash(input.password, env.BCRYPT_ROUNDS);
  const user = await prisma.user.create({ data: { email, name: input.name.trim(), passwordHash } });
  return issueSession(user, userAgent);
}

export async function login(input: { email: string; password: string }, userAgent?: string) {
  const user = await prisma.user.findUnique({ where: { email: input.email.toLowerCase().trim() } });
  const ok = await bcrypt.compare(input.password, user?.passwordHash ?? DUMMY_HASH);
  if (!user || !ok) throw unauthorized("Invalid email or password");
  return issueSession(user, userAgent);
}

async function issueSession(user: PublicUser, userAgent?: string, familyId?: string) {
  const refreshToken = randomToken();
  await prisma.refreshToken.create({
    data: {
      userId: user.id,
      tokenHash: sha256(refreshToken),
      familyId: familyId ?? randomToken(16),
      expiresAt: new Date(Date.now() + env.REFRESH_TOKEN_TTL_DAYS * 86_400_000),
      userAgent: userAgent?.slice(0, 255),
    },
  });
  return { user: toPublic(user), accessToken: signAccessToken(user), refreshToken };
}

/**
 * Refresh-token rotation with reuse detection:
 * - a valid token is revoked and replaced by a new one in the same family;
 * - presenting an already-revoked token means it was stolen (or replayed), so the
 *   whole family is revoked and the user must log in again.
 */
export async function refresh(token: string | undefined, userAgent?: string) {
  if (!token) throw unauthorized("No refresh token");
  const record = await prisma.refreshToken.findUnique({ where: { tokenHash: sha256(token) }, include: { user: true } });
  if (!record) throw unauthorized("Invalid refresh token");
  if (record.revokedAt) {
    await prisma.refreshToken.updateMany({ where: { familyId: record.familyId, revokedAt: null }, data: { revokedAt: new Date() } });
    logger.warn({ userId: record.userId }, "Refresh token reuse detected — token family revoked");
    throw unauthorized("Session expired, please sign in again");
  }
  if (record.expiresAt < new Date()) throw unauthorized("Session expired, please sign in again");

  // Conditional update guards against two concurrent refreshes both succeeding.
  const { count } = await prisma.refreshToken.updateMany({ where: { id: record.id, revokedAt: null }, data: { revokedAt: new Date() } });
  if (count === 0) throw unauthorized("Session expired, please sign in again");
  return issueSession(record.user, userAgent, record.familyId);
}

export async function logout(token: string | undefined) {
  if (!token) return;
  await prisma.refreshToken.updateMany({ where: { tokenHash: sha256(token), revokedAt: null }, data: { revokedAt: new Date() } });
}

export async function getUser(id: string) {
  const user = await prisma.user.findUnique({ where: { id } });
  if (!user) throw unauthorized();
  return toPublic(user);
}
