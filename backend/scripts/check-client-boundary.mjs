// Never prints secret values or matching snippets. Checks application sources and generated bundles.
import { readFile, readdir, stat } from "node:fs/promises";
import { parseEnv } from "node:util";
import { resolve } from "node:path";
const root = resolve(import.meta.dirname, "../..");
const names = [
  "DATABASE_URL",
  "MIGRATION_DATABASE_URL",
  "JWT_PRIVATE_KEY",
  "JWT_PUBLIC_KEY",
  "OTP_HMAC_SECRET",
  "OTP_PROVIDER_TOKEN",
  "R2_ACCESS_KEY_ID",
  "R2_SECRET_ACCESS_KEY",
  "EXPO_ACCESS_TOKEN",
];
const secrets = [];
for (const file of [".env.runtime.local", ".env.local", ".env"]) {
  try {
    const env = parseEnv(
      await readFile(resolve(root, "backend", file), "utf8"),
    );
    for (const n of names) {
      const value = env[n];
      if (value && value.length >= 16) secrets.push(Buffer.from(value));
    }
  } catch (e) {
    if (e.code !== "ENOENT") throw Error("Cannot load backend secret boundary");
  }
}
const bad = [],
  counts = { files: 0, bundles: 0 };
async function scan(dir, bundle = false) {
  for (const d of await readdir(dir, { withFileTypes: true })) {
    const path = resolve(dir, d.name);
    if (d.isDirectory()) {
      await scan(path, bundle);
      continue;
    }
    if (!bundle && !/\.(?:ts|tsx|js|cjs|json|example)$/.test(d.name)) continue;
    const b = await readFile(path);
    counts.files++;
    if (bundle) counts.bundles++;
    if (names.some((n) => b.includes(n)) || secrets.some((v) => b.includes(v)))
      bad.push(path.replace(root + "/", ""));
  }
}
for (const role of ["customer", "admin", "courier"]) {
  for (const file of await readdir(resolve(root, role + "-app"))) {
    if (!/^\.env(?:\.|$)/.test(file)) continue;
    const p = resolve(root, role + "-app", file);
    const b = await readFile(p);
    const env = parseEnv(b.toString());
    const publicNames = [
      "EXPO_PUBLIC_API_BASE_URL",
      "EXPO_PUBLIC_APP_ENV",
      "EXPO_PUBLIC_APP_KIND",
      "EXPO_PUBLIC_EAS_PROJECT_ID",
      "EXPO_PUBLIC_MAP_STYLE_URL",
    ];
    if (
      Object.keys(env).some((n) => !publicNames.includes(n)) ||
      secrets.some((v) => b.includes(v))
    )
      bad.push(role + "-app/" + file);
  }
  for (const d of ["src", "integration", "dist", "dist-native"]) {
    const p = resolve(root, role + "-app", d);
    try {
      if ((await stat(p)).isDirectory()) await scan(p, d.startsWith("dist"));
    } catch (e) {
      if (e.code !== "ENOENT") throw e;
      else if (d.startsWith("dist"))
        throw Error("Export bundles before checking secret boundary");
    }
  }
  for (const file of ["app.config.ts", ".env.example", "metro.config.js"]) {
    const p = resolve(root, role + "-app", file);
    try {
      const b = await readFile(p);
      counts.files++;
      if (
        names.some((n) => b.includes(n)) ||
        secrets.some((v) => b.includes(v))
      )
        bad.push(role + "-app/" + file);
    } catch (e) {
      if (e.code !== "ENOENT") throw e;
    }
  }
}
if (bad.length)
  throw Error(
    "Forbidden backend credentials or names found in: " + bad.join(", "),
  );
console.log(
  JSON.stringify({
    passed: true,
    backendSecretNames: names,
    secretValuesChecked: secrets.length,
    ...counts,
  }),
);
