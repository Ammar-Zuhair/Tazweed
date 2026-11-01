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

-- Phase06 catalog and stock: financial ledgers remain append-only and unwritable here.
GRANT SELECT ON categories,attributes,attribute_values,category_attributes,products,product_attribute_values,product_images,product_units,branch_unit_prices,stock_levels,stock_movements,stock_transfers,stock_transfer_items,stock_reservations,customer_maintenance,delivery_rules,media_objects,idempotency_records,outbox_events TO tazweed_app;
GRANT INSERT,UPDATE ON governorates,branches,categories,attributes,attribute_values,products,product_units,branch_unit_prices,stock_levels,delivery_rules,media_objects TO tazweed_app;
GRANT INSERT,UPDATE,DELETE ON category_attributes,product_attribute_values,product_images TO tazweed_app;
GRANT INSERT ON stock_movements,stock_transfers,stock_transfer_items,outbox_events,idempotency_records TO tazweed_app;
GRANT UPDATE(state) ON stock_reservations TO tazweed_app;
-- Existing guards need these exact referenced facts; no financial/private snapshots exposed.
GRANT SELECT ON order_quotes,quote_items,order_request_items,payments,payment_receipt_attempts,payment_receipt_reviews TO tazweed_app;
GRANT SELECT(id,branch_id) ON orders TO tazweed_app;

-- Phase07: promotion management and read-only pricing. Still no order/quote/hold inserts.
GRANT SELECT,INSERT,UPDATE ON promotions TO tazweed_app;
