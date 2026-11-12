/**
 * Starts a throwaway PostgreSQL for the test run (unless TEST_DATABASE_URL is
 * provided, e.g. by a CI service container) and applies all migrations.
 */
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import EmbeddedPostgres from "embedded-postgres";

export default async function setup() {
  const url = process.env.TEST_DATABASE_URL ?? "postgresql://apiforge:apiforge@localhost:5434/apiforge_test";
  let pg: EmbeddedPostgres | undefined;
  if (!process.env.TEST_DATABASE_URL) {
    const dir = path.resolve(".pgdata-test");
    fs.rmSync(dir, { recursive: true, force: true });
    pg = new EmbeddedPostgres({ databaseDir: dir, user: "apiforge", password: "apiforge", port: 5434, persistent: false, onLog: () => {} });
    await pg.initialise();
    await pg.start();
    await pg.createDatabase("apiforge_test");
  }
  execSync("npx prisma migrate deploy", { env: { ...process.env, DATABASE_URL: url }, stdio: "pipe" });
  return async () => {
    await pg?.stop();
  };
}
