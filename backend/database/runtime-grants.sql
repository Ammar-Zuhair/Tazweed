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

-- Phase08: immutable monetary facts are INSERT only. No dispatch, cash or commission writes.
GRANT SELECT ON orders,order_private_details,payment_methods,payment_instructions,
 quote_revalidations,order_cancellation_requests,financial_exceptions,financial_exception_resolutions,
 order_events,customer_flags TO tazweed_app;
GRANT INSERT ON orders,order_request_items,order_private_details,order_quotes,quote_items,
 stock_reservations,payment_methods,payment_instructions,payments,payment_receipt_attempts,
 payment_receipt_reviews,quote_revalidations,order_cancellation_requests,financial_exceptions,
 financial_exception_resolutions,order_events TO tazweed_app;
GRANT UPDATE(branch_id,branch_selected_by,branch_selected_at,payment_kind,status,review_stage,
 current_quote_id,version,confirmed_at,closed_reason) ON orders TO tazweed_app;
GRANT UPDATE(status,accepted_by,accepted_at) ON order_quotes TO tazweed_app;
GRANT UPDATE(hold_kind,expires_at,protected_at) ON stock_reservations TO tazweed_app;
GRANT UPDATE(status,reviewer_id,reviewed_at,review_note,approved_amount_yer) ON payments TO tazweed_app;
GRANT UPDATE(status,reviewed_by,review_note,reviewed_at) ON order_cancellation_requests TO tazweed_app;
GRANT UPDATE(status) ON financial_exceptions TO tazweed_app;
GRANT UPDATE ON payment_methods TO tazweed_app;
GRANT USAGE ON SEQUENCE orders_order_number_seq TO tazweed_app;
GRANT EXECUTE ON FUNCTION guard_quote_items(),guard_quote_history(),guard_instruction_issue(),
 guard_payment_update(),guard_receipt_attempt(),protect_reported_transfer(),guard_receipt_review(),
 apply_receipt_review(),guard_protected_reservation(),guard_order_state(),guard_exception_closure(),
 guard_private_evidence() TO tazweed_app;

-- Phase09: delivery and independent cash/commission ledgers. No ledger UPDATE/DELETE.
GRANT SELECT ON order_assignments,courier_earnings,courier_settlements,courier_settlement_reversals,
 settlement_items,cash_collections,cash_remittances,cash_remittance_reversals,cash_remittance_items,
 order_reviews,complaints TO tazweed_app;
GRANT INSERT ON order_assignments,courier_earnings,courier_settlements,courier_settlement_reversals,
 settlement_items,cash_collections,cash_remittances,cash_remittance_reversals,cash_remittance_items,
 order_reviews,complaints,customer_flags,courier_branches TO tazweed_app;
GRANT DELETE ON courier_branches TO tazweed_app;
GRANT UPDATE(ended_at) ON order_assignments TO tazweed_app;
GRANT UPDATE(delivered_at) ON orders TO tazweed_app;
GRANT UPDATE(status,admin_response,assigned_to,version) ON complaints TO tazweed_app;
GRANT UPDATE(status,admin_note,version) ON customer_flags TO tazweed_app;
GRANT EXECUTE ON FUNCTION guard_dispatch(),guard_earning_identity(),guard_cash_collection(),
 guard_allocation_owner(),validate_payout_total() TO tazweed_app;

-- Phase10 operational notification state only. Financial ledger grants unchanged.
GRANT SELECT,INSERT ON push_tokens,notification_campaigns,notification_inbox,notification_deliveries,app_releases TO tazweed_app;
GRANT UPDATE(user_id,app,environment,platform,active,updated_at,session_id,project_id,sound_enabled,version) ON push_tokens TO tazweed_app;
GRANT UPDATE(status,scheduled_at,version,audience_cursor,finished_at,error_code) ON notification_campaigns TO tazweed_app;
GRANT UPDATE(read_at) ON notification_inbox TO tazweed_app;
GRANT UPDATE(ticket_id,status,attempts,error_code,next_attempt_at,token_version,lease_id,locked_until,receipt_checks,updated_at) ON notification_deliveries TO tazweed_app;
GRANT UPDATE(state,attempts,available_at,locked_at,audience_cursor) ON outbox_events TO tazweed_app;
GRANT UPDATE(enabled,message_ar,updated_by,updated_at,version) ON customer_maintenance TO tazweed_app;
GRANT UPDATE(minimum_build,latest_build,latest_version,store_url,message_ar,updated_by,updated_at,version,binary_confirmed) ON app_releases TO tazweed_app;
