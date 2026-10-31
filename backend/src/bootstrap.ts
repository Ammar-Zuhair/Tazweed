// Explicit operator command, never an HTTP endpoint or automatic seed/default password.
import { createPool, transaction } from "./db.js";
import { hashPassword } from "./identity/security.js";
import { phone, password, name } from "./identity/contracts.js";
import { audit } from "./identity/audit.js";
import { randomUUID } from "node:crypto";
const url = process.env.MIGRATION_DATABASE_URL;
if (!url)
  throw new Error(
    "MIGRATION_DATABASE_URL required for explicit internal provisioning",
  );
const p = phone.safeParse(process.env.BOOTSTRAP_PHONE),
  n = name.safeParse(process.env.BOOTSTRAP_NAME),
  s = password.safeParse(process.env.BOOTSTRAP_PASSWORD);
if (!p.success || !n.success || !s.success)
  throw new Error(
    "Valid BOOTSTRAP_PHONE, BOOTSTRAP_NAME, BOOTSTRAP_PASSWORD required; use secure environment input",
  );
const pool = createPool(url);
try {
  const hash = await hashPassword(s.data);
  const id = await transaction(pool, async (db) => {
    await db.query("SELECT pg_advisory_xact_lock(105,70)");
    if (
      (
        await db.query(
          `SELECT 1 FROM staff_grants g JOIN roles r ON r.id=g.role_id WHERE r.code='general_admin' AND g.global_scope LIMIT 1`,
        )
      ).rowCount
    )
      throw new Error(
        "General admin already provisioned; use authenticated internal management",
      );
    const u = (
      await db.query(
        `INSERT INTO users(phone_e164,name_ar,password_hash,kind,status) VALUES($1,$2,$3,'staff','pending') RETURNING id`,
        [p.data, n.data, hash],
      )
    ).rows[0];
    await db.query(
      `INSERT INTO staff_grants(user_id,role_id,global_scope) SELECT $1,id,true FROM roles WHERE code='general_admin'`,
      [u.id],
    );
    await audit(
      db,
      randomUUID(),
      u.id,
      "identity.bootstrap_pending",
      "user",
      u.id,
    );
    return u.id;
  });
  console.log(
    JSON.stringify({
      userId: id,
      status: "pending",
      requiresPhoneVerification: true,
    }),
  );
} catch {
  console.error("Bootstrap failed; no account credentials are logged.");
  process.exitCode = 1;
} finally {
  await pool.end();
}
