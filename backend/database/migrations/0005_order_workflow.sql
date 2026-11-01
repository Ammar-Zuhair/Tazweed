-- Phase08, additive only. Preserve immutable reference and previous migrations.
ALTER TABLE financial_exceptions ADD COLUMN branch_id uuid REFERENCES branches(id);
ALTER TABLE media_objects DROP CONSTRAINT media_objects_purpose_check;
ALTER TABLE media_objects ADD CONSTRAINT media_objects_purpose_check CHECK
 (purpose IN ('product','category','banner','receipt','complaint','customer_flag','report','financial_proof'));
CREATE INDEX orders_customer_page ON orders(customer_id,id);
CREATE INDEX orders_branch_page ON orders(branch_id,id);
CREATE INDEX payments_order_history ON payments(order_id,created_at,id);
CREATE INDEX protected_receipt_alert ON stock_reservations(protected_at,quote_id)
 WHERE state='active' AND hold_kind='receipt_review';
CREATE INDEX exceptions_order_open ON financial_exceptions(order_id) WHERE status='open';
CREATE UNIQUE INDEX one_receipt_image_use ON payment_receipt_attempts(media_id);
CREATE UNIQUE INDEX one_external_money_reference ON financial_exception_resolutions
 (direction,upper(regexp_replace(translate(reference,'٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹','01234567890123456789'),'[[:space:][:punct:]]','','g')))
 WHERE direction IN ('refund_to_customer','received_from_customer');
-- Original requested quantities are retained independently of later quote revisions.
CREATE TRIGGER immutable_requested_items BEFORE UPDATE OR DELETE ON order_request_items
 FOR EACH ROW EXECUTE FUNCTION reject_ledger_mutation();
