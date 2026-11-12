/**
 * Local PostgreSQL without Docker.
 *
 * Uses the `embedded-postgres` package, which ships real PostgreSQL binaries
 * through npm. Data is stored in server/.pgdata so it persists between runs.
 * Keep this terminal open while developing; Ctrl+C stops the database.
 */
import EmbeddedPostgres from "embedded-postgres";
import fs from "node:fs";
import path from "node:path";

const dataDir = path.resolve(process.env.PGDATA_DIR ?? ".pgdata");
const port = Number(process.env.PGPORT ?? 5433);
const dbName = process.env.PGDATABASE ?? "apiforge";

const pg = new EmbeddedPostgres({
  databaseDir: dataDir,
  user: "apiforge",
  password: "apiforge",
  port,
  persistent: true,
  onLog: () => {},
});

const fresh = !fs.existsSync(path.join(dataDir, "PG_VERSION"));
if (fresh) {
  console.log(`Initialising new database cluster in ${dataDir}`);
  await pg.initialise();
}
await pg.start();
if (fresh) await pg.createDatabase(dbName);
try {
  await pg.createDatabase(`${dbName}_test`);
} catch {
  /* already exists */
}
console.log(`PostgreSQL ready on postgresql://apiforge:apiforge@localhost:${port}/${dbName} (Ctrl+C to stop)`);

const shutdown = async () => {
  await pg.stop();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
setInterval(() => {}, 1 << 30);
