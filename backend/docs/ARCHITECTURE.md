# المعمارية

## المنفذ حتى المرحلة01
ثلاثة مشاريع Expo مستقلة بهوية عربية وواجهات تأسيسية ومستودعات fake معلّمة، وهيكل Express بفحص صحة العملية فقط. الرسم والحدود التجارية أدناه هدف مراحل05+ وليست خدمات منفذة الآن. لا اتصال بقاعدة بيانات أو خدمات خارجية. راجع [دليل تشغيل01](PHASE01_BUILD.md) و[تقريرها](progress/phase-01.md).

## الحدود
Customer/Admin/Courier → HTTPS REST /api/v1 → Express modules → PostgreSQL.
التطبيق → R2 للبايتات مباشرة بعد تصريح الخادم. الخادم → OTP Provider + Expo Push + Routing Provider. Outbox وworker للتبليغ وإعادة المحاولة والتقارير والحذف.
لا اتصال مباشر من التطبيقات بقاعدة البيانات. لا يعتمد الموبايل على مفاتيح خاصة. منع تعدد المتاجر يبسط الملكية؛ نطاق كل موظف يحدد بمحافظات/فروع يملك صلاحيتها.

## الوحدات
auth, access-control, geography, branches, catalog, attributes, inventory, delivery-pricing, promotions, orders, quotations, payments, dispatch, commissions, reviews, complaints, customer-flags, notifications, app-config, audit, reporting, media, privacy.

## البيانات والصلاحيات
تحقق Zod على الإدخال، استعلامات parametrized، صلاحيات action+branch في كل endpoint، والتحقق من ملكية كل order/address/receipt على الخادم. العميل لا يحدد price أو delivery_fee أو customer_id موثوقًا. IDs UUID لا تحل محل فحص الملكية. إرسال رقم إصدار order revision يمنع الموافقة على عرض قديم.

## الاتساق
استخدم معاملات PostgreSQL وSELECT FOR UPDATE على الطلب والمخزون وفق ترتيب ثابت. عند التأكيد: راجع آخر quote وقبول العميل وفرع التنفيذ الذي اختاره المدير والحجز؛ للتحويل تحقق من صافي المال المعتمد المطابق، وللنقد لا تشترط تحويلًا أو إيصالًا. اخصم المخزون واستهلك الحجز وثبت السعر والحالة وسجل outbox ضمن المعاملة نفسها، دون إنشاء تحصيل نقدي مفترض. لا تعتمد نجاح إشعار كشرط حفظ الطلب.
للعمليات submit/approve-payment/confirm/assign/deliver/settle إرسـال Idempotency-Key وحفظ hash الطلب ونتيجته. المفتاح نفسه مع محتوى مختلف =409. إعادة المحاولة لا تكرر بيعًا أو عمولة أو دفعًا.

## الأداء
Pagination بالمؤشر، فهارس على نطاق الفرع والحالة والتاريخ، thumbnails وصور مضغوطة قبل النشر. CDN للكتالوج العام، private signed GET للإيصالات. Redis ليس شرطًا للبداية؛ استخدم worker بصفوف outbox وSKIP LOCKED مع backoff وdead-letter. لا تنشئ مستخدم × كل إشعار دون batching للرسائل الكبيرة.

## الخرائط
عرض MapLibre native + OpenFreeMap مع إسناد البيانات ظاهرًا. استعمل development build، لا Expo Go لهذه المكتبة. لا حاجة للترميز الجغرافي لتثبيت الدبوس: الإحداثيات هي الحقيقة، ووصف المكان/معلم قريب إضافة مفيدة. الموقع عند الاستخدام فقط، بلا صلاحية خلفية. افتح الملاحة برابط Maps URL من جهاز الموصل دون Directions API مدفوع. التسعير يحتاج Routing منفصلًا مثل OSRM مستضاف ذاتيًا ببيانات اليمن؛ تكلفة الاستضافة قائمة ولو كان البرنامج مفتوح المصدر. لا SLA مفترض لمزود عرض مجاني، اختبر التغطية والعربية والمناطق الفعلية.

## الاستقلال البيئي
قواعد بيانات وR2 buckets/keys وExpo application IDs وOTP sender/credentials منفصلة لstaging وproduction. لا تصل نسخة التجربة ببيانات إنتاج. وثق إعداد EAS projects الثلاثة وFCM لكل Android وAPNs لـiOS.

## توحيد قرارات متابعة00
معاينة checkout بلا كتابة أو حجز، وsubmit يحفظ الطلب منتظرًا المدير؛ معاملة إصدار العرض اللاحقة تجمع الفرع والعرض والحجز. catalog_branch_id مستقل عن فرع التنفيذ؛ لا أقرب فرع آلي أو تجميع مخزون. رسوم الطريق floor_km فقط، والعمولة قبل خصم التوصيل. receipt_review يحمي السعر والحجز حتى قرار المراجعة دون timeout آلي.
تعليمات الدفع immutable تسبق عرض المستفيد، والتحويل الواحد له محاولات ومراجعات إيصال. cash_collections/cash_remittances دفتر مال المتجر، وcourier_earnings/courier_settlements دفتر عمولات منفصل، دون مقاصة تلقائية. التعويضات/الاستثناءات لها إثباتات ومراجع ولا تمحو الأصل. order_private_details يفصل العنوان والتواصل القابلين للتعمية عن حقائق العرض المالية. راجع BUSINESS_RULES وDATABASE وAPI؛ هذه حدود مرجعية لا خدمات منفذة الآن.
