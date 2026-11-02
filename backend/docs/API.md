> تنفيذ08: [OpenAPI08](openapi.phase08.json) هو العقد الحالي، و[دورة الطلب](ORDERS.md) تشرح المعاملات والمال والخصوصية. حقول الأوامر `expectedVersion` و`Idempotency-Key`، والرد معرّف وإصدار مقتضبان ثمGET للتفاصيل. الطلبات والعروض والحجوزات والإيصالات والاستثناءات متصلة؛ الإسناد والتحصيل والعمولات في09 غير متاحة بعد. ملاحظات07 أدناه تاريخ المعاينة التي بقيتREAD ONLY.

> تنفيذ07: [OpenAPI07](openapi.phase07.json) هو العقد الحالي. أضيفت `/public/maps` و`/delivery/catalog-context` و`/catalog/promotions`، وCRUD العروض بصلاحية عامة `promotions.write`، و`POST /checkout/preview` لعميل بعنوان مملوك. خريطة العميل وCRUD العناوين يستعملان خدمة05. المعاينة READ ONLY: executionBranchId=null وawaiting_branch وpreviewOnly=true وreservationCreated=false، دون quoteId أو تعليمات تحويل. فشل الطريق يجعل total_yer=null وreview_required، وخارج التغطية outside_coverage. عرض واحد saving DESC/id ASC، دون جمع أو عروض تجزئة للجملة. إرسال الطلبات وإصدار العرض والحجز في08.

> تنفيذ05: الهوية والحساب والعناوين الداخلية والأدوار والمنح والتدقيق وhealth أصبحت API فعلية. العقد التفصيلي المنفذ [openapi.phase05.json](openapi.phase05.json)، مع أمثلة وschemas واختباراتHTTP/PostgreSQL؛ بقية هذه الوثيقة نطاق مرجعي لمراحل لاحقة. لا مزودOTP حقيقي مثبت، ولا ربط تلقائي للتطبيقات المحلية. الخطأ الفعلي مغلف: `{error:{code,message,details,requestId}}`.

> المنفذ حتى06: `/public/governorates` و`/public/branches`، `/catalog/*`، وCRUDالإدارة للكتالوج والخصائص والوحدات، وأسعار الفروع والمخزون والحركات والنقل، `/media/uploads/complete/access/public`. العقد الحالي [OpenAPI06](openapi.phase06.json)، والتفاصيل [تقرير06](progress/phase-06.md). بقيةالمسارات التالية تصميم للمراحل اللاحقة ما لم يذكر تقرير منفذ خلاف ذلك.

# عقد REST المرجعي — متابعة00

Base `/api/v1`؛ JSON؛ Bearer؛ وقت UTC ISO8601؛ pagination cursor+limit≤100. الأموال في JSON سلاسل عشرية صحيحة بالريال لتجنب فقد bigint، وbps أعداد صحيحة. الخطأ `{code,message,details,requestId}`؛ 401/403/409/422/429/503 وفق السبب. هذا عقد نطاق وتدفقات، وليس OpenAPI مكتملًا أو API منفذًا.

كل mutation مالية/مخزنية وتقديم/قبول/إلغاء/تأكيد/إسناد/تسليم/تحصيل/تسوية/عكس يتطلب `Idempotency-Key`؛ المفتاح مع محتوى مختلف=409. تعديلات الحالة تستخدم expectedVersion أو If-Match، وقبول العرض expectedQuoteRevision كذلك. صلاحيات action+branch وملكية الكائن على الخادم؛ X-App ليس تصريحًا.

## المسارات الأساسية

| المجموعة | المسارات والوظيفة |
|---|---|
| إعداد عام | GET /public/config?app&platform&build؛ /public/governorates؛ /public/branches?governorateId. يعاد catalogBranchId الصريح؛ غير المهيأ لا يستعمل فرعًا عشوائيًا. |
| هوية | POST /auth/register/start و/register/verify؛ /auth/login/start و/login/verify؛ /auth/otp/resend؛ /auth/password-reset/start و/verify؛ /auth/refresh؛ /auth/logout. |
| حساب | GET/PATCH /me؛ GET/POST /me/addresses؛ PATCH/DELETE /me/addresses/:id؛ POST /me/deletion-requests؛ GET /me/deletion-requests/:id. |
| كتالوج | GET /catalog/categories؛ /catalog/categories/:id/filters؛ /catalog/products?governorateId&categoryId&attributeValueIds&cursor؛ /catalog/products/:id?governorateId. السعر/التوفر من catalogBranchId وحده، دون عدادات مخزون. |
| إدارة كتالوج | CRUD /admin/categories و/attributes و/attributes/:id/values و/products و/products/:id/units؛ PUT /admin/categories/:id/attributes؛ PUT /admin/branches/:id/unit-prices/:unitId. |
| جغرافيا وتغطية | CRUD /admin/governorates و/branches؛ PUT /admin/governorates/:id/catalog-branch؛ PUT /admin/branches/:id/delivery-rule؛ PATCH /admin/branches/:id/delivery-enabled. لا تفعيل دون نطاق وحد طريق وتعرفة؛ لا أقرب فرع آلي. |
| مخزون | GET /admin/inventory و/movements؛ POST /admin/inventory/receipts و/adjustments و/transfers؛ النقل يحتاج صلاحية الفرعين. |
| معاينة | POST /checkout/preview (governorateId,addressId,kind,items[{unitId,quantity}])؛ لا حجز/عرض دائم. |
| تقديم طلب | POST /orders (governorateId,addressId,kind,items,paymentKind مطلوب)؛ ينشئ طلبًا منتظرًا اختيار المدير وبنوده الخاصة فقط. |
| عميل طلبات | GET /orders و/orders/:id؛ POST /orders/:id/decision (quoteId,accept,expectedVersion)؛ POST /orders/:id/cancel يلغي مباشرة بلا إيصال أو يسجل طلب مراجعة بعده؛ الطلبات وسجلها ضمنGET التفاصيل. |
| وسيلة الدفع | POST /orders/:id/payment-kind (transfer أو cash_on_delivery) قبل التأكيد ودون تجاهل تحويل مبلغ عنه. GET /orders/:id/payment-methods للتحويل فقط. |
| تعليمات التحويل | POST /orders/:id/instructions (methodId,expectedVersion)؛ يحفظ snapshot قبل إظهار الرقم والمستفيد. يعيدinstructionId ثمGET التفاصيل يعيد النسخة المثبتة. |
| تحويل | POST /orders/:id/receipts (instructionId,receiptNumber,amountYer,mediaId,expectedVersion)؛ سجل تحويل واحد ومحاولة أولى؛ POST /orders/:id/payments/:paymentId/images (mediaId,expectedVersion) لإعادة صورة مرفوضة دون تحويل جديد. |
| إدارة طلب | GET /admin/orders و/:id (تنبيه بلاغات للمخول)؛ POST /admin/orders/:id/quotes و/:id/confirm و/:id/reject و/:id/assign. |
| تغيير فرع/عنوان | POST /admin/orders/:id/quotes يحدد branchId صراحة ويعيد حقائق العنوان/السعر من الخادم؛ أي تغيير فرع يولد revision وقبولًا جديدًا. أمرconfirm يعيد التحقق والحجز الذري ويسجلquote_revalidations عند انتهاء عرض مقبول بلا حماية إيصال؛ لا endpoint يحجز منفصلًا ثم يترك سباقًا قبل التأكيد. |
| مراجعة إيصال | POST /admin/orders/:id/payments/:paymentId/review (attemptId,outcome,verifiedAmountYer إن تحقق,note,stockAction,expectedVersion). المحاولات والمراجعات ضمنGET التفاصيل بالنطاق المخول. لا مراجعة لمحاولة قديمة ولا اعتماد مكرر. |
| إلغاء إداري | طلبات الإلغاء ضمنGET /admin/orders/:id؛ POST /admin/orders/:id/cancel-review (requestId,approve,reason,expectedVersion) مع التحقق من المال. |
| استثناء مالي | القراءة ضمنGET /admin/orders/:id؛ POST /admin/orders/:id/exceptions؛ POST /admin/orders/:id/settlements (exceptionId,direction,amountYer,reason,reference,proofMediaId,occurredAt,expectedVersion)؛ POST /admin/orders/:id/resolve بعد تحقق الحالة. يجيز تسجيل التحويل المتأخر حتى للطلب الملغي. |
| إدارة وسائل التحويل | CRUD /admin/payment-methods (name,beneficiary,destinationNumber,instructions,branchScope,active)؛ التعديل للمستقبل، والتعليمات السابقة ثابتة. |
| موصل | GET /courier/orders و/orders/:id؛ POST /courier/orders/:id/start و/deliver؛ GET /courier/earnings?from&to. لا reject/accept للإسناد. |
| تحصيل نقد | POST /courier/orders/:id/cash-collections (amount,reference,collectedAt,expectedVersion)؛ POST /courier/orders/:id/cash-exceptions (amount,reason)؛ GET /courier/cash-balance؛ لا يسجل deliver مبلغًا تلقائيًا. |
| تسوية نقد | GET /admin/cash-collections؛ POST /admin/cash-collections/:id/adjustments؛ GET/POST /admin/cash-remittances (courierId,collectionIds أو reversalCreditIds,total,reference)؛ POST /admin/cash-remittances/:id/reversals مع مبلغ مطابق وسبب ومرجع وإثبات. |
| إدارة موصل | CRUD /admin/couriers؛ PUT /admin/couriers/:id/branches؛ PATCH /admin/couriers/:id/commission؛ النسبة صريحة ونطاق الفرع مفحوص. |
| عمولات وتسويات | GET /admin/couriers/:id/earnings؛ GET/POST /admin/settlements (earningIds أو reversalCreditIds,total,reference)؛ POST /admin/settlements/:id/reversals (reason,reference,proofMediaId)؛ لا صافي مقاصة تلقائية مع النقد. |
| جودة | POST /orders/:id/review و/complaints؛ POST /courier/orders/:id/customer-flags؛ POST /admin/customer-flags؛ PATCH /admin/complaints/:id. |
| محتوى | CRUD /admin/banners و/promotions؛ GET /home?governorateId. عرض واحد saving DESC ثم id ASC، لا usage limits غير مصممة. |
| إشعارات | POST/DELETE /devices/push-tokens؛ GET /notifications؛ PATCH /notifications/:id/read؛ POST /admin/campaigns؛ POST /admin/campaigns/:id/schedule أو/cancel. |
| تشغيل | PUT /admin/customer-maintenance؛ CRUD /admin/app-releases؛ CRUD /admin/staff/roles/permissions/scopes؛ GET /admin/audit. |
| تقرير | POST /admin/reports/monthly-sales (month,year,branchIds)؛ GET /admin/reports/:id و/:id/download الخاص؛ يفصل النقد والتحويل والعمولة والخصم والتسليم. |
| ملفات | POST /media/uploads (purpose,mime,size) → uploadId,putUrl؛ POST /media/uploads/:id/complete؛ GET /media/:id/access. الإيصالات والاستثناءات والعكس خاصة. |
| ويب | GET /privacy /terms /support /delete-account و/health/live و/health/ready؛ POST /web/account-deletion/start و/verify. |

## معاينة checkout ثم إصدار العرض

`POST /checkout/preview` يعيد `previewOnly=true, reservationCreated=false, catalogBranchId, estimatedTotals, pricingMode`؛ لا quoteId دائم أو إذن تحويل. تقديم الطلب يعيد `orderId,status=pending_review,reviewStage=awaiting_branch` ولا يزعم إسناد التنفيذ.
معاملة المدير `POST /admin/orders/:id/quotes` تجمع اختيار branchId وحساب السعر من الخادم وبناء العرض وبنوده وcurrent_quote والحجز والأحداث. طريق الخادم أو override إداري مسبب فقط؛ لا يقبل fee أو distance من العميل كحقيقة موثوقة. أول عرض وأي تغيير في فرع التنفيذ يحتاجان قبول صاحب الطلب.
الرد يتضمن catalogBranchId وexecutionBranchId وquoteRevision وpaymentKind وpaymentStatus وallowedActions. الرد لا يتضمن stock counts أو ملاحظات داخلية أو flags أو مفاتيح وسيلة وصول خاصة. الواجهة تعرض floor_km وbilledKm ورسوم التوصيل قبل الخصم والخصم ورسوم العميل.

## بوابات التأكيد والدفع

| النوع | ما يسبق التأكيد | ما لا يترتب تلقائيًا |
|---|---|---|
| transfer | آخر عرض مقبول وفرع معتمد، صافي تحويل متحقق منه مطابق، حجز صالح أو محمي بالمراجعة، ولا استثناء مفتوح. | رفع الصورة لا يعتمد المال؛ approval لا يعفي من معاملة المخزون. |
| cash_on_delivery | آخر عرض مقبول وفرع معتمد، إعادة تحقق وحجز صالح عند الحاجة، ولا استثناء مفتوح. | لا تحويل أو إيصال مطلوب، ولا paid ولا collection بالتأكيد. |

تعاد paymentStatus من السجلات: awaiting_transfer/checking_receipt/verified_transfer أو awaiting_cash_collection/partially_collected/collected/cash_exception، ومع no_payment_due عند إجمالي صفر. لا يشتق paid من status=confirmed أو delivered. cash balance = مجموع قيود التحصيل + عكس التوريد − التوريدات؛ commission balance مستقل.
`deliver` يتطلب actual collection مسجلًا أو cashExceptionId موثقًا إذا المبلغ غير مطابق، مع صلاحية الموصل المسند؛ زر التسليم لا ينشئ نقدًا. يسجل earning عند delivered مرة واحدة، أساسه رسوم التوصيل قبل الخصم. لا تعرض cash collected كدخل موصل.

## رفض صورة الإيصال والحجز

outcome=image_rejected لا يعلن أن المال غير موجود، ويسمح receipt-attempts على payment نفسها. transfer_rejected يعني مراجعة التحويل ونفيه/رفضه بسبب موثق. transfer_verified يثبت مبلغًا فعليًا. stockHoldAction صريح ومبرر بعد المراجعة، ولا worker ينهي حجز receipt_review بالوقت. صورة جديدة لا تزيد الحجز أو مبلغ التحويل. وصول مال بعد quote/طلب منتهٍ يذهب لسجل استثناء، ولا يضيع بسبب رفض endpoint الطلب العادي.

## الصيانة والخصوصية والربط اللاحق

public config/support/privacy/deletion ومتابعة الطلب الجاري وتفاعلاته الضرورية مسموحة أثناء صيانة العميل؛ الكتالوج وpreview وsubmit محجوبة. المدير والموصل غير محجوبين. لا تعتمد header وحده لتحديد الهوية. صلاحيات cash.collect وcash.remit وcash.adjust وcash.reverse وpayments.verify وcommissions.settle وprivacy.manage منفصلة.
عناوين وبيانات التواصل في order_private_details مرتبطة بالعرض؛ لا endpoint تعديل عام لها بعد إرسال العرض. تعمية البيانات لاحقًا خدمة مقيدة وفق السياسة، ولا ترفع حظر UPDATE على دفاتر المال. لا مدد احتفاظ مخترعة.
يجب تحويل هذا المرجع إلى OpenAPI بأمثلة نجاح/فشل واختبارات عقود وRBAC وتزامن قبل الربط. لا استجابة موصوفة هنا تعني أن API منفذ في المرحلة00.

## ملحق08 المنفذ

- GET/POST `/admin/payment-methods` وPUT `/admin/payment-methods/:id`؛ صلاحيةpayment-methods.write مستقلة، العام يحتاج نطاقًا عامًا.
- الاستثناءات وتسوياتها ضمنGET تفاصيل الطلب مع النطاق المناسب. POST `/admin/orders/:id/exceptions` يفتح سجلًا؛ `/settlements` يوثق direction/amountYer/reason/reference/proofMediaId/occurredAt؛ `/resolve` يغلقه بعد التحقق والإثبات. كلها تحتاجexpectedVersion ومفتاحًا ثابتًا. لا محفظة أو استرداد آلي.
- GET التفاصيل يعيدcatalogBranchId/executionBranchId/quoteRevision/paymentKind/paymentStatus/quoteValidity/allowedActions من الخادم. لا أعداد مخزون المتجر؛ holds تخص بنود الطلب نفسه. لا نص بلاغ أو بيانات إيصال تاريخي خارج صلاحيات الفروع.
- snapshot الطريق المالي لا يكرر إحداثيات العميل؛ privateDetailsId يربطه بالنسخة الخاصة. `addressId` الاختياري عند إصدار العرض يحتاج عنوانًا مملوكًا للعميل في محافظة الطلب، ويصدر نسخة خاصة وعرضًا وقبولًا جديدًا.
- PUT/POST للمزودات الحقيقية لم تختبر في08؛ نجاح المحولات المعزولة لا يعني تهيئتها.

## إضافة التنفيذ09

نُفذ الإسناد المتعدد والطريق والتسليم والعمولة المثبتة والتحصيل الفعلي المستقل والصرف/التوريد وتخصيصاته والعكس وcredit مرة واحدة، والتقييم والشكوى والبلاغ والتنبيه للطلب التالي. [العقد والسلوك وحدود الصلاحيات](DELIVERY.md). migration0006 إضافي؛ تبقى الدفاتر والتخصيصات الأصلية append-only. لا مفاتيح خدمات جديدة؛ لا Push قبل10 ولا اختبار مزود حقيقي دون طلب المالك.
