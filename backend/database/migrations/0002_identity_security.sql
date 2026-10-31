-- Additive changes only: business relations and ledger guards remain intact.
ALTER TABLE otp_challenges ADD COLUMN device_digest text NOT NULL DEFAULT 'legacy-invalid';
ALTER TABLE otp_challenges ADD COLUMN generation integer NOT NULL DEFAULT 1 CHECK(generation>0);
ALTER TABLE otp_challenges ADD COLUMN user_id uuid REFERENCES users(id);
ALTER TABLE sessions ADD COLUMN device_digest text NOT NULL DEFAULT 'legacy-invalid';
ALTER TABLE sessions ADD COLUMN authenticated_at timestamptz NOT NULL DEFAULT now();
-- Keep spent tokens to detect reuse; the session ID is a refresh family.
CREATE TABLE session_refresh_tokens (
  token_hash text PRIMARY KEY, session_id uuid NOT NULL REFERENCES sessions(id),
  used_at timestamptz, expires_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX refresh_family ON session_refresh_tokens(session_id);
CREATE INDEX sessions_by_user ON sessions(user_id) WHERE revoked_at IS NULL;
CREATE TABLE auth_rate_buckets (
  bucket_key text NOT NULL, window_start timestamptz NOT NULL,
  hits integer NOT NULL CHECK(hits>0), expires_at timestamptz NOT NULL,
  PRIMARY KEY(bucket_key,window_start)
);
CREATE INDEX auth_rate_expiry ON auth_rate_buckets(expires_at);
CREATE INDEX otp_unconsumed ON otp_challenges(phone_e164,purpose,app) WHERE consumed_at IS NULL;
-- This trigger concerns identity grants, not business/financial table rights.
CREATE FUNCTION guard_staff_grant_kind() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM users WHERE id=NEW.user_id AND kind='staff' AND status<>'deleted') THEN
   RAISE EXCEPTION 'Role grants are for staff identities only';
 END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER staff_identity_guard BEFORE INSERT OR UPDATE ON staff_grants FOR EACH ROW EXECUTE FUNCTION guard_staff_grant_kind();
INSERT INTO permissions(code,name_ar) VALUES
('catalog.write','إدارة الكتالوج'),('attributes.write','الخصائص'),
('inventory.adjust','تسوية المخزون'),('inventory.transfer','نقل المخزون'),
('orders.review','قراءة الطلبات'),('orders.reprice','التسعيرات'),('orders.confirm','تأكيد الطلب'),
('orders.reject','رفض الطلب'),('orders.assign','إسناد الموصل'),('payments.verify','مراجعة التحويلات'),
('couriers.manage','إدارة الموصلين'),('commissions.settle','تسوية العمولة'),
('cash.collect','تحصيل النقد'),('cash.remit','استلام النقد'),('cash.adjust','تصحيح النقد'),('cash.reverse','عكس النقد'),
('financial-exceptions.resolve','استثناءات المال'),('reports.read','قراءة التقارير'),
('promotions.write','العروض'),('notifications.broadcast','البث العام'),
('maintenance.write','الصيانة'),('releases.write','الإصدارات'),('staff.manage','الموظفون والأدوار'),
('audit.read','التدقيق'),('privacy.manage','الخصوصية'),('customer-flags.read','بلاغات العميل'),
('complaints.manage','الشكاوى'),('branches.write','الفروع'),('payment-methods.write','وسائل التحويل');
-- Technical bootstrap role; no accounts, branches, prices or business settings are fabricated.
INSERT INTO roles(code,name_ar) VALUES ('general_admin','المدير العام');
INSERT INTO role_permissions(role_id,permission_code) SELECT r.id,p.code FROM roles r CROSS JOIN permissions p WHERE r.code='general_admin';
