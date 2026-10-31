-- Run as migration owner after migrations, in each intended database.
-- Roles are provisioned separately by the operator, never by HTTP or startup migrations.
REVOKE ALL ON SCHEMA public FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM tazweed_app,tazweed_privacy;
-- Table REVOKE does not remove old column grants. Reset those explicitly too.
DO $$
DECLARE t record; cols text;
BEGIN
 FOR t IN SELECT tablename FROM pg_tables WHERE schemaname='public' LOOP
  SELECT string_agg(quote_ident(column_name),',') INTO cols FROM information_schema.columns
    WHERE table_schema='public' AND table_name=t.tablename;
  EXECUTE format('REVOKE ALL (%s) ON TABLE public.%I FROM tazweed_app,tazweed_privacy',cols,t.tablename);
 END LOOP;
END; $$;
GRANT USAGE ON SCHEMA public TO tazweed_app, tazweed_privacy;
GRANT SELECT ON schema_migrations,users,roles,permissions,role_permissions,staff_grants,
 courier_profiles,courier_branches,otp_challenges,sessions,session_refresh_tokens,auth_rate_buckets,
 addresses,audit_logs,governorates,branches TO tazweed_app;
GRANT INSERT,UPDATE ON users,courier_profiles,otp_challenges,sessions,session_refresh_tokens,auth_rate_buckets,addresses TO tazweed_app;
GRANT INSERT,UPDATE,DELETE ON roles,role_permissions,staff_grants TO tazweed_app;
GRANT INSERT ON audit_logs TO tazweed_app;
GRANT EXECUTE ON FUNCTION guard_staff_grant_kind(),reject_ledger_mutation() TO tazweed_app;
-- Dedicated NOLOGIN role: no app membership, no API path in05, no retention policy presumed.
-- Column rights permit only one-way redaction; the retained guard checks closure and audits it.
GRANT SELECT ON order_private_details TO tazweed_privacy;
GRANT UPDATE(address_snapshot,contact_snapshot,redacted_at,redacted_by,redaction_reason) ON order_private_details TO tazweed_privacy;
GRANT SELECT(id,status) ON orders TO tazweed_privacy;
GRANT SELECT(order_id,status) ON financial_exceptions TO tazweed_privacy;
GRANT INSERT ON audit_logs TO tazweed_privacy;
GRANT EXECUTE ON FUNCTION guard_private_redaction() TO tazweed_privacy;
-- No INSERT/UPDATE/DELETE grants on any monetary ledger; no SET ROLE from the application.
