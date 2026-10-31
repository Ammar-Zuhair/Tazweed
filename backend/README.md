# خادم تزويد — المرحلة05

Express5/TypeScript وPostgreSQL16: هوية password+OTP للتطبيقات الثلاثة، جلسات دوارة، ملف العميل وعناوينه، إدارة داخلية للأدوار والموظفين ونطاق الفروع، وتدقيق وhealth. [OpenAPI الفعلي](docs/openapi.phase05.json) و[تقرير05](docs/progress/phase-05.md). الكتالوج والمخزون والطلبات وخدمات المزودات الأخرى في مراحلها؛ تطبيقات Expo الحالية ما زالت معاينات محلية.

## تشغيل محلي داخل حاوية المشروع

```bash
bash /workspace/setup.sh
cd /workspace/backend
npm run db:local
npm run db:migrate
npm run db:grants
npm run typecheck
npm test
npm run build
npm run openapi:check
```

`db:local` أمر تطوير للحاوية فقط، يحتاج root داخلها وPostgreSQL16. ينشئ خدمة `tazweed-postgres-55432` على **127.0.0.1:55432**، وبيانات دائمة غير مرفوعة في `/workspace/.postgresql/data`. يعاد الأمر بعد إعادة إنشاء الحاوية لاستعادة الخدمة من البيانات نفسها. لا يكتب بيانات متجر أو حسابات تشغيل. `setup.sh` يستعيد البرامج والحزم فقط.

ينشئ سرَّين محليين غير ملتزمين وبصلاحية600:

- `.env.local`: إعداد المشغل وبيان اتصال مالك migrations، للأوامر الإدارية والاختبارات فقط.
- `.env.runtime.local`: إعداد العملية وحساب DB المحدود؛ **بلا بيانات اتصال مالك migrations**. لا تنقل الملفين إلى التطبيقات أو تقارير الأدلة.

لخادم يبقى بعد انتهاء الأمر، افحص8084 أولًا ثم شغّل:

```bash
systemd-run --unit=tazweed-backend-8084 --collect --service-type=exec \
  --working-directory=/workspace/backend --property=Restart=on-failure --property=RestartSec=2s \
  /usr/bin/node --env-file=.env.runtime.local dist/server.js
```

افحص `systemctl is-active tazweed-backend-8084` و`curl -fsS http://127.0.0.1:8084/health/live` والـlogs بعد انتهاء أمر التشغيل. المسار الخارجي لهذه الحاوية: `https://tazweed--8084.dev.remote-ammar.duckdns.org/health/live`. لا تعرض PostgreSQL للعامة.

`GET /health/live` حياة العملية. `GET /health/ready` يفحص DB ونسختَي migration وصلاحية حساب التشغيل ومحول OTP؛ يعيد503 إن غاب مزود OTP. **UNCONFIGURED لا يرسل رسائل، ومسارات بدء التحقق تعيد503**. لا تتغير هذه النتيجة بوجود رموز المعاينة المحلية في تطبيقات Expo. الخادم يرفض البدء بحساب DB واسع الصلاحيات أو schema غير مهيأة.

## الهوية والمزود

`/api/v1/openapi.json` يصف المسارات المنفذة. عمليات البدء تطلب `app` و`deviceId` عشوائيًا ثابتًا للتثبيت (32–128 محرفًا) ورقم اليمن؛ ثم يعاد `challengeId/preauthToken` دون الرمز. العمليات المحمية تحتاج `Authorization: Bearer …` و`X-Client-App` مطابقًا لـaudience الموقَّع. الرأس وحده لا يمنح صلاحية. العميل العام يسجل customer فقط؛ الموظف/الموصل يُنشآن داخليًا pending ويؤكدان الهاتف عند الدخول الأول.

- Argon2id: ذاكرة64MiB،3مرات،parallelism1؛ كلمات12–128محرفًا، بلا تخزين كلمة المرور في التحدي أو إرسالها للمزود.
- OTP عشوائي6أرقام/5دقائق/5محاولات، resend60ثانية دون إعادة عداد المحاولات. HMAC مقيد بالهاتف والغرض والتطبيق والجهاز وpreauth والجيل. payload مشفرAES-GCM ويضم hash فقط. يبطل التحدي القديم عند إصدار بديل.
- access موقّعEd25519 لمدة15دقيقة. refresh عشوائي وhash في DB، عمر عائلة ثابت30يومًا، وتدوير بقفل. إعادة استعمال token مستهلك تبطل العائلة بما فيها access الحالي؛ لا تعِد محاولة refresh القديمة تلقائيًا عند فقد الرد، بل أعد الدخول. التطبيق يفحص حالة الجلسة والحساب على كل طلب.
- حدود15دقيقة مشتركة عبر DB: start ‏60/IP و20/device و10/phone؛ verify ‏100/IP و40/device و30/phone؛ refresh ‏200/IP و100/device. cooldown الهاتف لا يتجاوز بتغيير الجهاز. تعاد429 معRetry-After إرشادي60؛ عداد النافذة هو المرجع. `trust proxy=false`؛ لا يعتمد X-Forwarded-For. اضبط proxy موثوقًا محدودًا واختبره قبل تشغيل خلف proxy إنتاجي؛ CORS قائمة مصادر محددة.

واجهة المزود `OtpProvider` ومحول `https-gateway` عقد HTTP عام يحتاج بوابة يهيئها المشغل، وليس اختيار شركة SMS/WhatsApp أو إثبات ربطها. JSON: `{phone,code,purpose,app,challengeId}`، وBearer server token، HTTPS فقط، مهلة5ثوانٍ، منع redirects؛2xx قبول إرسال وليس إثبات تسليم للهاتف. لا يمرر كلمة مرور، ولا يقرأ/يسجل body رد المزود. يلزم التحقق من العقد والتوقيع/القالب وشروط المزود المختار وتجربة رسالة حقيقية قبل اعتماده. `OTP_PROVIDER_URL/TOKEN` في الخادم فقط. لا تضع الرموز أو الأسرار في السجلات.

مزود الالتقاط موجود داخل `tests/phase05` فقط؛ createApp يرفضه خارج NODE_ENV=test، كما يرفض config أي mode تجريبي. production يتطلب مفاتيح وحالةHTTPS وCORS ومزودًا مهيأ؛ هذا فحص تهيئة، وليس شهادة نجاح مزود أو إذن نشر.

## migrations والصلاحيات والتشغيل

SQL صريح مع `pg` للحفاظ على حراس المرجع؛ لم يُعَد تفسيرها عبر ORM. `0001_reference_69.sql` يحفظ69جدولًا وقيودها، ثم `0002_identity_security.sql` يضيف حقول الربط وجدولَي token history/rate buckets. المجموع72معschema_migrations. runner يقفل اتصالًا واحدًا ويطبق كل ملف فيtransaction معSHA256، ويمنع تغير الملف المطبق أو ترتيب غير صالح. لا down migration تدميرية؛ التراجع عن الكود مع schema إضافية، والإصلاح بmigration لاحقة. قبل إنتاج: نسخة احتياطية واختبارrestore وخطة نشر مستقلة، لا صلاحيات migrations داخل عملية HTTP.

`database/runtime-grants.sql` يحتاج أدوارًا منفصلة يجهزها المشغل: `tazweed_owner` مالك المخطط، `tazweed_app` LOGIN بلا superuser/createrole/createdb/memberships، و`tazweed_privacy` **NOLOGIN بلا عضوية للتطبيق**. الأخير SELECT للنسخ الخاصة وUPDATE لأعمدة التعمية فقط مع الحارس والتدقيق الحاليين؛ لا تعديل مالي عام. لا API تعمية في05، ولا مدة احتفاظ مفترضة؛ الخدمة والسياسة والتحقق من الالتزامات في11. صلاحية `privacy.manage` في سجل أذونات التطبيق لا تمنح صلاحية SQL تلقائيًا.

`staff.manage` العام مطلوب لتغيير هوية موظف أو دور أو منحة لأن الدور قابل للاستخدام عبر فروع. النطاق المحلي يقرأ موظفي فرعه ومنحهم فقط. التدقيق المحلي يخفي الفروع الأخرى وNULL العام. guard العمليات متعددة الفروع يشترط جميع الفروع والإجراء نفسه؛ استخدامه في خدمات النقل الفعلية في06. تعديل صلاحيات الدور ينعكس على الطلب التالي حتى معaccess قديم.

للتهيئة الداخلية الأولى فقط: مرر `BOOTSTRAP_PHONE/BOOTSTRAP_NAME/BOOTSTRAP_PASSWORD` عبر بيئة آمنة إلى `npm run bootstrap:admin`. الأمر يمنع التكرار ويُنشئ مديرًا pending؛ لا كلمة افتراضية ولا دخول كامل قبل OTP. لم يُنشأ مدير تشغيل تلقائيًا. لا تحذف حسابات أو دفاتر لتهيئة بيانات.

`npm run auth:prune` أمر مشغل يمسح payload التحديات المنتهية/المستهلكة وعدادات rate المنتهية فقط. لا يحذفaudit أو الهوية أو التاريخ المالي ولا يختلق مدة احتفاظ لها؛ جدولة تشغيله ضمن خطة التشغيل. لا يوجد worker تنظيف منشور تلقائيًا.

## الفحص وحدوده

`npm test`/`test:phase05` ينشئ قاعدتين مؤقتتين باسم`tazweed_test_*` داخل الخادم المحلي ويزيلهما في النهاية: HTTP بهوية DB محدودة واختبارات ملكية/نطاق/OTP/rotation متعددة الاتصالات، وتتحقق استجاباتها منschemas المنشورة بواسطةAjv2020، ثم اختبارات حراس SQL المرجعية على PostgreSQL TCP الحقيقي. يفشل إن لم تتوفر DB؛ لا fallback إلىPGlite. اختبار gateway منفصل بمحولfetch معزول، وليس رسالة فعلية.

لبيئة CI مختلفة، جهز DBs معزولة وأدوارها ثم مرر `TEST_MIGRATION_DATABASE_URL/TEST_DATABASE_URL` إلى `node --import tsx --test tests/*.test.ts` و`REFERENCE_DATABASE_URL` إلى `reference-tests/schema.test.mjs` وفق بادئات الأسماء الآمنة فيhelpers. مسار الاختبار الافتراضي القديم لـreference-tests يظلPGlite، وهو دليل إضافي مستقل لا بديل لـPostgreSQL الحقيقي.

لا أعمال06، ولا نقل لواجهة الهاتف إلى خادم غير مهيأ بمزود حقيقي؛ Go/SDK57 والأصول تبقى كما هي.
