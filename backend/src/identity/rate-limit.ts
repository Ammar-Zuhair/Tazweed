import type pg from "pg";
import { transaction } from "../db.js";
import { ApiError } from "../http.js";
import type { Security } from "./security.js";
// Database-backed counters survive restarts and are shared by all API instances.
export async function rateLimit(
  pool: pg.Pool,
  security: Security,
  action: string,
  dimensions: { ip: string; device: string; phone?: string },
  limits = { ip: 60, device: 20, phone: 10 },
) {
  const allowed = await transaction(pool, async (db) => {
    let ok = true;
    for (const kind of ["ip", "device", "phone"] as const) {
      const value = dimensions[kind];
      if (!value) continue;
      const key = security.hmac("rate", action, kind, value);
      const r = await db.query(
        `INSERT INTO auth_rate_buckets(bucket_key,window_start,hits,expires_at)
    VALUES($1,to_timestamp(floor(extract(epoch from now())/900)*900),1,now()+interval '30 minutes')
    ON CONFLICT(bucket_key,window_start) DO UPDATE SET hits=auth_rate_buckets.hits+1 RETURNING hits`,
        [key],
      );
      if (r.rows[0].hits > limits[kind]) ok = false;
    }
    return ok;
  });
  if (!allowed)
    throw new ApiError(429, "RATE_LIMITED", "محاولات كثيرة؛ حاول لاحقًا");
}
