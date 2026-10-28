# المعمارية
## الحدود
Customer/Admin/Courier → HTTPS REST /api/v1 → Express modules → PostgreSQL.
التطبيق → R2 للبايتات مباشرة بعد تصريح الخادم. الخادم → OTP Provider + Expo Push + Routing Provider. Outbox وworker للتبليغ وإعادة المحاولة والتقارير والحذف.
لا اتصال مباشر من التطبيقات بقاعدة البيانات. لا يعتمد الموبايل على مفاتيح خاصة. منع تعدد المتاجر يبسط الملكية؛ نطاق كل موظف يحدد بمحافظات/فروع يملك صلاحيتها.

## الوحدات
auth, access-control, geography, branches, catalog, attributes, inventory, delivery-pricing, promotions, orders, quotations, payments, dispatch, commissions, reviews, complaints, customer-flags, notifications, app-config, audit, reporting, media, privacy.

## البيانات والصلاحيات
تحقق Zod على الإدخال، استعلامات parametrized، صلاحيات action+branch في كل endpoint، والتحقق من ملكية كل order/address/receipt على الخادم. العميل لا يحدد price أو delivery_fee أو customer_id موثوقًا. IDs UUID لا تحل محل فحص الملكية. إرسال رقم إصدار order revision يمنع الموافقة على عرض قديم.

## الاتساق
استخدم معاملات PostgreSQL وSELECT FOR UPDATE على الطلب والمخزون وفق ترتيب ثابت. عند التأكيد: راجع آخر quote وقبول العميل وسداد الإجمالي والحجز، ثم خصم المخزون وإطلاق الحجز وتثبيت السعر والحالة وسجل outbox ضمن المعاملة نفسها. لا تعتمد نجاح إشعار كشرط حفظ الطلب.
للعمليات submit/approve-payment/confirm/assign/deliver/settle إرسـال Idempotency-Key وحفظ hash الطلب ونتيجته. المفتاح نفسه مع محتوى مختلف =409. إعادة المحاولة لا تكرر بيعًا أو عمولة أو دفعًا.

## الأداء
Pagination بالمؤشر، فهارس على نطاق الفرع والحالة والتاريخ، thumbnails وصور مضغوطة قبل النشر. CDN للكتالوج العام، private signed GET للإيصالات. Redis ليس شرطًا للبداية؛ استخدم worker بصفوف outbox وSKIP LOCKED مع backoff وdead-letter. لا تنشئ مستخدم × كل إشعار دون batching للرسائل الكبيرة.

## الخرائط
عرض MapLibre native + OpenFreeMap مع إسناد البيانات ظاهرًا. استعمل development build، لا Expo Go لهذه المكتبة. لا حاجة للترميز الجغرافي لتثبيت الدبوس: الإحداثيات هي الحقيقة، ووصف المكان/معلم قريب إضافة مفيدة. الموقع عند الاستخدام فقط، بلا صلاحية خلفية. افتح الملاحة برابط Maps URL من جهاز الموصل دون Directions API مدفوع. التسعير يحتاج Routing منفصلًا مثل OSRM مستضاف ذاتيًا ببيانات اليمن؛ تكلفة الاستضافة قائمة ولو كان البرنامج مفتوح المصدر. لا SLA مفترض لمزود عرض مجاني، اختبر التغطية والعربية والمناطق الفعلية.

## الاستقلال البيئي
قواعد بيانات وR2 buckets/keys وExpo application IDs وOTP sender/credentials منفصلة لstaging وproduction. لا تصل نسخة التجربة ببيانات إنتاج. وثق إعداد EAS projects الثلاثة وFCM لكل Android وAPNs لـiOS.
