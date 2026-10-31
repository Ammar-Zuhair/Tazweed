import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import pg from "pg";
export const migrationsDirectory = fileURLToPath(
  new URL("../database/migrations/", import.meta.url),
);
export async function migrate(
  connectionString: string,
  directory = migrationsDirectory,
) {
  const db = new pg.Client({
    connectionString,
    application_name: "tazweed-migrations",
  });
  await db.connect();
  try {
    await db.query("SELECT pg_advisory_lock(105,69)");
    await db.query(
      "CREATE TABLE IF NOT EXISTS schema_migrations(name text PRIMARY KEY, sha256 text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())",
    );
    const files = (await readdir(directory))
      .filter((n) => /^\d{4}_[a-z0-9_]+\.sql$/.test(n))
      .sort();
    const applied = await db.query(
      "SELECT name,sha256 FROM schema_migrations ORDER BY name",
    );
    if (applied.rows.some((r) => !files.includes(r.name)))
      throw new Error("Unknown applied migration");
    const results: string[] = [];
    for (const name of files) {
      const sql = await readFile(resolve(directory, name), "utf8");
      const sha256 = createHash("sha256").update(sql).digest("hex");
      const previous = applied.rows.find((r) => r.name === name);
      if (previous) {
        if (previous.sha256 !== sha256)
          throw new Error("Migration checksum mismatch: " + name);
        continue;
      }
      if (applied.rows.some((r) => r.name > name))
        throw new Error("Out-of-order migration");
      await db.query("BEGIN");
      try {
        await db.query(sql);
        await db.query(
          "INSERT INTO schema_migrations(name,sha256) VALUES($1,$2)",
          [name, sha256],
        );
        await db.query("COMMIT");
        results.push(name);
      } catch (e) {
        await db.query("ROLLBACK");
        throw e;
      }
    }
    return results;
  } finally {
    await db.query("SELECT pg_advisory_unlock(105,69)").catch(() => {});
    await db.end();
  }
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const url = process.env.MIGRATION_DATABASE_URL;
  if (!url)
    throw new Error(
      "MIGRATION_DATABASE_URL is required (separate owner credential)",
    );
  // Report only migration names; no URL or SQL errors with supplied values.
  try {
    console.log(JSON.stringify({ applied: await migrate(url) }));
  } catch {
    console.error(
      "Migration failed; inspect schema/checksums through an authorized DB session.",
    );
    process.exitCode = 1;
  }
}
