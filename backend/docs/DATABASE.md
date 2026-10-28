# تصميم قاعدة البيانات المرجعي — متابعة00

المصدر التجاري: [قرارات المالك](../../OWNER_DECISIONS_PHASE00.md). المرجع التنفيذي للقيود هو [schema.sql](../database/schema.sql)، تصميم مراجعة فقط لا migration إنتاجية ولا خادمًا منشورًا. اختبر في PGlite داخل الذاكرة؛ لم يعتمد إصدار PostgreSQL إنتاجي بعد.

## الحدود والعلاقات

الهوية UUID؛ الوقت timestamptz وUTC؛ المال bigint بالريال، ويخرج من API كسلاسل عشرية صحيحة؛ العمولة bps حيث10000=100%. الكميات صحيحة موجبة. لا تجمع العروض ولا تقرب كيلومتر الطريق لأعلى. تصحيح الدفاتر بقيد تعويضي؛ لا حذف متسلسل للتاريخ.
`governorates.catalog_branch_id` مؤشر فرع كتالوج من المحافظة نفسها، و`orders.catalog_branch_id` يحفظ فرع ما عرضه العميل مستقلًا عن `orders.branch_id` الذي يختاره المدير. NULL في إعداد الكتالوج لا يجيز اختيارًا عشوائيًا؛ سياسة عدة فروع للمحافظة مؤجلة. branches تحتفظ بقابلية التوسع ولا تجمع مخزونًا أو تسند تلقائيًا.
Products→Units/AttributeValues؛ Branch×Product→Stock؛ Order→Quote revisions→QuoteItems؛ Quote×Branch→Reservation history؛ Order→PaymentInstructions→Payment→ReceiptAttempts→ReceiptReviews. Order→Assignment→CashCollections→CashRemittanceItems→CashRemittances مسار أموال المتجر، وAssignment→CourierEarnings→SettlementItems→CourierSettlements مسار العمولة المنفصل.

## الجداول المضافة وسببها

| الجدول | الدور |
|---|---|
| order_private_details | نسخ العنوان والتواصل الخاصة، منفصلة عن مبالغ العرض، مع تعمية أحادية الاتجاه وأثر تدقيق. العرض يشير إلى نسخته. |
| payment_instructions | تجميد المستفيد والرقم والوسيلة والمبلغ المتوقع قبل إظهارها للعميل؛ مرجع مركب يمنع خلط الطلب والعرض والوسيلة. |
| payment_receipt_attempts | كل صورة ترفع لنفس التحويل، بتسلسل وتاريخ ومالك. |
| payment_receipt_reviews | قرار واحد لكل محاولة، وهوية الموظف والسبب والمبلغ المتحقق منه؛ لا استبدال للمراجعة القديمة. |
| quote_revalidations | إثبات إعادة فحص نفس السعر بعد انتهاء الحجز، دون تعديل حقائق العرض أو قبول قديم. مقارنة السعر الحي وإعادة الحجز مسؤولية الخدمة. |
| order_cancellation_requests | مراجعة طلب الإلغاء بعد الإيصال وقبل التأكيد، ومراجعة واحدة مفتوحة للطلب. |
| financial_exceptions | مبلغ وسبب ونوع حالة مالية معلقة، بما فيه المتأخر أو الزائد أو نقص النقد. |
| financial_exception_resolutions | تسويات خارجية موثقة بمبلغ واتجاه ومرجع وإثبات ومسؤول وتاريخ، لا استرداد آلي. |
| courier_settlement_reversals | عكس تسوية كامل واحد للأصل وبنفس موصله ومبلغه، مع إثبات؛ credit مستقل لا earning إضافي. |
| cash_collections | سجل النقد الفعلي والتحسينات/التصحيحات المسببة، مرتبط بالطلب والموصل والإسناد، وليس عمولة. |
| cash_remittances | النقد المسلم للإدارة بإجمالي ومرجع ومستلِم. |
| cash_remittance_reversals | عكس توريد موثق مرة واحدة؛ لا حذف للأصل. |
| cash_remittance_items | تخصيص collection أو credit عكس مرة واحدة، وبنود لنفس الموصل ومجموع مطابق. |

## قرارات القيود والحراس

- حجز تاريخي يشير إلى `(quote_id,order_id,branch_id)` الثابتة في العرض، وليس إلى branch_id الطلب المتغير. تغيير التنفيذ يحفظ القديم ولا يستخدم CASCADE.
- billed_km مولد من distance_m/1000 مع مسافة غير سالبة؛ rounding=floor_km فقط. pricing_mode=road يطابق base+billed_km×per_km، وmanual يتطلب سببًا. delivery_enabled يتطلب نطاقًا وتعرفة بحد طريق، ولا حذف للقاعدة أثناء التفعيل.
- العرض يبدأ draft؛ البنود قابلة للتحرير فيه فقط، ومجموعها يطابق الرأس قبل sent. بعدها تتجمد حقائق المبلغ والفرع والوحدات والعنوان المرجعي؛ تسجيل القبول والحالة مسموح دون محو تاريخ accepted عند superseded/expired. قاموس القيود مولد من PostgreSQL حتى لا تعود مشكلة F07.
- وحدة استُخدمت في طلب/عرض لا يتغير product/kind/conversion لها. الأرشفة والسعر المستقبلي ممكنان، والطلبات تقرأ snapshot.
- snapshot واحد لعرض ترويجي واحد؛ لا منتج+توصيل معًا. حساب أهلية وأكبر توفير والتعادل بالخدمة. لم يضف النموذج حدود استعمال وهمية.
- حجز timed له expires_at؛ حجز receipt_review له protected_at وexpires_at=NULL ولا ينتقل expired. رفع محاولة على حجز وقتي صالح يحميه، ولا ينشئ مخزونًا إذا وصل التحويل بعد انتهاء الحجز. يلزم استثناء حينها. رفض صورة لا يحرر شيئًا تلقائيًا، والانتقال بعد المراجعة إجراء إداري موثق.
- التحويل الواحد فريد `(method_id,normalized_receipt_number)`؛ المحاولات والصور منفصلة. approved_amount_yer من آخر مراجعة transfer_verified، ولا يعاد اعتماد المال أو كتابة هويته. ملخص payment يتبع review بينما المحاولات/المراجعات append-only.
- تأكيد transfer يحتاج صافي مبلغ متحقق مطابق، أما cash_on_delivery فلا يحتاج تحويلًا أو إيصالًا. النوعان يحتاجان آخر قبول وفرعًا وحجزًا صالحًا وعدم استثناء مفتوح. هذا حارس إدخال/انتقال فقط؛ خصم المخزون واستهلاك الحجز ومنع التكرار وoutbox في خدمة معاملة لاحقة.
- التأكيد يثبت مرجع العرض وفرع التنفيذ؛ لا إلغاء بعده. delivered في النقد يحتاج collection حقيقية أو استثناء نقدي صريح، ولا ينشئ collection تلقائيًا. earning يستحق مرة واحدة عند delivered مطابقًا للإسناد.
- الإسناد يثبت delivery_fee_before_discount_yer وdelivery_discount_yer وcustomer_delivery_yer المولد وcommission_bps وcommission_yer. العمولة من قبل الخصم؛ نقد العميل وتوريده لا يدخلان مستحق الموصل.
- settlement_items وcash_remittance_items تخصص مصدرًا واحدًا: earning/collection أو reversal_credit. القيود المؤجلة تحقق مجموع الرأس عند نهاية المعاملة، وتمنع المالك المختلف والتكرار وتمويل الأصل بcredit عكسه. تظل allocations القديمة كما هي عند العكس.
- سجلات التسويات والعكس والتحصيل والإيصالات وتعويضات المال والـaudit append-only. financial_exceptions أصل ثابت وله انتقال إغلاق بعد توثيق resolution؛ لا إغلاق بالتخمين أو حذف لإخفاء التزام.

## مسؤوليات الخدمات التي لا تثبتها هذه القيود

تحقق action+branch وملكية كل endpoint وroles، اختيار فرع الكتالوج المهيأ والنشط، الخصائص المطلوبة ونشاط القيم ودورات الأقسام، أهلية العرض وأكبر توفير، مقارنة أسعار الفرع الحية عند revalidation، مخزون الحجوزات والدفاتر والعدادات المتساوي، صرف المخزون/تحريره ذريًا، idempotency وoutbox وإعادة المحاولة والتزامن متعدد الاتصالات، rate limits وتنبيه الحجز المحمي المتأخر، Routing والتغطية الفعلية، فحص الملف وR2، وإبطال الجلسات والحذف. توجد أربعة تشخيصات SV01–SV04 تبين بعض هذه الحدود؛ سماح SQL فيها لا يعني نجاح الخدمة.
القيم الحقيقية للتغطية والتعرفة والنسب ومدد الاحتفاظ وRPO/RTO لم تعتمد. regex رقم اليمن تنسيق لا إثبات مشغل أو وصول OTP. لا تنشأ بيانات تشغيلية وهمية من fixtures.

## الخصوصية وحفظ التاريخ

العنوان والتواصل في order_private_details، ولا تعدل نسخة مستخدمة ميدانيًا؛ ينشأ بديل ويشير عرض جديد إليه قبل التأكيد. التعمية تفريغ أحادي الاتجاه بـredacted_at/by/reason وتدقيق بلا نسخ البيانات المحذوفة، بعد انتهاء الالتزامات التشغيلية وعدم وجود استثناء مفتوح. حقائق المال ومرجع النسخة يظلان. مدخلات النص/JSON في الدفاتر تمنع بيانات شخصية غير لازمة عبر schemas والتحقق في الخدمة.
في05/11 خصص DB/API صلاحيات للخصوصية وحدها ولا تمنح UPDATE/DELETE عامًا على الدفاتر أو تعطّل triggers. حارس التعمية لا يقرر مدة احتفاظ أو يمحو بيانات طلب جارٍ؛ اعتماد السياسة والتحقق من التزامات النقد والتحويل مهمة الخدمة قبل الاستدعاء. ملفات الإثبات الخاصة لها سياسة حذف/تعمية منفصلة بعد المدة المعتمدة. لا DELETE users متسلسلًا.

## إعادة توليد القاموس والتحقق من مطابقته

```bash
cd backend/reference-tests
node generate-database-doc.mjs
node generate-database-doc.mjs --check
```

الجزء التالي مولد من pg_catalog بعد تنفيذ المخطط المرجعي في الذاكرة. الأنواع والـNULL/default/identity/generated وتعريفات CHECK/FK/UNIQUE والحراس مأخوذة من PostgreSQL نفسه؛ SQL هو المصدر النهائي. لا تحرر الجزء المولد يدويًا.

<!-- BEGIN GENERATED SCHEMA DICTIONARY -->

## قاموس الجداول المولد

عدد الجداول الفعلي: **69**. عدد حراس triggers الصريحة: **48**.

SHA-256 للمخطط: `265a32085ac4da1ce1d5b9377bfb9f0bb6e6e155f95b900148a90c9209013137`.

### `addresses`

| الحقل | النوع | NOT NULL | الافتراضي/التوليد |
|---|---|---|---|
| `id` | `uuid` | نعم | `gen_random_uuid()` |
| `user_id` | `uuid` | نعم | `—` |
| `governorate_id` | `uuid` | نعم | `—` |
| `label` | `text` | نعم | `—` |
| `description` | `text` | لا | `—` |
| `latitude` | `numeric(9,6)` | نعم | `—` |
| `longitude` | `numeric(9,6)` | نعم | `—` |
| `is_default` | `boolean` | نعم | `false` |
| `archived_at` | `timestamp with time zone` | لا | `—` |
| `created_at` | `timestamp with time zone` | نعم | `now()` |

القيود:

- `addresses_created_at_not_null`: `NOT NULL created_at`
- `addresses_governorate_id_fkey`: `FOREIGN KEY (governorate_id) REFERENCES governorates(id)`
- `addresses_governorate_id_not_null`: `NOT NULL governorate_id`
- `addresses_id_not_null`: `NOT NULL id`
- `addresses_is_default_not_null`: `NOT NULL is_default`
- `addresses_label_not_null`: `NOT NULL label`
- `addresses_latitude_check`: `CHECK (((latitude >= ('-90'::integer)::numeric) AND (latitude <= (90)::numeric)))`
- `addresses_latitude_not_null`: `NOT NULL latitude`
- `addresses_longitude_check`: `CHECK (((longitude >= ('-180'::integer)::numeric) AND (longitude <= (180)::numeric)))`
- `addresses_longitude_not_null`: `NOT NULL longitude`
- `addresses_pkey`: `PRIMARY KEY (id)`
- `addresses_user_id_fkey`: `FOREIGN KEY (user_id) REFERENCES users(id)`
- `addresses_user_id_not_null`: `NOT NULL user_id`

### `app_releases`

| الحقل | النوع | NOT NULL | الافتراضي/التوليد |
|---|---|---|---|
| `id` | `uuid` | نعم | `gen_random_uuid()` |
| `app` | `text` | نعم | `—` |
| `platform` | `text` | نعم | `—` |
| `environment` | `text` | نعم | `—` |
| `minimum_build` | `bigint` | نعم | `—` |
| `latest_build` | `bigint` | نعم | `—` |
| `latest_version` | `text` | نعم | `—` |
| `store_url` | `text` | نعم | `—` |
| `message_ar` | `text` | لا | `—` |
| `updated_by` | `uuid` | لا | `—` |
| `updated_at` | `timestamp with time zone` | نعم | `now()` |

القيود:

- `app_releases_app_check`: `CHECK ((app = ANY (ARRAY['customer'::text, 'admin'::text, 'courier'::text])))`
- `app_releases_app_not_null`: `NOT NULL app`
- `app_releases_app_platform_environment_key`: `UNIQUE (app, platform, environment)`
- `app_releases_check`: `CHECK ((latest_build >= minimum_build))`
- `app_releases_environment_check`: `CHECK ((environment = ANY (ARRAY['staging'::text, 'production'::text])))`
- `app_releases_environment_not_null`: `NOT NULL environment`
- `app_releases_id_not_null`: `NOT NULL id`
- `app_releases_latest_build_not_null`: `NOT NULL latest_build`
- `app_releases_latest_version_not_null`: `NOT NULL latest_version`
- `app_releases_minimum_build_check`: `CHECK ((minimum_build > 0))`
- `app_releases_minimum_build_not_null`: `NOT NULL minimum_build`
- `app_releases_pkey`: `PRIMARY KEY (id)`
- `app_releases_platform_check`: `CHECK ((platform = ANY (ARRAY['android'::text, 'ios'::text])))`
- `app_releases_platform_not_null`: `NOT NULL platform`
- `app_releases_store_url_not_null`: `NOT NULL store_url`
- `app_releases_updated_at_not_null`: `NOT NULL updated_at`
- `app_releases_updated_by_fkey`: `FOREIGN KEY (updated_by) REFERENCES users(id)`

### `attribute_values`

| الحقل | النوع | NOT NULL | الافتراضي/التوليد |
|---|---|---|---|
| `id` | `uuid` | نعم | `gen_random_uuid()` |
| `attribute_id` | `uuid` | نعم | `—` |
| `value_ar` | `text` | نعم | `—` |
| `active` | `boolean` | نعم | `true` |
| `sort_order` | `integer` | نعم | `0` |

القيود:

- `attribute_values_active_not_null`: `NOT NULL active`
- `attribute_values_attribute_id_fkey`: `FOREIGN KEY (attribute_id) REFERENCES attributes(id)`
- `attribute_values_attribute_id_id_key`: `UNIQUE (attribute_id, id)`
- `attribute_values_attribute_id_not_null`: `NOT NULL attribute_id`
- `attribute_values_attribute_id_value_ar_key`: `UNIQUE (attribute_id, value_ar)`
- `attribute_values_id_not_null`: `NOT NULL id`
- `attribute_values_pkey`: `PRIMARY KEY (id)`
- `attribute_values_sort_order_not_null`: `NOT NULL sort_order`
- `attribute_values_value_ar_not_null`: `NOT NULL value_ar`

### `attributes`

| الحقل | النوع | NOT NULL | الافتراضي/التوليد |
|---|---|---|---|
| `id` | `uuid` | نعم | `gen_random_uuid()` |
| `code` | `text` | نعم | `—` |
| `name_ar` | `text` | نعم | `—` |
| `active` | `boolean` | نعم | `true` |
| `created_at` | `timestamp with time zone` | نعم | `now()` |

القيود:

- `attributes_active_not_null`: `NOT NULL active`
- `attributes_code_key`: `UNIQUE (code)`
- `attributes_code_not_null`: `NOT NULL code`
- `attributes_created_at_not_null`: `NOT NULL created_at`
- `attributes_id_not_null`: `NOT NULL id`
- `attributes_name_ar_not_null`: `NOT NULL name_ar`
- `attributes_pkey`: `PRIMARY KEY (id)`

### `audit_logs`

| الحقل | النوع | NOT NULL | الافتراضي/التوليد |
|---|---|---|---|
| `id` | `uuid` | نعم | `gen_random_uuid()` |
| `actor_id` | `uuid` | لا | `—` |
| `action` | `text` | نعم | `—` |
| `entity_type` | `text` | نعم | `—` |
| `entity_id` | `uuid` | لا | `—` |
| `branch_id` | `uuid` | لا | `—` |
| `before_redacted` | `jsonb` | لا | `—` |
| `after_redacted` | `jsonb` | لا | `—` |
| `request_id` | `text` | نعم | `—` |
| `created_at` | `timestamp with time zone` | نعم | `now()` |

القيود:

- `audit_logs_action_not_null`: `NOT NULL action`
- `audit_logs_actor_id_fkey`: `FOREIGN KEY (actor_id) REFERENCES users(id)`
- `audit_logs_branch_id_fkey`: `FOREIGN KEY (branch_id) REFERENCES branches(id)`
- `audit_logs_created_at_not_null`: `NOT NULL created_at`
- `audit_logs_entity_type_not_null`: `NOT NULL entity_type`
- `audit_logs_id_not_null`: `NOT NULL id`
- `audit_logs_pkey`: `PRIMARY KEY (id)`
- `audit_logs_request_id_not_null`: `NOT NULL request_id`

الحراس:

- `immutable_audit`: `CREATE TRIGGER immutable_audit BEFORE DELETE OR UPDATE ON public.audit_logs FOR EACH ROW EXECUTE FUNCTION reject_ledger_mutation()`

### `banners`

| الحقل | النوع | NOT NULL | الافتراضي/التوليد |
|---|---|---|---|
| `id` | `uuid` | نعم | `gen_random_uuid()` |
| `title_ar` | `text` | نعم | `—` |
| `image_id` | `uuid` | نعم | `—` |
| `governorate_id` | `uuid` | لا | `—` |
| `product_id` | `uuid` | لا | `—` |
| `category_id` | `uuid` | لا | `—` |
| `starts_at` | `timestamp with time zone` | لا | `—` |
| `ends_at` | `timestamp with time zone` | لا | `—` |
| `active` | `boolean` | نعم | `true` |
| `sort_order` | `integer` | نعم | `0` |

القيود:

- `banners_active_not_null`: `NOT NULL active`
- `banners_category_id_fkey`: `FOREIGN KEY (category_id) REFERENCES categories(id)`
- `banners_check`: `CHECK (((ends_at IS NULL) OR (starts_at IS NULL) OR (ends_at > starts_at)))`
- `banners_governorate_id_fkey`: `FOREIGN KEY (governorate_id) REFERENCES governorates(id)`
- `banners_id_not_null`: `NOT NULL id`
- `banners_image_id_fkey`: `FOREIGN KEY (image_id) REFERENCES media_objects(id)`
- `banners_image_id_not_null`: `NOT NULL image_id`
- `banners_pkey`: `PRIMARY KEY (id)`
- `banners_product_id_fkey`: `FOREIGN KEY (product_id) REFERENCES products(id)`
- `banners_sort_order_not_null`: `NOT NULL sort_order`
- `banners_title_ar_not_null`: `NOT NULL title_ar`

### `branch_unit_prices`

| الحقل | النوع | NOT NULL | الافتراضي/التوليد |
|---|---|---|---|
| `branch_id` | `uuid` | نعم | `—` |
| `unit_id` | `uuid` | نعم | `—` |
| `price_yer` | `bigint` | نعم | `—` |
| `active` | `boolean` | نعم | `true` |

القيود:

- `branch_unit_prices_active_not_null`: `NOT NULL active`
- `branch_unit_prices_branch_id_fkey`: `FOREIGN KEY (branch_id) REFERENCES branches(id)`
- `branch_unit_prices_branch_id_not_null`: `NOT NULL branch_id`
- `branch_unit_prices_pkey`: `PRIMARY KEY (branch_id, unit_id)`
- `branch_unit_prices_price_yer_check`: `CHECK ((price_yer >= 0))`
- `branch_unit_prices_price_yer_not_null`: `NOT NULL price_yer`
- `branch_unit_prices_unit_id_fkey`: `FOREIGN KEY (unit_id) REFERENCES product_units(id)`
- `branch_unit_prices_unit_id_not_null`: `NOT NULL unit_id`

### `branches`

| الحقل | النوع | NOT NULL | الافتراضي/التوليد |
|---|---|---|---|
| `id` | `uuid` | نعم | `gen_random_uuid()` |
| `governorate_id` | `uuid` | نعم | `—` |
| `name_ar` | `text` | نعم | `—` |
| `latitude` | `numeric(9,6)` | نعم | `—` |
| `longitude` | `numeric(9,6)` | نعم | `—` |
| `coverage_radius_m` | `integer` | لا | `—` |
| `delivery_enabled` | `boolean` | نعم | `false` |
| `active` | `boolean` | نعم | `true` |
| `created_at` | `timestamp with time zone` | نعم | `now()` |

القيود:

- `branches_active_not_null`: `NOT NULL active`
- `branches_check`: `CHECK (((NOT delivery_enabled) OR (coverage_radius_m IS NOT NULL)))`
- `branches_coverage_radius_m_check`: `CHECK ((coverage_radius_m > 0))`
- `branches_created_at_not_null`: `NOT NULL created_at`
- `branches_delivery_enabled_not_null`: `NOT NULL delivery_enabled`
- `branches_governorate_id_fkey`: `FOREIGN KEY (governorate_id) REFERENCES governorates(id)`
- `branches_governorate_id_name_ar_key`: `UNIQUE (governorate_id, name_ar)`
- `branches_governorate_id_not_null`: `NOT NULL governorate_id`
- `branches_id_governorate_id_key`: `UNIQUE (id, governorate_id)`
- `branches_id_not_null`: `NOT NULL id`
- `branches_latitude_check`: `CHECK (((latitude >= ('-90'::integer)::numeric) AND (latitude <= (90)::numeric)))`
- `branches_latitude_not_null`: `NOT NULL latitude`
- `branches_longitude_check`: `CHECK (((longitude >= ('-180'::integer)::numeric) AND (longitude <= (180)::numeric)))`
- `branches_longitude_not_null`: `NOT NULL longitude`
- `branches_name_ar_not_null`: `NOT NULL name_ar`
- `branches_pkey`: `PRIMARY KEY (id)`

الحراس:

- `branch_delivery_configuration`: `CREATE TRIGGER branch_delivery_configuration BEFORE INSERT OR UPDATE ON public.branches FOR EACH ROW EXECUTE FUNCTION guard_coverage_activation()`

### `cash_collections`

| الحقل | النوع | NOT NULL | الافتراضي/التوليد |
|---|---|---|---|
| `id` | `uuid` | نعم | `gen_random_uuid()` |
| `order_id` | `uuid` | نعم | `—` |
| `assignment_id` | `uuid` | نعم | `—` |
| `courier_id` | `uuid` | نعم | `—` |
| `entry_type` | `text` | نعم | `'collection'::text` |
| `amount_yer` | `bigint` | نعم | `—` |
| `related_collection_id` | `uuid` | لا | `—` |
| `reason` | `text` | لا | `—` |
| `reference` | `text` | نعم | `—` |
| `recorded_by` | `uuid` | نعم | `—` |
| `collected_at` | `timestamp with time zone` | نعم | `—` |
| `created_at` | `timestamp with time zone` | نعم | `now()` |

القيود:

- `cash_collections_amount_yer_check`: `CHECK ((amount_yer <> 0))`
- `cash_collections_amount_yer_not_null`: `NOT NULL amount_yer`
- `cash_collections_assignment_id_not_null`: `NOT NULL assignment_id`
- `cash_collections_assignment_id_order_id_courier_id_fkey`: `FOREIGN KEY (assignment_id, order_id, courier_id) REFERENCES order_assignments(id, order_id, courier_id)`
- `cash_collections_check`: `CHECK ((((entry_type = 'collection'::text) AND (amount_yer > 0) AND (related_collection_id IS NULL)) OR ((entry_type = 'adjustment'::text) AND (related_collection_id IS NOT NULL) AND (reason IS NOT NULL) AND (length(btrim(reason)) > 0))))`
- `cash_collections_collected_at_not_null`: `NOT NULL collected_at`
- `cash_collections_courier_id_fkey`: `FOREIGN KEY (courier_id) REFERENCES courier_profiles(user_id)`
- `cash_collections_courier_id_not_null`: `NOT NULL courier_id`
- `cash_collections_created_at_not_null`: `NOT NULL created_at`
- `cash_collections_entry_type_check`: `CHECK ((entry_type = ANY (ARRAY['collection'::text, 'adjustment'::text])))`
- `cash_collections_entry_type_not_null`: `NOT NULL entry_type`
- `cash_collections_id_not_null`: `NOT NULL id`
- `cash_collections_order_id_fkey`: `FOREIGN KEY (order_id) REFERENCES orders(id)`
- `cash_collections_order_id_not_null`: `NOT NULL order_id`
- `cash_collections_pkey`: `PRIMARY KEY (id)`
- `cash_collections_recorded_by_fkey`: `FOREIGN KEY (recorded_by) REFERENCES users(id)`
- `cash_collections_recorded_by_not_null`: `NOT NULL recorded_by`
- `cash_collections_reference_check`: `CHECK ((length(btrim(reference)) > 0))`
- `cash_collections_reference_not_null`: `NOT NULL reference`
- `cash_collections_related_collection_id_fkey`: `FOREIGN KEY (related_collection_id) REFERENCES cash_collections(id)`

الحراس:

- `cash_collection_guard`: `CREATE TRIGGER cash_collection_guard BEFORE INSERT ON public.cash_collections FOR EACH ROW EXECUTE FUNCTION guard_cash_collection()`
- `immutable_cash_collections`: `CREATE TRIGGER immutable_cash_collections BEFORE DELETE OR UPDATE ON public.cash_collections FOR EACH ROW EXECUTE FUNCTION reject_ledger_mutation()`

### `cash_remittance_items`

| الحقل | النوع | NOT NULL | الافتراضي/التوليد |
|---|---|---|---|
| `id` | `uuid` | نعم | `gen_random_uuid()` |
| `remittance_id` | `uuid` | نعم | `—` |
| `collection_id` | `uuid` | لا | `—` |
| `reversal_credit_id` | `uuid` | لا | `—` |

القيود:

- `cash_remittance_items_check`: `CHECK ((num_nonnulls(collection_id, reversal_credit_id) = 1))`
- `cash_remittance_items_collection_id_fkey`: `FOREIGN KEY (collection_id) REFERENCES cash_collections(id)`
- `cash_remittance_items_collection_id_key`: `UNIQUE (collection_id)`
- `cash_remittance_items_id_not_null`: `NOT NULL id`
- `cash_remittance_items_pkey`: `PRIMARY KEY (id)`
- `cash_remittance_items_remittance_id_fkey`: `FOREIGN KEY (remittance_id) REFERENCES cash_remittances(id)`
- `cash_remittance_items_remittance_id_not_null`: `NOT NULL remittance_id`
- `cash_remittance_items_reversal_credit_id_fkey`: `FOREIGN KEY (reversal_credit_id) REFERENCES cash_remittance_reversals(id)`
- `cash_remittance_items_reversal_credit_id_key`: `UNIQUE (reversal_credit_id)`
- `remittance_items_total`: `TRIGGER DEFERRABLE INITIALLY DEFERRED`

الحراس:

- `immutable_cash_remittance_items`: `CREATE TRIGGER immutable_cash_remittance_items BEFORE DELETE OR UPDATE ON public.cash_remittance_items FOR EACH ROW EXECUTE FUNCTION reject_ledger_mutation()`
- `remittance_allocation_owner`: `CREATE TRIGGER remittance_allocation_owner BEFORE INSERT ON public.cash_remittance_items FOR EACH ROW EXECUTE FUNCTION guard_allocation_owner()`
- `remittance_items_total`: `CREATE CONSTRAINT TRIGGER remittance_items_total AFTER INSERT ON public.cash_remittance_items DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION validate_payout_total()`

### `cash_remittance_reversals`

| الحقل | النوع | NOT NULL | الافتراضي/التوليد |
|---|---|---|---|
| `id` | `uuid` | نعم | `gen_random_uuid()` |
| `remittance_id` | `uuid` | نعم | `—` |
| `courier_id` | `uuid` | نعم | `—` |
| `amount_yer` | `bigint` | نعم | `—` |
| `actor_id` | `uuid` | نعم | `—` |
| `reason` | `text` | نعم | `—` |
| `reference` | `text` | نعم | `—` |
| `proof_media_id` | `uuid` | نعم | `—` |
| `created_at` | `timestamp with time zone` | نعم | `now()` |

القيود:

- `cash_remittance_reversals_actor_id_fkey`: `FOREIGN KEY (actor_id) REFERENCES users(id)`
- `cash_remittance_reversals_actor_id_not_null`: `NOT NULL actor_id`
- `cash_remittance_reversals_amount_yer_check`: `CHECK ((amount_yer > 0))`
- `cash_remittance_reversals_amount_yer_not_null`: `NOT NULL amount_yer`
- `cash_remittance_reversals_courier_id_fkey`: `FOREIGN KEY (courier_id) REFERENCES courier_profiles(user_id)`
- `cash_remittance_reversals_courier_id_not_null`: `NOT NULL courier_id`
- `cash_remittance_reversals_created_at_not_null`: `NOT NULL created_at`
- `cash_remittance_reversals_id_not_null`: `NOT NULL id`
- `cash_remittance_reversals_pkey`: `PRIMARY KEY (id)`
- `cash_remittance_reversals_proof_media_id_fkey`: `FOREIGN KEY (proof_media_id) REFERENCES media_objects(id)`
- `cash_remittance_reversals_proof_media_id_not_null`: `NOT NULL proof_media_id`
- `cash_remittance_reversals_reason_check`: `CHECK ((length(btrim(reason)) > 0))`
- `cash_remittance_reversals_reason_not_null`: `NOT NULL reason`
- `cash_remittance_reversals_reference_check`: `CHECK ((length(btrim(reference)) > 0))`
- `cash_remittance_reversals_reference_not_null`: `NOT NULL reference`
- `cash_remittance_reversals_remittance_id_courier_id_amount__fkey`: `FOREIGN KEY (remittance_id, courier_id, amount_yer) REFERENCES cash_remittances(id, courier_id, total_yer)`
- `cash_remittance_reversals_remittance_id_key`: `UNIQUE (remittance_id)`
- `cash_remittance_reversals_remittance_id_not_null`: `NOT NULL remittance_id`

الحراس:

- `immutable_cash_remittance_reversals`: `CREATE TRIGGER immutable_cash_remittance_reversals BEFORE DELETE OR UPDATE ON public.cash_remittance_reversals FOR EACH ROW EXECUTE FUNCTION reject_ledger_mutation()`
- `remittance_reversal_private_evidence`: `CREATE TRIGGER remittance_reversal_private_evidence BEFORE INSERT ON public.cash_remittance_reversals FOR EACH ROW EXECUTE FUNCTION guard_private_evidence()`

### `cash_remittances`

| الحقل | النوع | NOT NULL | الافتراضي/التوليد |
|---|---|---|---|
| `id` | `uuid` | نعم | `gen_random_uuid()` |
| `courier_id` | `uuid` | نعم | `—` |
| `received_by` | `uuid` | نعم | `—` |
| `total_yer` | `bigint` | نعم | `—` |
| `reference` | `text` | نعم | `—` |
| `created_at` | `timestamp with time zone` | نعم | `now()` |

القيود:

- `cash_remittances_courier_id_fkey`: `FOREIGN KEY (courier_id) REFERENCES courier_profiles(user_id)`
- `cash_remittances_courier_id_not_null`: `NOT NULL courier_id`
- `cash_remittances_created_at_not_null`: `NOT NULL created_at`
- `cash_remittances_id_courier_id_total_yer_key`: `UNIQUE (id, courier_id, total_yer)`
- `cash_remittances_id_not_null`: `NOT NULL id`
- `cash_remittances_pkey`: `PRIMARY KEY (id)`
- `cash_remittances_received_by_fkey`: `FOREIGN KEY (received_by) REFERENCES users(id)`
- `cash_remittances_received_by_not_null`: `NOT NULL received_by`
- `cash_remittances_reference_check`: `CHECK ((length(btrim(reference)) > 0))`
- `cash_remittances_reference_not_null`: `NOT NULL reference`
- `cash_remittances_total_yer_check`: `CHECK ((total_yer > 0))`
- `cash_remittances_total_yer_not_null`: `NOT NULL total_yer`
- `remittance_total`: `TRIGGER DEFERRABLE INITIALLY DEFERRED`

الحراس:

- `immutable_cash_remittances`: `CREATE TRIGGER immutable_cash_remittances BEFORE DELETE OR UPDATE ON public.cash_remittances FOR EACH ROW EXECUTE FUNCTION reject_ledger_mutation()`
- `remittance_total`: `CREATE CONSTRAINT TRIGGER remittance_total AFTER INSERT ON public.cash_remittances DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION validate_payout_total()`

### `categories`

| الحقل | النوع | NOT NULL | الافتراضي/التوليد |
|---|---|---|---|
| `id` | `uuid` | نعم | `gen_random_uuid()` |
| `parent_id` | `uuid` | لا | `—` |
| `name_ar` | `text` | نعم | `—` |
| `image_id` | `uuid` | لا | `—` |
| `active` | `boolean` | نعم | `true` |
| `sort_order` | `integer` | نعم | `0` |
| `created_at` | `timestamp with time zone` | نعم | `now()` |

القيود:

- `categories_active_not_null`: `NOT NULL active`
- `categories_check`: `CHECK (((parent_id IS NULL) OR (parent_id <> id)))`
- `categories_created_at_not_null`: `NOT NULL created_at`
- `categories_id_not_null`: `NOT NULL id`
- `categories_image_id_fkey`: `FOREIGN KEY (image_id) REFERENCES media_objects(id)`
- `categories_name_ar_not_null`: `NOT NULL name_ar`
- `categories_parent_id_fkey`: `FOREIGN KEY (parent_id) REFERENCES categories(id)`
- `categories_pkey`: `PRIMARY KEY (id)`
- `categories_sort_order_not_null`: `NOT NULL sort_order`

### `category_attributes`

| الحقل | النوع | NOT NULL | الافتراضي/التوليد |
|---|---|---|---|
| `category_id` | `uuid` | نعم | `—` |
| `attribute_id` | `uuid` | نعم | `—` |
| `required` | `boolean` | نعم | `false` |
| `filterable` | `boolean` | نعم | `true` |
| `sort_order` | `integer` | نعم | `0` |

القيود:

- `category_attributes_attribute_id_fkey`: `FOREIGN KEY (attribute_id) REFERENCES attributes(id)`
- `category_attributes_attribute_id_not_null`: `NOT NULL attribute_id`
- `category_attributes_category_id_fkey`: `FOREIGN KEY (category_id) REFERENCES categories(id)`
- `category_attributes_category_id_not_null`: `NOT NULL category_id`
- `category_attributes_filterable_not_null`: `NOT NULL filterable`
- `category_attributes_pkey`: `PRIMARY KEY (category_id, attribute_id)`
- `category_attributes_required_not_null`: `NOT NULL required`
- `category_attributes_sort_order_not_null`: `NOT NULL sort_order`

### `complaints`

| الحقل | النوع | NOT NULL | الافتراضي/التوليد |
|---|---|---|---|
| `id` | `uuid` | نعم | `gen_random_uuid()` |
| `order_id` | `uuid` | نعم | `—` |
| `customer_id` | `uuid` | نعم | `—` |
| `details_ar` | `text` | نعم | `—` |
| `attachment_id` | `uuid` | لا | `—` |
| `status` | `text` | نعم | `'open'::text` |
| `admin_response` | `text` | لا | `—` |
| `assigned_to` | `uuid` | لا | `—` |
| `created_at` | `timestamp with time zone` | نعم | `now()` |

القيود:

- `complaints_assigned_to_fkey`: `FOREIGN KEY (assigned_to) REFERENCES users(id)`
- `complaints_attachment_id_fkey`: `FOREIGN KEY (attachment_id) REFERENCES media_objects(id)`
- `complaints_created_at_not_null`: `NOT NULL created_at`
- `complaints_customer_id_fkey`: `FOREIGN KEY (customer_id) REFERENCES users(id)`
- `complaints_customer_id_not_null`: `NOT NULL customer_id`
- `complaints_details_ar_not_null`: `NOT NULL details_ar`
- `complaints_id_not_null`: `NOT NULL id`
- `complaints_order_id_fkey`: `FOREIGN KEY (order_id) REFERENCES orders(id)`
- `complaints_order_id_not_null`: `NOT NULL order_id`
- `complaints_pkey`: `PRIMARY KEY (id)`
- `complaints_status_check`: `CHECK ((status = ANY (ARRAY['open'::text, 'in_progress'::text, 'resolved'::text])))`
- `complaints_status_not_null`: `NOT NULL status`

### `courier_branches`

| الحقل | النوع | NOT NULL | الافتراضي/التوليد |
|---|---|---|---|
| `courier_id` | `uuid` | نعم | `—` |
| `branch_id` | `uuid` | نعم | `—` |

القيود:

- `courier_branches_branch_id_fkey`: `FOREIGN KEY (branch_id) REFERENCES branches(id)`
- `courier_branches_branch_id_not_null`: `NOT NULL branch_id`
- `courier_branches_courier_id_fkey`: `FOREIGN KEY (courier_id) REFERENCES courier_profiles(user_id)`
- `courier_branches_courier_id_not_null`: `NOT NULL courier_id`
- `courier_branches_pkey`: `PRIMARY KEY (courier_id, branch_id)`

### `courier_earnings`

| الحقل | النوع | NOT NULL | الافتراضي/التوليد |
|---|---|---|---|
| `id` | `uuid` | نعم | `gen_random_uuid()` |
| `courier_id` | `uuid` | نعم | `—` |
| `order_id` | `uuid` | لا | `—` |
| `assignment_id` | `uuid` | لا | `—` |
| `entry_type` | `text` | نعم | `—` |
| `amount_yer` | `bigint` | نعم | `—` |
| `adjustment_reason` | `text` | لا | `—` |
| `related_earning_id` | `uuid` | لا | `—` |
| `earned_at` | `timestamp with time zone` | نعم | `now()` |

القيود:

- `courier_earnings_amount_yer_check`: `CHECK ((amount_yer <> 0))`
- `courier_earnings_amount_yer_not_null`: `NOT NULL amount_yer`
- `courier_earnings_assignment_id_fkey`: `FOREIGN KEY (assignment_id) REFERENCES order_assignments(id)`
- `courier_earnings_check`: `CHECK (((entry_type <> 'delivery'::text) OR ((order_id IS NOT NULL) AND (assignment_id IS NOT NULL) AND (amount_yer > 0))))`
- `courier_earnings_check1`: `CHECK (((entry_type <> 'adjustment'::text) OR (adjustment_reason IS NOT NULL)))`
- `courier_earnings_courier_id_fkey`: `FOREIGN KEY (courier_id) REFERENCES courier_profiles(user_id)`
- `courier_earnings_courier_id_not_null`: `NOT NULL courier_id`
- `courier_earnings_earned_at_not_null`: `NOT NULL earned_at`
- `courier_earnings_entry_type_check`: `CHECK ((entry_type = ANY (ARRAY['delivery'::text, 'adjustment'::text])))`
- `courier_earnings_entry_type_not_null`: `NOT NULL entry_type`
- `courier_earnings_id_not_null`: `NOT NULL id`
- `courier_earnings_order_id_fkey`: `FOREIGN KEY (order_id) REFERENCES orders(id)`
- `courier_earnings_pkey`: `PRIMARY KEY (id)`
- `courier_earnings_related_earning_id_fkey`: `FOREIGN KEY (related_earning_id) REFERENCES courier_earnings(id)`

الحراس:

- `earning_identity`: `CREATE TRIGGER earning_identity BEFORE INSERT ON public.courier_earnings FOR EACH ROW EXECUTE FUNCTION guard_earning_identity()`
- `immutable_courier_earnings`: `CREATE TRIGGER immutable_courier_earnings BEFORE DELETE OR UPDATE ON public.courier_earnings FOR EACH ROW EXECUTE FUNCTION reject_ledger_mutation()`

### `courier_profiles`

| الحقل | النوع | NOT NULL | الافتراضي/التوليد |
|---|---|---|---|
| `user_id` | `uuid` | نعم | `—` |
| `commission_bps` | `integer` | لا | `—` |
| `active` | `boolean` | نعم | `true` |

القيود:

- `courier_profiles_active_not_null`: `NOT NULL active`
- `courier_profiles_commission_bps_check`: `CHECK (((commission_bps >= 0) AND (commission_bps <= 10000)))`
- `courier_profiles_pkey`: `PRIMARY KEY (user_id)`
- `courier_profiles_user_id_fkey`: `FOREIGN KEY (user_id) REFERENCES users(id)`
- `courier_profiles_user_id_not_null`: `NOT NULL user_id`

### `courier_settlement_reversals`

| الحقل | النوع | NOT NULL | الافتراضي/التوليد |
|---|---|---|---|
| `id` | `uuid` | نعم | `gen_random_uuid()` |
| `settlement_id` | `uuid` | نعم | `—` |
| `courier_id` | `uuid` | نعم | `—` |
| `amount_yer` | `bigint` | نعم | `—` |
| `reason` | `text` | نعم | `—` |
| `reference` | `text` | نعم | `—` |
| `proof_media_id` | `uuid` | نعم | `—` |
| `actor_id` | `uuid` | نعم | `—` |
| `created_at` | `timestamp with time zone` | نعم | `now()` |

القيود:

- `courier_settlement_reversals_actor_id_fkey`: `FOREIGN KEY (actor_id) REFERENCES users(id)`
- `courier_settlement_reversals_actor_id_not_null`: `NOT NULL actor_id`
- `courier_settlement_reversals_amount_yer_check`: `CHECK ((amount_yer > 0))`
- `courier_settlement_reversals_amount_yer_not_null`: `NOT NULL amount_yer`
- `courier_settlement_reversals_courier_id_fkey`: `FOREIGN KEY (courier_id) REFERENCES courier_profiles(user_id)`
- `courier_settlement_reversals_courier_id_not_null`: `NOT NULL courier_id`
- `courier_settlement_reversals_created_at_not_null`: `NOT NULL created_at`
- `courier_settlement_reversals_id_not_null`: `NOT NULL id`
- `courier_settlement_reversals_pkey`: `PRIMARY KEY (id)`
- `courier_settlement_reversals_proof_media_id_fkey`: `FOREIGN KEY (proof_media_id) REFERENCES media_objects(id)`
- `courier_settlement_reversals_proof_media_id_not_null`: `NOT NULL proof_media_id`
- `courier_settlement_reversals_reason_check`: `CHECK ((length(btrim(reason)) > 0))`
- `courier_settlement_reversals_reason_not_null`: `NOT NULL reason`
- `courier_settlement_reversals_reference_check`: `CHECK ((length(btrim(reference)) > 0))`
- `courier_settlement_reversals_reference_not_null`: `NOT NULL reference`
- `courier_settlement_reversals_settlement_id_courier_id_amou_fkey`: `FOREIGN KEY (settlement_id, courier_id, amount_yer) REFERENCES courier_settlements(id, courier_id, total_yer)`
- `courier_settlement_reversals_settlement_id_key`: `UNIQUE (settlement_id)`
- `courier_settlement_reversals_settlement_id_not_null`: `NOT NULL settlement_id`

الحراس:

- `immutable_courier_settlement_reversals`: `CREATE TRIGGER immutable_courier_settlement_reversals BEFORE DELETE OR UPDATE ON public.courier_settlement_reversals FOR EACH ROW EXECUTE FUNCTION reject_ledger_mutation()`
- `settlement_reversal_private_evidence`: `CREATE TRIGGER settlement_reversal_private_evidence BEFORE INSERT ON public.courier_settlement_reversals FOR EACH ROW EXECUTE FUNCTION guard_private_evidence()`

### `courier_settlements`

| الحقل | النوع | NOT NULL | الافتراضي/التوليد |
|---|---|---|---|
| `id` | `uuid` | نعم | `gen_random_uuid()` |
| `courier_id` | `uuid` | نعم | `—` |
| `paid_by` | `uuid` | نعم | `—` |
| `total_yer` | `bigint` | نعم | `—` |
| `reference` | `text` | نعم | `—` |
| `created_at` | `timestamp with time zone` | نعم | `now()` |

القيود:

- `courier_settlements_courier_id_fkey`: `FOREIGN KEY (courier_id) REFERENCES courier_profiles(user_id)`
- `courier_settlements_courier_id_not_null`: `NOT NULL courier_id`
- `courier_settlements_created_at_not_null`: `NOT NULL created_at`
- `courier_settlements_id_courier_id_total_yer_key`: `UNIQUE (id, courier_id, total_yer)`
- `courier_settlements_id_not_null`: `NOT NULL id`
- `courier_settlements_paid_by_fkey`: `FOREIGN KEY (paid_by) REFERENCES users(id)`
- `courier_settlements_paid_by_not_null`: `NOT NULL paid_by`
- `courier_settlements_pkey`: `PRIMARY KEY (id)`
- `courier_settlements_reference_check`: `CHECK ((length(btrim(reference)) > 0))`
- `courier_settlements_reference_not_null`: `NOT NULL reference`
- `courier_settlements_total_yer_check`: `CHECK ((total_yer > 0))`
- `courier_settlements_total_yer_not_null`: `NOT NULL total_yer`
- `settlement_total`: `TRIGGER DEFERRABLE INITIALLY DEFERRED`

الحراس:

- `immutable_settlements`: `CREATE TRIGGER immutable_settlements BEFORE DELETE OR UPDATE ON public.courier_settlements FOR EACH ROW EXECUTE FUNCTION reject_ledger_mutation()`
- `settlement_total`: `CREATE CONSTRAINT TRIGGER settlement_total AFTER INSERT ON public.courier_settlements DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION validate_payout_total()`

### `customer_flags`

| الحقل | النوع | NOT NULL | الافتراضي/التوليد |
|---|---|---|---|
| `id` | `uuid` | نعم | `gen_random_uuid()` |
| `customer_id` | `uuid` | نعم | `—` |
| `order_id` | `uuid` | لا | `—` |
| `reporter_id` | `uuid` | نعم | `—` |
| `details_ar` | `text` | نعم | `—` |
| `attachment_id` | `uuid` | لا | `—` |
| `status` | `text` | نعم | `'open'::text` |
| `admin_note` | `text` | لا | `—` |
| `created_at` | `timestamp with time zone` | نعم | `now()` |

القيود:

- `customer_flags_attachment_id_fkey`: `FOREIGN KEY (attachment_id) REFERENCES media_objects(id)`
- `customer_flags_created_at_not_null`: `NOT NULL created_at`
- `customer_flags_customer_id_fkey`: `FOREIGN KEY (customer_id) REFERENCES users(id)`
- `customer_flags_customer_id_not_null`: `NOT NULL customer_id`
- `customer_flags_details_ar_not_null`: `NOT NULL details_ar`
- `customer_flags_id_not_null`: `NOT NULL id`
- `customer_flags_order_id_fkey`: `FOREIGN KEY (order_id) REFERENCES orders(id)`
- `customer_flags_pkey`: `PRIMARY KEY (id)`
- `customer_flags_reporter_id_fkey`: `FOREIGN KEY (reporter_id) REFERENCES users(id)`
- `customer_flags_reporter_id_not_null`: `NOT NULL reporter_id`
- `customer_flags_status_check`: `CHECK ((status = ANY (ARRAY['open'::text, 'reviewed'::text, 'dismissed'::text])))`
- `customer_flags_status_not_null`: `NOT NULL status`

### `customer_maintenance`

| الحقل | النوع | NOT NULL | الافتراضي/التوليد |
|---|---|---|---|
| `singleton` | `boolean` | نعم | `true` |
| `enabled` | `boolean` | نعم | `false` |
| `message_ar` | `text` | نعم | `'التطبيق في وضع الصيانة، سنعود في أقرب فرصة ممكنة'::text` |
| `updated_by` | `uuid` | لا | `—` |
| `updated_at` | `timestamp with time zone` | نعم | `now()` |

القيود:

- `customer_maintenance_enabled_not_null`: `NOT NULL enabled`
- `customer_maintenance_message_ar_not_null`: `NOT NULL message_ar`
- `customer_maintenance_pkey`: `PRIMARY KEY (singleton)`
- `customer_maintenance_singleton_check`: `CHECK (singleton)`
- `customer_maintenance_singleton_not_null`: `NOT NULL singleton`
- `customer_maintenance_updated_at_not_null`: `NOT NULL updated_at`
- `customer_maintenance_updated_by_fkey`: `FOREIGN KEY (updated_by) REFERENCES users(id)`

### `deletion_requests`

| الحقل | النوع | NOT NULL | الافتراضي/التوليد |
|---|---|---|---|
| `id` | `uuid` | نعم | `gen_random_uuid()` |
| `user_id` | `uuid` | لا | `—` |
| `source` | `text` | نعم | `—` |
| `status` | `text` | نعم | `'requested'::text` |
| `verified_at` | `timestamp with time zone` | لا | `—` |
| `completed_at` | `timestamp with time zone` | لا | `—` |
| `retention_notice` | `text` | لا | `—` |
| `created_at` | `timestamp with time zone` | نعم | `now()` |

القيود:

- `deletion_requests_created_at_not_null`: `NOT NULL created_at`
- `deletion_requests_id_not_null`: `NOT NULL id`
- `deletion_requests_pkey`: `PRIMARY KEY (id)`
- `deletion_requests_source_check`: `CHECK ((source = ANY (ARRAY['app'::text, 'web'::text])))`
- `deletion_requests_source_not_null`: `NOT NULL source`
- `deletion_requests_status_check`: `CHECK ((status = ANY (ARRAY['requested'::text, 'verified'::text, 'processing'::text, 'completed'::text, 'needs_review'::text])))`
- `deletion_requests_status_not_null`: `NOT NULL status`
- `deletion_requests_user_id_fkey`: `FOREIGN KEY (user_id) REFERENCES users(id)`

### `delivery_rules`

| الحقل | النوع | NOT NULL | الافتراضي/التوليد |
|---|---|---|---|
| `branch_id` | `uuid` | نعم | `—` |
| `base_yer` | `bigint` | نعم | `—` |
| `per_km_yer` | `bigint` | نعم | `—` |
| `rounding` | `text` | نعم | `'floor_km'::text` |
| `max_distance_m` | `integer` | لا | `—` |
| `version` | `integer` | نعم | `1` |

القيود:

- `delivery_rules_base_yer_check`: `CHECK ((base_yer >= 0))`
- `delivery_rules_base_yer_not_null`: `NOT NULL base_yer`
- `delivery_rules_branch_id_fkey`: `FOREIGN KEY (branch_id) REFERENCES branches(id)`
- `delivery_rules_branch_id_not_null`: `NOT NULL branch_id`
- `delivery_rules_max_distance_m_check`: `CHECK ((max_distance_m > 0))`
- `delivery_rules_per_km_yer_check`: `CHECK ((per_km_yer >= 0))`
- `delivery_rules_per_km_yer_not_null`: `NOT NULL per_km_yer`
- `delivery_rules_pkey`: `PRIMARY KEY (branch_id)`
- `delivery_rules_rounding_check`: `CHECK ((rounding = 'floor_km'::text))`
- `delivery_rules_rounding_not_null`: `NOT NULL rounding`
- `delivery_rules_version_check`: `CHECK ((version > 0))`
- `delivery_rules_version_not_null`: `NOT NULL version`

الحراس:

- `delivery_limit_configuration`: `CREATE TRIGGER delivery_limit_configuration BEFORE INSERT OR DELETE OR UPDATE ON public.delivery_rules FOR EACH ROW EXECUTE FUNCTION guard_coverage_activation()`

### `financial_exception_resolutions`

| الحقل | النوع | NOT NULL | الافتراضي/التوليد |
|---|---|---|---|
| `id` | `uuid` | نعم | `gen_random_uuid()` |
| `exception_id` | `uuid` | نعم | `—` |
| `direction` | `text` | نعم | `—` |
| `amount_yer` | `bigint` | نعم | `—` |
| `reason` | `text` | نعم | `—` |
| `reference` | `text` | نعم | `—` |
| `proof_media_id` | `uuid` | نعم | `—` |
| `actor_id` | `uuid` | نعم | `—` |
| `occurred_at` | `timestamp with time zone` | نعم | `—` |
| `created_at` | `timestamp with time zone` | نعم | `now()` |

القيود:

- `financial_exception_resolutions_actor_id_fkey`: `FOREIGN KEY (actor_id) REFERENCES users(id)`
- `financial_exception_resolutions_actor_id_not_null`: `NOT NULL actor_id`
- `financial_exception_resolutions_amount_yer_check`: `CHECK ((amount_yer >= 0))`
- `financial_exception_resolutions_amount_yer_not_null`: `NOT NULL amount_yer`
- `financial_exception_resolutions_created_at_not_null`: `NOT NULL created_at`
- `financial_exception_resolutions_direction_check`: `CHECK ((direction = ANY (ARRAY['refund_to_customer'::text, 'received_from_customer'::text, 'write_off'::text, 'other'::text])))`
- `financial_exception_resolutions_direction_not_null`: `NOT NULL direction`
- `financial_exception_resolutions_exception_id_fkey`: `FOREIGN KEY (exception_id) REFERENCES financial_exceptions(id)`
- `financial_exception_resolutions_exception_id_not_null`: `NOT NULL exception_id`
- `financial_exception_resolutions_id_not_null`: `NOT NULL id`
- `financial_exception_resolutions_occurred_at_not_null`: `NOT NULL occurred_at`
- `financial_exception_resolutions_pkey`: `PRIMARY KEY (id)`
- `financial_exception_resolutions_proof_media_id_fkey`: `FOREIGN KEY (proof_media_id) REFERENCES media_objects(id)`
- `financial_exception_resolutions_proof_media_id_not_null`: `NOT NULL proof_media_id`
- `financial_exception_resolutions_reason_check`: `CHECK ((length(btrim(reason)) > 0))`
- `financial_exception_resolutions_reason_not_null`: `NOT NULL reason`
- `financial_exception_resolutions_reference_check`: `CHECK ((length(btrim(reference)) > 0))`
- `financial_exception_resolutions_reference_not_null`: `NOT NULL reference`

الحراس:

- `immutable_financial_exception_resolutions`: `CREATE TRIGGER immutable_financial_exception_resolutions BEFORE DELETE OR UPDATE ON public.financial_exception_resolutions FOR EACH ROW EXECUTE FUNCTION reject_ledger_mutation()`
- `resolution_private_evidence`: `CREATE TRIGGER resolution_private_evidence BEFORE INSERT ON public.financial_exception_resolutions FOR EACH ROW EXECUTE FUNCTION guard_private_evidence()`

### `financial_exceptions`

| الحقل | النوع | NOT NULL | الافتراضي/التوليد |
|---|---|---|---|
| `id` | `uuid` | نعم | `gen_random_uuid()` |
| `order_id` | `uuid` | نعم | `—` |
| `kind` | `text` | نعم | `—` |
| `amount_yer` | `bigint` | نعم | `—` |
| `reason` | `text` | نعم | `—` |
| `status` | `text` | نعم | `'open'::text` |
| `opened_by` | `uuid` | نعم | `—` |
| `created_at` | `timestamp with time zone` | نعم | `now()` |

القيود:

- `financial_exceptions_amount_yer_check`: `CHECK ((amount_yer >= 0))`
- `financial_exceptions_amount_yer_not_null`: `NOT NULL amount_yer`
- `financial_exceptions_created_at_not_null`: `NOT NULL created_at`
- `financial_exceptions_id_not_null`: `NOT NULL id`
- `financial_exceptions_kind_check`: `CHECK ((kind = ANY (ARRAY['overpayment'::text, 'underpayment'::text, 'late_transfer'::text, 'stock_unavailable'::text, 'cash_shortfall'::text, 'cash_uncollected'::text, 'other'::text])))`
- `financial_exceptions_kind_not_null`: `NOT NULL kind`
- `financial_exceptions_opened_by_fkey`: `FOREIGN KEY (opened_by) REFERENCES users(id)`
- `financial_exceptions_opened_by_not_null`: `NOT NULL opened_by`
- `financial_exceptions_order_id_fkey`: `FOREIGN KEY (order_id) REFERENCES orders(id)`
- `financial_exceptions_order_id_not_null`: `NOT NULL order_id`
- `financial_exceptions_pkey`: `PRIMARY KEY (id)`
- `financial_exceptions_reason_check`: `CHECK ((length(btrim(reason)) > 0))`
- `financial_exceptions_reason_not_null`: `NOT NULL reason`
- `financial_exceptions_status_check`: `CHECK ((status = ANY (ARRAY['open'::text, 'resolved'::text])))`
- `financial_exceptions_status_not_null`: `NOT NULL status`

الحراس:

- `financial_exception_closure`: `CREATE TRIGGER financial_exception_closure BEFORE UPDATE ON public.financial_exceptions FOR EACH ROW EXECUTE FUNCTION guard_exception_closure()`
- `preserve_financial_exceptions`: `CREATE TRIGGER preserve_financial_exceptions BEFORE DELETE ON public.financial_exceptions FOR EACH ROW EXECUTE FUNCTION reject_ledger_mutation()`

### `governorates`

| الحقل | النوع | NOT NULL | الافتراضي/التوليد |
|---|---|---|---|
| `id` | `uuid` | نعم | `gen_random_uuid()` |
| `name_ar` | `text` | نعم | `—` |
| `active` | `boolean` | نعم | `true` |
| `sort_order` | `integer` | نعم | `0` |
| `created_at` | `timestamp with time zone` | نعم | `now()` |
| `catalog_branch_id` | `uuid` | لا | `—` |

القيود:

- `catalog_branch_in_governorate`: `FOREIGN KEY (catalog_branch_id, id) REFERENCES branches(id, governorate_id)`
- `governorates_active_not_null`: `NOT NULL active`
- `governorates_created_at_not_null`: `NOT NULL created_at`
- `governorates_id_not_null`: `NOT NULL id`
- `governorates_name_ar_key`: `UNIQUE (name_ar)`
- `governorates_name_ar_not_null`: `NOT NULL name_ar`
- `governorates_pkey`: `PRIMARY KEY (id)`
- `governorates_sort_order_not_null`: `NOT NULL sort_order`

### `idempotency_records`

| الحقل | النوع | NOT NULL | الافتراضي/التوليد |
|---|---|---|---|
| `actor_id` | `uuid` | نعم | `—` |
| `scope` | `text` | نعم | `—` |
| `key` | `text` | نعم | `—` |
| `request_hash` | `text` | نعم | `—` |
| `response_status` | `integer` | لا | `—` |
| `response_body` | `jsonb` | لا | `—` |
| `expires_at` | `timestamp with time zone` | نعم | `—` |

القيود:

- `idempotency_records_actor_id_fkey`: `FOREIGN KEY (actor_id) REFERENCES users(id)`
- `idempotency_records_actor_id_not_null`: `NOT NULL actor_id`
- `idempotency_records_expires_at_not_null`: `NOT NULL expires_at`
- `idempotency_records_key_not_null`: `NOT NULL key`
- `idempotency_records_pkey`: `PRIMARY KEY (actor_id, scope, key)`
- `idempotency_records_request_hash_not_null`: `NOT NULL request_hash`
- `idempotency_records_scope_not_null`: `NOT NULL scope`

### `media_objects`

| الحقل | النوع | NOT NULL | الافتراضي/التوليد |
|---|---|---|---|
| `id` | `uuid` | نعم | `gen_random_uuid()` |
| `owner_id` | `uuid` | لا | `—` |
| `object_key` | `text` | نعم | `—` |
| `visibility` | `text` | نعم | `—` |
| `purpose` | `text` | نعم | `—` |
| `mime_type` | `text` | نعم | `—` |
| `size_bytes` | `bigint` | نعم | `—` |
| `status` | `text` | نعم | `'pending'::text` |
| `sha256` | `text` | لا | `—` |
| `created_at` | `timestamp with time zone` | نعم | `now()` |

القيود:

- `media_objects_created_at_not_null`: `NOT NULL created_at`
- `media_objects_id_not_null`: `NOT NULL id`
- `media_objects_mime_type_not_null`: `NOT NULL mime_type`
- `media_objects_object_key_key`: `UNIQUE (object_key)`
- `media_objects_object_key_not_null`: `NOT NULL object_key`
- `media_objects_owner_id_fkey`: `FOREIGN KEY (owner_id) REFERENCES users(id)`
- `media_objects_pkey`: `PRIMARY KEY (id)`
- `media_objects_purpose_check`: `CHECK ((purpose = ANY (ARRAY['product'::text, 'category'::text, 'banner'::text, 'receipt'::text, 'complaint'::text, 'customer_flag'::text, 'report'::text])))`
- `media_objects_purpose_not_null`: `NOT NULL purpose`
- `media_objects_size_bytes_check`: `CHECK ((size_bytes > 0))`
- `media_objects_size_bytes_not_null`: `NOT NULL size_bytes`
- `media_objects_status_check`: `CHECK ((status = ANY (ARRAY['pending'::text, 'verified'::text, 'rejected'::text, 'deleted'::text])))`
- `media_objects_status_not_null`: `NOT NULL status`
- `media_objects_visibility_check`: `CHECK ((visibility = ANY (ARRAY['public'::text, 'private'::text])))`
- `media_objects_visibility_not_null`: `NOT NULL visibility`

### `notification_campaigns`

| الحقل | النوع | NOT NULL | الافتراضي/التوليد |
|---|---|---|---|
| `id` | `uuid` | نعم | `gen_random_uuid()` |
| `author_id` | `uuid` | نعم | `—` |
| `title_ar` | `text` | نعم | `—` |
| `body_ar` | `text` | نعم | `—` |
| `audience` | `jsonb` | نعم | `—` |
| `status` | `text` | نعم | `—` |
| `scheduled_at` | `timestamp with time zone` | لا | `—` |
| `created_at` | `timestamp with time zone` | نعم | `now()` |

القيود:

- `notification_campaigns_audience_not_null`: `NOT NULL audience`
- `notification_campaigns_author_id_fkey`: `FOREIGN KEY (author_id) REFERENCES users(id)`
- `notification_campaigns_author_id_not_null`: `NOT NULL author_id`
- `notification_campaigns_body_ar_not_null`: `NOT NULL body_ar`
- `notification_campaigns_created_at_not_null`: `NOT NULL created_at`
- `notification_campaigns_id_not_null`: `NOT NULL id`
- `notification_campaigns_pkey`: `PRIMARY KEY (id)`
- `notification_campaigns_status_check`: `CHECK ((status = ANY (ARRAY['draft'::text, 'scheduled'::text, 'sending'::text, 'sent'::text, 'cancelled'::text, 'failed'::text])))`
- `notification_campaigns_status_not_null`: `NOT NULL status`
- `notification_campaigns_title_ar_not_null`: `NOT NULL title_ar`

### `notification_deliveries`

| الحقل | النوع | NOT NULL | الافتراضي/التوليد |
|---|---|---|---|
| `id` | `uuid` | نعم | `gen_random_uuid()` |
| `notification_id` | `uuid` | نعم | `—` |
| `push_token_id` | `uuid` | نعم | `—` |
| `ticket_id` | `text` | لا | `—` |
| `status` | `text` | نعم | `—` |
| `attempts` | `integer` | نعم | `0` |
| `error_code` | `text` | لا | `—` |
| `next_attempt_at` | `timestamp with time zone` | لا | `—` |

القيود:

- `notification_deliveries_attempts_check`: `CHECK ((attempts >= 0))`
- `notification_deliveries_attempts_not_null`: `NOT NULL attempts`
- `notification_deliveries_id_not_null`: `NOT NULL id`
- `notification_deliveries_notification_id_fkey`: `FOREIGN KEY (notification_id) REFERENCES notification_inbox(id)`
- `notification_deliveries_notification_id_not_null`: `NOT NULL notification_id`
- `notification_deliveries_notification_id_push_token_id_key`: `UNIQUE (notification_id, push_token_id)`
- `notification_deliveries_pkey`: `PRIMARY KEY (id)`
- `notification_deliveries_push_token_id_fkey`: `FOREIGN KEY (push_token_id) REFERENCES push_tokens(id)`
- `notification_deliveries_push_token_id_not_null`: `NOT NULL push_token_id`
- `notification_deliveries_status_check`: `CHECK ((status = ANY (ARRAY['pending'::text, 'sent'::text, 'delivered'::text, 'failed'::text])))`
- `notification_deliveries_status_not_null`: `NOT NULL status`

### `notification_inbox`

| الحقل | النوع | NOT NULL | الافتراضي/التوليد |
|---|---|---|---|
| `id` | `uuid` | نعم | `gen_random_uuid()` |
| `user_id` | `uuid` | نعم | `—` |
| `app` | `text` | نعم | `—` |
| `title_ar` | `text` | نعم | `—` |
| `body_ar` | `text` | نعم | `—` |
| `data` | `jsonb` | نعم | `'{}'::jsonb` |
| `event_key` | `text` | نعم | `—` |
| `read_at` | `timestamp with time zone` | لا | `—` |
| `created_at` | `timestamp with time zone` | نعم | `now()` |

القيود:

- `notification_inbox_app_check`: `CHECK ((app = ANY (ARRAY['customer'::text, 'admin'::text, 'courier'::text])))`
- `notification_inbox_app_not_null`: `NOT NULL app`
- `notification_inbox_body_ar_not_null`: `NOT NULL body_ar`
- `notification_inbox_created_at_not_null`: `NOT NULL created_at`
- `notification_inbox_data_not_null`: `NOT NULL data`
- `notification_inbox_event_key_not_null`: `NOT NULL event_key`
- `notification_inbox_id_not_null`: `NOT NULL id`
- `notification_inbox_pkey`: `PRIMARY KEY (id)`
- `notification_inbox_title_ar_not_null`: `NOT NULL title_ar`
- `notification_inbox_user_id_app_event_key_key`: `UNIQUE (user_id, app, event_key)`
- `notification_inbox_user_id_fkey`: `FOREIGN KEY (user_id) REFERENCES users(id)`
- `notification_inbox_user_id_not_null`: `NOT NULL user_id`

### `order_assignments`

| الحقل | النوع | NOT NULL | الافتراضي/التوليد |
|---|---|---|---|
| `id` | `uuid` | نعم | `gen_random_uuid()` |
| `order_id` | `uuid` | نعم | `—` |
| `courier_id` | `uuid` | نعم | `—` |
| `assigned_by` | `uuid` | نعم | `—` |
| `commission_bps` | `integer` | نعم | `—` |
| `delivery_fee_before_discount_yer` | `bigint` | نعم | `—` |
| `delivery_discount_yer` | `bigint` | نعم | `—` |
| `customer_delivery_yer` | `bigint` | لا | `GENERATED ALWAYS AS ((delivery_fee_before_discount_yer - delivery_discount_yer)) STORED` |
| `commission_yer` | `bigint` | نعم | `—` |
| `assigned_at` | `timestamp with time zone` | نعم | `now()` |
| `ended_at` | `timestamp with time zone` | لا | `—` |

القيود:

- `order_assignments_assigned_at_not_null`: `NOT NULL assigned_at`
- `order_assignments_assigned_by_fkey`: `FOREIGN KEY (assigned_by) REFERENCES users(id)`
- `order_assignments_assigned_by_not_null`: `NOT NULL assigned_by`
- `order_assignments_check`: `CHECK (((delivery_discount_yer >= 0) AND (delivery_discount_yer <= delivery_fee_before_discount_yer)))`
- `order_assignments_check1`: `CHECK ((commission_yer = (round((((delivery_fee_before_discount_yer)::numeric * (commission_bps)::numeric) / (10000)::numeric)))::bigint))`
- `order_assignments_commission_bps_check`: `CHECK (((commission_bps >= 0) AND (commission_bps <= 10000)))`
- `order_assignments_commission_bps_not_null`: `NOT NULL commission_bps`
- `order_assignments_commission_yer_check`: `CHECK ((commission_yer >= 0))`
- `order_assignments_commission_yer_not_null`: `NOT NULL commission_yer`
- `order_assignments_courier_id_fkey`: `FOREIGN KEY (courier_id) REFERENCES courier_profiles(user_id)`
- `order_assignments_courier_id_not_null`: `NOT NULL courier_id`
- `order_assignments_delivery_discount_yer_not_null`: `NOT NULL delivery_discount_yer`
- `order_assignments_delivery_fee_before_discount_yer_check`: `CHECK ((delivery_fee_before_discount_yer >= 0))`
- `order_assignments_delivery_fee_before_discount_yer_not_null`: `NOT NULL delivery_fee_before_discount_yer`
- `order_assignments_id_not_null`: `NOT NULL id`
- `order_assignments_id_order_id_courier_id_key`: `UNIQUE (id, order_id, courier_id)`
- `order_assignments_order_id_fkey`: `FOREIGN KEY (order_id) REFERENCES orders(id)`
- `order_assignments_order_id_not_null`: `NOT NULL order_id`
- `order_assignments_pkey`: `PRIMARY KEY (id)`

الحراس:

- `dispatch_facts`: `CREATE TRIGGER dispatch_facts BEFORE INSERT OR UPDATE ON public.order_assignments FOR EACH ROW EXECUTE FUNCTION guard_dispatch()`
- `preserve_assignments`: `CREATE TRIGGER preserve_assignments BEFORE DELETE ON public.order_assignments FOR EACH ROW EXECUTE FUNCTION reject_ledger_mutation()`

### `order_cancellation_requests`

| الحقل | النوع | NOT NULL | الافتراضي/التوليد |
|---|---|---|---|
| `id` | `uuid` | نعم | `gen_random_uuid()` |
| `order_id` | `uuid` | نعم | `—` |
| `requested_by` | `uuid` | نعم | `—` |
| `reason` | `text` | نعم | `—` |
| `status` | `text` | نعم | `'requested'::text` |
| `reviewed_by` | `uuid` | لا | `—` |
| `review_note` | `text` | لا | `—` |
| `reviewed_at` | `timestamp with time zone` | لا | `—` |
| `created_at` | `timestamp with time zone` | نعم | `now()` |

القيود:

- `order_cancellation_requests_check`: `CHECK (((status = 'requested'::text) OR ((reviewed_by IS NOT NULL) AND (reviewed_at IS NOT NULL) AND (review_note IS NOT NULL))))`
- `order_cancellation_requests_created_at_not_null`: `NOT NULL created_at`
- `order_cancellation_requests_id_not_null`: `NOT NULL id`
- `order_cancellation_requests_order_id_fkey`: `FOREIGN KEY (order_id) REFERENCES orders(id)`
- `order_cancellation_requests_order_id_not_null`: `NOT NULL order_id`
- `order_cancellation_requests_pkey`: `PRIMARY KEY (id)`
- `order_cancellation_requests_reason_not_null`: `NOT NULL reason`
- `order_cancellation_requests_requested_by_fkey`: `FOREIGN KEY (requested_by) REFERENCES users(id)`
- `order_cancellation_requests_requested_by_not_null`: `NOT NULL requested_by`
- `order_cancellation_requests_reviewed_by_fkey`: `FOREIGN KEY (reviewed_by) REFERENCES users(id)`
- `order_cancellation_requests_status_check`: `CHECK ((status = ANY (ARRAY['requested'::text, 'approved'::text, 'denied'::text])))`
- `order_cancellation_requests_status_not_null`: `NOT NULL status`

### `order_events`

| الحقل | النوع | NOT NULL | الافتراضي/التوليد |
|---|---|---|---|
| `id` | `uuid` | نعم | `gen_random_uuid()` |
| `order_id` | `uuid` | نعم | `—` |
| `actor_id` | `uuid` | لا | `—` |
| `event_type` | `text` | نعم | `—` |
| `details` | `jsonb` | نعم | `'{}'::jsonb` |
| `created_at` | `timestamp with time zone` | نعم | `now()` |

القيود:

- `order_events_actor_id_fkey`: `FOREIGN KEY (actor_id) REFERENCES users(id)`
- `order_events_created_at_not_null`: `NOT NULL created_at`
- `order_events_details_not_null`: `NOT NULL details`
- `order_events_event_type_not_null`: `NOT NULL event_type`
- `order_events_id_not_null`: `NOT NULL id`
- `order_events_order_id_fkey`: `FOREIGN KEY (order_id) REFERENCES orders(id)`
- `order_events_order_id_not_null`: `NOT NULL order_id`
- `order_events_pkey`: `PRIMARY KEY (id)`

الحراس:

- `immutable_order_events`: `CREATE TRIGGER immutable_order_events BEFORE DELETE OR UPDATE ON public.order_events FOR EACH ROW EXECUTE FUNCTION reject_ledger_mutation()`

### `order_private_details`

| الحقل | النوع | NOT NULL | الافتراضي/التوليد |
|---|---|---|---|
| `id` | `uuid` | نعم | `gen_random_uuid()` |
| `order_id` | `uuid` | نعم | `—` |
| `revision` | `integer` | نعم | `—` |
| `address_snapshot` | `jsonb` | نعم | `—` |
| `contact_snapshot` | `jsonb` | نعم | `'{}'::jsonb` |
| `redacted_at` | `timestamp with time zone` | لا | `—` |
| `redacted_by` | `uuid` | لا | `—` |
| `redaction_reason` | `text` | لا | `—` |

القيود:

- `order_private_details_address_snapshot_not_null`: `NOT NULL address_snapshot`
- `order_private_details_check`: `CHECK ((((redacted_at IS NULL) AND (redacted_by IS NULL) AND (redaction_reason IS NULL)) OR ((redacted_at IS NOT NULL) AND (redacted_by IS NOT NULL) AND (length(btrim(redaction_reason)) > 0) AND (redaction_reason IS NOT NULL) AND (address_snapshot = '{}'::jsonb) AND (contact_snapshot = '{}'::jsonb))))`
- `order_private_details_contact_snapshot_not_null`: `NOT NULL contact_snapshot`
- `order_private_details_id_not_null`: `NOT NULL id`
- `order_private_details_id_order_id_key`: `UNIQUE (id, order_id)`
- `order_private_details_order_id_fkey`: `FOREIGN KEY (order_id) REFERENCES orders(id)`
- `order_private_details_order_id_not_null`: `NOT NULL order_id`
- `order_private_details_order_id_revision_key`: `UNIQUE (order_id, revision)`
- `order_private_details_pkey`: `PRIMARY KEY (id)`
- `order_private_details_redacted_by_fkey`: `FOREIGN KEY (redacted_by) REFERENCES users(id)`
- `order_private_details_revision_check`: `CHECK ((revision > 0))`
- `order_private_details_revision_not_null`: `NOT NULL revision`

الحراس:

- `preserve_private_snapshots`: `CREATE TRIGGER preserve_private_snapshots BEFORE DELETE ON public.order_private_details FOR EACH ROW EXECUTE FUNCTION reject_ledger_mutation()`
- `private_snapshot_redaction`: `CREATE TRIGGER private_snapshot_redaction BEFORE UPDATE ON public.order_private_details FOR EACH ROW EXECUTE FUNCTION guard_private_redaction()`

### `order_quotes`

| الحقل | النوع | NOT NULL | الافتراضي/التوليد |
|---|---|---|---|
| `id` | `uuid` | نعم | `gen_random_uuid()` |
| `order_id` | `uuid` | نعم | `—` |
| `branch_id` | `uuid` | نعم | `—` |
| `private_details_id` | `uuid` | نعم | `—` |
| `revision` | `integer` | نعم | `—` |
| `status` | `text` | نعم | `'draft'::text` |
| `subtotal_yer` | `bigint` | نعم | `—` |
| `product_discount_yer` | `bigint` | نعم | `0` |
| `delivery_yer` | `bigint` | نعم | `—` |
| `delivery_discount_yer` | `bigint` | نعم | `0` |
| `total_yer` | `bigint` | نعم | `—` |
| `pricing_mode` | `text` | نعم | `'road'::text` |
| `distance_m` | `integer` | لا | `—` |
| `billed_km` | `integer` | لا | `GENERATED ALWAYS AS ((distance_m / 1000)) STORED` |
| `base_yer` | `bigint` | نعم | `—` |
| `per_km_yer` | `bigint` | نعم | `—` |
| `rounding` | `text` | نعم | `'floor_km'::text` |
| `routing_source` | `text` | نعم | `—` |
| `delivery_rule_snapshot` | `jsonb` | نعم | `—` |
| `promotion_id` | `uuid` | لا | `—` |
| `promotion_snapshot` | `jsonb` | لا | `—` |
| `author_id` | `uuid` | لا | `—` |
| `accepted_by` | `uuid` | لا | `—` |
| `accepted_at` | `timestamp with time zone` | لا | `—` |
| `expires_at` | `timestamp with time zone` | نعم | `—` |
| `reason` | `text` | لا | `—` |
| `created_at` | `timestamp with time zone` | نعم | `now()` |

القيود:

- `order_quotes_accepted_by_fkey`: `FOREIGN KEY (accepted_by) REFERENCES users(id)`
- `order_quotes_author_id_fkey`: `FOREIGN KEY (author_id) REFERENCES users(id)`
- `order_quotes_base_yer_check`: `CHECK ((base_yer >= 0))`
- `order_quotes_base_yer_not_null`: `NOT NULL base_yer`
- `order_quotes_branch_id_fkey`: `FOREIGN KEY (branch_id) REFERENCES branches(id)`
- `order_quotes_branch_id_not_null`: `NOT NULL branch_id`
- `order_quotes_check`: `CHECK (((product_discount_yer >= 0) AND (product_discount_yer <= subtotal_yer)))`
- `order_quotes_check1`: `CHECK (((delivery_discount_yer >= 0) AND (delivery_discount_yer <= delivery_yer)))`
- `order_quotes_check2`: `CHECK ((total_yer = (((subtotal_yer - product_discount_yer) + delivery_yer) - delivery_discount_yer)))`
- `order_quotes_check3`: `CHECK (((status <> 'accepted'::text) OR ((accepted_at IS NOT NULL) AND (accepted_by IS NOT NULL))))`
- `order_quotes_check4`: `CHECK (((accepted_at IS NULL) = (accepted_by IS NULL)))`
- `order_quotes_check5`: `CHECK ((((pricing_mode = 'road'::text) AND (distance_m IS NOT NULL) AND (delivery_yer = (base_yer + ((billed_km)::bigint * per_km_yer)))) OR ((pricing_mode = 'manual'::text) AND (length(btrim(reason)) > 0) AND (reason IS NOT NULL))))`
- `order_quotes_check6`: `CHECK ((NOT ((product_discount_yer > 0) AND (delivery_discount_yer > 0))))`
- `order_quotes_check7`: `CHECK ((((promotion_id IS NULL) AND (promotion_snapshot IS NULL) AND (product_discount_yer = 0) AND (delivery_discount_yer = 0)) OR ((promotion_id IS NOT NULL) AND (jsonb_typeof(promotion_snapshot) = 'object'::text) AND (promotion_snapshot IS NOT NULL))))`
- `order_quotes_created_at_not_null`: `NOT NULL created_at`
- `order_quotes_delivery_discount_yer_not_null`: `NOT NULL delivery_discount_yer`
- `order_quotes_delivery_rule_snapshot_not_null`: `NOT NULL delivery_rule_snapshot`
- `order_quotes_delivery_yer_check`: `CHECK ((delivery_yer >= 0))`
- `order_quotes_delivery_yer_not_null`: `NOT NULL delivery_yer`
- `order_quotes_distance_m_check`: `CHECK ((distance_m >= 0))`
- `order_quotes_expires_at_not_null`: `NOT NULL expires_at`
- `order_quotes_id_not_null`: `NOT NULL id`
- `order_quotes_id_order_id_branch_id_key`: `UNIQUE (id, order_id, branch_id)`
- `order_quotes_id_order_id_key`: `UNIQUE (id, order_id)`
- `order_quotes_order_id_fkey`: `FOREIGN KEY (order_id) REFERENCES orders(id)`
- `order_quotes_order_id_not_null`: `NOT NULL order_id`
- `order_quotes_order_id_revision_key`: `UNIQUE (order_id, revision)`
- `order_quotes_per_km_yer_check`: `CHECK ((per_km_yer >= 0))`
- `order_quotes_per_km_yer_not_null`: `NOT NULL per_km_yer`
- `order_quotes_pkey`: `PRIMARY KEY (id)`
- `order_quotes_pricing_mode_check`: `CHECK ((pricing_mode = ANY (ARRAY['road'::text, 'manual'::text])))`
- `order_quotes_pricing_mode_not_null`: `NOT NULL pricing_mode`
- `order_quotes_private_details_id_not_null`: `NOT NULL private_details_id`
- `order_quotes_private_details_id_order_id_fkey`: `FOREIGN KEY (private_details_id, order_id) REFERENCES order_private_details(id, order_id)`
- `order_quotes_product_discount_yer_not_null`: `NOT NULL product_discount_yer`
- `order_quotes_promotion_id_fkey`: `FOREIGN KEY (promotion_id) REFERENCES promotions(id)`
- `order_quotes_revision_check`: `CHECK ((revision > 0))`
- `order_quotes_revision_not_null`: `NOT NULL revision`
- `order_quotes_rounding_check`: `CHECK ((rounding = 'floor_km'::text))`
- `order_quotes_rounding_not_null`: `NOT NULL rounding`
- `order_quotes_routing_source_not_null`: `NOT NULL routing_source`
- `order_quotes_status_check`: `CHECK ((status = ANY (ARRAY['draft'::text, 'sent'::text, 'accepted'::text, 'declined'::text, 'superseded'::text, 'expired'::text])))`
- `order_quotes_status_not_null`: `NOT NULL status`
- `order_quotes_subtotal_yer_check`: `CHECK ((subtotal_yer >= 0))`
- `order_quotes_subtotal_yer_not_null`: `NOT NULL subtotal_yer`
- `order_quotes_total_yer_check`: `CHECK ((total_yer >= 0))`
- `order_quotes_total_yer_not_null`: `NOT NULL total_yer`

الحراس:

- `quote_history`: `CREATE TRIGGER quote_history BEFORE INSERT OR DELETE OR UPDATE ON public.order_quotes FOR EACH ROW EXECUTE FUNCTION guard_quote_history()`

### `order_request_items`

| الحقل | النوع | NOT NULL | الافتراضي/التوليد |
|---|---|---|---|
| `id` | `uuid` | نعم | `gen_random_uuid()` |
| `order_id` | `uuid` | نعم | `—` |
| `product_id` | `uuid` | نعم | `—` |
| `unit_id` | `uuid` | نعم | `—` |
| `quantity` | `integer` | نعم | `—` |

القيود:

- `order_request_items_id_not_null`: `NOT NULL id`
- `order_request_items_order_id_fkey`: `FOREIGN KEY (order_id) REFERENCES orders(id)`
- `order_request_items_order_id_not_null`: `NOT NULL order_id`
- `order_request_items_pkey`: `PRIMARY KEY (id)`
- `order_request_items_product_id_fkey`: `FOREIGN KEY (product_id) REFERENCES products(id)`
- `order_request_items_product_id_not_null`: `NOT NULL product_id`
- `order_request_items_quantity_check`: `CHECK ((quantity > 0))`
- `order_request_items_quantity_not_null`: `NOT NULL quantity`
- `order_request_items_unit_id_not_null`: `NOT NULL unit_id`
- `order_request_items_unit_id_product_id_fkey`: `FOREIGN KEY (unit_id, product_id) REFERENCES product_units(id, product_id)`

### `order_reviews`

| الحقل | النوع | NOT NULL | الافتراضي/التوليد |
|---|---|---|---|
| `order_id` | `uuid` | نعم | `—` |
| `customer_id` | `uuid` | نعم | `—` |
| `rating` | `smallint` | نعم | `—` |
| `comment_ar` | `text` | لا | `—` |
| `created_at` | `timestamp with time zone` | نعم | `now()` |

القيود:

- `order_reviews_created_at_not_null`: `NOT NULL created_at`
- `order_reviews_customer_id_fkey`: `FOREIGN KEY (customer_id) REFERENCES users(id)`
- `order_reviews_customer_id_not_null`: `NOT NULL customer_id`
- `order_reviews_order_id_fkey`: `FOREIGN KEY (order_id) REFERENCES orders(id)`
- `order_reviews_order_id_not_null`: `NOT NULL order_id`
- `order_reviews_pkey`: `PRIMARY KEY (order_id)`
- `order_reviews_rating_check`: `CHECK (((rating >= 1) AND (rating <= 5)))`
- `order_reviews_rating_not_null`: `NOT NULL rating`

### `orders`

| الحقل | النوع | NOT NULL | الافتراضي/التوليد |
|---|---|---|---|
| `id` | `uuid` | نعم | `gen_random_uuid()` |
| `order_number` | `bigint` | نعم | `GENERATED ALWAYS AS IDENTITY` |
| `customer_id` | `uuid` | نعم | `—` |
| `governorate_id` | `uuid` | نعم | `—` |
| `catalog_branch_id` | `uuid` | نعم | `—` |
| `branch_id` | `uuid` | لا | `—` |
| `branch_selected_by` | `uuid` | لا | `—` |
| `branch_selected_at` | `timestamp with time zone` | لا | `—` |
| `kind` | `text` | نعم | `—` |
| `payment_kind` | `text` | لا | `—` |
| `status` | `text` | نعم | `'pending_review'::text` |
| `review_stage` | `text` | نعم | `'awaiting_branch'::text` |
| `current_quote_id` | `uuid` | لا | `—` |
| `version` | `integer` | نعم | `1` |
| `confirmed_at` | `timestamp with time zone` | لا | `—` |
| `delivered_at` | `timestamp with time zone` | لا | `—` |
| `closed_reason` | `text` | لا | `—` |
| `created_at` | `timestamp with time zone` | نعم | `now()` |

القيود:

- `current_quote_belongs_to_order`: `FOREIGN KEY (current_quote_id, id) REFERENCES order_quotes(id, order_id) DEFERRABLE INITIALLY DEFERRED`
- `orders_branch_id_fkey`: `FOREIGN KEY (branch_id) REFERENCES branches(id)`
- `orders_branch_selected_by_fkey`: `FOREIGN KEY (branch_selected_by) REFERENCES users(id)`
- `orders_catalog_branch_id_fkey`: `FOREIGN KEY (catalog_branch_id) REFERENCES branches(id)`
- `orders_catalog_branch_id_governorate_id_fkey`: `FOREIGN KEY (catalog_branch_id, governorate_id) REFERENCES branches(id, governorate_id)`
- `orders_catalog_branch_id_not_null`: `NOT NULL catalog_branch_id`
- `orders_check`: `CHECK ((((branch_id IS NULL) AND (branch_selected_by IS NULL) AND (branch_selected_at IS NULL)) OR ((branch_id IS NOT NULL) AND (branch_selected_by IS NOT NULL) AND (branch_selected_at IS NOT NULL))))`
- `orders_created_at_not_null`: `NOT NULL created_at`
- `orders_customer_id_fkey`: `FOREIGN KEY (customer_id) REFERENCES users(id)`
- `orders_customer_id_not_null`: `NOT NULL customer_id`
- `orders_governorate_id_fkey`: `FOREIGN KEY (governorate_id) REFERENCES governorates(id)`
- `orders_governorate_id_not_null`: `NOT NULL governorate_id`
- `orders_id_not_null`: `NOT NULL id`
- `orders_kind_check`: `CHECK ((kind = ANY (ARRAY['retail'::text, 'wholesale'::text])))`
- `orders_kind_not_null`: `NOT NULL kind`
- `orders_order_number_key`: `UNIQUE (order_number)`
- `orders_order_number_not_null`: `NOT NULL order_number`
- `orders_payment_kind_check`: `CHECK ((payment_kind = ANY (ARRAY['transfer'::text, 'cash_on_delivery'::text])))`
- `orders_pkey`: `PRIMARY KEY (id)`
- `orders_review_stage_check`: `CHECK ((review_stage = ANY (ARRAY['awaiting_branch'::text, 'awaiting_quote'::text, 'awaiting_customer'::text, 'awaiting_transfer'::text, 'checking_receipt'::text, 'ready_to_confirm'::text, 'closed'::text])))`
- `orders_review_stage_not_null`: `NOT NULL review_stage`
- `orders_status_check`: `CHECK ((status = ANY (ARRAY['pending_review'::text, 'confirmed'::text, 'on_the_way'::text, 'delivered'::text, 'rejected'::text, 'cancelled'::text])))`
- `orders_status_not_null`: `NOT NULL status`
- `orders_version_check`: `CHECK ((version > 0))`
- `orders_version_not_null`: `NOT NULL version`

الحراس:

- `order_state_guard`: `CREATE TRIGGER order_state_guard BEFORE INSERT OR UPDATE ON public.orders FOR EACH ROW EXECUTE FUNCTION guard_order_state()`

### `otp_challenges`

| الحقل | النوع | NOT NULL | الافتراضي/التوليد |
|---|---|---|---|
| `id` | `uuid` | نعم | `gen_random_uuid()` |
| `phone_e164` | `text` | نعم | `—` |
| `purpose` | `text` | نعم | `—` |
| `app` | `text` | نعم | `—` |
| `code_hmac` | `text` | نعم | `—` |
| `preauth_digest` | `text` | نعم | `—` |
| `pending_payload_encrypted` | `text` | لا | `—` |
| `attempts` | `integer` | نعم | `0` |
| `expires_at` | `timestamp with time zone` | نعم | `—` |
| `consumed_at` | `timestamp with time zone` | لا | `—` |
| `resend_after` | `timestamp with time zone` | نعم | `—` |
| `created_at` | `timestamp with time zone` | نعم | `now()` |

القيود:

- `otp_challenges_app_check`: `CHECK ((app = ANY (ARRAY['customer'::text, 'admin'::text, 'courier'::text, 'web'::text])))`
- `otp_challenges_app_not_null`: `NOT NULL app`
- `otp_challenges_attempts_check`: `CHECK (((attempts >= 0) AND (attempts <= 5)))`
- `otp_challenges_attempts_not_null`: `NOT NULL attempts`
- `otp_challenges_code_hmac_not_null`: `NOT NULL code_hmac`
- `otp_challenges_created_at_not_null`: `NOT NULL created_at`
- `otp_challenges_expires_at_not_null`: `NOT NULL expires_at`
- `otp_challenges_id_not_null`: `NOT NULL id`
- `otp_challenges_phone_e164_not_null`: `NOT NULL phone_e164`
- `otp_challenges_pkey`: `PRIMARY KEY (id)`
- `otp_challenges_preauth_digest_not_null`: `NOT NULL preauth_digest`
- `otp_challenges_purpose_check`: `CHECK ((purpose = ANY (ARRAY['register'::text, 'login'::text, 'reset_password'::text, 'delete_account'::text, 'invite'::text])))`
- `otp_challenges_purpose_not_null`: `NOT NULL purpose`
- `otp_challenges_resend_after_not_null`: `NOT NULL resend_after`

### `outbox_events`

| الحقل | النوع | NOT NULL | الافتراضي/التوليد |
|---|---|---|---|
| `id` | `uuid` | نعم | `gen_random_uuid()` |
| `event_type` | `text` | نعم | `—` |
| `aggregate_id` | `uuid` | لا | `—` |
| `dedupe_key` | `text` | نعم | `—` |
| `payload` | `jsonb` | نعم | `—` |
| `state` | `text` | نعم | `'pending'::text` |
| `attempts` | `integer` | نعم | `0` |
| `available_at` | `timestamp with time zone` | نعم | `now()` |
| `locked_at` | `timestamp with time zone` | لا | `—` |
| `created_at` | `timestamp with time zone` | نعم | `now()` |

القيود:

- `outbox_events_attempts_check`: `CHECK ((attempts >= 0))`
- `outbox_events_attempts_not_null`: `NOT NULL attempts`
- `outbox_events_available_at_not_null`: `NOT NULL available_at`
- `outbox_events_created_at_not_null`: `NOT NULL created_at`
- `outbox_events_dedupe_key_key`: `UNIQUE (dedupe_key)`
- `outbox_events_dedupe_key_not_null`: `NOT NULL dedupe_key`
- `outbox_events_event_type_not_null`: `NOT NULL event_type`
- `outbox_events_id_not_null`: `NOT NULL id`
- `outbox_events_payload_not_null`: `NOT NULL payload`
- `outbox_events_pkey`: `PRIMARY KEY (id)`
- `outbox_events_state_check`: `CHECK ((state = ANY (ARRAY['pending'::text, 'processing'::text, 'done'::text, 'dead'::text])))`
- `outbox_events_state_not_null`: `NOT NULL state`

### `payment_instructions`

| الحقل | النوع | NOT NULL | الافتراضي/التوليد |
|---|---|---|---|
| `id` | `uuid` | نعم | `gen_random_uuid()` |
| `order_id` | `uuid` | نعم | `—` |
| `quote_id` | `uuid` | نعم | `—` |
| `method_id` | `uuid` | نعم | `—` |
| `revision` | `integer` | نعم | `—` |
| `method_snapshot` | `jsonb` | نعم | `—` |
| `expected_amount_yer` | `bigint` | نعم | `—` |
| `created_at` | `timestamp with time zone` | نعم | `now()` |

القيود:

- `payment_instructions_created_at_not_null`: `NOT NULL created_at`
- `payment_instructions_expected_amount_yer_check`: `CHECK ((expected_amount_yer > 0))`
- `payment_instructions_expected_amount_yer_not_null`: `NOT NULL expected_amount_yer`
- `payment_instructions_id_not_null`: `NOT NULL id`
- `payment_instructions_id_order_id_quote_id_method_id_key`: `UNIQUE (id, order_id, quote_id, method_id)`
- `payment_instructions_method_id_fkey`: `FOREIGN KEY (method_id) REFERENCES payment_methods(id)`
- `payment_instructions_method_id_not_null`: `NOT NULL method_id`
- `payment_instructions_method_snapshot_check`: `CHECK (((jsonb_typeof(method_snapshot) = 'object'::text) AND (method_snapshot ?& ARRAY['name_ar'::text, 'beneficiary'::text, 'destination_number'::text])))`
- `payment_instructions_method_snapshot_not_null`: `NOT NULL method_snapshot`
- `payment_instructions_order_id_fkey`: `FOREIGN KEY (order_id) REFERENCES orders(id)`
- `payment_instructions_order_id_not_null`: `NOT NULL order_id`
- `payment_instructions_order_id_revision_key`: `UNIQUE (order_id, revision)`
- `payment_instructions_pkey`: `PRIMARY KEY (id)`
- `payment_instructions_quote_id_not_null`: `NOT NULL quote_id`
- `payment_instructions_quote_id_order_id_fkey`: `FOREIGN KEY (quote_id, order_id) REFERENCES order_quotes(id, order_id)`
- `payment_instructions_revision_check`: `CHECK ((revision > 0))`
- `payment_instructions_revision_not_null`: `NOT NULL revision`

الحراس:

- `immutable_payment_instructions`: `CREATE TRIGGER immutable_payment_instructions BEFORE DELETE OR UPDATE ON public.payment_instructions FOR EACH ROW EXECUTE FUNCTION reject_ledger_mutation()`
- `issue_payment_instructions`: `CREATE TRIGGER issue_payment_instructions BEFORE INSERT ON public.payment_instructions FOR EACH ROW EXECUTE FUNCTION guard_instruction_issue()`

### `payment_methods`

| الحقل | النوع | NOT NULL | الافتراضي/التوليد |
|---|---|---|---|
| `id` | `uuid` | نعم | `gen_random_uuid()` |
| `branch_id` | `uuid` | لا | `—` |
| `name_ar` | `text` | نعم | `—` |
| `beneficiary` | `text` | نعم | `—` |
| `destination_number` | `text` | نعم | `—` |
| `instructions_ar` | `text` | لا | `—` |
| `active` | `boolean` | نعم | `true` |
| `sort_order` | `integer` | نعم | `0` |
| `created_at` | `timestamp with time zone` | نعم | `now()` |

القيود:

- `payment_methods_active_not_null`: `NOT NULL active`
- `payment_methods_beneficiary_not_null`: `NOT NULL beneficiary`
- `payment_methods_branch_id_fkey`: `FOREIGN KEY (branch_id) REFERENCES branches(id)`
- `payment_methods_created_at_not_null`: `NOT NULL created_at`
- `payment_methods_destination_number_not_null`: `NOT NULL destination_number`
- `payment_methods_id_not_null`: `NOT NULL id`
- `payment_methods_name_ar_not_null`: `NOT NULL name_ar`
- `payment_methods_pkey`: `PRIMARY KEY (id)`
- `payment_methods_sort_order_not_null`: `NOT NULL sort_order`

### `payment_receipt_attempts`

| الحقل | النوع | NOT NULL | الافتراضي/التوليد |
|---|---|---|---|
| `id` | `uuid` | نعم | `gen_random_uuid()` |
| `payment_id` | `uuid` | نعم | `—` |
| `attempt_number` | `integer` | نعم | `—` |
| `media_id` | `uuid` | نعم | `—` |
| `submitted_by` | `uuid` | نعم | `—` |
| `submitted_at` | `timestamp with time zone` | نعم | `now()` |

القيود:

- `payment_receipt_attempts_attempt_number_check`: `CHECK ((attempt_number > 0))`
- `payment_receipt_attempts_attempt_number_not_null`: `NOT NULL attempt_number`
- `payment_receipt_attempts_id_not_null`: `NOT NULL id`
- `payment_receipt_attempts_id_payment_id_key`: `UNIQUE (id, payment_id)`
- `payment_receipt_attempts_media_id_fkey`: `FOREIGN KEY (media_id) REFERENCES media_objects(id)`
- `payment_receipt_attempts_media_id_not_null`: `NOT NULL media_id`
- `payment_receipt_attempts_payment_id_attempt_number_key`: `UNIQUE (payment_id, attempt_number)`
- `payment_receipt_attempts_payment_id_fkey`: `FOREIGN KEY (payment_id) REFERENCES payments(id)`
- `payment_receipt_attempts_payment_id_not_null`: `NOT NULL payment_id`
- `payment_receipt_attempts_pkey`: `PRIMARY KEY (id)`
- `payment_receipt_attempts_submitted_at_not_null`: `NOT NULL submitted_at`
- `payment_receipt_attempts_submitted_by_fkey`: `FOREIGN KEY (submitted_by) REFERENCES users(id)`
- `payment_receipt_attempts_submitted_by_not_null`: `NOT NULL submitted_by`

الحراس:

- `immutable_payment_receipt_attempts`: `CREATE TRIGGER immutable_payment_receipt_attempts BEFORE DELETE OR UPDATE ON public.payment_receipt_attempts FOR EACH ROW EXECUTE FUNCTION reject_ledger_mutation()`
- `receipt_attempt_guard`: `CREATE TRIGGER receipt_attempt_guard BEFORE INSERT ON public.payment_receipt_attempts FOR EACH ROW EXECUTE FUNCTION guard_receipt_attempt()`
- `receipt_protects_stock`: `CREATE TRIGGER receipt_protects_stock AFTER INSERT ON public.payment_receipt_attempts FOR EACH ROW EXECUTE FUNCTION protect_reported_transfer()`

### `payment_receipt_reviews`

| الحقل | النوع | NOT NULL | الافتراضي/التوليد |
|---|---|---|---|
| `id` | `uuid` | نعم | `gen_random_uuid()` |
| `payment_id` | `uuid` | نعم | `—` |
| `attempt_id` | `uuid` | نعم | `—` |
| `reviewer_id` | `uuid` | نعم | `—` |
| `outcome` | `text` | نعم | `—` |
| `verified_amount_yer` | `bigint` | لا | `—` |
| `note` | `text` | نعم | `—` |
| `created_at` | `timestamp with time zone` | نعم | `now()` |

القيود:

- `payment_receipt_reviews_attempt_id_key`: `UNIQUE (attempt_id)`
- `payment_receipt_reviews_attempt_id_not_null`: `NOT NULL attempt_id`
- `payment_receipt_reviews_attempt_id_payment_id_fkey`: `FOREIGN KEY (attempt_id, payment_id) REFERENCES payment_receipt_attempts(id, payment_id)`
- `payment_receipt_reviews_check`: `CHECK (((outcome = 'transfer_verified'::text) = (verified_amount_yer IS NOT NULL)))`
- `payment_receipt_reviews_created_at_not_null`: `NOT NULL created_at`
- `payment_receipt_reviews_id_not_null`: `NOT NULL id`
- `payment_receipt_reviews_note_check`: `CHECK ((length(btrim(note)) > 0))`
- `payment_receipt_reviews_note_not_null`: `NOT NULL note`
- `payment_receipt_reviews_outcome_check`: `CHECK ((outcome = ANY (ARRAY['image_rejected'::text, 'transfer_verified'::text, 'transfer_rejected'::text])))`
- `payment_receipt_reviews_outcome_not_null`: `NOT NULL outcome`
- `payment_receipt_reviews_payment_id_fkey`: `FOREIGN KEY (payment_id) REFERENCES payments(id)`
- `payment_receipt_reviews_payment_id_not_null`: `NOT NULL payment_id`
- `payment_receipt_reviews_pkey`: `PRIMARY KEY (id)`
- `payment_receipt_reviews_reviewer_id_fkey`: `FOREIGN KEY (reviewer_id) REFERENCES users(id)`
- `payment_receipt_reviews_reviewer_id_not_null`: `NOT NULL reviewer_id`
- `payment_receipt_reviews_verified_amount_yer_check`: `CHECK ((verified_amount_yer > 0))`

الحراس:

- `immutable_payment_receipt_reviews`: `CREATE TRIGGER immutable_payment_receipt_reviews BEFORE DELETE OR UPDATE ON public.payment_receipt_reviews FOR EACH ROW EXECUTE FUNCTION reject_ledger_mutation()`
- `latest_receipt_review`: `CREATE TRIGGER latest_receipt_review BEFORE INSERT ON public.payment_receipt_reviews FOR EACH ROW EXECUTE FUNCTION guard_receipt_review()`
- `receipt_review_summary`: `CREATE TRIGGER receipt_review_summary AFTER INSERT ON public.payment_receipt_reviews FOR EACH ROW EXECUTE FUNCTION apply_receipt_review()`

### `payments`

| الحقل | النوع | NOT NULL | الافتراضي/التوليد |
|---|---|---|---|
| `id` | `uuid` | نعم | `gen_random_uuid()` |
| `order_id` | `uuid` | نعم | `—` |
| `quote_id` | `uuid` | نعم | `—` |
| `method_id` | `uuid` | نعم | `—` |
| `instruction_id` | `uuid` | نعم | `—` |
| `receipt_number` | `text` | نعم | `—` |
| `normalized_receipt_number` | `text` | نعم | `—` |
| `amount_yer` | `bigint` | نعم | `—` |
| `approved_amount_yer` | `bigint` | لا | `—` |
| `status` | `text` | نعم | `'pending'::text` |
| `reviewer_id` | `uuid` | لا | `—` |
| `reviewed_at` | `timestamp with time zone` | لا | `—` |
| `review_note` | `text` | لا | `—` |
| `created_at` | `timestamp with time zone` | نعم | `now()` |

القيود:

- `payments_amount_yer_check`: `CHECK ((amount_yer > 0))`
- `payments_amount_yer_not_null`: `NOT NULL amount_yer`
- `payments_approved_amount_yer_check`: `CHECK ((approved_amount_yer > 0))`
- `payments_check`: `CHECK (((status = 'pending'::text) OR ((reviewer_id IS NOT NULL) AND (reviewed_at IS NOT NULL))))`
- `payments_check1`: `CHECK (((status = 'approved'::text) = (approved_amount_yer IS NOT NULL)))`
- `payments_created_at_not_null`: `NOT NULL created_at`
- `payments_id_not_null`: `NOT NULL id`
- `payments_instruction_id_not_null`: `NOT NULL instruction_id`
- `payments_instruction_id_order_id_quote_id_method_id_fkey`: `FOREIGN KEY (instruction_id, order_id, quote_id, method_id) REFERENCES payment_instructions(id, order_id, quote_id, method_id)`
- `payments_method_id_fkey`: `FOREIGN KEY (method_id) REFERENCES payment_methods(id)`
- `payments_method_id_normalized_receipt_number_key`: `UNIQUE (method_id, normalized_receipt_number)`
- `payments_method_id_not_null`: `NOT NULL method_id`
- `payments_normalized_receipt_number_not_null`: `NOT NULL normalized_receipt_number`
- `payments_order_id_fkey`: `FOREIGN KEY (order_id) REFERENCES orders(id)`
- `payments_order_id_not_null`: `NOT NULL order_id`
- `payments_pkey`: `PRIMARY KEY (id)`
- `payments_quote_id_not_null`: `NOT NULL quote_id`
- `payments_quote_id_order_id_fkey`: `FOREIGN KEY (quote_id, order_id) REFERENCES order_quotes(id, order_id)`
- `payments_receipt_number_not_null`: `NOT NULL receipt_number`
- `payments_reviewer_id_fkey`: `FOREIGN KEY (reviewer_id) REFERENCES users(id)`
- `payments_status_check`: `CHECK ((status = ANY (ARRAY['pending'::text, 'approved'::text, 'rejected'::text])))`
- `payments_status_not_null`: `NOT NULL status`

الحراس:

- `payment_review_state`: `CREATE TRIGGER payment_review_state BEFORE INSERT OR UPDATE ON public.payments FOR EACH ROW EXECUTE FUNCTION guard_payment_update()`
- `preserve_payments`: `CREATE TRIGGER preserve_payments BEFORE DELETE ON public.payments FOR EACH ROW EXECUTE FUNCTION reject_ledger_mutation()`

### `permissions`

| الحقل | النوع | NOT NULL | الافتراضي/التوليد |
|---|---|---|---|
| `code` | `text` | نعم | `—` |
| `name_ar` | `text` | نعم | `—` |

القيود:

- `permissions_code_not_null`: `NOT NULL code`
- `permissions_name_ar_not_null`: `NOT NULL name_ar`
- `permissions_pkey`: `PRIMARY KEY (code)`

### `product_attribute_values`

| الحقل | النوع | NOT NULL | الافتراضي/التوليد |
|---|---|---|---|
| `product_id` | `uuid` | نعم | `—` |
| `category_id` | `uuid` | نعم | `—` |
| `attribute_id` | `uuid` | نعم | `—` |
| `value_id` | `uuid` | نعم | `—` |

القيود:

- `product_attribute_values_attribute_id_not_null`: `NOT NULL attribute_id`
- `product_attribute_values_attribute_id_value_id_fkey`: `FOREIGN KEY (attribute_id, value_id) REFERENCES attribute_values(attribute_id, id)`
- `product_attribute_values_category_id_attribute_id_fkey`: `FOREIGN KEY (category_id, attribute_id) REFERENCES category_attributes(category_id, attribute_id)`
- `product_attribute_values_category_id_not_null`: `NOT NULL category_id`
- `product_attribute_values_pkey`: `PRIMARY KEY (product_id, attribute_id)`
- `product_attribute_values_product_id_category_id_fkey`: `FOREIGN KEY (product_id, category_id) REFERENCES products(id, category_id)`
- `product_attribute_values_product_id_not_null`: `NOT NULL product_id`
- `product_attribute_values_value_id_not_null`: `NOT NULL value_id`

### `product_images`

| الحقل | النوع | NOT NULL | الافتراضي/التوليد |
|---|---|---|---|
| `product_id` | `uuid` | نعم | `—` |
| `media_id` | `uuid` | نعم | `—` |
| `sort_order` | `integer` | نعم | `0` |

القيود:

- `product_images_media_id_fkey`: `FOREIGN KEY (media_id) REFERENCES media_objects(id)`
- `product_images_media_id_not_null`: `NOT NULL media_id`
- `product_images_pkey`: `PRIMARY KEY (product_id, media_id)`
- `product_images_product_id_fkey`: `FOREIGN KEY (product_id) REFERENCES products(id)`
- `product_images_product_id_not_null`: `NOT NULL product_id`
- `product_images_sort_order_not_null`: `NOT NULL sort_order`

### `product_units`

| الحقل | النوع | NOT NULL | الافتراضي/التوليد |
|---|---|---|---|
| `id` | `uuid` | نعم | `gen_random_uuid()` |
| `product_id` | `uuid` | نعم | `—` |
| `unit_kind` | `text` | نعم | `—` |
| `pieces_per_unit` | `integer` | نعم | `—` |
| `price_yer` | `bigint` | نعم | `—` |
| `active` | `boolean` | نعم | `true` |
| `archived_at` | `timestamp with time zone` | لا | `—` |
| `created_at` | `timestamp with time zone` | نعم | `now()` |

القيود:

- `product_units_active_not_null`: `NOT NULL active`
- `product_units_check`: `CHECK (((unit_kind <> 'piece'::text) OR (pieces_per_unit = 1)))`
- `product_units_check1`: `CHECK (((unit_kind <> 'carton'::text) OR (pieces_per_unit > 1)))`
- `product_units_created_at_not_null`: `NOT NULL created_at`
- `product_units_id_not_null`: `NOT NULL id`
- `product_units_id_product_id_key`: `UNIQUE (id, product_id)`
- `product_units_pieces_per_unit_check`: `CHECK ((pieces_per_unit > 0))`
- `product_units_pieces_per_unit_not_null`: `NOT NULL pieces_per_unit`
- `product_units_pkey`: `PRIMARY KEY (id)`
- `product_units_price_yer_check`: `CHECK ((price_yer >= 0))`
- `product_units_price_yer_not_null`: `NOT NULL price_yer`
- `product_units_product_id_fkey`: `FOREIGN KEY (product_id) REFERENCES products(id)`
- `product_units_product_id_not_null`: `NOT NULL product_id`
- `product_units_unit_kind_check`: `CHECK ((unit_kind = ANY (ARRAY['piece'::text, 'carton'::text])))`
- `product_units_unit_kind_not_null`: `NOT NULL unit_kind`

الحراس:

- `used_unit_history`: `CREATE TRIGGER used_unit_history BEFORE DELETE OR UPDATE ON public.product_units FOR EACH ROW EXECUTE FUNCTION guard_unit_history()`

### `products`

| الحقل | النوع | NOT NULL | الافتراضي/التوليد |
|---|---|---|---|
| `id` | `uuid` | نعم | `gen_random_uuid()` |
| `sku` | `text` | نعم | `—` |
| `category_id` | `uuid` | نعم | `—` |
| `name_ar` | `text` | نعم | `—` |
| `description_ar` | `text` | نعم | `''::text` |
| `origin_country` | `text` | لا | `—` |
| `active` | `boolean` | نعم | `true` |
| `version` | `integer` | نعم | `1` |
| `created_at` | `timestamp with time zone` | نعم | `now()` |

القيود:

- `products_active_not_null`: `NOT NULL active`
- `products_category_id_fkey`: `FOREIGN KEY (category_id) REFERENCES categories(id)`
- `products_category_id_not_null`: `NOT NULL category_id`
- `products_created_at_not_null`: `NOT NULL created_at`
- `products_description_ar_not_null`: `NOT NULL description_ar`
- `products_id_category_id_key`: `UNIQUE (id, category_id)`
- `products_id_not_null`: `NOT NULL id`
- `products_name_ar_not_null`: `NOT NULL name_ar`
- `products_pkey`: `PRIMARY KEY (id)`
- `products_sku_key`: `UNIQUE (sku)`
- `products_sku_not_null`: `NOT NULL sku`
- `products_version_check`: `CHECK ((version > 0))`
- `products_version_not_null`: `NOT NULL version`

### `promotions`

| الحقل | النوع | NOT NULL | الافتراضي/التوليد |
|---|---|---|---|
| `id` | `uuid` | نعم | `gen_random_uuid()` |
| `name_ar` | `text` | نعم | `—` |
| `governorate_id` | `uuid` | لا | `—` |
| `category_id` | `uuid` | لا | `—` |
| `product_id` | `uuid` | لا | `—` |
| `target` | `text` | نعم | `—` |
| `discount_kind` | `text` | نعم | `—` |
| `value` | `bigint` | نعم | `—` |
| `starts_at` | `timestamp with time zone` | نعم | `—` |
| `ends_at` | `timestamp with time zone` | نعم | `—` |
| `active` | `boolean` | نعم | `true` |

القيود:

- `promotions_active_not_null`: `NOT NULL active`
- `promotions_category_id_fkey`: `FOREIGN KEY (category_id) REFERENCES categories(id)`
- `promotions_check`: `CHECK ((ends_at > starts_at))`
- `promotions_check1`: `CHECK (((discount_kind <> 'percent'::text) OR (value <= 10000)))`
- `promotions_check2`: `CHECK ((NOT ((category_id IS NOT NULL) AND (product_id IS NOT NULL))))`
- `promotions_discount_kind_check`: `CHECK ((discount_kind = ANY (ARRAY['fixed'::text, 'percent'::text])))`
- `promotions_discount_kind_not_null`: `NOT NULL discount_kind`
- `promotions_ends_at_not_null`: `NOT NULL ends_at`
- `promotions_governorate_id_fkey`: `FOREIGN KEY (governorate_id) REFERENCES governorates(id)`
- `promotions_id_not_null`: `NOT NULL id`
- `promotions_name_ar_not_null`: `NOT NULL name_ar`
- `promotions_pkey`: `PRIMARY KEY (id)`
- `promotions_product_id_fkey`: `FOREIGN KEY (product_id) REFERENCES products(id)`
- `promotions_starts_at_not_null`: `NOT NULL starts_at`
- `promotions_target_check`: `CHECK ((target = ANY (ARRAY['products'::text, 'delivery'::text])))`
- `promotions_target_not_null`: `NOT NULL target`
- `promotions_value_check`: `CHECK ((value >= 0))`
- `promotions_value_not_null`: `NOT NULL value`

### `push_tokens`

| الحقل | النوع | NOT NULL | الافتراضي/التوليد |
|---|---|---|---|
| `id` | `uuid` | نعم | `gen_random_uuid()` |
| `user_id` | `uuid` | نعم | `—` |
| `app` | `text` | نعم | `—` |
| `environment` | `text` | نعم | `—` |
| `token` | `text` | نعم | `—` |
| `platform` | `text` | نعم | `—` |
| `active` | `boolean` | نعم | `true` |
| `updated_at` | `timestamp with time zone` | نعم | `now()` |

القيود:

- `push_tokens_active_not_null`: `NOT NULL active`
- `push_tokens_app_check`: `CHECK ((app = ANY (ARRAY['customer'::text, 'admin'::text, 'courier'::text])))`
- `push_tokens_app_not_null`: `NOT NULL app`
- `push_tokens_environment_check`: `CHECK ((environment = ANY (ARRAY['staging'::text, 'production'::text])))`
- `push_tokens_environment_not_null`: `NOT NULL environment`
- `push_tokens_id_not_null`: `NOT NULL id`
- `push_tokens_pkey`: `PRIMARY KEY (id)`
- `push_tokens_platform_check`: `CHECK ((platform = ANY (ARRAY['android'::text, 'ios'::text])))`
- `push_tokens_platform_not_null`: `NOT NULL platform`
- `push_tokens_token_key`: `UNIQUE (token)`
- `push_tokens_token_not_null`: `NOT NULL token`
- `push_tokens_updated_at_not_null`: `NOT NULL updated_at`
- `push_tokens_user_id_fkey`: `FOREIGN KEY (user_id) REFERENCES users(id)`
- `push_tokens_user_id_not_null`: `NOT NULL user_id`

### `quote_items`

| الحقل | النوع | NOT NULL | الافتراضي/التوليد |
|---|---|---|---|
| `id` | `uuid` | نعم | `gen_random_uuid()` |
| `quote_id` | `uuid` | نعم | `—` |
| `product_id` | `uuid` | نعم | `—` |
| `unit_id` | `uuid` | نعم | `—` |
| `name_snapshot` | `text` | نعم | `—` |
| `attributes_snapshot` | `jsonb` | نعم | `'{}'::jsonb` |
| `unit_snapshot` | `text` | نعم | `—` |
| `pieces_per_unit` | `integer` | نعم | `—` |
| `quantity` | `integer` | نعم | `—` |
| `unit_price_yer` | `bigint` | نعم | `—` |
| `line_total_yer` | `bigint` | نعم | `—` |

القيود:

- `quote_items_attributes_snapshot_not_null`: `NOT NULL attributes_snapshot`
- `quote_items_check`: `CHECK ((line_total_yer = ((quantity)::bigint * unit_price_yer)))`
- `quote_items_id_not_null`: `NOT NULL id`
- `quote_items_line_total_yer_check`: `CHECK ((line_total_yer >= 0))`
- `quote_items_line_total_yer_not_null`: `NOT NULL line_total_yer`
- `quote_items_name_snapshot_not_null`: `NOT NULL name_snapshot`
- `quote_items_pieces_per_unit_check`: `CHECK ((pieces_per_unit > 0))`
- `quote_items_pieces_per_unit_not_null`: `NOT NULL pieces_per_unit`
- `quote_items_pkey`: `PRIMARY KEY (id)`
- `quote_items_product_id_fkey`: `FOREIGN KEY (product_id) REFERENCES products(id)`
- `quote_items_product_id_not_null`: `NOT NULL product_id`
- `quote_items_quantity_check`: `CHECK ((quantity > 0))`
- `quote_items_quantity_not_null`: `NOT NULL quantity`
- `quote_items_quote_id_fkey`: `FOREIGN KEY (quote_id) REFERENCES order_quotes(id)`
- `quote_items_quote_id_not_null`: `NOT NULL quote_id`
- `quote_items_unit_id_not_null`: `NOT NULL unit_id`
- `quote_items_unit_id_product_id_fkey`: `FOREIGN KEY (unit_id, product_id) REFERENCES product_units(id, product_id)`
- `quote_items_unit_price_yer_check`: `CHECK ((unit_price_yer >= 0))`
- `quote_items_unit_price_yer_not_null`: `NOT NULL unit_price_yer`
- `quote_items_unit_snapshot_not_null`: `NOT NULL unit_snapshot`

الحراس:

- `draft_quote_lines`: `CREATE TRIGGER draft_quote_lines BEFORE INSERT OR DELETE OR UPDATE ON public.quote_items FOR EACH ROW EXECUTE FUNCTION guard_quote_items()`

### `quote_revalidations`

| الحقل | النوع | NOT NULL | الافتراضي/التوليد |
|---|---|---|---|
| `id` | `uuid` | نعم | `gen_random_uuid()` |
| `quote_id` | `uuid` | نعم | `—` |
| `checked_by` | `uuid` | نعم | `—` |
| `checked_at` | `timestamp with time zone` | نعم | `now()` |
| `valid_until` | `timestamp with time zone` | نعم | `—` |
| `reason` | `text` | نعم | `—` |

القيود:

- `quote_revalidations_check`: `CHECK ((valid_until > checked_at))`
- `quote_revalidations_checked_at_not_null`: `NOT NULL checked_at`
- `quote_revalidations_checked_by_fkey`: `FOREIGN KEY (checked_by) REFERENCES users(id)`
- `quote_revalidations_checked_by_not_null`: `NOT NULL checked_by`
- `quote_revalidations_id_not_null`: `NOT NULL id`
- `quote_revalidations_pkey`: `PRIMARY KEY (id)`
- `quote_revalidations_quote_id_fkey`: `FOREIGN KEY (quote_id) REFERENCES order_quotes(id)`
- `quote_revalidations_quote_id_not_null`: `NOT NULL quote_id`
- `quote_revalidations_reason_check`: `CHECK ((length(btrim(reason)) > 0))`
- `quote_revalidations_reason_not_null`: `NOT NULL reason`
- `quote_revalidations_valid_until_not_null`: `NOT NULL valid_until`

الحراس:

- `immutable_quote_revalidations`: `CREATE TRIGGER immutable_quote_revalidations BEFORE DELETE OR UPDATE ON public.quote_revalidations FOR EACH ROW EXECUTE FUNCTION reject_ledger_mutation()`

### `report_jobs`

| الحقل | النوع | NOT NULL | الافتراضي/التوليد |
|---|---|---|---|
| `id` | `uuid` | نعم | `gen_random_uuid()` |
| `requested_by` | `uuid` | نعم | `—` |
| `kind` | `text` | نعم | `—` |
| `parameters` | `jsonb` | نعم | `—` |
| `state` | `text` | نعم | `—` |
| `media_id` | `uuid` | لا | `—` |
| `error_message` | `text` | لا | `—` |
| `created_at` | `timestamp with time zone` | نعم | `now()` |

القيود:

- `report_jobs_created_at_not_null`: `NOT NULL created_at`
- `report_jobs_id_not_null`: `NOT NULL id`
- `report_jobs_kind_check`: `CHECK ((kind = 'monthly_sales'::text))`
- `report_jobs_kind_not_null`: `NOT NULL kind`
- `report_jobs_media_id_fkey`: `FOREIGN KEY (media_id) REFERENCES media_objects(id)`
- `report_jobs_parameters_not_null`: `NOT NULL parameters`
- `report_jobs_pkey`: `PRIMARY KEY (id)`
- `report_jobs_requested_by_fkey`: `FOREIGN KEY (requested_by) REFERENCES users(id)`
- `report_jobs_requested_by_not_null`: `NOT NULL requested_by`
- `report_jobs_state_check`: `CHECK ((state = ANY (ARRAY['pending'::text, 'processing'::text, 'ready'::text, 'failed'::text])))`
- `report_jobs_state_not_null`: `NOT NULL state`

### `role_permissions`

| الحقل | النوع | NOT NULL | الافتراضي/التوليد |
|---|---|---|---|
| `role_id` | `uuid` | نعم | `—` |
| `permission_code` | `text` | نعم | `—` |

القيود:

- `role_permissions_permission_code_fkey`: `FOREIGN KEY (permission_code) REFERENCES permissions(code)`
- `role_permissions_permission_code_not_null`: `NOT NULL permission_code`
- `role_permissions_pkey`: `PRIMARY KEY (role_id, permission_code)`
- `role_permissions_role_id_fkey`: `FOREIGN KEY (role_id) REFERENCES roles(id)`
- `role_permissions_role_id_not_null`: `NOT NULL role_id`

### `roles`

| الحقل | النوع | NOT NULL | الافتراضي/التوليد |
|---|---|---|---|
| `id` | `uuid` | نعم | `gen_random_uuid()` |
| `code` | `text` | نعم | `—` |
| `name_ar` | `text` | نعم | `—` |

القيود:

- `roles_code_key`: `UNIQUE (code)`
- `roles_code_not_null`: `NOT NULL code`
- `roles_id_not_null`: `NOT NULL id`
- `roles_name_ar_not_null`: `NOT NULL name_ar`
- `roles_pkey`: `PRIMARY KEY (id)`

### `sessions`

| الحقل | النوع | NOT NULL | الافتراضي/التوليد |
|---|---|---|---|
| `id` | `uuid` | نعم | `gen_random_uuid()` |
| `user_id` | `uuid` | نعم | `—` |
| `app` | `text` | نعم | `—` |
| `refresh_token_hash` | `text` | نعم | `—` |
| `expires_at` | `timestamp with time zone` | نعم | `—` |
| `revoked_at` | `timestamp with time zone` | لا | `—` |
| `created_at` | `timestamp with time zone` | نعم | `now()` |

القيود:

- `sessions_app_check`: `CHECK ((app = ANY (ARRAY['customer'::text, 'admin'::text, 'courier'::text])))`
- `sessions_app_not_null`: `NOT NULL app`
- `sessions_created_at_not_null`: `NOT NULL created_at`
- `sessions_expires_at_not_null`: `NOT NULL expires_at`
- `sessions_id_not_null`: `NOT NULL id`
- `sessions_pkey`: `PRIMARY KEY (id)`
- `sessions_refresh_token_hash_key`: `UNIQUE (refresh_token_hash)`
- `sessions_refresh_token_hash_not_null`: `NOT NULL refresh_token_hash`
- `sessions_user_id_fkey`: `FOREIGN KEY (user_id) REFERENCES users(id)`
- `sessions_user_id_not_null`: `NOT NULL user_id`

### `settings`

| الحقل | النوع | NOT NULL | الافتراضي/التوليد |
|---|---|---|---|
| `key` | `text` | نعم | `—` |
| `value` | `jsonb` | نعم | `—` |
| `updated_by` | `uuid` | لا | `—` |
| `updated_at` | `timestamp with time zone` | نعم | `now()` |

القيود:

- `settings_key_not_null`: `NOT NULL key`
- `settings_pkey`: `PRIMARY KEY (key)`
- `settings_updated_at_not_null`: `NOT NULL updated_at`
- `settings_updated_by_fkey`: `FOREIGN KEY (updated_by) REFERENCES users(id)`
- `settings_value_not_null`: `NOT NULL value`

### `settlement_items`

| الحقل | النوع | NOT NULL | الافتراضي/التوليد |
|---|---|---|---|
| `id` | `uuid` | نعم | `gen_random_uuid()` |
| `settlement_id` | `uuid` | نعم | `—` |
| `earning_id` | `uuid` | لا | `—` |
| `reversal_credit_id` | `uuid` | لا | `—` |

القيود:

- `settlement_items_check`: `CHECK ((num_nonnulls(earning_id, reversal_credit_id) = 1))`
- `settlement_items_earning_id_fkey`: `FOREIGN KEY (earning_id) REFERENCES courier_earnings(id)`
- `settlement_items_earning_id_key`: `UNIQUE (earning_id)`
- `settlement_items_id_not_null`: `NOT NULL id`
- `settlement_items_pkey`: `PRIMARY KEY (id)`
- `settlement_items_reversal_credit_id_fkey`: `FOREIGN KEY (reversal_credit_id) REFERENCES courier_settlement_reversals(id)`
- `settlement_items_reversal_credit_id_key`: `UNIQUE (reversal_credit_id)`
- `settlement_items_settlement_id_fkey`: `FOREIGN KEY (settlement_id) REFERENCES courier_settlements(id)`
- `settlement_items_settlement_id_not_null`: `NOT NULL settlement_id`
- `settlement_items_total`: `TRIGGER DEFERRABLE INITIALLY DEFERRED`

الحراس:

- `immutable_settlement_items`: `CREATE TRIGGER immutable_settlement_items BEFORE DELETE OR UPDATE ON public.settlement_items FOR EACH ROW EXECUTE FUNCTION reject_ledger_mutation()`
- `settlement_allocation_owner`: `CREATE TRIGGER settlement_allocation_owner BEFORE INSERT ON public.settlement_items FOR EACH ROW EXECUTE FUNCTION guard_allocation_owner()`
- `settlement_items_total`: `CREATE CONSTRAINT TRIGGER settlement_items_total AFTER INSERT ON public.settlement_items DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION validate_payout_total()`

### `staff_grants`

| الحقل | النوع | NOT NULL | الافتراضي/التوليد |
|---|---|---|---|
| `id` | `uuid` | نعم | `gen_random_uuid()` |
| `user_id` | `uuid` | نعم | `—` |
| `role_id` | `uuid` | نعم | `—` |
| `branch_id` | `uuid` | لا | `—` |
| `global_scope` | `boolean` | نعم | `false` |

القيود:

- `staff_grants_branch_id_fkey`: `FOREIGN KEY (branch_id) REFERENCES branches(id)`
- `staff_grants_check`: `CHECK (((global_scope AND (branch_id IS NULL)) OR ((NOT global_scope) AND (branch_id IS NOT NULL))))`
- `staff_grants_global_scope_not_null`: `NOT NULL global_scope`
- `staff_grants_id_not_null`: `NOT NULL id`
- `staff_grants_pkey`: `PRIMARY KEY (id)`
- `staff_grants_role_id_fkey`: `FOREIGN KEY (role_id) REFERENCES roles(id)`
- `staff_grants_role_id_not_null`: `NOT NULL role_id`
- `staff_grants_user_id_fkey`: `FOREIGN KEY (user_id) REFERENCES users(id)`
- `staff_grants_user_id_not_null`: `NOT NULL user_id`

### `stock_levels`

| الحقل | النوع | NOT NULL | الافتراضي/التوليد |
|---|---|---|---|
| `branch_id` | `uuid` | نعم | `—` |
| `product_id` | `uuid` | نعم | `—` |
| `on_hand` | `bigint` | نعم | `0` |
| `reserved` | `bigint` | نعم | `0` |
| `sellable` | `boolean` | نعم | `true` |
| `version` | `integer` | نعم | `1` |

القيود:

- `stock_levels_branch_id_fkey`: `FOREIGN KEY (branch_id) REFERENCES branches(id)`
- `stock_levels_branch_id_not_null`: `NOT NULL branch_id`
- `stock_levels_check`: `CHECK ((reserved <= on_hand))`
- `stock_levels_on_hand_check`: `CHECK ((on_hand >= 0))`
- `stock_levels_on_hand_not_null`: `NOT NULL on_hand`
- `stock_levels_pkey`: `PRIMARY KEY (branch_id, product_id)`
- `stock_levels_product_id_fkey`: `FOREIGN KEY (product_id) REFERENCES products(id)`
- `stock_levels_product_id_not_null`: `NOT NULL product_id`
- `stock_levels_reserved_check`: `CHECK ((reserved >= 0))`
- `stock_levels_reserved_not_null`: `NOT NULL reserved`
- `stock_levels_sellable_not_null`: `NOT NULL sellable`
- `stock_levels_version_check`: `CHECK ((version > 0))`
- `stock_levels_version_not_null`: `NOT NULL version`

### `stock_movements`

| الحقل | النوع | NOT NULL | الافتراضي/التوليد |
|---|---|---|---|
| `id` | `uuid` | نعم | `gen_random_uuid()` |
| `branch_id` | `uuid` | نعم | `—` |
| `product_id` | `uuid` | نعم | `—` |
| `delta_pieces` | `bigint` | نعم | `—` |
| `reason` | `text` | نعم | `—` |
| `order_id` | `uuid` | لا | `—` |
| `transfer_id` | `uuid` | لا | `—` |
| `reverses_id` | `uuid` | لا | `—` |
| `actor_id` | `uuid` | نعم | `—` |
| `note` | `text` | لا | `—` |
| `created_at` | `timestamp with time zone` | نعم | `now()` |

القيود:

- `stock_movements_actor_id_fkey`: `FOREIGN KEY (actor_id) REFERENCES users(id)`
- `stock_movements_actor_id_not_null`: `NOT NULL actor_id`
- `stock_movements_branch_id_fkey`: `FOREIGN KEY (branch_id) REFERENCES branches(id)`
- `stock_movements_branch_id_not_null`: `NOT NULL branch_id`
- `stock_movements_created_at_not_null`: `NOT NULL created_at`
- `stock_movements_delta_pieces_check`: `CHECK ((delta_pieces <> 0))`
- `stock_movements_delta_pieces_not_null`: `NOT NULL delta_pieces`
- `stock_movements_id_not_null`: `NOT NULL id`
- `stock_movements_order_id_fkey`: `FOREIGN KEY (order_id) REFERENCES orders(id)`
- `stock_movements_pkey`: `PRIMARY KEY (id)`
- `stock_movements_product_id_fkey`: `FOREIGN KEY (product_id) REFERENCES products(id)`
- `stock_movements_product_id_not_null`: `NOT NULL product_id`
- `stock_movements_reason_check`: `CHECK ((reason = ANY (ARRAY['receipt'::text, 'adjustment'::text, 'transfer_in'::text, 'transfer_out'::text, 'sale'::text, 'reversal'::text])))`
- `stock_movements_reason_not_null`: `NOT NULL reason`
- `stock_movements_reverses_id_fkey`: `FOREIGN KEY (reverses_id) REFERENCES stock_movements(id)`
- `stock_movements_reverses_id_key`: `UNIQUE (reverses_id)`
- `stock_movements_transfer_id_fkey`: `FOREIGN KEY (transfer_id) REFERENCES stock_transfers(id)`

الحراس:

- `immutable_stock_movements`: `CREATE TRIGGER immutable_stock_movements BEFORE DELETE OR UPDATE ON public.stock_movements FOR EACH ROW EXECUTE FUNCTION reject_ledger_mutation()`

### `stock_reservations`

| الحقل | النوع | NOT NULL | الافتراضي/التوليد |
|---|---|---|---|
| `id` | `uuid` | نعم | `gen_random_uuid()` |
| `order_id` | `uuid` | نعم | `—` |
| `branch_id` | `uuid` | نعم | `—` |
| `product_id` | `uuid` | نعم | `—` |
| `quote_id` | `uuid` | نعم | `—` |
| `pieces` | `bigint` | نعم | `—` |
| `state` | `text` | نعم | `'active'::text` |
| `hold_kind` | `text` | نعم | `'timed'::text` |
| `expires_at` | `timestamp with time zone` | لا | `—` |
| `protected_at` | `timestamp with time zone` | لا | `—` |
| `created_at` | `timestamp with time zone` | نعم | `now()` |

القيود:

- `stock_reservations_branch_id_not_null`: `NOT NULL branch_id`
- `stock_reservations_branch_id_product_id_fkey`: `FOREIGN KEY (branch_id, product_id) REFERENCES stock_levels(branch_id, product_id)`
- `stock_reservations_check`: `CHECK ((((hold_kind = 'timed'::text) AND (expires_at IS NOT NULL) AND (protected_at IS NULL)) OR ((hold_kind = 'receipt_review'::text) AND (expires_at IS NULL) AND (protected_at IS NOT NULL))))`
- `stock_reservations_check1`: `CHECK ((NOT ((hold_kind = 'receipt_review'::text) AND (state = 'expired'::text))))`
- `stock_reservations_created_at_not_null`: `NOT NULL created_at`
- `stock_reservations_hold_kind_check`: `CHECK ((hold_kind = ANY (ARRAY['timed'::text, 'receipt_review'::text])))`
- `stock_reservations_hold_kind_not_null`: `NOT NULL hold_kind`
- `stock_reservations_id_not_null`: `NOT NULL id`
- `stock_reservations_order_id_fkey`: `FOREIGN KEY (order_id) REFERENCES orders(id)`
- `stock_reservations_order_id_not_null`: `NOT NULL order_id`
- `stock_reservations_pieces_check`: `CHECK ((pieces > 0))`
- `stock_reservations_pieces_not_null`: `NOT NULL pieces`
- `stock_reservations_pkey`: `PRIMARY KEY (id)`
- `stock_reservations_product_id_fkey`: `FOREIGN KEY (product_id) REFERENCES products(id)`
- `stock_reservations_product_id_not_null`: `NOT NULL product_id`
- `stock_reservations_quote_id_not_null`: `NOT NULL quote_id`
- `stock_reservations_quote_id_order_id_branch_id_fkey`: `FOREIGN KEY (quote_id, order_id, branch_id) REFERENCES order_quotes(id, order_id, branch_id)`
- `stock_reservations_state_check`: `CHECK ((state = ANY (ARRAY['active'::text, 'consumed'::text, 'released'::text, 'expired'::text])))`
- `stock_reservations_state_not_null`: `NOT NULL state`

الحراس:

- `preserve_reservations`: `CREATE TRIGGER preserve_reservations BEFORE DELETE ON public.stock_reservations FOR EACH ROW EXECUTE FUNCTION reject_ledger_mutation()`
- `protected_stock_review`: `CREATE TRIGGER protected_stock_review BEFORE UPDATE ON public.stock_reservations FOR EACH ROW EXECUTE FUNCTION guard_protected_reservation()`

### `stock_transfer_items`

| الحقل | النوع | NOT NULL | الافتراضي/التوليد |
|---|---|---|---|
| `transfer_id` | `uuid` | نعم | `—` |
| `product_id` | `uuid` | نعم | `—` |
| `pieces` | `bigint` | نعم | `—` |

القيود:

- `stock_transfer_items_pieces_check`: `CHECK ((pieces > 0))`
- `stock_transfer_items_pieces_not_null`: `NOT NULL pieces`
- `stock_transfer_items_pkey`: `PRIMARY KEY (transfer_id, product_id)`
- `stock_transfer_items_product_id_fkey`: `FOREIGN KEY (product_id) REFERENCES products(id)`
- `stock_transfer_items_product_id_not_null`: `NOT NULL product_id`
- `stock_transfer_items_transfer_id_fkey`: `FOREIGN KEY (transfer_id) REFERENCES stock_transfers(id)`
- `stock_transfer_items_transfer_id_not_null`: `NOT NULL transfer_id`

### `stock_transfers`

| الحقل | النوع | NOT NULL | الافتراضي/التوليد |
|---|---|---|---|
| `id` | `uuid` | نعم | `gen_random_uuid()` |
| `from_branch_id` | `uuid` | نعم | `—` |
| `to_branch_id` | `uuid` | نعم | `—` |
| `actor_id` | `uuid` | نعم | `—` |
| `reason` | `text` | نعم | `—` |
| `created_at` | `timestamp with time zone` | نعم | `now()` |

القيود:

- `stock_transfers_actor_id_fkey`: `FOREIGN KEY (actor_id) REFERENCES users(id)`
- `stock_transfers_actor_id_not_null`: `NOT NULL actor_id`
- `stock_transfers_check`: `CHECK ((from_branch_id <> to_branch_id))`
- `stock_transfers_created_at_not_null`: `NOT NULL created_at`
- `stock_transfers_from_branch_id_fkey`: `FOREIGN KEY (from_branch_id) REFERENCES branches(id)`
- `stock_transfers_from_branch_id_not_null`: `NOT NULL from_branch_id`
- `stock_transfers_id_not_null`: `NOT NULL id`
- `stock_transfers_pkey`: `PRIMARY KEY (id)`
- `stock_transfers_reason_not_null`: `NOT NULL reason`
- `stock_transfers_to_branch_id_fkey`: `FOREIGN KEY (to_branch_id) REFERENCES branches(id)`
- `stock_transfers_to_branch_id_not_null`: `NOT NULL to_branch_id`

### `users`

| الحقل | النوع | NOT NULL | الافتراضي/التوليد |
|---|---|---|---|
| `id` | `uuid` | نعم | `gen_random_uuid()` |
| `phone_e164` | `text` | لا | `—` |
| `name_ar` | `text` | نعم | `—` |
| `password_hash` | `text` | لا | `—` |
| `kind` | `text` | نعم | `—` |
| `status` | `text` | نعم | `'pending'::text` |
| `phone_verified_at` | `timestamp with time zone` | لا | `—` |
| `deleted_at` | `timestamp with time zone` | لا | `—` |
| `created_at` | `timestamp with time zone` | نعم | `now()` |

القيود:

- `users_check`: `CHECK (((status = 'deleted'::text) OR ((phone_e164 IS NOT NULL) AND (password_hash IS NOT NULL))))`
- `users_created_at_not_null`: `NOT NULL created_at`
- `users_id_not_null`: `NOT NULL id`
- `users_kind_check`: `CHECK ((kind = ANY (ARRAY['customer'::text, 'staff'::text, 'courier'::text])))`
- `users_kind_not_null`: `NOT NULL kind`
- `users_name_ar_not_null`: `NOT NULL name_ar`
- `users_phone_e164_check`: `CHECK ((phone_e164 ~ '^\+967[0-9]{9}$'::text))`
- `users_phone_e164_key`: `UNIQUE (phone_e164)`
- `users_pkey`: `PRIMARY KEY (id)`
- `users_status_check`: `CHECK ((status = ANY (ARRAY['pending'::text, 'active'::text, 'disabled'::text, 'deleted'::text])))`
- `users_status_not_null`: `NOT NULL status`

<!-- END GENERATED SCHEMA DICTIONARY -->
