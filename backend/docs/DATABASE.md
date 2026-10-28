# تصميم قاعدة البيانات المرجعي

هذا تصميم مراجعة شامل للجداول والأنواع والمفاتيح والقيود، وليس خادمًا منفذًا. يتم تحويله إلى migrations بعد اعتماد المرحلة00. قاعدة PostgreSQL، UUID للهوية، timestamptz للتاريخ، وأعداد صحيحة bigint للريال اليمني. quantity للحبة/الكرتون أعداد صحيحة موجبة. نسبة العمولة بالنقاط الأساسية bps حيث10000=100%.

## خريطة العلاقات الأساسية
Governorate→Branches؛ Category→CategoryAttributes→Attributes→Values؛ Product→Units/Images/AttributeValues؛ Branch×Product→Stock؛ Customer→Orders→Quotes→QuoteItems؛ Order→Payments/Reservations/Assignments؛ Assignment→Earnings→SettlementItems→Settlements.

## حدود القيود
SQL يمنع السالب والمفاتيح غير المتطابقة وتكرار إسناد نشط وعمولة تسليم وصرف مستحق. يربط خاصية المنتج بقسمه وقيمتها، ويربط عرض السعر والإيصال والحجز بالطلب الصحيح. لا يكفي وحده لتطبيق سير العمل.
الخادم داخل معاملات ملزمة مسؤول عن: مجموع quote_items يساوي subtotal؛ كل required attribute مسجلة؛ هوية الفرع ومحافظته والعنوان متوافقة؛ reserved يساوي الحجوزات النشطة؛ رصيد دفتر المخزون يساوي stock_levels؛ آخر quote المقبول هو المستخدم؛ قبول صاحب الطلب؛ مجموع الدفعات المعتمدة يطابق الإجمالي؛ السماح بانتقال الحالة؛ مستحق الموصل يطابق الإسناد؛ بنود التسوية تخص الموصل نفسه ومجموعها يطابق الرأس؛ ملفات الإيصال خاصة ومتحقق منها؛ scope الموظف؛ عدم دورات شجرة الأقسام. اختبر هذه الشروط على الخادم ولا تدّع أن CHECK عابر للجداول ينفذها.

السجلات التاريخية لا تستخدم cascade delete. حذف الحساب يتطلب خدمة anonymization وحذف مرفقات وسياسة احتفاظ، لا DELETE users تلقائي. تفريغ snapshots الشخصية قد يتطلب مسار خصوصية منفصلًا محدودًا وسجلًا لا يتضمن البيانات المحذوفة. لا تضع رقم هاتف أو OTP في audit before/after.
الدفاتر المالية والمخزنية append-only. التصحيح بقيد تعويضي لا تعديل. earning adjustment قد يكون موجبًا أو سالبًا؛ الخدمة تمنع تسوية بإجمالي سالب وتراجع تخصيص القيود. استحقاق بقيمة0 لا يحتاج earning صفريًا، لكنه يظهر من طلبه في التقرير. عند عكس تسوية يُنشأ قيد تعويضي مرجعه الأصل وسببه، دون حذف allocation الأصل.

الخاصية مفردة القيمة للمنتج في النطاق الأولي. لإتاحة مقاس آخر تنشأ SKU أخرى، ولا يتشارك المقاسان stock_levels. القسم الرئيسي للمنتج واحد. القسم الأب يعرض أبناءه، لكن ربط الخصائص لا يورث ضمنيًا: يوثقه المدير صراحة.

## قاموس الحقول
الأنواع والـNOT NULL والـCHECK والـFK أدناه مأخوذة مباشرة من schema.sql. حقول JSON محدودة للـsnapshots والإعدادات، وليست بديلًا عن الجداول الأساسية. يُرفق JSON schema لكل snapshot عند تنفيذ API.

### `governorates` — المحافظات القابلة للإضافة والإيقاف

| الحقل/القيد | التعريف |
|---|---|
| `id` | `uuid PRIMARY KEY DEFAULT gen_random_uuid()` |
| `name_ar` | `text NOT NULL UNIQUE` |
| `active` | `boolean NOT NULL DEFAULT true` |
| `sort_order` | `integer NOT NULL DEFAULT 0` |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` |

### `branches` — الفروع ومواقعها ونطاق التغطية

| الحقل/القيد | التعريف |
|---|---|
| `id` | `uuid PRIMARY KEY DEFAULT gen_random_uuid()` |
| `governorate_id` | `uuid NOT NULL REFERENCES governorates(id)` |
| `name_ar` | `text NOT NULL` |
| `latitude` | `numeric(9,6) NOT NULL CHECK(latitude BETWEEN -90 AND 90)` |
| `longitude` | `numeric(9,6) NOT NULL CHECK(longitude BETWEEN -180 AND 180)` |
| `coverage_radius_m` | `integer CHECK(coverage_radius_m>0)` |
| `active` | `boolean NOT NULL DEFAULT true` |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` |
| `UNIQUE(governorate_id,name_ar)` | `` |

### `users` — الحسابات، العميل أو الموظف أو الموصل

| الحقل/القيد | التعريف |
|---|---|
| `id` | `uuid PRIMARY KEY DEFAULT gen_random_uuid()` |
| `phone_e164` | `text UNIQUE CHECK(phone_e164 ~ '^\+967[0-9]{9}$')` |
| `name_ar` | `text NOT NULL` |
| `password_hash` | `text` |
| `kind` | `text NOT NULL CHECK(kind IN ('customer','staff','courier'))` |
| `status` | `text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','active','disabled','deleted'))` |
| `phone_verified_at` | `timestamptz` |
| `deleted_at` | `timestamptz` |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` |
| `CHECK(status='deleted'` | `OR (phone_e164 IS NOT NULL AND password_hash IS NOT NULL))` |

### `roles` — أدوار الموظفين

| الحقل/القيد | التعريف |
|---|---|
| `id` | `uuid PRIMARY KEY DEFAULT gen_random_uuid()` |
| `code` | `text NOT NULL UNIQUE` |
| `name_ar` | `text NOT NULL` |

### `permissions` — الصلاحيات الدقيقة

| الحقل/القيد | التعريف |
|---|---|
| `code` | `text PRIMARY KEY` |
| `name_ar` | `text NOT NULL` |

### `role_permissions` — صلاحيات كل دور

| الحقل/القيد | التعريف |
|---|---|
| `role_id` | `uuid NOT NULL REFERENCES roles(id)` |
| `permission_code` | `text NOT NULL REFERENCES permissions(code)` |
| `PRIMARY` | `KEY(role_id,permission_code)` |

### `staff_grants` — منح دور لموظف بنطاق فرع أو نطاق عام

| الحقل/القيد | التعريف |
|---|---|
| `id` | `uuid PRIMARY KEY DEFAULT gen_random_uuid()` |
| `user_id` | `uuid NOT NULL REFERENCES users(id)` |
| `role_id` | `uuid NOT NULL REFERENCES roles(id)` |
| `branch_id` | `uuid REFERENCES branches(id)` |
| `global_scope` | `boolean NOT NULL DEFAULT false` |
| `CHECK((global_scope` | `AND branch_id IS NULL) OR (NOT global_scope AND branch_id IS NOT NULL))` |

### `courier_profiles` — نسبة عمولة الموصل الافتراضية

| الحقل/القيد | التعريف |
|---|---|
| `user_id` | `uuid PRIMARY KEY REFERENCES users(id)` |
| `commission_bps` | `integer CHECK(commission_bps BETWEEN 0 AND 10000)` |
| `active` | `boolean NOT NULL DEFAULT true` |

### `courier_branches` — الفروع التي يعمل فيها الموصل

| الحقل/القيد | التعريف |
|---|---|
| `courier_id` | `uuid NOT NULL REFERENCES courier_profiles(user_id)` |
| `branch_id` | `uuid NOT NULL REFERENCES branches(id)` |
| `PRIMARY` | `KEY(courier_id,branch_id)` |

### `otp_challenges` — تحديات OTP ذات الغرض الواحد

| الحقل/القيد | التعريف |
|---|---|
| `id` | `uuid PRIMARY KEY DEFAULT gen_random_uuid()` |
| `phone_e164` | `text NOT NULL` |
| `purpose` | `text NOT NULL CHECK(purpose IN ('register','login','reset_password','delete_account','invite'))` |
| `app` | `text NOT NULL CHECK(app IN ('customer','admin','courier','web'))` |
| `code_hmac` | `text NOT NULL` |
| `preauth_digest` | `text NOT NULL` |
| `pending_payload_encrypted` | `text` |
| `attempts` | `integer NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 5)` |
| `expires_at` | `timestamptz NOT NULL` |
| `consumed_at` | `timestamptz` |
| `resend_after` | `timestamptz NOT NULL` |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` |

### `sessions` — جلسات التجديد الدوارة

| الحقل/القيد | التعريف |
|---|---|
| `id` | `uuid PRIMARY KEY DEFAULT gen_random_uuid()` |
| `user_id` | `uuid NOT NULL REFERENCES users(id)` |
| `app` | `text NOT NULL CHECK(app IN ('customer','admin','courier'))` |
| `refresh_token_hash` | `text NOT NULL UNIQUE` |
| `expires_at` | `timestamptz NOT NULL` |
| `revoked_at` | `timestamptz` |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` |

### `addresses` — عناوين العميل المؤكدة بالدبوس

| الحقل/القيد | التعريف |
|---|---|
| `id` | `uuid PRIMARY KEY DEFAULT gen_random_uuid()` |
| `user_id` | `uuid NOT NULL REFERENCES users(id)` |
| `governorate_id` | `uuid NOT NULL REFERENCES governorates(id)` |
| `label` | `text NOT NULL` |
| `description` | `text` |
| `latitude` | `numeric(9,6) NOT NULL CHECK(latitude BETWEEN -90 AND 90)` |
| `longitude` | `numeric(9,6) NOT NULL CHECK(longitude BETWEEN -180 AND 180)` |
| `is_default` | `boolean NOT NULL DEFAULT false` |
| `archived_at` | `timestamptz` |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` |

### `media_objects` — مفاتيح ملفات R2 وملكيتها

| الحقل/القيد | التعريف |
|---|---|
| `id` | `uuid PRIMARY KEY DEFAULT gen_random_uuid()` |
| `owner_id` | `uuid REFERENCES users(id)` |
| `object_key` | `text NOT NULL UNIQUE` |
| `visibility` | `text NOT NULL CHECK(visibility IN ('public','private'))` |
| `purpose` | `text NOT NULL CHECK(purpose IN ('product','category','banner','receipt','complaint','customer_flag','report'))` |
| `mime_type` | `text NOT NULL` |
| `size_bytes` | `bigint NOT NULL CHECK(size_bytes>0)` |
| `status` | `text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','verified','rejected','deleted'))` |
| `sha256` | `text` |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` |

### `categories` — الأقسام

| الحقل/القيد | التعريف |
|---|---|
| `id` | `uuid PRIMARY KEY DEFAULT gen_random_uuid()` |
| `parent_id` | `uuid REFERENCES categories(id)` |
| `name_ar` | `text NOT NULL` |
| `image_id` | `uuid REFERENCES media_objects(id)` |
| `active` | `boolean NOT NULL DEFAULT true` |
| `sort_order` | `integer NOT NULL DEFAULT 0` |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` |
| `CHECK(parent_id` | `IS NULL OR parent_id<>id)` |

### `attributes` — تعريفات الخصائص مثل الماركة واللزوجة

| الحقل/القيد | التعريف |
|---|---|
| `id` | `uuid PRIMARY KEY DEFAULT gen_random_uuid()` |
| `code` | `text NOT NULL UNIQUE` |
| `name_ar` | `text NOT NULL` |
| `active` | `boolean NOT NULL DEFAULT true` |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` |

### `attribute_values` — قائمة القيم المسموحة لكل خاصية

| الحقل/القيد | التعريف |
|---|---|
| `id` | `uuid PRIMARY KEY DEFAULT gen_random_uuid()` |
| `attribute_id` | `uuid NOT NULL REFERENCES attributes(id)` |
| `value_ar` | `text NOT NULL` |
| `active` | `boolean NOT NULL DEFAULT true` |
| `sort_order` | `integer NOT NULL DEFAULT 0` |
| `UNIQUE(attribute_id,value_ar)` | `` |
| `UNIQUE(attribute_id,id)` | `` |

### `category_attributes` — خصائص القسم وما يظهر كفلتر

| الحقل/القيد | التعريف |
|---|---|
| `category_id` | `uuid NOT NULL REFERENCES categories(id)` |
| `attribute_id` | `uuid NOT NULL REFERENCES attributes(id)` |
| `required` | `boolean NOT NULL DEFAULT false` |
| `filterable` | `boolean NOT NULL DEFAULT true` |
| `sort_order` | `integer NOT NULL DEFAULT 0` |
| `PRIMARY` | `KEY(category_id,attribute_id)` |

### `products` — منتجات SKU بعبوة أو مقاس ثابت

| الحقل/القيد | التعريف |
|---|---|
| `id` | `uuid PRIMARY KEY DEFAULT gen_random_uuid()` |
| `sku` | `text NOT NULL UNIQUE` |
| `category_id` | `uuid NOT NULL REFERENCES categories(id)` |
| `name_ar` | `text NOT NULL` |
| `description_ar` | `text NOT NULL DEFAULT ''` |
| `origin_country` | `text` |
| `active` | `boolean NOT NULL DEFAULT true` |
| `version` | `integer NOT NULL DEFAULT 1 CHECK(version>0)` |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` |
| `UNIQUE(id,category_id)` | `` |

### `product_attribute_values` — اختيار قيمة مسجلة لخاصية مسموحة في قسم المنتج

| الحقل/القيد | التعريف |
|---|---|
| `product_id` | `uuid NOT NULL` |
| `category_id` | `uuid NOT NULL` |
| `attribute_id` | `uuid NOT NULL` |
| `value_id` | `uuid NOT NULL` |
| `PRIMARY` | `KEY(product_id,attribute_id)` |
| `FOREIGN` | `KEY(product_id,category_id) REFERENCES products(id,category_id)` |
| `FOREIGN` | `KEY(category_id,attribute_id) REFERENCES category_attributes(category_id,attribute_id)` |
| `FOREIGN` | `KEY(attribute_id,value_id) REFERENCES attribute_values(attribute_id,id)` |

### `product_images` — صور المنتج وترتيبها

| الحقل/القيد | التعريف |
|---|---|
| `product_id` | `uuid NOT NULL REFERENCES products(id)` |
| `media_id` | `uuid NOT NULL REFERENCES media_objects(id)` |
| `sort_order` | `integer NOT NULL DEFAULT 0` |
| `PRIMARY` | `KEY(product_id,media_id)` |

### `product_units` — وحدات البيع بالحبة أو الكرتون ومعامل التحويل

| الحقل/القيد | التعريف |
|---|---|
| `id` | `uuid PRIMARY KEY DEFAULT gen_random_uuid()` |
| `product_id` | `uuid NOT NULL REFERENCES products(id)` |
| `unit_kind` | `text NOT NULL CHECK(unit_kind IN ('piece','carton'))` |
| `pieces_per_unit` | `integer NOT NULL CHECK(pieces_per_unit>0)` |
| `price_yer` | `bigint NOT NULL CHECK(price_yer>=0)` |
| `active` | `boolean NOT NULL DEFAULT true` |
| `archived_at` | `timestamptz` |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` |
| `CHECK(unit_kind<>'piece'` | `OR pieces_per_unit=1)` |
| `CHECK(unit_kind<>'carton'` | `OR pieces_per_unit>1)` |
| `UNIQUE(id,product_id)` | `` |

### `branch_unit_prices` — أسعار اختيارية مختلفة بين الفروع

| الحقل/القيد | التعريف |
|---|---|
| `branch_id` | `uuid NOT NULL REFERENCES branches(id)` |
| `unit_id` | `uuid NOT NULL REFERENCES product_units(id)` |
| `price_yer` | `bigint NOT NULL CHECK(price_yer>=0)` |
| `active` | `boolean NOT NULL DEFAULT true` |
| `PRIMARY` | `KEY(branch_id,unit_id)` |

### `stock_levels` — الرصيد والمحجوز والحالة البيعية لكل فرع ومنتج

| الحقل/القيد | التعريف |
|---|---|
| `branch_id` | `uuid NOT NULL REFERENCES branches(id)` |
| `product_id` | `uuid NOT NULL REFERENCES products(id)` |
| `on_hand` | `bigint NOT NULL DEFAULT 0 CHECK(on_hand>=0)` |
| `reserved` | `bigint NOT NULL DEFAULT 0 CHECK(reserved>=0)` |
| `sellable` | `boolean NOT NULL DEFAULT true` |
| `version` | `integer NOT NULL DEFAULT 1 CHECK(version>0)` |
| `PRIMARY` | `KEY(branch_id,product_id)` |
| `CHECK(reserved<=on_hand)` | `` |

### `stock_transfers` — نقل المخزون بين الفروع

| الحقل/القيد | التعريف |
|---|---|
| `id` | `uuid PRIMARY KEY DEFAULT gen_random_uuid()` |
| `from_branch_id` | `uuid NOT NULL REFERENCES branches(id)` |
| `to_branch_id` | `uuid NOT NULL REFERENCES branches(id)` |
| `actor_id` | `uuid NOT NULL REFERENCES users(id)` |
| `reason` | `text NOT NULL` |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` |
| `CHECK(from_branch_id<>to_branch_id)` | `` |

### `stock_transfer_items` — بنود النقل بكميات الحبات

| الحقل/القيد | التعريف |
|---|---|
| `transfer_id` | `uuid NOT NULL REFERENCES stock_transfers(id)` |
| `product_id` | `uuid NOT NULL REFERENCES products(id)` |
| `pieces` | `bigint NOT NULL CHECK(pieces>0)` |
| `PRIMARY` | `KEY(transfer_id,product_id)` |

### `delivery_rules` — تعرفة توصيل الفرع

| الحقل/القيد | التعريف |
|---|---|
| `branch_id` | `uuid PRIMARY KEY REFERENCES branches(id)` |
| `base_yer` | `bigint NOT NULL CHECK(base_yer>=0)` |
| `per_km_yer` | `bigint NOT NULL CHECK(per_km_yer>=0)` |
| `rounding` | `text NOT NULL DEFAULT 'ceil_km' CHECK(rounding IN ('ceil_km','proportional'))` |
| `max_distance_m` | `integer CHECK(max_distance_m>0)` |
| `version` | `integer NOT NULL DEFAULT 1 CHECK(version>0)` |

### `payment_methods` — المحافظ وبيانات التحويل المدارة

| الحقل/القيد | التعريف |
|---|---|
| `id` | `uuid PRIMARY KEY DEFAULT gen_random_uuid()` |
| `branch_id` | `uuid REFERENCES branches(id)` |
| `name_ar` | `text NOT NULL` |
| `beneficiary` | `text NOT NULL` |
| `destination_number` | `text NOT NULL` |
| `instructions_ar` | `text` |
| `active` | `boolean NOT NULL DEFAULT true` |
| `sort_order` | `integer NOT NULL DEFAULT 0` |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` |

### `promotions` — عروض مؤرخة غير متراكمة

| الحقل/القيد | التعريف |
|---|---|
| `id` | `uuid PRIMARY KEY DEFAULT gen_random_uuid()` |
| `name_ar` | `text NOT NULL` |
| `governorate_id` | `uuid REFERENCES governorates(id)` |
| `category_id` | `uuid REFERENCES categories(id)` |
| `product_id` | `uuid REFERENCES products(id)` |
| `target` | `text NOT NULL CHECK(target IN ('products','delivery'))` |
| `discount_kind` | `text NOT NULL CHECK(discount_kind IN ('fixed','percent'))` |
| `value` | `bigint NOT NULL CHECK(value>=0)` |
| `starts_at` | `timestamptz NOT NULL` |
| `ends_at` | `timestamptz NOT NULL` |
| `active` | `boolean NOT NULL DEFAULT true` |
| `CHECK(ends_at>starts_at)` | `` |
| `CHECK(discount_kind<>'percent'` | `OR value<=10000)` |
| `CHECK(NOT(category_id` | `IS NOT NULL AND product_id IS NOT NULL))` |

### `orders` — رأس الطلب وحالته الظاهرة

| الحقل/القيد | التعريف |
|---|---|
| `id` | `uuid PRIMARY KEY DEFAULT gen_random_uuid()` |
| `order_number` | `bigint GENERATED ALWAYS AS IDENTITY UNIQUE` |
| `customer_id` | `uuid NOT NULL REFERENCES users(id)` |
| `governorate_id` | `uuid NOT NULL REFERENCES governorates(id)` |
| `branch_id` | `uuid REFERENCES branches(id)` |
| `kind` | `text NOT NULL CHECK(kind IN ('retail','wholesale'))` |
| `status` | `text NOT NULL DEFAULT 'pending_review' CHECK(status IN ('pending_review','confirmed','on_the_way','delivered','rejected','cancelled'))` |
| `review_stage` | `text NOT NULL DEFAULT 'awaiting_quote' CHECK(review_stage IN ('awaiting_quote','awaiting_customer','awaiting_transfer','checking_receipt','ready_to_confirm','closed'))` |
| `address_snapshot` | `jsonb NOT NULL` |
| `current_quote_id` | `uuid` |
| `version` | `integer NOT NULL DEFAULT 1 CHECK(version>0)` |
| `confirmed_at` | `timestamptz` |
| `delivered_at` | `timestamptz` |
| `closed_reason` | `text` |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` |
| `UNIQUE(id,branch_id)` | `` |

### `order_request_items` — بنود طلب الجملة الأولي قبل عرض الإدارة

| الحقل/القيد | التعريف |
|---|---|
| `id` | `uuid PRIMARY KEY DEFAULT gen_random_uuid()` |
| `order_id` | `uuid NOT NULL REFERENCES orders(id)` |
| `product_id` | `uuid NOT NULL REFERENCES products(id)` |
| `unit_id` | `uuid NOT NULL` |
| `quantity` | `integer NOT NULL CHECK(quantity>0)` |
| `FOREIGN` | `KEY(unit_id,product_id) REFERENCES product_units(id,product_id)` |

### `order_quotes` — نسخ عرض أسعار الطلب مع snapshots

| الحقل/القيد | التعريف |
|---|---|
| `id` | `uuid PRIMARY KEY DEFAULT gen_random_uuid()` |
| `order_id` | `uuid NOT NULL REFERENCES orders(id)` |
| `branch_id` | `uuid NOT NULL REFERENCES branches(id)` |
| `revision` | `integer NOT NULL CHECK(revision>0)` |
| `status` | `text NOT NULL DEFAULT 'sent' CHECK(status IN ('draft','sent','accepted','declined','superseded','expired'))` |
| `subtotal_yer` | `bigint NOT NULL CHECK(subtotal_yer>=0)` |
| `product_discount_yer` | `bigint NOT NULL DEFAULT 0 CHECK(product_discount_yer>=0 AND product_discount_yer<=subtotal_yer)` |
| `delivery_yer` | `bigint NOT NULL CHECK(delivery_yer>=0)` |
| `delivery_discount_yer` | `bigint NOT NULL DEFAULT 0 CHECK(delivery_discount_yer>=0 AND delivery_discount_yer<=delivery_yer)` |
| `total_yer` | `bigint NOT NULL CHECK(total_yer>=0)` |
| `distance_m` | `integer CHECK(distance_m>=0)` |
| `routing_source` | `text NOT NULL` |
| `delivery_rule_snapshot` | `jsonb NOT NULL` |
| `promotion_snapshot` | `jsonb` |
| `author_id` | `uuid REFERENCES users(id)` |
| `accepted_by` | `uuid REFERENCES users(id)` |
| `accepted_at` | `timestamptz` |
| `expires_at` | `timestamptz NOT NULL` |
| `reason` | `text` |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` |
| `UNIQUE(order_id,revision)` | `` |
| `UNIQUE(id,order_id)` | `` |
| `CHECK(total_yer=subtotal_yer-product_discount_yer+delivery_yer-delivery_discount_yer)` | `` |
| `CHECK((status='accepted')=(accepted_at` | `IS NOT NULL AND accepted_by IS NOT NULL))` |

### `quote_items` — بنود عرض السعر immutable بعد الإرسال

| الحقل/القيد | التعريف |
|---|---|
| `id` | `uuid PRIMARY KEY DEFAULT gen_random_uuid()` |
| `quote_id` | `uuid NOT NULL REFERENCES order_quotes(id)` |
| `product_id` | `uuid NOT NULL REFERENCES products(id)` |
| `unit_id` | `uuid NOT NULL` |
| `name_snapshot` | `text NOT NULL` |
| `attributes_snapshot` | `jsonb NOT NULL DEFAULT '{}'` |
| `unit_snapshot` | `text NOT NULL` |
| `pieces_per_unit` | `integer NOT NULL CHECK(pieces_per_unit>0)` |
| `quantity` | `integer NOT NULL CHECK(quantity>0)` |
| `unit_price_yer` | `bigint NOT NULL CHECK(unit_price_yer>=0)` |
| `line_total_yer` | `bigint NOT NULL CHECK(line_total_yer>=0)` |
| `FOREIGN` | `KEY(unit_id,product_id) REFERENCES product_units(id,product_id)` |
| `CHECK(line_total_yer=quantity::bigint*unit_price_yer)` | `` |

### `stock_reservations` — حجز حبات لطلب وفرع ومنتج

| الحقل/القيد | التعريف |
|---|---|
| `id` | `uuid PRIMARY KEY DEFAULT gen_random_uuid()` |
| `order_id` | `uuid NOT NULL` |
| `branch_id` | `uuid NOT NULL` |
| `product_id` | `uuid NOT NULL REFERENCES products(id)` |
| `quote_id` | `uuid NOT NULL` |
| `pieces` | `bigint NOT NULL CHECK(pieces>0)` |
| `state` | `text NOT NULL DEFAULT 'active' CHECK(state IN ('active','consumed','released','expired'))` |
| `expires_at` | `timestamptz NOT NULL` |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` |
| `FOREIGN` | `KEY(order_id,branch_id) REFERENCES orders(id,branch_id)` |
| `FOREIGN` | `KEY(branch_id,product_id) REFERENCES stock_levels(branch_id,product_id)` |
| `FOREIGN` | `KEY(quote_id,order_id) REFERENCES order_quotes(id,order_id)` |

### `stock_movements` — دفتر حركات المخزون، لا يعدل ولا يحذف

| الحقل/القيد | التعريف |
|---|---|
| `id` | `uuid PRIMARY KEY DEFAULT gen_random_uuid()` |
| `branch_id` | `uuid NOT NULL REFERENCES branches(id)` |
| `product_id` | `uuid NOT NULL REFERENCES products(id)` |
| `delta_pieces` | `bigint NOT NULL CHECK(delta_pieces<>0)` |
| `reason` | `text NOT NULL CHECK(reason IN ('receipt','adjustment','transfer_in','transfer_out','sale','reversal'))` |
| `order_id` | `uuid REFERENCES orders(id)` |
| `transfer_id` | `uuid REFERENCES stock_transfers(id)` |
| `reverses_id` | `uuid UNIQUE REFERENCES stock_movements(id)` |
| `actor_id` | `uuid NOT NULL REFERENCES users(id)` |
| `note` | `text` |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` |

### `payments` — التحويلات والإيصالات ومراجعتها

| الحقل/القيد | التعريف |
|---|---|
| `id` | `uuid PRIMARY KEY DEFAULT gen_random_uuid()` |
| `order_id` | `uuid NOT NULL REFERENCES orders(id)` |
| `quote_id` | `uuid NOT NULL` |
| `method_id` | `uuid NOT NULL REFERENCES payment_methods(id)` |
| `method_snapshot` | `jsonb NOT NULL` |
| `receipt_number` | `text NOT NULL` |
| `normalized_receipt_number` | `text NOT NULL` |
| `receipt_media_id` | `uuid NOT NULL REFERENCES media_objects(id)` |
| `amount_yer` | `bigint NOT NULL CHECK(amount_yer>0)` |
| `status` | `text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected'))` |
| `reviewer_id` | `uuid REFERENCES users(id)` |
| `reviewed_at` | `timestamptz` |
| `review_note` | `text` |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` |
| `FOREIGN` | `KEY(quote_id,order_id) REFERENCES order_quotes(id,order_id)` |
| `UNIQUE(method_id,normalized_receipt_number)` | `` |
| `CHECK(status='pending'` | `OR (reviewer_id IS NOT NULL AND reviewed_at IS NOT NULL))` |

### `order_events` — تاريخ حالات الطلب وقراراته

| الحقل/القيد | التعريف |
|---|---|
| `id` | `uuid PRIMARY KEY DEFAULT gen_random_uuid()` |
| `order_id` | `uuid NOT NULL REFERENCES orders(id)` |
| `actor_id` | `uuid REFERENCES users(id)` |
| `event_type` | `text NOT NULL` |
| `details` | `jsonb NOT NULL DEFAULT '{}'` |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` |

### `order_assignments` — إسناد الطلب وتثبيت نسبة العمولة

| الحقل/القيد | التعريف |
|---|---|
| `id` | `uuid PRIMARY KEY DEFAULT gen_random_uuid()` |
| `order_id` | `uuid NOT NULL REFERENCES orders(id)` |
| `courier_id` | `uuid NOT NULL REFERENCES courier_profiles(user_id)` |
| `assigned_by` | `uuid NOT NULL REFERENCES users(id)` |
| `commission_bps` | `integer NOT NULL CHECK(commission_bps BETWEEN 0 AND 10000)` |
| `delivery_fee_yer` | `bigint NOT NULL CHECK(delivery_fee_yer>=0)` |
| `commission_yer` | `bigint NOT NULL CHECK(commission_yer>=0)` |
| `assigned_at` | `timestamptz NOT NULL DEFAULT now()` |
| `ended_at` | `timestamptz` |
| `CHECK(commission_yer=round(delivery_fee_yer::numeric*commission_bps/10000)::bigint)` | `` |

### `courier_earnings` — دفتر مستحقات التسليم والتصحيحات

| الحقل/القيد | التعريف |
|---|---|
| `id` | `uuid PRIMARY KEY DEFAULT gen_random_uuid()` |
| `courier_id` | `uuid NOT NULL REFERENCES courier_profiles(user_id)` |
| `order_id` | `uuid REFERENCES orders(id)` |
| `assignment_id` | `uuid REFERENCES order_assignments(id)` |
| `entry_type` | `text NOT NULL CHECK(entry_type IN ('delivery','adjustment'))` |
| `amount_yer` | `bigint NOT NULL CHECK(amount_yer<>0)` |
| `adjustment_reason` | `text` |
| `related_earning_id` | `uuid REFERENCES courier_earnings(id)` |
| `earned_at` | `timestamptz NOT NULL DEFAULT now()` |
| `CHECK(entry_type<>'delivery'` | `OR (order_id IS NOT NULL AND assignment_id IS NOT NULL AND amount_yer>0))` |
| `CHECK(entry_type<>'adjustment'` | `OR adjustment_reason IS NOT NULL)` |

### `courier_settlements` — تسويات مدفوعة للموصلين

| الحقل/القيد | التعريف |
|---|---|
| `id` | `uuid PRIMARY KEY DEFAULT gen_random_uuid()` |
| `courier_id` | `uuid NOT NULL REFERENCES courier_profiles(user_id)` |
| `paid_by` | `uuid NOT NULL REFERENCES users(id)` |
| `total_yer` | `bigint NOT NULL CHECK(total_yer>=0)` |
| `reference` | `text NOT NULL` |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` |

### `settlement_items` — ربط المستحق بالتسوية مرة واحدة

| الحقل/القيد | التعريف |
|---|---|
| `settlement_id` | `uuid NOT NULL REFERENCES courier_settlements(id)` |
| `earning_id` | `uuid NOT NULL UNIQUE REFERENCES courier_earnings(id)` |
| `PRIMARY` | `KEY(settlement_id,earning_id)` |

### `order_reviews` — تقييم طلب مسلم مرة واحدة

| الحقل/القيد | التعريف |
|---|---|
| `order_id` | `uuid PRIMARY KEY REFERENCES orders(id)` |
| `customer_id` | `uuid NOT NULL REFERENCES users(id)` |
| `rating` | `smallint NOT NULL CHECK(rating BETWEEN 1 AND 5)` |
| `comment_ar` | `text` |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` |

### `complaints` — شكاوى العميل المرتبطة بطلب

| الحقل/القيد | التعريف |
|---|---|
| `id` | `uuid PRIMARY KEY DEFAULT gen_random_uuid()` |
| `order_id` | `uuid NOT NULL REFERENCES orders(id)` |
| `customer_id` | `uuid NOT NULL REFERENCES users(id)` |
| `details_ar` | `text NOT NULL` |
| `attachment_id` | `uuid REFERENCES media_objects(id)` |
| `status` | `text NOT NULL DEFAULT 'open' CHECK(status IN ('open','in_progress','resolved'))` |
| `admin_response` | `text` |
| `assigned_to` | `uuid REFERENCES users(id)` |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` |

### `customer_flags` — بلاغات الإدارة والموصل على العميل

| الحقل/القيد | التعريف |
|---|---|
| `id` | `uuid PRIMARY KEY DEFAULT gen_random_uuid()` |
| `customer_id` | `uuid NOT NULL REFERENCES users(id)` |
| `order_id` | `uuid REFERENCES orders(id)` |
| `reporter_id` | `uuid NOT NULL REFERENCES users(id)` |
| `details_ar` | `text NOT NULL` |
| `attachment_id` | `uuid REFERENCES media_objects(id)` |
| `status` | `text NOT NULL DEFAULT 'open' CHECK(status IN ('open','reviewed','dismissed'))` |
| `admin_note` | `text` |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` |

### `banners` — بنرات الرئيسية

| الحقل/القيد | التعريف |
|---|---|
| `id` | `uuid PRIMARY KEY DEFAULT gen_random_uuid()` |
| `title_ar` | `text NOT NULL` |
| `image_id` | `uuid NOT NULL REFERENCES media_objects(id)` |
| `governorate_id` | `uuid REFERENCES governorates(id)` |
| `product_id` | `uuid REFERENCES products(id)` |
| `category_id` | `uuid REFERENCES categories(id)` |
| `starts_at` | `timestamptz` |
| `ends_at` | `timestamptz` |
| `active` | `boolean NOT NULL DEFAULT true` |
| `sort_order` | `integer NOT NULL DEFAULT 0` |
| `CHECK(ends_at` | `IS NULL OR starts_at IS NULL OR ends_at>starts_at)` |

### `push_tokens` — أجهزة الإشعارات

| الحقل/القيد | التعريف |
|---|---|
| `id` | `uuid PRIMARY KEY DEFAULT gen_random_uuid()` |
| `user_id` | `uuid NOT NULL REFERENCES users(id)` |
| `app` | `text NOT NULL CHECK(app IN ('customer','admin','courier'))` |
| `environment` | `text NOT NULL CHECK(environment IN ('staging','production'))` |
| `token` | `text NOT NULL UNIQUE` |
| `platform` | `text NOT NULL CHECK(platform IN ('android','ios'))` |
| `active` | `boolean NOT NULL DEFAULT true` |
| `updated_at` | `timestamptz NOT NULL DEFAULT now()` |

### `notification_campaigns` — البث والإشعارات المجدولة

| الحقل/القيد | التعريف |
|---|---|
| `id` | `uuid PRIMARY KEY DEFAULT gen_random_uuid()` |
| `author_id` | `uuid NOT NULL REFERENCES users(id)` |
| `title_ar` | `text NOT NULL` |
| `body_ar` | `text NOT NULL` |
| `audience` | `jsonb NOT NULL` |
| `status` | `text NOT NULL CHECK(status IN ('draft','scheduled','sending','sent','cancelled','failed'))` |
| `scheduled_at` | `timestamptz` |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` |

### `notification_inbox` — مركز الإشعارات الدائم

| الحقل/القيد | التعريف |
|---|---|
| `id` | `uuid PRIMARY KEY DEFAULT gen_random_uuid()` |
| `user_id` | `uuid NOT NULL REFERENCES users(id)` |
| `app` | `text NOT NULL CHECK(app IN ('customer','admin','courier'))` |
| `title_ar` | `text NOT NULL` |
| `body_ar` | `text NOT NULL` |
| `data` | `jsonb NOT NULL DEFAULT '{}'` |
| `event_key` | `text NOT NULL` |
| `read_at` | `timestamptz` |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` |
| `UNIQUE(user_id,app,event_key)` | `` |

### `notification_deliveries` — محاولات push ونتائجها

| الحقل/القيد | التعريف |
|---|---|
| `id` | `uuid PRIMARY KEY DEFAULT gen_random_uuid()` |
| `notification_id` | `uuid NOT NULL REFERENCES notification_inbox(id)` |
| `push_token_id` | `uuid NOT NULL REFERENCES push_tokens(id)` |
| `ticket_id` | `text` |
| `status` | `text NOT NULL CHECK(status IN ('pending','sent','delivered','failed'))` |
| `attempts` | `integer NOT NULL DEFAULT 0 CHECK(attempts>=0)` |
| `error_code` | `text` |
| `next_attempt_at` | `timestamptz` |
| `UNIQUE(notification_id,push_token_id)` | `` |

### `outbox_events` — أحداث ترسل بعد حفظ المعاملة

| الحقل/القيد | التعريف |
|---|---|
| `id` | `uuid PRIMARY KEY DEFAULT gen_random_uuid()` |
| `event_type` | `text NOT NULL` |
| `aggregate_id` | `uuid` |
| `dedupe_key` | `text NOT NULL UNIQUE` |
| `payload` | `jsonb NOT NULL` |
| `state` | `text NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','processing','done','dead'))` |
| `attempts` | `integer NOT NULL DEFAULT 0 CHECK(attempts>=0)` |
| `available_at` | `timestamptz NOT NULL DEFAULT now()` |
| `locked_at` | `timestamptz` |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` |

### `customer_maintenance` — صيانة العميل فقط

| الحقل/القيد | التعريف |
|---|---|
| `singleton` | `boolean PRIMARY KEY DEFAULT true CHECK(singleton)` |
| `enabled` | `boolean NOT NULL DEFAULT false` |
| `message_ar` | `text NOT NULL DEFAULT 'التطبيق في وضع الصيانة، سنعود في أقرب فرصة ممكنة'` |
| `updated_by` | `uuid REFERENCES users(id)` |
| `updated_at` | `timestamptz NOT NULL DEFAULT now()` |

### `app_releases` — حدود الإصدارات لكل تطبيق ومنصة وبيئة

| الحقل/القيد | التعريف |
|---|---|
| `id` | `uuid PRIMARY KEY DEFAULT gen_random_uuid()` |
| `app` | `text NOT NULL CHECK(app IN ('customer','admin','courier'))` |
| `platform` | `text NOT NULL CHECK(platform IN ('android','ios'))` |
| `environment` | `text NOT NULL CHECK(environment IN ('staging','production'))` |
| `minimum_build` | `bigint NOT NULL CHECK(minimum_build>0)` |
| `latest_build` | `bigint NOT NULL CHECK(latest_build>=minimum_build)` |
| `latest_version` | `text NOT NULL` |
| `store_url` | `text NOT NULL` |
| `message_ar` | `text` |
| `updated_by` | `uuid REFERENCES users(id)` |
| `updated_at` | `timestamptz NOT NULL DEFAULT now()` |
| `UNIQUE(app,platform,environment)` | `` |

### `settings` — إعدادات تشغيل غير سرية

| الحقل/القيد | التعريف |
|---|---|
| `key` | `text PRIMARY KEY` |
| `value` | `jsonb NOT NULL` |
| `updated_by` | `uuid REFERENCES users(id)` |
| `updated_at` | `timestamptz NOT NULL DEFAULT now()` |

### `deletion_requests` — طلبات حذف من التطبيق أو المتصفح

| الحقل/القيد | التعريف |
|---|---|
| `id` | `uuid PRIMARY KEY DEFAULT gen_random_uuid()` |
| `user_id` | `uuid REFERENCES users(id)` |
| `source` | `text NOT NULL CHECK(source IN ('app','web'))` |
| `status` | `text NOT NULL DEFAULT 'requested' CHECK(status IN ('requested','verified','processing','completed','needs_review'))` |
| `verified_at` | `timestamptz` |
| `completed_at` | `timestamptz` |
| `retention_notice` | `text` |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` |

### `audit_logs` — سجل إداري لا يقبل التعديل

| الحقل/القيد | التعريف |
|---|---|
| `id` | `uuid PRIMARY KEY DEFAULT gen_random_uuid()` |
| `actor_id` | `uuid REFERENCES users(id)` |
| `action` | `text NOT NULL` |
| `entity_type` | `text NOT NULL` |
| `entity_id` | `uuid` |
| `branch_id` | `uuid REFERENCES branches(id)` |
| `before_redacted` | `jsonb` |
| `after_redacted` | `jsonb` |
| `request_id` | `text NOT NULL` |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` |

### `idempotency_records` — حفظ نتائج العمليات ومنع تكرارها

| الحقل/القيد | التعريف |
|---|---|
| `actor_id` | `uuid NOT NULL REFERENCES users(id)` |
| `scope` | `text NOT NULL` |
| `key` | `text NOT NULL` |
| `request_hash` | `text NOT NULL` |
| `response_status` | `integer` |
| `response_body` | `jsonb` |
| `expires_at` | `timestamptz NOT NULL` |
| `PRIMARY` | `KEY(actor_id,scope,key)` |

### `report_jobs` — توليد تقارير PDF خاصة

| الحقل/القيد | التعريف |
|---|---|
| `id` | `uuid PRIMARY KEY DEFAULT gen_random_uuid()` |
| `requested_by` | `uuid NOT NULL REFERENCES users(id)` |
| `kind` | `text NOT NULL CHECK(kind='monthly_sales')` |
| `parameters` | `jsonb NOT NULL` |
| `state` | `text NOT NULL CHECK(state IN ('pending','processing','ready','failed'))` |
| `media_id` | `uuid REFERENCES media_objects(id)` |
| `error_message` | `text` |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` |

## تنفيذ الخصم الفعلي
اجمع الحبة والكرتون للمنتج نفسه في حركة sale واحدة لكل order/branch/product، بما يتوافق مع unique index. لا تخصم مرة لكل سطر منفصل دون التجميع. التزامن والحجز والخصم والتحديثات كلها داخل معاملة واحدة في خدمة المخزون.
