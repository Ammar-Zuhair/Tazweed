-- Additive phase09. Monetary and assignment history remains append-only.
ALTER TABLE cash_collections ADD COLUMN proof_media_id uuid REFERENCES media_objects(id);
ALTER TABLE cash_collections ADD CONSTRAINT cash_adjustment_proof CHECK(entry_type<>'adjustment' OR proof_media_id IS NOT NULL);
ALTER TABLE complaints ADD COLUMN version integer NOT NULL DEFAULT 1 CHECK(version>0);
ALTER TABLE customer_flags ADD COLUMN version integer NOT NULL DEFAULT 1 CHECK(version>0);
ALTER TABLE customer_flags ADD COLUMN kind text NOT NULL DEFAULT 'customer_flag' CHECK(kind IN ('customer_flag','delivery_problem'));
CREATE INDEX assigned_courier_tasks ON order_assignments(courier_id,order_id) WHERE ended_at IS NULL;
CREATE INDEX flags_customer_active ON customer_flags(customer_id,created_at) WHERE status<>'dismissed';
CREATE INDEX complaints_order ON complaints(order_id,created_at);
CREATE UNIQUE INDEX cash_reference_per_courier ON cash_collections(courier_id,lower(btrim(reference)));
CREATE UNIQUE INDEX settlement_reference_per_courier ON courier_settlements(courier_id,lower(btrim(reference)));
CREATE UNIQUE INDEX remittance_reference_per_courier ON cash_remittances(courier_id,lower(btrim(reference)));
CREATE UNIQUE INDEX settlement_reversal_reference ON courier_settlement_reversals(courier_id,lower(btrim(reference)));
CREATE UNIQUE INDEX remittance_reversal_reference ON cash_remittance_reversals(courier_id,lower(btrim(reference)));
INSERT INTO permissions(code,name_ar) VALUES ('commissions.reverse','عكس تسوية العمولة'),('customer-flags.write','تسجيل ومراجعة البلاغات');
INSERT INTO role_permissions(role_id,permission_code) SELECT r.id,p.code FROM roles r CROSS JOIN permissions p WHERE r.code='general_admin' AND p.code IN ('commissions.reverse','customer-flags.write');
CREATE TRIGGER cash_adjustment_private_evidence BEFORE INSERT ON cash_collections FOR EACH ROW WHEN (NEW.entry_type='adjustment') EXECUTE FUNCTION guard_private_evidence();
