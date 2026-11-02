import type { Db } from "./db.js";
export async function databaseReadiness(db: Db) {
  const r =
    await db.query(`SELECT r.rolsuper,r.rolcreatedb,r.rolcreaterole,r.rolbypassrls,
  (SELECT array_agg(name ORDER BY name) FROM schema_migrations) AS migrations,
  has_schema_privilege(current_user,'public','CREATE') AS can_create,
  EXISTS(SELECT 1 FROM pg_auth_members WHERE member=r.oid) AS memberships,
  EXISTS(SELECT 1 FROM pg_tables t WHERE t.schemaname='public' AND t.tablename NOT IN
   ('courier_branches','order_assignments','courier_earnings','courier_settlements','courier_settlement_reversals','settlement_items','cash_collections','cash_remittances','cash_remittance_reversals','cash_remittance_items','order_reviews','complaints','customer_flags','orders','order_request_items','order_private_details','order_quotes','quote_items','stock_reservations','payment_methods','payment_instructions','payments','payment_receipt_attempts','payment_receipt_reviews','quote_revalidations','order_cancellation_requests','financial_exceptions','financial_exception_resolutions','order_events','promotions','governorates','branches','categories','attributes','attribute_values','category_attributes','products','product_attribute_values','product_images','product_units','branch_unit_prices','stock_levels','stock_movements','stock_transfers','stock_transfer_items','order_request_items','payment_instructions','payment_receipt_attempts','payment_receipt_reviews','quote_revalidations','financial_exception_resolutions','order_events','stock_reservations','delivery_rules','media_objects','outbox_events','idempotency_records','users','roles','role_permissions','staff_grants','courier_profiles','otp_challenges','sessions','session_refresh_tokens','auth_rate_buckets','addresses','audit_logs')
   AND (has_table_privilege(current_user,quote_ident(t.schemaname)||'.'||quote_ident(t.tablename),'INSERT,UPDATE,DELETE,TRUNCATE')
     OR has_any_column_privilege(current_user,quote_ident(t.schemaname)||'.'||quote_ident(t.tablename),'INSERT,UPDATE'))) AS unauthorized_writes,
  (has_table_privilege(current_user,'audit_logs','UPDATE,DELETE,TRUNCATE') OR has_any_column_privilege(current_user,'audit_logs','UPDATE')) AS audit_mutation,
  EXISTS(SELECT 1 FROM unnest(ARRAY['courier_earnings','courier_settlements','courier_settlement_reversals','settlement_items','cash_collections','cash_remittances','cash_remittance_reversals','cash_remittance_items','order_reviews','stock_movements','stock_transfers','stock_transfer_items','order_request_items','payment_instructions','payment_receipt_attempts','payment_receipt_reviews','quote_revalidations','financial_exception_resolutions','order_events']) n WHERE has_table_privilege(current_user,n,'UPDATE,DELETE,TRUNCATE') OR has_any_column_privilege(current_user,n,'UPDATE')) AS stock_history_mutation
 FROM pg_roles r WHERE rolname=current_user`);
  const row = r.rows[0];
  return {
    database: true,
    migrations:
      JSON.stringify(row?.migrations) ===
      JSON.stringify([
        "0001_reference_69.sql",
        "0002_identity_security.sql",
        "0003_catalog_media.sql",
        "0004_checkout_read_models.sql",
        "0005_order_workflow.sql",
        "0006_delivery_quality.sql",
      ]),
    runtimeRole:
      !!row &&
      !row.rolsuper &&
      !row.rolcreatedb &&
      !row.rolcreaterole &&
      !row.rolbypassrls &&
      !row.can_create &&
      !row.memberships &&
      !row.unauthorized_writes &&
      !row.audit_mutation &&
      !row.stock_history_mutation,
  };
}
