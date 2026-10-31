// Explicit operator housekeeping; no audit, identity or financial retention policy is inferred.
import { createPool, transaction } from "./db.js";
const url = process.env.MIGRATION_DATABASE_URL;
if (!url) throw new Error("MIGRATION_DATABASE_URL required");
const pool = createPool(url);
try {
  const counts = await transaction(pool, async (db) => {
    const pending = await db.query(
      "UPDATE otp_challenges SET pending_payload_encrypted=NULL WHERE (expires_at<=now() OR consumed_at IS NOT NULL) AND pending_payload_encrypted IS NOT NULL",
    );
    const rates = await db.query(
      "DELETE FROM auth_rate_buckets WHERE expires_at<=now()",
    );
    return {
      expiredPendingPayloadsCleared: pending.rowCount,
      expiredRateBucketsRemoved: rates.rowCount,
    };
  });
  console.log(JSON.stringify(counts));
} catch {
  console.error("Auth housekeeping failed; no supplied values logged.");
  process.exitCode = 1;
} finally {
  await pool.end();
}
