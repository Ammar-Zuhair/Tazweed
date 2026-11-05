import type pg from "pg";
import { transaction } from "../db.js";
import type { Config } from "../config.js";
import { ApiError, notFound } from "../http.js";
import { requirePermission, type Identity } from "../identity/access.js";
import { audit } from "../identity/audit.js";
import { deployment } from "./provider.js";
import { z } from "zod";
import * as c from "./contracts.js";
export async function configuration(
  pool: pg.Pool,
  config: Config,
  q: z.infer<typeof c.publicConfig>,
) {
  return transaction(pool, async (db) => {
    await db.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const m = (
      await db.query(
        "SELECT enabled,message_ar,version FROM customer_maintenance WHERE singleton",
      )
    ).rows[0];
    const r = (
      await db.query(
        "SELECT minimum_build::int,latest_build::int,latest_version,store_url,message_ar,version FROM app_releases WHERE app=$1 AND platform=$2 AND environment=$3 AND binary_confirmed",
        [q.app, q.platform, deployment(config)],
      )
    ).rows[0];
    return {
      environment: deployment(config),
      maintenance: {
        enabled: q.app === "customer" && !!m?.enabled,
        message: q.app === "customer" ? (m?.message_ar ?? "") : "",
        version: m?.version ?? 1,
      },
      release: r
        ? {
            minimumBuild: r.minimum_build,
            latestBuild: r.latest_build,
            latestVersion: r.latest_version,
            storeUrl: r.store_url,
            message: r.message_ar ?? "",
            version: r.version,
            required: q.build > 0 && q.build < r.minimum_build,
            optional:
              q.build > 0 &&
              q.build >= r.minimum_build &&
              q.build < r.latest_build,
          }
        : null,
    };
  });
}
export async function saveMaintenance(
  pool: pg.Pool,
  i: Identity,
  v: z.infer<typeof c.maintenance>,
) {
  await requirePermission(pool, i, "maintenance.write", null);
  return transaction(pool, async (db) => {
    await requirePermission(db, i, "maintenance.write", null);
    const r = (
      await db.query(
        "UPDATE customer_maintenance SET enabled=$1,message_ar=$2,updated_by=$3,updated_at=now(),version=version+1 WHERE singleton AND version=$4 RETURNING version",
        [v.enabled, v.message, i.id, v.expectedVersion],
      )
    ).rows[0];
    if (!r)
      throw new ApiError(409, "STALE_VERSION", "حدث إعداد الصيانة قبل الحفظ");
    await audit(
      db,
      i.requestId ?? i.id,
      i.id,
      "operations.maintenance",
      "customer_maintenance",
      null,
      { enabled: v.enabled, version: r.version },
    );
    return r;
  });
}
export function validStoreUrl(platform: string, url: string) {
  try {
    const u = new URL(url);
    return (
      u.protocol === "https:" &&
      !u.username &&
      !u.password &&
      !u.hash &&
      (platform === "android"
        ? u.hostname === "play.google.com" &&
          u.pathname === "/store/apps/details" &&
          !!u.searchParams.get("id")
        : u.hostname === "apps.apple.com" && /\/id\d+(?:\/|$)/.test(u.pathname))
    );
  } catch {
    return false;
  }
}
export async function saveRelease(
  pool: pg.Pool,
  config: Config,
  i: Identity,
  v: z.infer<typeof c.release>,
) {
  await requirePermission(pool, i, "releases.write", null);
  if (!validStoreUrl(v.platform, v.storeUrl))
    throw new ApiError(
      422,
      "STORE_URL_INVALID",
      "يلزم رابط متجر HTTPS صحيح وإصدار متاح مثبت قبل تفعيل الحدود",
    );
  return transaction(pool, async (db) => {
    await db.query("SELECT pg_advisory_xact_lock(1010,2)");
    await requirePermission(db, i, "releases.write", null);
    const old = (
      await db.query(
        "SELECT * FROM app_releases WHERE app=$1 AND platform=$2 AND environment=$3 FOR UPDATE",
        [v.app, v.platform, deployment(config)],
      )
    ).rows[0];
    if ((old?.version ?? 0) !== v.expectedVersion)
      throw new ApiError(409, "STALE_VERSION", "حدث إعداد الإصدار قبل الحفظ");
    const args = [
      v.minimumBuild,
      v.latestBuild,
      v.latestVersion,
      v.storeUrl,
      v.message,
      i.id,
    ];
    const r = old
      ? (
          await db.query(
            "UPDATE app_releases SET minimum_build=$1,latest_build=$2,latest_version=$3,store_url=$4,message_ar=$5,updated_by=$6,updated_at=now(),binary_confirmed=true,version=version+1 WHERE id=$7 RETURNING id,version",
            [...args, old.id],
          )
        ).rows[0]
      : (
          await db.query(
            "INSERT INTO app_releases(minimum_build,latest_build,latest_version,store_url,message_ar,updated_by,app,platform,environment,binary_confirmed) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,true) RETURNING id,version",
            [...args, v.app, v.platform, deployment(config)],
          )
        ).rows[0];
    await audit(
      db,
      i.requestId ?? i.id,
      i.id,
      "operations.release",
      "app_release",
      r.id,
      {
        app: v.app,
        platform: v.platform,
        environment: deployment(config),
        minimumBuild: v.minimumBuild,
        latestBuild: v.latestBuild,
        version: r.version,
      },
    );
    return r;
  });
}
