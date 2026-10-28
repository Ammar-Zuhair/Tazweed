-- Tazweed reference PostgreSQL schema, v1.2, owner phase-00 decisions.
-- Reference design + isolated SQL guards only; no production migration or API implementation.
-- Design package only. Apply to an isolated review DB, not production.
-- Service transactions MUST enforce the cross-row invariants documented in DATABASE.md.
BEGIN;

-- المحافظات القابلة للإضافة والإيقاف
CREATE TABLE governorates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name_ar text NOT NULL UNIQUE, active boolean NOT NULL DEFAULT true, sort_order integer NOT NULL DEFAULT 0, created_at timestamptz NOT NULL DEFAULT now()
);

-- الفروع ومواقعها ونطاق التغطية
CREATE TABLE branches (
id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  governorate_id uuid NOT NULL REFERENCES governorates(id), name_ar text NOT NULL,
  latitude numeric(9,6) NOT NULL CHECK(latitude BETWEEN -90 AND 90),
  longitude numeric(9,6) NOT NULL CHECK(longitude BETWEEN -180 AND 180),
  coverage_radius_m integer CHECK(coverage_radius_m>0),
  delivery_enabled boolean NOT NULL DEFAULT false,
  active boolean NOT NULL DEFAULT true, created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(governorate_id,name_ar), UNIQUE(id,governorate_id),
  CHECK(NOT delivery_enabled OR coverage_radius_m IS NOT NULL)
);

-- الحسابات، العميل أو الموظف أو الموصل
CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), phone_e164 text UNIQUE CHECK(phone_e164 ~ '^\+967[0-9]{9}$'), name_ar text NOT NULL, password_hash text, kind text NOT NULL CHECK(kind IN ('customer','staff','courier')), status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','active','disabled','deleted')), phone_verified_at timestamptz, deleted_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), CHECK(status='deleted' OR (phone_e164 IS NOT NULL AND password_hash IS NOT NULL))
);

-- أدوار الموظفين
CREATE TABLE roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), code text NOT NULL UNIQUE, name_ar text NOT NULL
);

-- الصلاحيات الدقيقة
CREATE TABLE permissions (
  code text PRIMARY KEY, name_ar text NOT NULL
);

-- صلاحيات كل دور
CREATE TABLE role_permissions (
  role_id uuid NOT NULL REFERENCES roles(id), permission_code text NOT NULL REFERENCES permissions(code), PRIMARY KEY(role_id,permission_code)
);

-- منح دور لموظف بنطاق فرع أو نطاق عام
CREATE TABLE staff_grants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES users(id), role_id uuid NOT NULL REFERENCES roles(id), branch_id uuid REFERENCES branches(id), global_scope boolean NOT NULL DEFAULT false, CHECK((global_scope AND branch_id IS NULL) OR (NOT global_scope AND branch_id IS NOT NULL))
);

-- نسبة عمولة الموصل الافتراضية
CREATE TABLE courier_profiles (
  user_id uuid PRIMARY KEY REFERENCES users(id), commission_bps integer CHECK(commission_bps BETWEEN 0 AND 10000), active boolean NOT NULL DEFAULT true
);

-- الفروع التي يعمل فيها الموصل
CREATE TABLE courier_branches (
  courier_id uuid NOT NULL REFERENCES courier_profiles(user_id), branch_id uuid NOT NULL REFERENCES branches(id), PRIMARY KEY(courier_id,branch_id)
);

-- تحديات OTP ذات الغرض الواحد
CREATE TABLE otp_challenges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), phone_e164 text NOT NULL, purpose text NOT NULL CHECK(purpose IN ('register','login','reset_password','delete_account','invite')), app text NOT NULL CHECK(app IN ('customer','admin','courier','web')), code_hmac text NOT NULL, preauth_digest text NOT NULL, pending_payload_encrypted text, attempts integer NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 5), expires_at timestamptz NOT NULL, consumed_at timestamptz, resend_after timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);

-- جلسات التجديد الدوارة
CREATE TABLE sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES users(id), app text NOT NULL CHECK(app IN ('customer','admin','courier')), refresh_token_hash text NOT NULL UNIQUE, expires_at timestamptz NOT NULL, revoked_at timestamptz, created_at timestamptz NOT NULL DEFAULT now()
);

-- عناوين العميل المؤكدة بالدبوس
CREATE TABLE addresses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES users(id), governorate_id uuid NOT NULL REFERENCES governorates(id), label text NOT NULL, description text, latitude numeric(9,6) NOT NULL CHECK(latitude BETWEEN -90 AND 90), longitude numeric(9,6) NOT NULL CHECK(longitude BETWEEN -180 AND 180), is_default boolean NOT NULL DEFAULT false, archived_at timestamptz, created_at timestamptz NOT NULL DEFAULT now()
);

-- مفاتيح ملفات R2 وملكيتها
CREATE TABLE media_objects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), owner_id uuid REFERENCES users(id), object_key text NOT NULL UNIQUE, visibility text NOT NULL CHECK(visibility IN ('public','private')), purpose text NOT NULL CHECK(purpose IN ('product','category','banner','receipt','complaint','customer_flag','report')), mime_type text NOT NULL, size_bytes bigint NOT NULL CHECK(size_bytes>0), status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','verified','rejected','deleted')), sha256 text, created_at timestamptz NOT NULL DEFAULT now()
);

-- الأقسام
CREATE TABLE categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), parent_id uuid REFERENCES categories(id), name_ar text NOT NULL, image_id uuid REFERENCES media_objects(id), active boolean NOT NULL DEFAULT true, sort_order integer NOT NULL DEFAULT 0, created_at timestamptz NOT NULL DEFAULT now(), CHECK(parent_id IS NULL OR parent_id<>id)
);

-- تعريفات الخصائص مثل الماركة واللزوجة
CREATE TABLE attributes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), code text NOT NULL UNIQUE, name_ar text NOT NULL, active boolean NOT NULL DEFAULT true, created_at timestamptz NOT NULL DEFAULT now()
);

-- قائمة القيم المسموحة لكل خاصية
CREATE TABLE attribute_values (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), attribute_id uuid NOT NULL REFERENCES attributes(id), value_ar text NOT NULL, active boolean NOT NULL DEFAULT true, sort_order integer NOT NULL DEFAULT 0, UNIQUE(attribute_id,value_ar), UNIQUE(attribute_id,id)
);

-- خصائص القسم وما يظهر كفلتر
CREATE TABLE category_attributes (
  category_id uuid NOT NULL REFERENCES categories(id), attribute_id uuid NOT NULL REFERENCES attributes(id), required boolean NOT NULL DEFAULT false, filterable boolean NOT NULL DEFAULT true, sort_order integer NOT NULL DEFAULT 0, PRIMARY KEY(category_id,attribute_id)
);

-- منتجات SKU بعبوة أو مقاس ثابت
CREATE TABLE products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), sku text NOT NULL UNIQUE, category_id uuid NOT NULL REFERENCES categories(id), name_ar text NOT NULL, description_ar text NOT NULL DEFAULT '', origin_country text, active boolean NOT NULL DEFAULT true, version integer NOT NULL DEFAULT 1 CHECK(version>0), created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(id,category_id)
);

-- اختيار قيمة مسجلة لخاصية مسموحة في قسم المنتج
CREATE TABLE product_attribute_values (
  product_id uuid NOT NULL, category_id uuid NOT NULL, attribute_id uuid NOT NULL, value_id uuid NOT NULL, PRIMARY KEY(product_id,attribute_id), FOREIGN KEY(product_id,category_id) REFERENCES products(id,category_id), FOREIGN KEY(category_id,attribute_id) REFERENCES category_attributes(category_id,attribute_id), FOREIGN KEY(attribute_id,value_id) REFERENCES attribute_values(attribute_id,id)
);

-- صور المنتج وترتيبها
CREATE TABLE product_images (
  product_id uuid NOT NULL REFERENCES products(id), media_id uuid NOT NULL REFERENCES media_objects(id), sort_order integer NOT NULL DEFAULT 0, PRIMARY KEY(product_id,media_id)
);

-- وحدات البيع بالحبة أو الكرتون ومعامل التحويل
CREATE TABLE product_units (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), product_id uuid NOT NULL REFERENCES products(id), unit_kind text NOT NULL CHECK(unit_kind IN ('piece','carton')), pieces_per_unit integer NOT NULL CHECK(pieces_per_unit>0), price_yer bigint NOT NULL CHECK(price_yer>=0), active boolean NOT NULL DEFAULT true, archived_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), CHECK(unit_kind<>'piece' OR pieces_per_unit=1), CHECK(unit_kind<>'carton' OR pieces_per_unit>1), UNIQUE(id,product_id)
);

-- أسعار اختيارية مختلفة بين الفروع
CREATE TABLE branch_unit_prices (
  branch_id uuid NOT NULL REFERENCES branches(id), unit_id uuid NOT NULL REFERENCES product_units(id), price_yer bigint NOT NULL CHECK(price_yer>=0), active boolean NOT NULL DEFAULT true, PRIMARY KEY(branch_id,unit_id)
);

-- الرصيد والمحجوز والحالة البيعية لكل فرع ومنتج
CREATE TABLE stock_levels (
  branch_id uuid NOT NULL REFERENCES branches(id), product_id uuid NOT NULL REFERENCES products(id), on_hand bigint NOT NULL DEFAULT 0 CHECK(on_hand>=0), reserved bigint NOT NULL DEFAULT 0 CHECK(reserved>=0), sellable boolean NOT NULL DEFAULT true, version integer NOT NULL DEFAULT 1 CHECK(version>0), PRIMARY KEY(branch_id,product_id), CHECK(reserved<=on_hand)
);

-- نقل المخزون بين الفروع
CREATE TABLE stock_transfers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), from_branch_id uuid NOT NULL REFERENCES branches(id), to_branch_id uuid NOT NULL REFERENCES branches(id), actor_id uuid NOT NULL REFERENCES users(id), reason text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), CHECK(from_branch_id<>to_branch_id)
);

-- بنود النقل بكميات الحبات
CREATE TABLE stock_transfer_items (
  transfer_id uuid NOT NULL REFERENCES stock_transfers(id), product_id uuid NOT NULL REFERENCES products(id), pieces bigint NOT NULL CHECK(pieces>0), PRIMARY KEY(transfer_id,product_id)
);

-- تعرفة توصيل الفرع
CREATE TABLE delivery_rules (
branch_id uuid PRIMARY KEY REFERENCES branches(id),
  base_yer bigint NOT NULL CHECK(base_yer>=0), per_km_yer bigint NOT NULL CHECK(per_km_yer>=0),
  rounding text NOT NULL DEFAULT 'floor_km' CHECK(rounding='floor_km'),
  max_distance_m integer CHECK(max_distance_m>0), version integer NOT NULL DEFAULT 1 CHECK(version>0)
);

-- المحافظ وبيانات التحويل المدارة
CREATE TABLE payment_methods (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), branch_id uuid REFERENCES branches(id), name_ar text NOT NULL, beneficiary text NOT NULL, destination_number text NOT NULL, instructions_ar text, active boolean NOT NULL DEFAULT true, sort_order integer NOT NULL DEFAULT 0, created_at timestamptz NOT NULL DEFAULT now()
);

-- عروض مؤرخة غير متراكمة
CREATE TABLE promotions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name_ar text NOT NULL, governorate_id uuid REFERENCES governorates(id), category_id uuid REFERENCES categories(id), product_id uuid REFERENCES products(id), target text NOT NULL CHECK(target IN ('products','delivery')), discount_kind text NOT NULL CHECK(discount_kind IN ('fixed','percent')), value bigint NOT NULL CHECK(value>=0), starts_at timestamptz NOT NULL, ends_at timestamptz NOT NULL, active boolean NOT NULL DEFAULT true, CHECK(ends_at>starts_at), CHECK(discount_kind<>'percent' OR value<=10000), CHECK(NOT(category_id IS NOT NULL AND product_id IS NOT NULL))
);

-- رأس الطلب وحالته الظاهرة
CREATE TABLE orders (
id uuid PRIMARY KEY DEFAULT gen_random_uuid(), order_number bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
  customer_id uuid NOT NULL REFERENCES users(id), governorate_id uuid NOT NULL REFERENCES governorates(id),
  catalog_branch_id uuid NOT NULL REFERENCES branches(id),
  branch_id uuid REFERENCES branches(id), branch_selected_by uuid REFERENCES users(id), branch_selected_at timestamptz,
  kind text NOT NULL CHECK(kind IN ('retail','wholesale')),
  payment_kind text CHECK(payment_kind IN ('transfer','cash_on_delivery')),
  status text NOT NULL DEFAULT 'pending_review' CHECK(status IN ('pending_review','confirmed','on_the_way','delivered','rejected','cancelled')),
  review_stage text NOT NULL DEFAULT 'awaiting_branch' CHECK(review_stage IN ('awaiting_branch','awaiting_quote','awaiting_customer','awaiting_transfer','checking_receipt','ready_to_confirm','closed')),
  current_quote_id uuid, version integer NOT NULL DEFAULT 1 CHECK(version>0),
  confirmed_at timestamptz, delivered_at timestamptz, closed_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(catalog_branch_id,governorate_id) REFERENCES branches(id,governorate_id),
  CHECK((branch_id IS NULL AND branch_selected_by IS NULL AND branch_selected_at IS NULL)
     OR (branch_id IS NOT NULL AND branch_selected_by IS NOT NULL AND branch_selected_at IS NOT NULL))
);


-- Customer identity/address snapshots are isolated from immutable financial facts.
CREATE TABLE order_private_details (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), order_id uuid NOT NULL REFERENCES orders(id),
  revision integer NOT NULL CHECK(revision>0), address_snapshot jsonb NOT NULL,
  contact_snapshot jsonb NOT NULL DEFAULT '{}', redacted_at timestamptz,
  redacted_by uuid REFERENCES users(id), redaction_reason text,
  UNIQUE(order_id,revision), UNIQUE(id,order_id),
  CHECK((redacted_at IS NULL AND redacted_by IS NULL AND redaction_reason IS NULL)
     OR (redacted_at IS NOT NULL AND redacted_by IS NOT NULL AND length(btrim(redaction_reason))>0
         AND redaction_reason IS NOT NULL AND address_snapshot='{}'::jsonb AND contact_snapshot='{}'::jsonb))
);

-- بنود طلب الجملة الأولي قبل عرض الإدارة
CREATE TABLE order_request_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), order_id uuid NOT NULL REFERENCES orders(id), product_id uuid NOT NULL REFERENCES products(id), unit_id uuid NOT NULL, quantity integer NOT NULL CHECK(quantity>0), FOREIGN KEY(unit_id,product_id) REFERENCES product_units(id,product_id)
);

-- نسخ عرض أسعار الطلب مع snapshots
CREATE TABLE order_quotes (
id uuid PRIMARY KEY DEFAULT gen_random_uuid(), order_id uuid NOT NULL REFERENCES orders(id),
  branch_id uuid NOT NULL REFERENCES branches(id), private_details_id uuid NOT NULL,
  revision integer NOT NULL CHECK(revision>0),
  status text NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','sent','accepted','declined','superseded','expired')),
  subtotal_yer bigint NOT NULL CHECK(subtotal_yer>=0),
  product_discount_yer bigint NOT NULL DEFAULT 0 CHECK(product_discount_yer>=0 AND product_discount_yer<=subtotal_yer),
  delivery_yer bigint NOT NULL CHECK(delivery_yer>=0),
  delivery_discount_yer bigint NOT NULL DEFAULT 0 CHECK(delivery_discount_yer>=0 AND delivery_discount_yer<=delivery_yer),
  total_yer bigint NOT NULL CHECK(total_yer>=0),
  pricing_mode text NOT NULL DEFAULT 'road' CHECK(pricing_mode IN ('road','manual')),
  distance_m integer CHECK(distance_m>=0),
  billed_km integer GENERATED ALWAYS AS (distance_m/1000) STORED,
  base_yer bigint NOT NULL CHECK(base_yer>=0), per_km_yer bigint NOT NULL CHECK(per_km_yer>=0),
  rounding text NOT NULL DEFAULT 'floor_km' CHECK(rounding='floor_km'),
  routing_source text NOT NULL, delivery_rule_snapshot jsonb NOT NULL,
  promotion_id uuid REFERENCES promotions(id), promotion_snapshot jsonb,
  author_id uuid REFERENCES users(id), accepted_by uuid REFERENCES users(id), accepted_at timestamptz,
  expires_at timestamptz NOT NULL, reason text, created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(order_id,revision), UNIQUE(id,order_id), UNIQUE(id,order_id,branch_id),
  FOREIGN KEY(private_details_id,order_id) REFERENCES order_private_details(id,order_id),
  CHECK(total_yer=subtotal_yer-product_discount_yer+delivery_yer-delivery_discount_yer),
  CHECK(status<>'accepted' OR (accepted_at IS NOT NULL AND accepted_by IS NOT NULL)),
  CHECK((accepted_at IS NULL)=(accepted_by IS NULL)),
  CHECK((pricing_mode='road' AND distance_m IS NOT NULL AND delivery_yer=base_yer+billed_km::bigint*per_km_yer)
     OR (pricing_mode='manual' AND length(btrim(reason))>0 AND reason IS NOT NULL)),
  CHECK(NOT(product_discount_yer>0 AND delivery_discount_yer>0)),
  CHECK((promotion_id IS NULL AND promotion_snapshot IS NULL AND product_discount_yer=0 AND delivery_discount_yer=0)
     OR (promotion_id IS NOT NULL AND jsonb_typeof(promotion_snapshot)='object' AND promotion_snapshot IS NOT NULL))
);

-- بنود عرض السعر immutable بعد الإرسال
CREATE TABLE quote_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), quote_id uuid NOT NULL REFERENCES order_quotes(id), product_id uuid NOT NULL REFERENCES products(id), unit_id uuid NOT NULL, name_snapshot text NOT NULL, attributes_snapshot jsonb NOT NULL DEFAULT '{}', unit_snapshot text NOT NULL, pieces_per_unit integer NOT NULL CHECK(pieces_per_unit>0), quantity integer NOT NULL CHECK(quantity>0), unit_price_yer bigint NOT NULL CHECK(unit_price_yer>=0), line_total_yer bigint NOT NULL CHECK(line_total_yer>=0), FOREIGN KEY(unit_id,product_id) REFERENCES product_units(id,product_id), CHECK(line_total_yer=quantity::bigint*unit_price_yer)
);

-- حجز حبات لطلب وفرع ومنتج
CREATE TABLE stock_reservations (
id uuid PRIMARY KEY DEFAULT gen_random_uuid(), order_id uuid NOT NULL REFERENCES orders(id),
  branch_id uuid NOT NULL, product_id uuid NOT NULL REFERENCES products(id), quote_id uuid NOT NULL,
  pieces bigint NOT NULL CHECK(pieces>0),
  state text NOT NULL DEFAULT 'active' CHECK(state IN ('active','consumed','released','expired')),
  hold_kind text NOT NULL DEFAULT 'timed' CHECK(hold_kind IN ('timed','receipt_review')),
  expires_at timestamptz, protected_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(branch_id,product_id) REFERENCES stock_levels(branch_id,product_id),
  FOREIGN KEY(quote_id,order_id,branch_id) REFERENCES order_quotes(id,order_id,branch_id),
  CHECK((hold_kind='timed' AND expires_at IS NOT NULL AND protected_at IS NULL)
     OR (hold_kind='receipt_review' AND expires_at IS NULL AND protected_at IS NOT NULL)),
  CHECK(NOT(hold_kind='receipt_review' AND state='expired'))
);

-- دفتر حركات المخزون، لا يعدل ولا يحذف
CREATE TABLE stock_movements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), branch_id uuid NOT NULL REFERENCES branches(id), product_id uuid NOT NULL REFERENCES products(id), delta_pieces bigint NOT NULL CHECK(delta_pieces<>0), reason text NOT NULL CHECK(reason IN ('receipt','adjustment','transfer_in','transfer_out','sale','reversal')), order_id uuid REFERENCES orders(id), transfer_id uuid REFERENCES stock_transfers(id), reverses_id uuid UNIQUE REFERENCES stock_movements(id), actor_id uuid NOT NULL REFERENCES users(id), note text, created_at timestamptz NOT NULL DEFAULT now()
);


-- Issued BEFORE displaying destination details; later wallet edits cannot change it.
CREATE TABLE payment_instructions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), order_id uuid NOT NULL REFERENCES orders(id),
  quote_id uuid NOT NULL, method_id uuid NOT NULL REFERENCES payment_methods(id),
  revision integer NOT NULL CHECK(revision>0), method_snapshot jsonb NOT NULL,
  expected_amount_yer bigint NOT NULL CHECK(expected_amount_yer>0), created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(quote_id,order_id) REFERENCES order_quotes(id,order_id),
  UNIQUE(order_id,revision), UNIQUE(id,order_id,quote_id,method_id),
  CHECK(jsonb_typeof(method_snapshot)='object'
    AND method_snapshot ?& ARRAY['name_ar','beneficiary','destination_number'])
);

-- التحويلات والإيصالات ومراجعتها
CREATE TABLE payments (
id uuid PRIMARY KEY DEFAULT gen_random_uuid(), order_id uuid NOT NULL REFERENCES orders(id), quote_id uuid NOT NULL,
  method_id uuid NOT NULL REFERENCES payment_methods(id), instruction_id uuid NOT NULL,
  receipt_number text NOT NULL, normalized_receipt_number text NOT NULL,
  amount_yer bigint NOT NULL CHECK(amount_yer>0), approved_amount_yer bigint CHECK(approved_amount_yer>0),
  status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected')),
  reviewer_id uuid REFERENCES users(id), reviewed_at timestamptz, review_note text, created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(quote_id,order_id) REFERENCES order_quotes(id,order_id),
  FOREIGN KEY(instruction_id,order_id,quote_id,method_id) REFERENCES payment_instructions(id,order_id,quote_id,method_id),
  UNIQUE(method_id,normalized_receipt_number),
  CHECK(status='pending' OR (reviewer_id IS NOT NULL AND reviewed_at IS NOT NULL)),
  CHECK((status='approved')=(approved_amount_yer IS NOT NULL))
);

-- تاريخ حالات الطلب وقراراته
CREATE TABLE order_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), order_id uuid NOT NULL REFERENCES orders(id), actor_id uuid REFERENCES users(id), event_type text NOT NULL, details jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now()
);

-- إسناد الطلب وتثبيت نسبة العمولة
CREATE TABLE order_assignments (
id uuid PRIMARY KEY DEFAULT gen_random_uuid(), order_id uuid NOT NULL REFERENCES orders(id),
  courier_id uuid NOT NULL REFERENCES courier_profiles(user_id), assigned_by uuid NOT NULL REFERENCES users(id),
  commission_bps integer NOT NULL CHECK(commission_bps BETWEEN 0 AND 10000),
  delivery_fee_before_discount_yer bigint NOT NULL CHECK(delivery_fee_before_discount_yer>=0),
  delivery_discount_yer bigint NOT NULL CHECK(delivery_discount_yer>=0 AND delivery_discount_yer<=delivery_fee_before_discount_yer),
  customer_delivery_yer bigint GENERATED ALWAYS AS (delivery_fee_before_discount_yer-delivery_discount_yer) STORED,
  commission_yer bigint NOT NULL CHECK(commission_yer>=0),
  assigned_at timestamptz NOT NULL DEFAULT now(), ended_at timestamptz,
  UNIQUE(id,order_id,courier_id),
  CHECK(commission_yer=round(delivery_fee_before_discount_yer::numeric*commission_bps/10000)::bigint)
);

-- دفتر مستحقات التسليم والتصحيحات
CREATE TABLE courier_earnings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), courier_id uuid NOT NULL REFERENCES courier_profiles(user_id), order_id uuid REFERENCES orders(id), assignment_id uuid REFERENCES order_assignments(id), entry_type text NOT NULL CHECK(entry_type IN ('delivery','adjustment')), amount_yer bigint NOT NULL CHECK(amount_yer<>0), adjustment_reason text, related_earning_id uuid REFERENCES courier_earnings(id), earned_at timestamptz NOT NULL DEFAULT now(), CHECK(entry_type<>'delivery' OR (order_id IS NOT NULL AND assignment_id IS NOT NULL AND amount_yer>0)), CHECK(entry_type<>'adjustment' OR adjustment_reason IS NOT NULL)
);

-- تسويات مدفوعة للموصلين
CREATE TABLE courier_settlements (
id uuid PRIMARY KEY DEFAULT gen_random_uuid(), courier_id uuid NOT NULL REFERENCES courier_profiles(user_id),
  paid_by uuid NOT NULL REFERENCES users(id), total_yer bigint NOT NULL CHECK(total_yer>0),
  reference text NOT NULL CHECK(length(btrim(reference))>0), created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(id,courier_id,total_yer)
);


-- A reversal is a new payable credit; original payout and allocations stay intact.
CREATE TABLE courier_settlement_reversals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), settlement_id uuid NOT NULL UNIQUE,
  courier_id uuid NOT NULL REFERENCES courier_profiles(user_id), amount_yer bigint NOT NULL CHECK(amount_yer>0),
  reason text NOT NULL CHECK(length(btrim(reason))>0), reference text NOT NULL CHECK(length(btrim(reference))>0),
  proof_media_id uuid NOT NULL REFERENCES media_objects(id), actor_id uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(settlement_id,courier_id,amount_yer) REFERENCES courier_settlements(id,courier_id,total_yer)
);

-- ربط المستحق بالتسوية مرة واحدة
CREATE TABLE settlement_items (
id uuid PRIMARY KEY DEFAULT gen_random_uuid(), settlement_id uuid NOT NULL REFERENCES courier_settlements(id),
  earning_id uuid UNIQUE REFERENCES courier_earnings(id),
  reversal_credit_id uuid UNIQUE REFERENCES courier_settlement_reversals(id),
  CHECK(num_nonnulls(earning_id,reversal_credit_id)=1)
);

-- تقييم طلب مسلم مرة واحدة
CREATE TABLE order_reviews (
  order_id uuid PRIMARY KEY REFERENCES orders(id), customer_id uuid NOT NULL REFERENCES users(id), rating smallint NOT NULL CHECK(rating BETWEEN 1 AND 5), comment_ar text, created_at timestamptz NOT NULL DEFAULT now()
);

-- شكاوى العميل المرتبطة بطلب
CREATE TABLE complaints (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), order_id uuid NOT NULL REFERENCES orders(id), customer_id uuid NOT NULL REFERENCES users(id), details_ar text NOT NULL, attachment_id uuid REFERENCES media_objects(id), status text NOT NULL DEFAULT 'open' CHECK(status IN ('open','in_progress','resolved')), admin_response text, assigned_to uuid REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now()
);

-- بلاغات الإدارة والموصل على العميل
CREATE TABLE customer_flags (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), customer_id uuid NOT NULL REFERENCES users(id), order_id uuid REFERENCES orders(id), reporter_id uuid NOT NULL REFERENCES users(id), details_ar text NOT NULL, attachment_id uuid REFERENCES media_objects(id), status text NOT NULL DEFAULT 'open' CHECK(status IN ('open','reviewed','dismissed')), admin_note text, created_at timestamptz NOT NULL DEFAULT now()
);

-- بنرات الرئيسية
CREATE TABLE banners (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), title_ar text NOT NULL, image_id uuid NOT NULL REFERENCES media_objects(id), governorate_id uuid REFERENCES governorates(id), product_id uuid REFERENCES products(id), category_id uuid REFERENCES categories(id), starts_at timestamptz, ends_at timestamptz, active boolean NOT NULL DEFAULT true, sort_order integer NOT NULL DEFAULT 0, CHECK(ends_at IS NULL OR starts_at IS NULL OR ends_at>starts_at)
);

-- أجهزة الإشعارات
CREATE TABLE push_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES users(id), app text NOT NULL CHECK(app IN ('customer','admin','courier')), environment text NOT NULL CHECK(environment IN ('staging','production')), token text NOT NULL UNIQUE, platform text NOT NULL CHECK(platform IN ('android','ios')), active boolean NOT NULL DEFAULT true, updated_at timestamptz NOT NULL DEFAULT now()
);

-- البث والإشعارات المجدولة
CREATE TABLE notification_campaigns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), author_id uuid NOT NULL REFERENCES users(id), title_ar text NOT NULL, body_ar text NOT NULL, audience jsonb NOT NULL, status text NOT NULL CHECK(status IN ('draft','scheduled','sending','sent','cancelled','failed')), scheduled_at timestamptz, created_at timestamptz NOT NULL DEFAULT now()
);

-- مركز الإشعارات الدائم
CREATE TABLE notification_inbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES users(id), app text NOT NULL CHECK(app IN ('customer','admin','courier')), title_ar text NOT NULL, body_ar text NOT NULL, data jsonb NOT NULL DEFAULT '{}', event_key text NOT NULL, read_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(user_id,app,event_key)
);

-- محاولات push ونتائجها
CREATE TABLE notification_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), notification_id uuid NOT NULL REFERENCES notification_inbox(id), push_token_id uuid NOT NULL REFERENCES push_tokens(id), ticket_id text, status text NOT NULL CHECK(status IN ('pending','sent','delivered','failed')), attempts integer NOT NULL DEFAULT 0 CHECK(attempts>=0), error_code text, next_attempt_at timestamptz, UNIQUE(notification_id,push_token_id)
);

-- أحداث ترسل بعد حفظ المعاملة
CREATE TABLE outbox_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), event_type text NOT NULL, aggregate_id uuid, dedupe_key text NOT NULL UNIQUE, payload jsonb NOT NULL, state text NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','processing','done','dead')), attempts integer NOT NULL DEFAULT 0 CHECK(attempts>=0), available_at timestamptz NOT NULL DEFAULT now(), locked_at timestamptz, created_at timestamptz NOT NULL DEFAULT now()
);

-- صيانة العميل فقط
CREATE TABLE customer_maintenance (
  singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton), enabled boolean NOT NULL DEFAULT false, message_ar text NOT NULL DEFAULT 'التطبيق في وضع الصيانة، سنعود في أقرب فرصة ممكنة', updated_by uuid REFERENCES users(id), updated_at timestamptz NOT NULL DEFAULT now()
);

-- حدود الإصدارات لكل تطبيق ومنصة وبيئة
CREATE TABLE app_releases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), app text NOT NULL CHECK(app IN ('customer','admin','courier')), platform text NOT NULL CHECK(platform IN ('android','ios')), environment text NOT NULL CHECK(environment IN ('staging','production')), minimum_build bigint NOT NULL CHECK(minimum_build>0), latest_build bigint NOT NULL CHECK(latest_build>=minimum_build), latest_version text NOT NULL, store_url text NOT NULL, message_ar text, updated_by uuid REFERENCES users(id), updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(app,platform,environment)
);

-- إعدادات تشغيل غير سرية
CREATE TABLE settings (
  key text PRIMARY KEY, value jsonb NOT NULL, updated_by uuid REFERENCES users(id), updated_at timestamptz NOT NULL DEFAULT now()
);

-- طلبات حذف من التطبيق أو المتصفح
CREATE TABLE deletion_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid REFERENCES users(id), source text NOT NULL CHECK(source IN ('app','web')), status text NOT NULL DEFAULT 'requested' CHECK(status IN ('requested','verified','processing','completed','needs_review')), verified_at timestamptz, completed_at timestamptz, retention_notice text, created_at timestamptz NOT NULL DEFAULT now()
);

-- سجل إداري لا يقبل التعديل
CREATE TABLE audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), actor_id uuid REFERENCES users(id), action text NOT NULL, entity_type text NOT NULL, entity_id uuid, branch_id uuid REFERENCES branches(id), before_redacted jsonb, after_redacted jsonb, request_id text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);

-- حفظ نتائج العمليات ومنع تكرارها
CREATE TABLE idempotency_records (
  actor_id uuid NOT NULL REFERENCES users(id), scope text NOT NULL, key text NOT NULL, request_hash text NOT NULL, response_status integer, response_body jsonb, expires_at timestamptz NOT NULL, PRIMARY KEY(actor_id,scope,key)
);

-- توليد تقارير PDF خاصة
CREATE TABLE report_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), requested_by uuid NOT NULL REFERENCES users(id), kind text NOT NULL CHECK(kind='monthly_sales'), parameters jsonb NOT NULL, state text NOT NULL CHECK(state IN ('pending','processing','ready','failed')), media_id uuid REFERENCES media_objects(id), error_message text, created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE payment_receipt_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), payment_id uuid NOT NULL REFERENCES payments(id),
  attempt_number integer NOT NULL CHECK(attempt_number>0), media_id uuid NOT NULL REFERENCES media_objects(id),
  submitted_by uuid NOT NULL REFERENCES users(id), submitted_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(payment_id,attempt_number), UNIQUE(id,payment_id)
);
CREATE TABLE payment_receipt_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), payment_id uuid NOT NULL REFERENCES payments(id),
  attempt_id uuid NOT NULL UNIQUE, reviewer_id uuid NOT NULL REFERENCES users(id),
  outcome text NOT NULL CHECK(outcome IN ('image_rejected','transfer_verified','transfer_rejected')),
  verified_amount_yer bigint CHECK(verified_amount_yer>0),
  note text NOT NULL CHECK(length(btrim(note))>0), created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(attempt_id,payment_id) REFERENCES payment_receipt_attempts(id,payment_id),
  CHECK((outcome='transfer_verified')=(verified_amount_yer IS NOT NULL))
);
CREATE TABLE quote_revalidations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), quote_id uuid NOT NULL REFERENCES order_quotes(id),
  checked_by uuid NOT NULL REFERENCES users(id), checked_at timestamptz NOT NULL DEFAULT now(),
  valid_until timestamptz NOT NULL, reason text NOT NULL CHECK(length(btrim(reason))>0),
  CHECK(valid_until>checked_at)
);
CREATE TABLE order_cancellation_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), order_id uuid NOT NULL REFERENCES orders(id),
  requested_by uuid NOT NULL REFERENCES users(id), reason text NOT NULL,
  status text NOT NULL DEFAULT 'requested' CHECK(status IN ('requested','approved','denied')),
  reviewed_by uuid REFERENCES users(id), review_note text, reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK(status='requested' OR (reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL AND review_note IS NOT NULL))
);
CREATE UNIQUE INDEX one_open_cancellation ON order_cancellation_requests(order_id) WHERE status='requested';
CREATE TABLE financial_exceptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), order_id uuid NOT NULL REFERENCES orders(id),
  kind text NOT NULL CHECK(kind IN ('overpayment','underpayment','late_transfer','stock_unavailable','cash_shortfall','cash_uncollected','other')),
  amount_yer bigint NOT NULL CHECK(amount_yer>=0), reason text NOT NULL CHECK(length(btrim(reason))>0),
  status text NOT NULL DEFAULT 'open' CHECK(status IN ('open','resolved')),
  opened_by uuid NOT NULL REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE financial_exception_resolutions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), exception_id uuid NOT NULL REFERENCES financial_exceptions(id),
  direction text NOT NULL CHECK(direction IN ('refund_to_customer','received_from_customer','write_off','other')),
  amount_yer bigint NOT NULL CHECK(amount_yer>=0), reason text NOT NULL CHECK(length(btrim(reason))>0),
  reference text NOT NULL CHECK(length(btrim(reference))>0), proof_media_id uuid NOT NULL REFERENCES media_objects(id),
  actor_id uuid NOT NULL REFERENCES users(id), occurred_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
-- Cash held on behalf of the store is a separate ledger from courier earnings.
CREATE TABLE cash_collections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), order_id uuid NOT NULL REFERENCES orders(id),
  assignment_id uuid NOT NULL, courier_id uuid NOT NULL REFERENCES courier_profiles(user_id),
  entry_type text NOT NULL DEFAULT 'collection' CHECK(entry_type IN ('collection','adjustment')),
  amount_yer bigint NOT NULL CHECK(amount_yer<>0), related_collection_id uuid REFERENCES cash_collections(id),
  reason text, reference text NOT NULL CHECK(length(btrim(reference))>0),
  recorded_by uuid NOT NULL REFERENCES users(id), collected_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(assignment_id,order_id,courier_id) REFERENCES order_assignments(id,order_id,courier_id),
  CHECK((entry_type='collection' AND amount_yer>0 AND related_collection_id IS NULL)
     OR (entry_type='adjustment' AND related_collection_id IS NOT NULL AND reason IS NOT NULL AND length(btrim(reason))>0))
);
CREATE UNIQUE INDEX one_initial_cash_collection ON cash_collections(order_id) WHERE entry_type='collection';
CREATE TABLE cash_remittances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), courier_id uuid NOT NULL REFERENCES courier_profiles(user_id),
  received_by uuid NOT NULL REFERENCES users(id), total_yer bigint NOT NULL CHECK(total_yer>0),
  reference text NOT NULL CHECK(length(btrim(reference))>0), created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(id,courier_id,total_yer)
);
CREATE TABLE cash_remittance_reversals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), remittance_id uuid NOT NULL UNIQUE,
  courier_id uuid NOT NULL REFERENCES courier_profiles(user_id), amount_yer bigint NOT NULL CHECK(amount_yer>0),
  actor_id uuid NOT NULL REFERENCES users(id), reason text NOT NULL CHECK(length(btrim(reason))>0),
  reference text NOT NULL CHECK(length(btrim(reference))>0), proof_media_id uuid NOT NULL REFERENCES media_objects(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(remittance_id,courier_id,amount_yer) REFERENCES cash_remittances(id,courier_id,total_yer)
);
CREATE TABLE cash_remittance_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), remittance_id uuid NOT NULL REFERENCES cash_remittances(id),
  collection_id uuid UNIQUE REFERENCES cash_collections(id),
  reversal_credit_id uuid UNIQUE REFERENCES cash_remittance_reversals(id),
  CHECK(num_nonnulls(collection_id,reversal_credit_id)=1)
);

-- Exactly one explicit catalog branch pointer, with same-governorate integrity.
-- Multiple branches remain representable; no automatic selection/aggregation policy is implied.
ALTER TABLE governorates ADD COLUMN catalog_branch_id uuid;
ALTER TABLE governorates ADD CONSTRAINT catalog_branch_in_governorate
  FOREIGN KEY(catalog_branch_id,id) REFERENCES branches(id,governorate_id);

ALTER TABLE orders ADD CONSTRAINT current_quote_belongs_to_order
 FOREIGN KEY(current_quote_id,id) REFERENCES order_quotes(id,order_id) DEFERRABLE INITIALLY DEFERRED;
CREATE UNIQUE INDEX staff_global_unique ON staff_grants(user_id,role_id) WHERE global_scope;
CREATE UNIQUE INDEX staff_branch_unique ON staff_grants(user_id,role_id,branch_id) WHERE NOT global_scope;
CREATE UNIQUE INDEX one_default_address ON addresses(user_id) WHERE is_default AND archived_at IS NULL;
CREATE UNIQUE INDEX active_product_unit ON product_units(product_id,unit_kind) WHERE active;
CREATE UNIQUE INDEX active_reservation ON stock_reservations(order_id,branch_id,product_id) WHERE state='active';
CREATE UNIQUE INDEX one_active_assignment ON order_assignments(order_id) WHERE ended_at IS NULL;
CREATE UNIQUE INDEX one_delivery_earning ON courier_earnings(order_id) WHERE entry_type='delivery';
CREATE UNIQUE INDEX one_order_sale ON stock_movements(order_id,branch_id,product_id) WHERE reason='sale';
CREATE INDEX branch_governorate ON branches(governorate_id) WHERE active;
CREATE INDEX product_category ON products(category_id,id) WHERE active;
CREATE INDEX product_attr_filter ON product_attribute_values(attribute_id,value_id,product_id);
CREATE INDEX orders_branch_status_time ON orders(branch_id,status,created_at DESC);
CREATE INDEX orders_customer_time ON orders(customer_id,created_at DESC);
CREATE INDEX reservation_expiry ON stock_reservations(expires_at) WHERE state='active' AND hold_kind='timed';
CREATE INDEX protected_reservation_review ON stock_reservations(created_at) WHERE state='active' AND hold_kind='receipt_review';
CREATE INDEX stock_history ON stock_movements(branch_id,product_id,created_at DESC);
CREATE INDEX payments_order ON payments(order_id,status);
CREATE INDEX assignments_courier ON order_assignments(courier_id,assigned_at DESC) WHERE ended_at IS NULL;
CREATE INDEX earnings_courier_time ON courier_earnings(courier_id,earned_at);
CREATE INDEX flags_customer ON customer_flags(customer_id,created_at DESC);
CREATE INDEX inbox_user_time ON notification_inbox(user_id,app,created_at DESC);
CREATE INDEX outbox_due ON outbox_events(state,available_at);
CREATE INDEX otp_phone_expiry ON otp_challenges(phone_e164,purpose,expires_at);
CREATE INDEX audit_actor_time ON audit_logs(actor_id,created_at DESC);

CREATE FUNCTION reject_ledger_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 RAISE EXCEPTION 'Append-only ledger: use an explicit compensating entry';
END;
$$;
CREATE TRIGGER immutable_stock_movements BEFORE UPDATE OR DELETE ON stock_movements FOR EACH ROW EXECUTE FUNCTION reject_ledger_mutation();
CREATE TRIGGER immutable_courier_earnings BEFORE UPDATE OR DELETE ON courier_earnings FOR EACH ROW EXECUTE FUNCTION reject_ledger_mutation();
CREATE TRIGGER immutable_settlements BEFORE UPDATE OR DELETE ON courier_settlements FOR EACH ROW EXECUTE FUNCTION reject_ledger_mutation();
CREATE TRIGGER immutable_settlement_items BEFORE UPDATE OR DELETE ON settlement_items FOR EACH ROW EXECUTE FUNCTION reject_ledger_mutation();
CREATE TRIGGER immutable_audit BEFORE UPDATE OR DELETE ON audit_logs FOR EACH ROW EXECUTE FUNCTION reject_ledger_mutation();
INSERT INTO customer_maintenance(singleton) VALUES (true);
INSERT INTO attributes(code,name_ar) VALUES ('brand','العلامة التجارية');
-- Guards strengthen the reference design; authorization, reservation/counter
-- transactions, retries, file processing and provider integration remain services.
CREATE FUNCTION guard_unit_history() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' OR ROW(OLD.product_id,OLD.unit_kind,OLD.pieces_per_unit)
       IS DISTINCT FROM ROW(NEW.product_id,NEW.unit_kind,NEW.pieces_per_unit) THEN
    IF EXISTS(SELECT 1 FROM quote_items WHERE unit_id=OLD.id)
       OR EXISTS(SELECT 1 FROM order_request_items WHERE unit_id=OLD.id) THEN
      RAISE EXCEPTION 'Used unit conversion is immutable; archive and create a new unit';
    END IF;
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER used_unit_history BEFORE UPDATE OR DELETE ON product_units FOR EACH ROW EXECUTE FUNCTION guard_unit_history();

CREATE FUNCTION guard_quote_items() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE qid uuid; parent_status text; conversion integer;
BEGIN
  qid:=CASE WHEN TG_OP='DELETE' THEN OLD.quote_id ELSE NEW.quote_id END;
  IF TG_OP='UPDATE' AND NEW.quote_id<>OLD.quote_id THEN RAISE EXCEPTION 'Cannot move quote lines'; END IF;
  SELECT status INTO parent_status FROM order_quotes WHERE id=qid FOR UPDATE;
  IF parent_status IS DISTINCT FROM 'draft' THEN RAISE EXCEPTION 'Only draft quote lines can change'; END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  SELECT pieces_per_unit INTO conversion FROM product_units WHERE id=NEW.unit_id FOR SHARE;
  IF conversion IS NOT NULL AND conversion<>NEW.pieces_per_unit THEN RAISE EXCEPTION 'Unit snapshot conversion mismatch'; END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER draft_quote_lines BEFORE INSERT OR UPDATE OR DELETE ON quote_items FOR EACH ROW EXECUTE FUNCTION guard_quote_items();

CREATE FUNCTION guard_quote_history() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE o orders; lines_total bigint;
BEGIN
  IF TG_OP='INSERT' THEN
    IF NEW.status<>'draft' OR NEW.accepted_at IS NOT NULL THEN RAISE EXCEPTION 'Build a draft before sending'; END IF;
    RETURN NEW;
  END IF;
  IF TG_OP='DELETE' THEN
    IF OLD.status<>'draft' THEN RAISE EXCEPTION 'Sent quote history cannot be deleted'; END IF;
    RETURN OLD;
  END IF;
  IF OLD.status<>'draft' AND (to_jsonb(NEW)-ARRAY['status','accepted_by','accepted_at','billed_km'])
       IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['status','accepted_by','accepted_at','billed_km']) THEN
    RAISE EXCEPTION 'Sent quote financial facts are immutable';
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status AND EXISTS(
    SELECT 1 FROM orders WHERE current_quote_id=OLD.id AND status IN ('confirmed','on_the_way','delivered')
  ) THEN RAISE EXCEPTION 'Confirmed order retains its accepted quote state'; END IF;
  IF OLD.accepted_at IS NOT NULL AND ROW(OLD.accepted_by,OLD.accepted_at)
       IS DISTINCT FROM ROW(NEW.accepted_by,NEW.accepted_at) THEN RAISE EXCEPTION 'Preserve historical acceptance'; END IF;
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF NOT ((OLD.status='draft' AND NEW.status='sent')
         OR (OLD.status='sent' AND NEW.status IN ('accepted','declined','superseded','expired'))
         OR (OLD.status='accepted' AND NEW.status IN ('superseded','expired'))) THEN
      RAISE EXCEPTION 'Invalid quote transition';
    END IF;
    IF NEW.status IN ('superseded','expired') AND EXISTS(
      SELECT 1 FROM stock_reservations WHERE quote_id=OLD.id AND state='active' AND hold_kind='receipt_review'
    ) THEN RAISE EXCEPTION 'Receipt review protects quote and stock until explicit reviewed action'; END IF;
  END IF;
  IF OLD.status='draft' AND NEW.status='sent' THEN
    IF EXISTS(SELECT 1 FROM stock_reservations WHERE order_id=NEW.order_id AND quote_id<>NEW.id AND state='active' AND hold_kind='receipt_review') THEN
      RAISE EXCEPTION 'Review protected transfer before issuing another final quote';
    END IF;
    SELECT coalesce(sum(line_total_yer),0) INTO lines_total FROM quote_items WHERE quote_id=NEW.id;
    IF NOT EXISTS(SELECT 1 FROM quote_items WHERE quote_id=NEW.id) OR lines_total<>NEW.subtotal_yer THEN
      RAISE EXCEPTION 'Quote lines must match subtotal before sending';
    END IF;
  END IF;
  IF NEW.accepted_at IS NOT NULL AND OLD.accepted_at IS NULL AND NEW.status<>'accepted' THEN
    RAISE EXCEPTION 'Acceptance must be recorded by the acceptance transition';
  END IF;
  IF NEW.status='accepted' AND OLD.status<>'accepted' THEN
    SELECT * INTO o FROM orders WHERE id=NEW.order_id FOR UPDATE;
    IF o.current_quote_id IS DISTINCT FROM NEW.id OR o.customer_id IS DISTINCT FROM NEW.accepted_by
       OR o.branch_id IS DISTINCT FROM NEW.branch_id OR o.status<>'pending_review'
       OR NEW.expires_at<=now() THEN RAISE EXCEPTION 'Accept only own latest unexpired quote and selected branch'; END IF;
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER quote_history BEFORE INSERT OR UPDATE OR DELETE ON order_quotes FOR EACH ROW EXECUTE FUNCTION guard_quote_history();

CREATE FUNCTION guard_instruction_issue() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE o orders; q order_quotes; m payment_methods;
BEGIN
  SELECT * INTO o FROM orders WHERE id=NEW.order_id FOR UPDATE;
  SELECT * INTO q FROM order_quotes WHERE id=NEW.quote_id;
  SELECT * INTO m FROM payment_methods WHERE id=NEW.method_id;
  IF o.payment_kind IS DISTINCT FROM 'transfer' OR o.status<>'pending_review'
     OR o.current_quote_id IS DISTINCT FROM NEW.quote_id OR q.status<>'accepted'
     OR NOT m.active OR (m.branch_id IS NOT NULL AND m.branch_id<>q.branch_id) THEN
    RAISE EXCEPTION 'Transfer instructions require accepted current quote and eligible method';
  END IF;
  IF NOT (NEW.method_snapshot @> jsonb_build_object('name_ar',m.name_ar,'beneficiary',m.beneficiary,'destination_number',m.destination_number)) THEN
    RAISE EXCEPTION 'Freeze the actual destination before displaying it';
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER issue_payment_instructions BEFORE INSERT ON payment_instructions FOR EACH ROW EXECUTE FUNCTION guard_instruction_issue();

CREATE FUNCTION guard_payment_update() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE r payment_receipt_reviews; latest_attempt uuid;
BEGIN
  IF TG_OP='INSERT' THEN
    IF NEW.status<>'pending' THEN RAISE EXCEPTION 'New transfers start pending review'; END IF;
    RETURN NEW;
  END IF;
  IF OLD.status='approved' THEN RAISE EXCEPTION 'Approved money cannot be rewritten'; END IF;
  IF (to_jsonb(OLD)-ARRAY['status','reviewer_id','reviewed_at','review_note','approved_amount_yer'])
       IS DISTINCT FROM (to_jsonb(NEW)-ARRAY['status','reviewer_id','reviewed_at','review_note','approved_amount_yer']) THEN
    RAISE EXCEPTION 'Transfer identity and reported amount are immutable';
  END IF;
  IF NEW.status IN ('approved','rejected') THEN
    SELECT id INTO latest_attempt FROM payment_receipt_attempts WHERE payment_id=NEW.id ORDER BY attempt_number DESC LIMIT 1;
    SELECT * INTO r FROM payment_receipt_reviews WHERE attempt_id=latest_attempt;
    IF r.id IS NULL OR r.reviewer_id IS DISTINCT FROM NEW.reviewer_id
       OR (NEW.status='approved' AND (r.outcome<>'transfer_verified' OR NEW.approved_amount_yer IS DISTINCT FROM r.verified_amount_yer))
       OR (NEW.status='rejected' AND r.outcome='transfer_verified') THEN
      RAISE EXCEPTION 'Payment status must follow latest documented receipt review';
    END IF;
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER payment_review_state BEFORE INSERT OR UPDATE ON payments FOR EACH ROW EXECUTE FUNCTION guard_payment_update();

CREATE FUNCTION guard_receipt_attempt() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE p payments; owner_id uuid; m media_objects; last_attempt payment_receipt_attempts;
BEGIN
  SELECT * INTO p FROM payments WHERE id=NEW.payment_id FOR UPDATE;
  IF p.status='approved' THEN RAISE EXCEPTION 'Approved transfer cannot accept another receipt attempt'; END IF;
  SELECT customer_id INTO owner_id FROM orders WHERE id=p.order_id;
  SELECT * INTO m FROM media_objects WHERE id=NEW.media_id;
  IF NEW.submitted_by IS DISTINCT FROM owner_id OR m.owner_id IS DISTINCT FROM owner_id
     OR m.visibility IS DISTINCT FROM 'private' OR m.purpose IS DISTINCT FROM 'receipt'
     OR m.status IS DISTINCT FROM 'verified' THEN RAISE EXCEPTION 'Verified private receipt must belong to order owner'; END IF;
  SELECT * INTO last_attempt FROM payment_receipt_attempts WHERE payment_id=p.id ORDER BY attempt_number DESC LIMIT 1;
  IF NEW.attempt_number<>coalesce(last_attempt.attempt_number,0)+1 THEN RAISE EXCEPTION 'Sequential receipt attempts required'; END IF;
  IF last_attempt.id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM payment_receipt_reviews WHERE attempt_id=last_attempt.id) THEN
    RAISE EXCEPTION 'Current receipt is still awaiting review';
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER receipt_attempt_guard BEFORE INSERT ON payment_receipt_attempts FOR EACH ROW EXECUTE FUNCTION guard_receipt_attempt();

CREATE FUNCTION protect_reported_transfer() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE p payments;
BEGIN
  SELECT * INTO p FROM payments WHERE id=NEW.payment_id;
  UPDATE stock_reservations SET hold_kind='receipt_review',expires_at=NULL,protected_at=now()
    WHERE quote_id=p.quote_id AND state='active' AND hold_kind='timed' AND expires_at>now();
  IF p.status='rejected' THEN
    UPDATE payments SET status='pending',reviewer_id=NULL,reviewed_at=NULL,review_note=NULL WHERE id=p.id;
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER receipt_protects_stock AFTER INSERT ON payment_receipt_attempts FOR EACH ROW EXECUTE FUNCTION protect_reported_transfer();

CREATE FUNCTION guard_receipt_review() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE latest uuid; existing_status text;
BEGIN
  SELECT status INTO existing_status FROM payments WHERE id=NEW.payment_id FOR UPDATE;
  SELECT id INTO latest FROM payment_receipt_attempts WHERE payment_id=NEW.payment_id ORDER BY attempt_number DESC LIMIT 1;
  IF NEW.attempt_id IS DISTINCT FROM latest OR existing_status='approved'
     OR NOT EXISTS(SELECT 1 FROM users WHERE id=NEW.reviewer_id AND kind='staff' AND status='active') THEN
    RAISE EXCEPTION 'Review the latest attempt as active staff only';
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER latest_receipt_review BEFORE INSERT ON payment_receipt_reviews FOR EACH ROW EXECUTE FUNCTION guard_receipt_review();
CREATE FUNCTION apply_receipt_review() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  UPDATE payments SET status=CASE WHEN NEW.outcome='transfer_verified' THEN 'approved' ELSE 'rejected' END,
    approved_amount_yer=NEW.verified_amount_yer,reviewer_id=NEW.reviewer_id,reviewed_at=NEW.created_at,review_note=NEW.note
    WHERE id=NEW.payment_id;
  -- No stock expiry/release on rejection: a documented admin action follows review.
  RETURN NEW;
END; $$;
CREATE TRIGGER receipt_review_summary AFTER INSERT ON payment_receipt_reviews FOR EACH ROW EXECUTE FUNCTION apply_receipt_review();

CREATE FUNCTION guard_protected_reservation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF ROW(NEW.order_id,NEW.quote_id,NEW.branch_id,NEW.product_id,NEW.pieces)
       IS DISTINCT FROM ROW(OLD.order_id,OLD.quote_id,OLD.branch_id,OLD.product_id,OLD.pieces) THEN
    RAISE EXCEPTION 'Reservation identity is historical';
  END IF;
  IF OLD.hold_kind='receipt_review' AND OLD.state='active' THEN
    IF NEW.hold_kind<>'receipt_review' OR NEW.state='expired' THEN RAISE EXCEPTION 'No automatic expiry of a reported transfer'; END IF;
    IF NEW.state<>'active' AND EXISTS(
      SELECT 1 FROM payments p JOIN payment_receipt_attempts a ON a.payment_id=p.id
      WHERE p.quote_id=OLD.quote_id AND NOT EXISTS(SELECT 1 FROM payment_receipt_reviews r WHERE r.attempt_id=a.id)
    ) THEN RAISE EXCEPTION 'Review receipt before releasing or consuming protected stock'; END IF;
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER protected_stock_review BEFORE UPDATE ON stock_reservations FOR EACH ROW EXECUTE FUNCTION guard_protected_reservation();

CREATE FUNCTION guard_order_state() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE q order_quotes; paid bigint; collected bigint; missing_stock boolean;
BEGIN
  IF TG_OP='INSERT' THEN
    IF NEW.status<>'pending_review' THEN RAISE EXCEPTION 'Orders start in review'; END IF;
    RETURN NEW;
  END IF;
  IF OLD.status IN ('confirmed','on_the_way','delivered') AND
    ROW(OLD.customer_id,OLD.governorate_id,OLD.catalog_branch_id,OLD.branch_id,OLD.branch_selected_by,OLD.branch_selected_at,OLD.current_quote_id,OLD.kind,OLD.payment_kind,OLD.confirmed_at)
    IS DISTINCT FROM ROW(NEW.customer_id,NEW.governorate_id,NEW.catalog_branch_id,NEW.branch_id,NEW.branch_selected_by,NEW.branch_selected_at,NEW.current_quote_id,NEW.kind,NEW.payment_kind,NEW.confirmed_at) THEN
    RAISE EXCEPTION 'Confirmed order financial facts and execution branch are frozen';
  END IF;
  IF OLD.payment_kind IS DISTINCT FROM NEW.payment_kind AND EXISTS(SELECT 1 FROM payments WHERE order_id=OLD.id) THEN
    RAISE EXCEPTION 'Resolve reported transfers before changing payment kind';
  END IF;
  IF ROW(OLD.branch_id,OLD.current_quote_id) IS DISTINCT FROM ROW(NEW.branch_id,NEW.current_quote_id)
     AND EXISTS(SELECT 1 FROM stock_reservations WHERE order_id=OLD.id AND state='active' AND hold_kind='receipt_review') THEN
    RAISE EXCEPTION 'Protected transfer requires reviewed stock action before changing execution/quote';
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF NOT ((OLD.status='pending_review' AND NEW.status IN ('confirmed','rejected','cancelled'))
         OR (OLD.status='confirmed' AND NEW.status='on_the_way')
         OR (OLD.status='on_the_way' AND NEW.status='delivered')) THEN RAISE EXCEPTION 'Invalid order transition'; END IF;
    IF NEW.status='confirmed' THEN
      SELECT * INTO q FROM order_quotes WHERE id=NEW.current_quote_id;
      IF q.id IS NULL OR q.status<>'accepted' OR q.accepted_by IS DISTINCT FROM NEW.customer_id
         OR q.branch_id IS DISTINCT FROM NEW.branch_id OR NEW.payment_kind IS NULL OR NEW.confirmed_at IS NULL THEN
        RAISE EXCEPTION 'Confirmation requires accepted current quote and manager-selected branch';
      END IF;
      IF q.expires_at<=now()
         AND NOT EXISTS(SELECT 1 FROM stock_reservations WHERE quote_id=q.id AND state='active' AND hold_kind='receipt_review')
         AND NOT EXISTS(SELECT 1 FROM quote_revalidations WHERE quote_id=q.id AND valid_until>now()) THEN
        RAISE EXCEPTION 'Expired quote needs unchanged-price revalidation or a new accepted quote';
      END IF;
      SELECT EXISTS(
        SELECT 1 FROM (SELECT product_id,sum(quantity::bigint*pieces_per_unit) AS pieces FROM quote_items WHERE quote_id=q.id GROUP BY product_id) needed
        LEFT JOIN stock_reservations r ON r.quote_id=q.id AND r.product_id=needed.product_id AND r.state='active'
        LEFT JOIN stock_levels st ON st.branch_id=q.branch_id AND st.product_id=needed.product_id
        WHERE r.id IS NULL OR r.pieces<>needed.pieces OR (r.hold_kind='timed' AND r.expires_at<=now())
          OR st.product_id IS NULL OR NOT st.sellable OR st.reserved<needed.pieces OR st.on_hand<needed.pieces
      ) INTO missing_stock;
      IF missing_stock THEN RAISE EXCEPTION 'Confirmation needs valid matching stock reservations'; END IF;
      IF EXISTS(SELECT 1 FROM financial_exceptions WHERE order_id=NEW.id AND status='open') THEN RAISE EXCEPTION 'Resolve financial exception before confirmation'; END IF;
      IF NEW.payment_kind='transfer' THEN
        SELECT coalesce(sum(approved_amount_yer),0) INTO paid FROM payments WHERE order_id=NEW.id AND status='approved';
        SELECT paid+coalesce(sum(CASE WHEN r.direction='refund_to_customer' THEN -r.amount_yer WHEN r.direction='received_from_customer' THEN r.amount_yer ELSE 0 END),0)
          INTO paid FROM financial_exception_resolutions r JOIN financial_exceptions e ON e.id=r.exception_id WHERE e.order_id=NEW.id;
        IF paid<>q.total_yer THEN RAISE EXCEPTION 'Transfer confirmation requires exact verified net payment'; END IF;
      END IF;
      -- COD deliberately has no prepaid-payment/receipt gate and creates no cash record.
    ELSIF NEW.status IN ('rejected','cancelled') THEN
      IF EXISTS(SELECT 1 FROM financial_exceptions WHERE order_id=NEW.id AND status='open') THEN RAISE EXCEPTION 'Resolve financial liability before closure'; END IF;
      IF EXISTS(SELECT 1 FROM payment_receipt_attempts a JOIN payments p ON p.id=a.payment_id WHERE p.order_id=NEW.id)
         AND NOT EXISTS(SELECT 1 FROM order_cancellation_requests WHERE order_id=NEW.id AND status='approved')
         AND NEW.status='cancelled' THEN RAISE EXCEPTION 'Receipt requires administrative cancellation review'; END IF;
      SELECT coalesce(sum(approved_amount_yer),0) INTO paid FROM payments WHERE order_id=NEW.id AND status='approved';
      SELECT paid+coalesce(sum(CASE WHEN r.direction='refund_to_customer' THEN -r.amount_yer WHEN r.direction='received_from_customer' THEN r.amount_yer ELSE 0 END),0)
        INTO paid FROM financial_exception_resolutions r JOIN financial_exceptions e ON e.id=r.exception_id WHERE e.order_id=NEW.id;
      IF paid<>0 THEN RAISE EXCEPTION 'Resolve net money before closing order'; END IF;
    ELSIF NEW.status='delivered' AND NEW.payment_kind='cash_on_delivery' THEN
      SELECT * INTO q FROM order_quotes WHERE id=NEW.current_quote_id;
      SELECT coalesce(sum(amount_yer),0) INTO collected FROM cash_collections WHERE order_id=NEW.id;
      IF collected<>q.total_yer AND NOT EXISTS(SELECT 1 FROM financial_exceptions WHERE order_id=NEW.id AND kind IN ('cash_shortfall','cash_uncollected','overpayment')) THEN
        RAISE EXCEPTION 'Record cash or an explicit cash exception before delivery; delivery is not collection';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER order_state_guard BEFORE INSERT OR UPDATE ON orders FOR EACH ROW EXECUTE FUNCTION guard_order_state();

CREATE FUNCTION guard_dispatch() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE o orders; q order_quotes;
BEGIN
  IF TG_OP='UPDATE' THEN
    IF (to_jsonb(OLD)-ARRAY['ended_at','customer_delivery_yer']) IS DISTINCT FROM (to_jsonb(NEW)-ARRAY['ended_at','customer_delivery_yer']) OR OLD.ended_at IS NOT NULL THEN
      RAISE EXCEPTION 'Assignment facts are immutable; end and reassign';
    END IF;
    RETURN NEW;
  END IF;
  SELECT * INTO o FROM orders WHERE id=NEW.order_id;
  SELECT * INTO q FROM order_quotes WHERE id=o.current_quote_id;
  IF o.status IS DISTINCT FROM 'confirmed' OR NEW.delivery_fee_before_discount_yer IS DISTINCT FROM q.delivery_yer
     OR NEW.delivery_discount_yer IS DISTINCT FROM q.delivery_discount_yer
     OR NOT EXISTS(SELECT 1 FROM courier_profiles WHERE user_id=NEW.courier_id AND active AND commission_bps=NEW.commission_bps)
     OR NOT EXISTS(SELECT 1 FROM courier_branches WHERE courier_id=NEW.courier_id AND branch_id=o.branch_id) THEN
    RAISE EXCEPTION 'Dispatch requires confirmed order, assigned branch and configured pre-discount commission';
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER dispatch_facts BEFORE INSERT OR UPDATE ON order_assignments FOR EACH ROW EXECUTE FUNCTION guard_dispatch();

CREATE FUNCTION guard_earning_identity() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE a order_assignments; o orders;
BEGIN
  IF NEW.entry_type='delivery' THEN
    SELECT * INTO a FROM order_assignments WHERE id=NEW.assignment_id;
    SELECT * INTO o FROM orders WHERE id=NEW.order_id;
    IF a.order_id IS DISTINCT FROM NEW.order_id OR a.courier_id IS DISTINCT FROM NEW.courier_id
       OR a.commission_yer IS DISTINCT FROM NEW.amount_yer OR o.status IS DISTINCT FROM 'delivered' THEN
      RAISE EXCEPTION 'Earn only delivered-order commission for the matching courier and assignment';
    END IF;
  ELSIF NEW.related_earning_id IS NOT NULL AND NOT EXISTS(
    SELECT 1 FROM courier_earnings WHERE id=NEW.related_earning_id AND courier_id=NEW.courier_id
  ) THEN RAISE EXCEPTION 'Adjustment courier mismatch'; END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER earning_identity BEFORE INSERT ON courier_earnings FOR EACH ROW EXECUTE FUNCTION guard_earning_identity();

CREATE FUNCTION guard_cash_collection() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE o orders;
BEGIN
  SELECT * INTO o FROM orders WHERE id=NEW.order_id;
  IF o.payment_kind IS DISTINCT FROM 'cash_on_delivery' OR o.status NOT IN ('confirmed','on_the_way','delivered') THEN
    RAISE EXCEPTION 'Cash ledger is for confirmed COD orders only';
  END IF;
  IF NEW.entry_type='adjustment' AND NOT EXISTS(SELECT 1 FROM cash_collections WHERE id=NEW.related_collection_id AND order_id=NEW.order_id AND courier_id=NEW.courier_id) THEN
    RAISE EXCEPTION 'Cash adjustment must reference same order and courier';
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER cash_collection_guard BEFORE INSERT ON cash_collections FOR EACH ROW EXECUTE FUNCTION guard_cash_collection();

CREATE FUNCTION guard_allocation_owner() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE owner uuid; source_owner uuid; source_parent uuid;
BEGIN
  IF TG_TABLE_NAME='settlement_items' THEN
    SELECT courier_id INTO owner FROM courier_settlements WHERE id=NEW.settlement_id;
    IF NEW.earning_id IS NOT NULL THEN SELECT courier_id INTO source_owner FROM courier_earnings WHERE id=NEW.earning_id;
    ELSE SELECT courier_id,settlement_id INTO source_owner,source_parent FROM courier_settlement_reversals WHERE id=NEW.reversal_credit_id; END IF;
    IF source_parent=NEW.settlement_id THEN RAISE EXCEPTION 'Reversal credit cannot fund its own original payout'; END IF;
  ELSE
    SELECT courier_id INTO owner FROM cash_remittances WHERE id=NEW.remittance_id;
    IF NEW.collection_id IS NOT NULL THEN SELECT courier_id INTO source_owner FROM cash_collections WHERE id=NEW.collection_id;
    ELSE SELECT courier_id,remittance_id INTO source_owner,source_parent FROM cash_remittance_reversals WHERE id=NEW.reversal_credit_id; END IF;
    IF source_parent=NEW.remittance_id THEN RAISE EXCEPTION 'Reversal credit cannot fund its own original remittance'; END IF;
  END IF;
  IF owner IS DISTINCT FROM source_owner THEN RAISE EXCEPTION 'Allocation must belong to the same courier'; END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER settlement_allocation_owner BEFORE INSERT ON settlement_items FOR EACH ROW EXECUTE FUNCTION guard_allocation_owner();
CREATE TRIGGER remittance_allocation_owner BEFORE INSERT ON cash_remittance_items FOR EACH ROW EXECUTE FUNCTION guard_allocation_owner();

CREATE FUNCTION validate_payout_total() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE head uuid; expected bigint; actual bigint;
BEGIN
  IF TG_TABLE_NAME IN ('courier_settlements','settlement_items') THEN
    IF TG_TABLE_NAME='courier_settlements' THEN head:=NEW.id; ELSE head:=NEW.settlement_id; END IF;
    SELECT total_yer INTO expected FROM courier_settlements WHERE id=head;
    SELECT coalesce(sum(coalesce(e.amount_yer,r.amount_yer)),0) INTO actual FROM settlement_items i
      LEFT JOIN courier_earnings e ON e.id=i.earning_id LEFT JOIN courier_settlement_reversals r ON r.id=i.reversal_credit_id WHERE i.settlement_id=head;
  ELSE
    IF TG_TABLE_NAME='cash_remittances' THEN head:=NEW.id; ELSE head:=NEW.remittance_id; END IF;
    SELECT total_yer INTO expected FROM cash_remittances WHERE id=head;
    SELECT coalesce(sum(coalesce(c.amount_yer,r.amount_yer)),0) INTO actual FROM cash_remittance_items i
      LEFT JOIN cash_collections c ON c.id=i.collection_id LEFT JOIN cash_remittance_reversals r ON r.id=i.reversal_credit_id WHERE i.remittance_id=head;
  END IF;
  IF actual IS DISTINCT FROM expected THEN RAISE EXCEPTION 'Payout/remittance total must equal explicit allocations'; END IF;
  RETURN NEW;
END; $$;
CREATE CONSTRAINT TRIGGER settlement_total AFTER INSERT ON courier_settlements DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION validate_payout_total();
CREATE CONSTRAINT TRIGGER settlement_items_total AFTER INSERT ON settlement_items DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION validate_payout_total();
CREATE CONSTRAINT TRIGGER remittance_total AFTER INSERT ON cash_remittances DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION validate_payout_total();
CREATE CONSTRAINT TRIGGER remittance_items_total AFTER INSERT ON cash_remittance_items DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION validate_payout_total();

CREATE FUNCTION guard_private_redaction() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.redacted_at IS NOT NULL OR NEW.redacted_at IS NULL OR NEW.id<>OLD.id OR NEW.order_id<>OLD.order_id OR NEW.revision<>OLD.revision
     OR NEW.address_snapshot<>'{}'::jsonb OR NEW.contact_snapshot<>'{}'::jsonb
     OR EXISTS(SELECT 1 FROM orders WHERE id=OLD.order_id AND status NOT IN ('delivered','cancelled','rejected'))
     OR EXISTS(SELECT 1 FROM financial_exceptions WHERE order_id=OLD.order_id AND status='open') THEN
    RAISE EXCEPTION 'Private snapshots permit only documented one-way redaction after operational obligations';
  END IF;
  INSERT INTO audit_logs(actor_id,action,entity_type,entity_id,request_id)
    VALUES(NEW.redacted_by,'privacy.order_details_redacted','order_private_details',OLD.id,gen_random_uuid()::text);
  RETURN NEW;
END; $$;
CREATE TRIGGER private_snapshot_redaction BEFORE UPDATE ON order_private_details FOR EACH ROW EXECUTE FUNCTION guard_private_redaction();

CREATE FUNCTION guard_coverage_activation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_TABLE_NAME='branches' THEN
    IF NEW.delivery_enabled AND NOT EXISTS(SELECT 1 FROM delivery_rules WHERE branch_id=NEW.id AND max_distance_m IS NOT NULL) THEN
      RAISE EXCEPTION 'Configure coverage and road-distance limit before enabling delivery';
    END IF;
  ELSE
    IF TG_OP='DELETE' THEN
      IF EXISTS(SELECT 1 FROM branches WHERE id=OLD.branch_id AND delivery_enabled) THEN
        RAISE EXCEPTION 'Disable delivery before deleting its rule';
      END IF;
      RETURN OLD;
    END IF;
    IF NEW.max_distance_m IS NULL AND EXISTS(SELECT 1 FROM branches WHERE id=NEW.branch_id AND delivery_enabled) THEN
      RAISE EXCEPTION 'Enabled delivery needs a configured road-distance limit';
    END IF;
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER branch_delivery_configuration BEFORE INSERT OR UPDATE ON branches FOR EACH ROW EXECUTE FUNCTION guard_coverage_activation();
CREATE TRIGGER delivery_limit_configuration BEFORE INSERT OR UPDATE OR DELETE ON delivery_rules FOR EACH ROW EXECUTE FUNCTION guard_coverage_activation();

CREATE FUNCTION guard_exception_closure() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status='resolved' AND OLD.status<>'resolved' AND NOT EXISTS(
    SELECT 1 FROM financial_exception_resolutions WHERE exception_id=NEW.id
  ) THEN RAISE EXCEPTION 'Document financial resolution and evidence before closing'; END IF;
  IF OLD.status='resolved' OR (to_jsonb(OLD)-'status') IS DISTINCT FROM (to_jsonb(NEW)-'status') THEN
    RAISE EXCEPTION 'Preserve original financial exception facts';
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER financial_exception_closure BEFORE UPDATE ON financial_exceptions FOR EACH ROW EXECUTE FUNCTION guard_exception_closure();
CREATE TRIGGER preserve_financial_exceptions BEFORE DELETE ON financial_exceptions FOR EACH ROW EXECUTE FUNCTION reject_ledger_mutation();

CREATE FUNCTION guard_private_evidence() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS(SELECT 1 FROM media_objects WHERE id=NEW.proof_media_id AND visibility='private' AND status='verified') THEN
    RAISE EXCEPTION 'Financial resolution/reversal needs verified private evidence';
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER resolution_private_evidence BEFORE INSERT ON financial_exception_resolutions FOR EACH ROW EXECUTE FUNCTION guard_private_evidence();
CREATE TRIGGER settlement_reversal_private_evidence BEFORE INSERT ON courier_settlement_reversals FOR EACH ROW EXECUTE FUNCTION guard_private_evidence();
CREATE TRIGGER remittance_reversal_private_evidence BEFORE INSERT ON cash_remittance_reversals FOR EACH ROW EXECUTE FUNCTION guard_private_evidence();

DO $$
DECLARE name text;
BEGIN
  FOREACH name IN ARRAY ARRAY['payment_instructions','payment_receipt_attempts','payment_receipt_reviews',
    'quote_revalidations','financial_exception_resolutions','courier_settlement_reversals',
    'cash_collections','cash_remittances','cash_remittance_reversals','cash_remittance_items','order_events'] LOOP
    EXECUTE format('CREATE TRIGGER immutable_%I BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION reject_ledger_mutation()',name,name);
  END LOOP;
END; $$;
CREATE TRIGGER preserve_payments BEFORE DELETE ON payments FOR EACH ROW EXECUTE FUNCTION reject_ledger_mutation();
CREATE TRIGGER preserve_assignments BEFORE DELETE ON order_assignments FOR EACH ROW EXECUTE FUNCTION reject_ledger_mutation();
CREATE TRIGGER preserve_reservations BEFORE DELETE ON stock_reservations FOR EACH ROW EXECUTE FUNCTION reject_ledger_mutation();
CREATE TRIGGER preserve_private_snapshots BEFORE DELETE ON order_private_details FOR EACH ROW EXECUTE FUNCTION reject_ledger_mutation();

COMMIT;
