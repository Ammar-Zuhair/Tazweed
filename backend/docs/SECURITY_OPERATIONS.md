# الأمان والتشغيل والخصوصية
## الهوية
توحيد الأرقام إلى E.164 +967 مع قبول 9 أرقام محلية والتحقق بقواعد المشغلين المحدّثة، وعدم إضافة رمز دولة من إعداد الجهاز. Argon2id لكلمات المرور، ورسائل خطأ لا تكشف وجود الحساب. كلمة المرور لا تُرسل إلى OTP provider. تحدي التسجيل يُحفظ مؤقتًا أو يحتفظ بـpassword_hash فقط؛ لا حساب نشط قبل نجاح OTP. الدخول يطلب password ثم OTP قبل إصدار session كامل.
OTP عشوائي آمن 6 أرقام، صلاحية5 دقائق، محاولة5، إعادة إرسال60 ثانية مبدئيًا، حدود حسب IP والرقم والجهاز، لا أكواد في السجلات. استخدم HMAC بمفتاح خادم لتخزين digest الرمز، لا hash غير مملح يسهل كسره. التحدي مقيد purpose/phone/app/pre-auth وذو استخدام واحد. لا mock OTP في production، ولا master bypass. جلسة قصيرة وتجديد دوّار مخزن hash في DB وSecureStore على الجهاز، إبطال عند الحذف أو تغيير كلمة المرور. استرداد كلمة المرور OTP منفصل.

## RBAC
صلاحيات منفصلة: catalog.write، attributes.write، inventory.adjust/transfer، orders.review/reprice/confirm/reject، payments.verify، orders.assign، couriers.manage، commissions.settle، reports.read، promotions.write، notifications.broadcast، maintenance.write، releases.write، staff.manage، audit.read، privacy.manage. كل موظف نطاق فرع/فروع أو global محدد صراحة. لا مدير فرع يعدل نسب موصلي فرع آخر. صلاحية maintenance والإصدارات والبث العام للمدير العام افتراضيًا. تسجيل الموظفين والموصلين داخلي فقط.

## R2
bucket عام لصور الكتالوج المعالجة، وآخر خاص للإيصالات والمرفقات. يخزن DB object_key وليس URL مؤقتًا. presigned PUT لمدة5 دقائق لkey عشوائي يحدده الخادم، وحد حجم ونوع وتحقق magic bytes وفحص صورة بعد الرفع عبر completion endpoint قبل اعتمادها. لا تكتفِ بـContent-Type من الجهاز. إيصال private GET بتصريح مالك الطلب أو موظف مخوّل ومدة قصيرة؛ الموصل لا يحتاج الإيصال المالي افتراضيًا. CORS لمصادر الويب المحددة، إزالة EXIF للموقع، سياسة تنظيف orphan uploads وحذف ملفات الحساب عند تنفيذ الحذف. لا proxy للبايتات عبر Express في المسار المعتاد.

## الصيانة والإصدارات
الصيانة في الخادم على customer scope، ليست علمًا في التطبيق فقط، ولا تعتمد X-App كدليل صلاحية. endpoints مشتركة للإدارة لا تتأثر. public config، privacy، delete-account، دعم، وطلبات العميل الجارية ضمن قائمة استثناء واضحة وفق DECISIONS. 503 MAINTENANCE مع Retry-After وواجهة جذابة، بلا إعادة إرسال تلقائية لطلبات كتابة.
إصدارات لكل app/platform/environment: minimum_build وlatest_build وstore_url وmessage. تحقق أرقام build بمقارنة أعداد، لا مقارنة strings للنسخة. OTA سياسة fingerprint وقنوات staging/production مستقلة. لا reloadAsync أثناء الاستخدام، تنزيل بالخلفية واستخدام التالي عند تشغيل جديد. أي إضافة native/تعديل icon/صلاحيات يستلزم build جديدًا ومطابقة runtime.

## الحذف والصفحات العامة
Express يقدم /privacy و/terms و/support و/delete-account بعربية وRTL. حذف من التطبيق بتحقق حديث، ومن الويب برقم+OTP دون الحاجة لتثبيت التطبيق، مع rate limiting وCSRF عند استخدام cookie. لا تدّع صفحة وهمية أنها نفذت الحذف. تعرض رقم متابعة وحالة الطلب والمدة المعتمدة.
طلب مفتوح لا يمنع استقبال طلب الحذف؛ التواصل وحسم الالتزامات قبل حذف ما يلزم تشغيلًا مع تفسير واضح. حذف العناوين وtokens وpush tokens والملفات غير اللازمة وتعمية البيانات الشخصية في snapshots عند انتهاء سياسة الاحتفاظ. السجل المالي والأمني يحتفظ بالحد الأدنى والمدة التي يقرها المالك قانونيًا، ويذكر ذلك في الخصوصية. راجع مزود OTP وR2 والنسخ الاحتياطية. لا إطلاق بسياسة تحتوي حقولًا غير مكتملة.

## النشر والنسخ الاحتياطي
HTTPS، CORS محصور، Helmet، حدود body/files، request ID، مراقبة أخطاء دون بيانات حساسة. logs لا تحتوي password/OTP/tokens/receipt URLs. DB user محدود؛ credentials للبيئات منفصلة. Secrets في secret store أو .env غير committed. ربط OTP وFCM/APNs وفحص الإشعارات على أجهزة فعلية.
نشر الخادم rolling أو blue/green مع readiness ولـhealth endpoints، وإيقاف رشيق وdrain للworker. migrations بأسلوب expand/contract للحفاظ على الإصدارات القديمة، لا حذف أعمدة في أول نشر. نشر migration قبل code المتوافق أو بعده وفق خطة ملموسة. rollback للكود مع schema متوافقة، backup مشفر وتجربة restore؛ نشر بلا انقطاع يحتاج الاستضافة المناسبة وليس ضمانًا من الكود وحده.

## إضافات قرارات متابعة00
صلاحيات مستقلة مقترحة للتنفيذ: cash.collect للموصل المسند، cash.remit للإدارة المستلمة، cash.adjust وcash.reverse للمخول، financial-exceptions.resolve، مع payments.verify وcommissions.settle وprivacy.manage القائمة. منع قراءة نقد/عمولة موصل آخر أو إثبات مالي لطلب خارج الفرع. لا تعتبر إخفاء زر جمع/توريد حماية.
تعليمات التحويل قبل عرضه snapshot غير قابل للتعديل؛ ملفات الإيصال والاستثناء والعكس خاصة ومتحقق منها. صورتان لنفس التحويل ليستا دفعتين. لا يحرر حجز receipt_review بالوقت، بل قرار مراجعة مسبب وصلاحية مناسبة، مع إنذارات وضوابط رفع ومحاولات دون مدة مالية جديدة.
بيانات العنوان/التواصل في order_private_details، والتعمية بعد التحقق والسياسة المقبولة فقط. حارس SQL يسمح بتفريغ أحادي الاتجاه مع أثر تدقيق دون تحرير الدفاتر؛ تخصيص صلاحيات DB للقراءة/التعمية المقيدة في05/11 مطلوب، وليس نشر grants عام. لم تعتمد مدد احتفاظ أو ميزانية نسخ أو RPO/RTO؛ لا وعد بحذف فوري لكل أثر مالي أو تعمية بيانات طلب جارٍ.
