// Local development only. Data and generated secrets stay in ignored durable workspace paths.
import {
  mkdirSync,
  existsSync,
  writeFileSync,
  readFileSync,
  chownSync,
  chmodSync,
} from "node:fs";
import { execFileSync } from "node:child_process";
import { randomBytes, generateKeyPairSync } from "node:crypto";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../../", import.meta.url)),
  dir = root + ".postgresql",
  data = dir + "/data",
  socket = dir + "/run";
if (process.getuid() !== 0)
  throw new Error("Local cluster setup requires container root");
const pgUid = Number(
    execFileSync("id", ["-u", "postgres"], { encoding: "utf8" }).trim(),
  ),
  pgGid = Number(
    execFileSync("id", ["-g", "postgres"], { encoding: "utf8" }).trim(),
  );
for (const path of [dir, data, socket]) {
  mkdirSync(path, { recursive: true, mode: 0o700 });
  chownSync(path, pgUid, pgGid);
  chmodSync(path, 0o700);
}
const pg = (command, args, input) =>
  execFileSync("runuser", ["-u", "postgres", "--", command, ...args], {
    input,
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
  });
if (!existsSync(data + "/PG_VERSION")) {
  pg("/usr/lib/postgresql/16/bin/initdb", [
    "-D",
    data,
    "--auth-local=peer",
    "--auth-host=scram-sha-256",
    "--encoding=UTF8",
    "--locale=C.UTF-8",
  ]);
  writeFileSync(
    data + "/postgresql.conf",
    `listen_addresses='127.0.0.1'\nport=55432\nunix_socket_directories='${socket}'\npassword_encryption='scram-sha-256'\nlog_statement='none'\nlog_min_error_statement='panic'\nlogging_collector=off\n`,
  );
  chownSync(data + "/postgresql.conf", pgUid, pgGid);
}
try {
  execFileSync("systemctl", ["is-active", "--quiet", "tazweed-postgres-55432"]);
} catch {
  execFileSync(
    "systemd-run",
    [
      "--unit=tazweed-postgres-55432",
      "--description=Tazweed private PostgreSQL development database",
      "--collect",
      "--service-type=exec",
      "--working-directory=" + dir,
      "--property=User=postgres",
      "--property=Restart=on-failure",
      "--property=RestartSec=2s",
      "/usr/lib/postgresql/16/bin/postgres",
      "-D",
      data,
    ],
    { stdio: "pipe" },
  );
}
// Bounded readiness retry; no credentials appear in command arguments or outputs.
for (let i = 0; i < 30; i++) {
  try {
    pg("/usr/bin/pg_isready", ["-h", socket, "-p", "55432"]);
    break;
  } catch {
    await new Promise((r) => setTimeout(r, 200));
  }
}
const envPath = root + "backend/.env.local";
let ownerPassword, appPassword;
if (existsSync(envPath)) {
  const old = readFileSync(envPath, "utf8");
  const ownerUrl = old.match(/^MIGRATION_DATABASE_URL=(.+)$/m)?.[1],
    appUrl = old.match(/^DATABASE_URL=(.+)$/m)?.[1];
  if (!ownerUrl || !appUrl)
    throw new Error("Existing local config requires manual review");
  ownerPassword = new URL(ownerUrl).password;
  appPassword = new URL(appUrl).password;
} else {
  ownerPassword = randomBytes(32).toString("hex");
  appPassword = randomBytes(32).toString("hex");
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const lines = {
    NODE_ENV: "development",
    APP_ENV: "staging",
    HOST: "0.0.0.0",
    PORT: "8084",
    PUBLIC_BASE_URL: "https://tazweed--8084.dev.remote-ammar.duckdns.org",
    CORS_ALLOWED_ORIGINS: [8081, 8082, 8083]
      .map((p) => `https://tazweed--${p}.dev.remote-ammar.duckdns.org`)
      .join(","),
    DATABASE_URL: `postgresql://tazweed_app:${appPassword}@127.0.0.1:55432/tazweed_staging`,
    MIGRATION_DATABASE_URL: `postgresql://tazweed_owner:${ownerPassword}@127.0.0.1:55432/tazweed_staging`,
    OTP_PROVIDER: "UNCONFIGURED",
    OTP_HMAC_SECRET: randomBytes(32).toString("hex"),
    JWT_PRIVATE_KEY: privateKey
      .export({ type: "pkcs8", format: "pem" })
      .toString()
      .replaceAll("\n", "\\n"),
    JWT_PUBLIC_KEY: publicKey
      .export({ type: "spki", format: "pem" })
      .toString()
      .replaceAll("\n", "\\n"),
  };
  writeFileSync(
    envPath,
    Object.entries(lines)
      .map(([k, v]) => `${k}=${v}`)
      .join("\n") + "\n",
    { mode: 0o600 },
  );
}
// Passwords are generated hex (or the same pre-existing generated local hex), not user SQL.
if (
  !/^[a-f0-9]{64}$/.test(ownerPassword) ||
  !/^[a-f0-9]{64}$/.test(appPassword)
)
  throw new Error("Unexpected local credential format");
pg(
  "/usr/bin/psql",
  ["-h", socket, "-p", "55432", "-v", "ON_ERROR_STOP=1", "-d", "postgres"],
  `
SELECT 'CREATE ROLE tazweed_owner LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS' WHERE NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='tazweed_owner')\\gexec
SELECT 'CREATE ROLE tazweed_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS' WHERE NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='tazweed_app')\\gexec
SELECT 'CREATE ROLE tazweed_privacy NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS' WHERE NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='tazweed_privacy')\\gexec
ALTER ROLE tazweed_owner PASSWORD '${ownerPassword}';
ALTER ROLE tazweed_app PASSWORD '${appPassword}';
SELECT 'CREATE DATABASE tazweed_staging OWNER tazweed_owner' WHERE NOT EXISTS(SELECT 1 FROM pg_database WHERE datname='tazweed_staging')\\gexec
REVOKE ALL ON DATABASE tazweed_staging FROM PUBLIC;
GRANT CONNECT ON DATABASE tazweed_staging TO tazweed_owner,tazweed_app;
`,
);
// Runtime process receives only its own DB credential, never the migration owner's.
writeFileSync(
  root + "backend/.env.runtime.local",
  readFileSync(envPath, "utf8")
    .split("\n")
    .filter((line) => !line.startsWith("MIGRATION_DATABASE_URL="))
    .join("\n"),
  { mode: 0o600 },
);
chmodSync(envPath, 0o600);
chmodSync(root + "backend/.env.runtime.local", 0o600);
console.log(
  JSON.stringify({
    cluster: "tazweed-postgres-55432",
    port: 55432,
    data: "ignored durable .postgresql/data",
    config: "backend/.env.local",
    production: false,
  }),
);
