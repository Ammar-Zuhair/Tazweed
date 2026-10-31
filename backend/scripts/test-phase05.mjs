// Real PostgreSQL only: creates disposable databases, never uses the staging database as a fixture.
import { execFileSync, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
const backend = fileURLToPath(new URL("../", import.meta.url));
if (!process.env.MIGRATION_DATABASE_URL)
  process.loadEnvFile(backend + ".env.local");
const owner = new URL(process.env.MIGRATION_DATABASE_URL),
  runtime = new URL(process.env.DATABASE_URL);
if (
  owner.hostname !== "127.0.0.1" ||
  owner.port !== "55432" ||
  process.getuid() !== 0
)
  throw new Error(
    "This local disposable test runner requires the documented private local cluster; use explicit TEST_* URLs for another isolated database.",
  );
const suffix = randomBytes(6).toString("hex"),
  names = ["tazweed_test_auth_" + suffix, "tazweed_test_reference_" + suffix];
const psql = (sql) =>
  execFileSync(
    "runuser",
    [
      "-u",
      "postgres",
      "--",
      "psql",
      "-h",
      "/workspace/.postgresql/run",
      "-p",
      "55432",
      "-d",
      "postgres",
      "-v",
      "ON_ERROR_STOP=1",
    ],
    { input: sql, stdio: ["pipe", "pipe", "pipe"] },
  );
const run = (args, env) =>
  new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, {
      cwd: backend,
      env: { ...process.env, ...env },
      stdio: "inherit",
    });
    child.once("error", reject);
    child.once("exit", (code) =>
      code === 0
        ? resolve()
        : reject(new Error("Acceptance subprocess failed: " + code)),
    );
  });
const url = (template, name) => {
  const u = new URL(template);
  u.pathname = "/" + name;
  return u.toString();
};
try {
  for (const n of names)
    psql(
      `CREATE DATABASE ${n} OWNER tazweed_owner; REVOKE ALL ON DATABASE ${n} FROM PUBLIC; GRANT CONNECT ON DATABASE ${n} TO tazweed_owner,tazweed_app;`,
    );
  await run(["--import", "tsx", "--test", "tests/*.test.ts"], {
    NODE_ENV: "test",
    APP_ENV: "test",
    TEST_MIGRATION_DATABASE_URL: url(owner, names[0]),
    TEST_DATABASE_URL: url(runtime, names[0]),
  });
  await run(["reference-tests/schema.test.mjs"], {
    REFERENCE_DATABASE_URL: url(owner, names[1]),
  });
} catch {
  console.error("Phase05 acceptance failed (no credentials logged).");
  process.exitCode = 1;
} finally {
  for (const n of names) {
    try {
      psql(`DROP DATABASE IF EXISTS ${n} WITH (FORCE);`);
    } catch {
      console.error("Disposable database cleanup needs review: " + n);
    }
  }
}
