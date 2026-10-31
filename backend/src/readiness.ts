import type { Db } from "./db.js";
export async function databaseReadiness(db: Db) {
  const r =
    await db.query(`SELECT r.rolsuper,r.rolcreatedb,r.rolcreaterole,r.rolbypassrls,
  (SELECT array_agg(name ORDER BY name) FROM schema_migrations) AS migrations,
  has_schema_privilege(current_user,'public','CREATE') AS can_create,
  EXISTS(SELECT 1 FROM pg_auth_members WHERE member=r.oid) AS memberships,
  EXISTS(SELECT 1 FROM pg_tables t WHERE t.schemaname='public' AND t.tablename NOT IN
   ('users','roles','role_permissions','staff_grants','courier_profiles','otp_challenges','sessions','session_refresh_tokens','auth_rate_buckets','addresses','audit_logs')
   AND (has_table_privilege(current_user,quote_ident(t.schemaname)||'.'||quote_ident(t.tablename),'INSERT,UPDATE,DELETE,TRUNCATE')
     OR has_any_column_privilege(current_user,quote_ident(t.schemaname)||'.'||quote_ident(t.tablename),'INSERT,UPDATE'))) AS unauthorized_writes,
  (has_table_privilege(current_user,'audit_logs','UPDATE,DELETE,TRUNCATE') OR has_any_column_privilege(current_user,'audit_logs','UPDATE')) AS audit_mutation
 FROM pg_roles r WHERE rolname=current_user`);
  const row = r.rows[0];
  return {
    database: true,
    migrations:
      JSON.stringify(row?.migrations) ===
      JSON.stringify(["0001_reference_69.sql", "0002_identity_security.sql"]),
    runtimeRole:
      !!row &&
      !row.rolsuper &&
      !row.rolcreatedb &&
      !row.rolcreaterole &&
      !row.rolbypassrls &&
      !row.can_create &&
      !row.memberships &&
      !row.unauthorized_writes &&
      !row.audit_mutation,
  };
}
