// Emits only public metadata. No credentials or provider keys are copied to applications.
import { readFile, writeFile } from "node:fs/promises";
import { parseEnv } from "node:util";
const args = process.argv.slice(2),
  app = args[args.indexOf("--app") + 1],
  environment = args[args.indexOf("--environment") + 1];
if (
  !["customer", "admin", "courier"].includes(app) ||
  !["staging", "production"].includes(environment)
)
  throw Error(
    "Specify --app customer|admin|courier --environment staging|production",
  );
const source =
  process.env.NATIVE_CONFIG_ENV_FILE ?? new URL("../.env", import.meta.url);
const e = { ...parseEnv(await readFile(source, "utf8")), ...process.env },
  prefix = app.toUpperCase();
const fields = {
  projectId: "EXPO_" + prefix + "_PROJECT_ID",
  apiUrl: prefix + "_API_URL",
  androidPackage: prefix + "_ANDROID_PACKAGE",
  iosBundleIdentifier: prefix + "_IOS_BUNDLE_IDENTIFIER",
};
if ((e.APP_ENV ?? "staging") !== environment)
  throw Error(
    "Native metadata must use the matching backend deployment environment",
  );
const missing = Object.values(fields).filter((k) => !e[k]);
if (missing.length)
  throw Error("Missing configuration names: " + missing.join(", "));
const data = {
  environment,
  ...Object.fromEntries(
    Object.entries(fields).map(([k, name]) => [k, e[name]]),
  ),
};
if (
  !/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(
    data.projectId,
  )
)
  throw Error("Invalid project ID");
const u = new URL(data.apiUrl);
if (u.protocol !== "https:" || u.username || u.password || u.search || u.hash)
  throw Error("API requires public HTTPS without credentials/query/hash");
if (Object.values(fields).some((name) => /TOKEN|SECRET|PASSWORD/.test(name)))
  throw Error("Credential field prohibited");
const ids = ["CUSTOMER", "ADMIN", "COURIER"]
  .map((a) => e["EXPO_" + a + "_PROJECT_ID"])
  .filter(Boolean);
if (new Set(ids).size !== ids.length)
  throw Error("Separate EAS projects required per app");
for (const key of ["androidPackage", "iosBundleIdentifier"])
  if (
    !/^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z][A-Za-z0-9_]*){2,}$/.test(data[key]) ||
    data[key].includes(".preview.")
  )
    throw Error("Owner-confirmed native identifiers required");
const path = new URL(
  "../../" + app + "-app/integration/release." + environment + ".local.json",
  import.meta.url,
);
await writeFile(path, JSON.stringify(data, null, 2) + "\n", { mode: 0o600 });
console.log(
  "Wrote public native metadata for " +
    app +
    "/" +
    environment +
    "; no secrets emitted.",
);
