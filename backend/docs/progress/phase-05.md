# المرحلة05 — قاعدة البيانات والهوية والصلاحيات

نفذت **05 فقط** بطلب المالك بعد مراجعته المرحلة السابقة. قرأت `remember.md` وتقريري04 ووضوح الخط اللاحق، وخطة05 ومراجعها من المستودع: MASTER_PROMPT وREQUIREMENTS وDECISIONS وOWNER_DECISIONS وISSUES وARCHITECTURE وDATABASE وschema.sql وSECURITY_OPERATIONS وAPI وACCEPTANCE و.env.example. لا تنفيذ06 أو ربط لخدمات الكتالوج والمخزون.

النتيجة: خادم Express بهوية password+OTP وجلسات وصلاحيات حقيقية علىPostgreSQL محلي، مع OpenAPI واختبارات HTTP/DB. **مزود OTP الفعلي غير مهيأ**؛ نجاح الاختبارات يستخدم مزود التقاط معزولًا، ولا يثبت إرسالSMS/WhatsApp أو تشغيلًا على هاتف. تطبيقات Expo الثلاثة وSDK57 تبقى معاينات محلية منفصلة.

## ما نُفذ

| الجزء | السلوك والملفات الأساسية |
|---|---|
| migrations | `database/migrations/0001_reference_69.sql` يحفظ المرجع المعتمد حرفيًا، مع نقل حدودtransaction إلىrunner. `0002_identity_security.sql` إضافة حقول الربط وتاريخrefresh وحدود المحاولات وحارس منحstaff. `src/migrate.ts`: اتصال وقفل واحد، transaction لكل ملف، SHA256 ومنع التغيير/الترتيب الخاطئ. لا down تدميرية أو بيانات متجر وهمية. |
| قاعدة فعلية | PostgreSQL16.15 خاص على127.0.0.1:55432، وبيانات دائمة داخل`.postgresql/data` غير ملتزمة.72جدولًا =69مرجعية +2هوية +schema_migrations؛49trigger مقابل48فيbaseline. `setup.sh` يستعيد البرامج، و`db:local` يعيد خدمة التطوير بعد إعادة إنشاء الحاوية. لم يُنشأ حساب أو منتج تشغيل تلقائيًا. |
| إعدادات وحدودHTTP | `src/config.ts`, `app.ts`, `http.ts`, `server.ts`: مدخلاتZod صارمة، Helmet، CORS بمصادر محددة، JSON16kb، requestId مولد، أخطاء منظمة بلا تفاصيلSQL أو بيانات اعتماد، وسجلات بأسماء المسارات لاbody/query/tokens. رفض تهيئةproduction الناقصة أو المزود التجريبي. |
| هوية | `src/identity/auth.ts`, `security.ts`, `contracts.ts`: تسجيلcustomer فقط، دخولcustomer/admin/courier بكلمة مرور ثمOTP، استرداد منفصل، تطبيع أرقام اليمن، ورسائل لا تكشف وجود الحساب. Argon2id64MiB/3/1؛ pending payload مشفر يحملhash فقط، ولا حساب نشط أوsession كاملة قبلOTP. |
| تحدياتOTP |6أرقامCSPRNG،5دقائق،5محاولات محفوظة حتى عند الرفض، resend60ث لا يمحو العداد. HMAC مقيد بالغرض والهاتف والتطبيق والجهاز وpreauth والجيل، واستخدام واحد بقفل. التحدي البديل يبطل القديم، وفشل الإرسال يتراجع دون إعلان نجاح. حدودIP/phone/device مشتركة عبرDB؛ X-Forwarded-For غير موثوق افتراضيًا. |
| جلسات | access موقّعEd25519/15دقيقة، وrefresh عشوائي محفوظhash بعائلة30يومًا ثابتة. تاريخspent وقفل يمنعان تكرار التدوير؛ replay يبطل العائلة وaccess فورًا. الغرض/app/device لا يتبادلون التوكن. logout/reset/disabled/deleted يبطلون الاستخدام؛ refresh لا يعيد طلبOTP. |
| ملكية الحساب | `/me` وتعديل الاسم فقط، وعناوينcustomer المملوكة: إنشاء/قراءة/PATCH/أرشفة. لا mass assignment للمالك أوkind/status. قفل المستخدم وUNIQUE يمنعان وجود عنوانين افتراضيين متنافسين. |
| RBAC ونطاق | `access.ts`, `routes.ts`: صلاحية الإجراء ونطاق كل فرع منDB، لا ثقة برأسapp وحده أوصلاحية داخلJWT قديم. قراءة موظفين/منح/تدقيق ضمن الفرع؛ تغيير الأدوار والمنح والهوية يتطلبstaff.manage عامًا. guard متعدد الفروع يشترط جميع الفروع؛ خدمة نقل المخزون نفسها مؤجلة06. حماية آخر مدير عام والدور الأساسي. |
| إدارة داخلية | أدوار وصلاحيات ومنح، إنشاءstaff/courier بحالةpending، تغيير حالة موثقة مع إبطال الجلسات والتحديات. `bootstrap.ts` أمر مشغل لأول مدير بمدخلات آمنة دون كلمة افتراضية، يمنع التكرار ويتطلبOTP عند الدخول؛ اختبر فيDB مؤقتة فقط. |
| تدقيق وخصوصية | `audit.ts`: أثر للانتقالات الأمنية دون نسخ أسماء/هواتف/كلمات/رموز أوعناوين. audit append-only. `runtime-grants.sql` يزيل منح الجداول والأعمدة القديمة ثمallowlist الهوية؛ runtime لا يقرأorder_private_details ولا يحرر الدفاتر أوينتمي إلىprivacy. دورprivacy مستقلNOLOGIN وUPDATE أعمدة التعمية فقط مع الحارس السابق؛ لاAPI تعمية أومدة احتفاظ معتمدة في05. |
| أوامر وعقد | `prune-auth.ts` ينظفpayload المنتهي/المستهلك وrate buckets المنتهية، دون حذفaudit/هوية/مال؛ أمر مشغل غير مجدول تلقائيًا. `openapi.ts` و`responses.ts` و`docs/openapi.phase05.json`: المجموعة المنفذة فقط، schemas وأمثلة نجاح/رفض؛ توليد وفحص تطابق مع المصدر ومطابقة الاستجابات الحقيقية عبرAjv2020. |

## نتائج الفحص

الدليل القابل للمراجعة: [phase-05-checks.json](phase-05-checks.json)، و[نتائج مختصرة بلا أسرار](phase-05-evidence/acceptance.txt). يحفظ JSON التوقيت وبصمات المصدر ونسخةPostgreSQL وSHA migrations وحقوق الأدوار وحالة الخدمات؛ الأرقام التالية من الجولة النهائية، لا من مسودات الاختبار السابقة.

- **44 اختبارًا ناجحًا،0فشل،0تخطي**: هوية/HTTP/DB، وتهيئة أول مدير والتنظيف، وعقدgateway المعزول. الردود التي تمر عبر مساعدHTTP تتحقق منschemas المنشورة، بما فيها رفض الملكية والصلاحيات. قاعدة API تستعمل فعلًا`tazweed_app` المحدود، وإعدادfixtures فقط عبرowner.
- **73 اختبارًا ناجحًا S01–S22 وO01–O51 علىPostgreSQL TCP الحقيقي**: حفظ علاقات69جدولًا وحراس الوحدات والعرض والقبول والتحويل والحجز المحمي والدفترين والخصوصية. هذه اختبارات قيودbaseline، وليست خدمة طلبات/مال أو اختبار تزامن لمخزون المرحلة06.
- نجح `npm run typecheck` و`npm run build` و`npm run openapi:check`. نجح فحص القاموس المرجعي:69جدولًا و48trigger، دون تعديل الجزء المولد فيDATABASE.
- اختبرت migration من قاعدة فارغة، وإعادة التطبيق دون تغييرات، ورفضchecksum المتغير، والتراجع الذري لإضافة فاشلة. اختبرت رفضSQL لتعديل الدفاتر أوقراءة/تعميةsnapshot منruntime، ورفضSET ROLE privacy، وإزالة منح أعمدة غير مسموحة عند إعادة ضبط الحقوق.
- هجماتOTP: غرض/app/device/preauth خاطئ، انتهاء صلاحية،5محاولات متزامنة، resend مبكر، عدم تصفير المحاولات، فشل إرسال/إعادة إرسال، وتحقق متزامن لا يصدر إلاsession واحدة. لا رمز فيردAPI أوlogs، ولااعتماد لـ000000 المعاينة.
- هجماتtokens: توقيع محرف/unsigned، app/device خاطئ، refresh متزامن وreuse، logout، reset، حسابdisabled/deleted وعائلة منتهية. اختبرت أن reset يرفض كلمة المرور القديمة ويلغيsessions، ثم يسمح بدخول جديد دون تجاوزOTP.
- هجمات ملكية/نطاق: عناوين عميل آخر تعيد404 ولا تتغير، حقولمالك/kind/status ترفض، جميع المسارات المحمية ترفضtoken المفقود، فرع آخر أوglobal غير مخول يرفض، وسحب صلاحية يظهر معaccess قائم. audit المحلي يخفي الفرع الآخر وNULL العام، ولا يمكن محوه. guard النقل اختبر على فرع واحد/الفرعين دون إنشاءendpoint نقل مؤجل.

`npm test` ينشئ قاعدتين`tazweed_test_*` ويزيلهما بعد الفحص؛ لا PGlite fallback. ملفات الالتقاط داخلtests فقط. كانت هناك إخفاقات أثناء التطوير أُصلحت ثم أعيدت الجولة؛ تفاصيلها P05-02..07 في [ISSUES](../../../ISSUES.md)، وليست نتيجة القبول النهائية. لا إعادة اختبارات واجهات أوهاتف/أنفاق في05؛ مصادر التطبيقات لم تتغير.

## التشغيل الفعلي للمراجعة

| الخدمة | الحالة المفحوصة |
|---|---|
| `tazweed-backend-8084` | active/running، يستمع0.0.0.0:8084، و`GET /health/live` محليًا200 معphase05. البيئة`.env.runtime.local` بصلاحية600 ولا تحتويMIGRATION_DATABASE_URL. |
| `tazweed-postgres-55432` | active/running، يستمع127.0.0.1:55432 فقط، مع حسابowner للأوامر وحسابapp محدود للعملية. |
| `GET /health/ready` |503 مقصود: database=connected، migrations=current، runtimeRole=limited، otp=unconfigured. فحص الاختبار يميز أيضًا انقطاعDB وحسابowner غير الآمن. |
| بدءOTP |503 `OTP_UNAVAILABLE` في خادم المراجعة، بلا إنشاءuser/session أو ادعاء إرسال. |
| OpenAPI | `GET /api/v1/openapi.json` محليًا200 مطابق بنيويًا لملفJSON المولد. |

الرابط الخارجي: [فحص حياة خادم05](https://tazweed--8084.dev.remote-ammar.duckdns.org/health/live)، و[OpenAPI](https://tazweed--8084.dev.remote-ammar.duckdns.org/api/v1/openapi.json). بوابةHTTPS أعادت302 إلى دخولremote.futrx؛ ذلك يثبت مسار البوابة فقط، وليس جلسة مالك مصادقًا عليها. التحقق الكامل منAPI ونتائجه أعلاه محليHTTP معPostgreSQL حقيقي. [دليل التشغيل والأوامر](../../README.md) يشرح إعادة الخدمات والصلاحيات والتهيئة الداخلية.

## الحدود وما بقي لمراحله

1. لا إعدادOTP في بيئة المشروع. `HttpsOtpProvider` عقد بوابة عام يرسلphone/code/purpose/app/challengeId إلى عنوان محدد بالخادم، بمهلة5ثوانٍ ومنعredirects. اختبار الناقل يستبدلfetch داخلunit test فقط، ومزود التقاطAPI داخلtests فقط؛ لاSMS/WhatsApp حقيقي أوشركة/قناة/تكلفة معتمدة. يلزم إعداد مزود وتجربته قبل ربط هوية الهاتف وتشغيل فعلي.
2. لا تغيير لمعايناتExpo Go57 أوأصول الفيديو والخط والخلفيات؛ دخول المعاينة ليسJWT الخادم. لا جهاز حقيقي أوSecureStore/token binding في التطبيقات مثبت في05. ربط واجهاتها يأتي ضمن مراحله بعد تهيئة الخدمات.
3. لاAPI كتالوج/مخزون/تسعير/طلبات/تحويل/تسليم/نقد/عمولات/R2/Routing/Push أوتعمية حساب فعلية. وجود جداولها أوtestfixture لا يعني تنفيذها. حالةUTC لا تعتمدAsia/Aden؛ D01/D15/D19 وقرارات التشغيل المؤجلة لا تتغير.
4. لا قاعدة إنتاج أو نشر إنتاجي أو اختبارbackup/restore/HA أو ضمان عدم انقطاع. إعدادproxy/TLS ومراقبة الخدمات وجدولة تنظيف الأسرار وسياسة الاحتفاظ المعتمدة ومزود حقيقي فحوص تشغيل مستقلة. runtime لا يحمل بيانات اتصال مالكmigrations.

مراجع قرارات الأمان التقنية: [OWASP لتخزين كلمات المرور](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html)، [OWASP للاسترداد](https://cheatsheetseries.owasp.org/cheatsheets/Forgot_Password_Cheat_Sheet.html)، [معاملاتnode-postgres باتصال واحد](https://node-postgres.com/features/transactions)، [JSON Schema2020-12 فيAjv](https://ajv.js.org/json-schema.html). تنسيق أرقام اليمن يراجع مع [خطةITU](https://www.ituob.org/issues/1025-en/) و[إعلان المشغل لفئة78](https://ae.linkedin.com/posts/yemenmobile_%D8%A7%D9%84%D9%8A%D9%85%D9%86-%D9%8A%D9%85%D9%86%D9%85%D9%88%D8%A8%D8%A7%D9%8A%D9%84-%D8%B4%D8%A8%D9%83%D8%A9%D8%A8%D8%AD%D8%AC%D9%85%D8%A7%D9%84%D9%8A%D9%85%D9%86-activity-7019016280179404800-ItRD)، ولا يحل محل تأكيد الهاتف بالرمز.

**حُدّث التقرير والذاكرة وسجل المشكلات. التوقف بعد05؛ لا تبدأ06 دون طلب منفصل.**
