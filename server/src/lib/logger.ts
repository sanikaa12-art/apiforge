import pino from "pino";
import { env, isProd } from "../config/env.js";

export const logger = pino({
  level: env.LOG_LEVEL,
  // Never log credentials, even by accident.
  redact: {
    paths: [
      "req.headers.authorization",
      "req.headers.cookie",
      'res.headers["set-cookie"]',
      "*.password",
      "*.passwordHash",
      "*.token",
      "*.accessToken",
      "*.refreshToken",
    ],
    censor: "[REDACTED]",
  },
  transport: !isProd && env.LOG_LEVEL !== "silent" ? { target: "pino-pretty", options: { colorize: true, translateTime: "SYS:HH:MM:ss" } } : undefined,
});
