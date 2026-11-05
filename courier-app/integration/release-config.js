import { readFileSync } from "node:fs";
export function releaseConfig(app, environment) {
  if (environment === "preview") return null;
  if (!["staging", "production"].includes(environment))
    throw Error("Unknown app deployment environment");
  let v;
  try {
    v = JSON.parse(
      readFileSync(`./integration/release.${environment}.local.json`, "utf8"),
    );
  } catch {
    throw Error(
      "Prepare public native configuration from backend first; credentials and identities are not configured.",
    );
  }
  const u = new URL(v.apiUrl);
  if (
    v.environment !== environment ||
    !/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(
      v.projectId,
    ) ||
    u.protocol !== "https:" ||
    u.username ||
    u.password ||
    u.search ||
    u.hash
  )
    throw Error("Invalid native public metadata");
  for (const key of ["androidPackage", "iosBundleIdentifier"])
    if (
      typeof v[key] !== "string" ||
      !/^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z][A-Za-z0-9_]*){2,}$/.test(v[key]) ||
      v[key].includes(".preview.")
    )
      throw Error("Owner-confirmed native identity required");
  return {
    projectId: v.projectId,
    apiUrl: v.apiUrl.replace(/\/$/, "").replace(/\/api\/v1$/, ""),
    androidPackage: v.androidPackage,
    iosBundleIdentifier: v.iosBundleIdentifier,
  };
}
