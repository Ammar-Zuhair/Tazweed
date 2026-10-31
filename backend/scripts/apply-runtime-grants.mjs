import { readFileSync } from "node:fs";
import pg from "pg";
if (!process.env.MIGRATION_DATABASE_URL)
  throw new Error("MIGRATION_DATABASE_URL required");
const db = new pg.Client({
  connectionString: process.env.MIGRATION_DATABASE_URL,
});
try {
  await db.connect();
  await db.query("BEGIN");
  await db.query(
    readFileSync(
      new URL("../database/runtime-grants.sql", import.meta.url),
      "utf8",
    ),
  );
  await db.query("COMMIT");
  console.log("Runtime and separate NOLOGIN privacy grants applied");
} catch {
  await db.query("ROLLBACK").catch(() => {});
  console.error(
    "Grant application failed; inspect roles/schema with an authorized DB session.",
  );
  process.exitCode = 1;
} finally {
  await db.end();
}
