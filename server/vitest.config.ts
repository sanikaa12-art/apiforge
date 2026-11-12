import { defineConfig } from "vitest/config";

const TEST_DB = process.env.TEST_DATABASE_URL ?? "postgresql://apiforge:apiforge@localhost:5434/apiforge_test";

export default defineConfig({
  test: {
    globalSetup: ["./tests/global-setup.ts"],
    fileParallelism: false, // integration tests share one database
    testTimeout: 30_000,
    hookTimeout: 120_000,
    env: {
      NODE_ENV: "test",
      LOG_LEVEL: "silent",
      DATABASE_URL: TEST_DB,
      JWT_ACCESS_SECRET: "test-secret-test-secret-test-secret-1234",
      ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"),
      BCRYPT_ROUNDS: "4",
      ANTHROPIC_API_KEY: "",
      REDIS_URL: "",
      SSRF_ALLOWLIST: "",
      REQUEST_TIMEOUT_MS: "3000",
    },
  },
});
