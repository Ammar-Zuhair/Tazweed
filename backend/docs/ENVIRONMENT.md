# إعداد الخادم للمرحلة06

الملف المحلي المطلوب للمالك هو `backend/.env`، غير مرفوع إلى Git وصلاحيته600. أضيفت أسماء الإعدادات الناقصة دون تغيير أي قيمة موجودة. المثال الآمن المرفوع هو `.env.example`. لا تنسخ مفاتيح خدمات أو قاعدة بيانات أو توقيع إلى التطبيقات أو إلى متغيرات `EXPO_PUBLIC_*`.

## المطلوب الآن، دون اختبار المزودات قبل طلب المالك

| الاسم في backend/.env | المطلوب |
|---|---|
| `OTP_PROVIDER` | غيّره من `UNCONFIGURED` إلى `https-gateway` بعد تجهيز بوابة متوافقة. |
| `OTP_PROVIDER_URL` | عنوان HTTPS للبوابة التي تقبل عقد `{phone,code,purpose,app,challengeId}`. اختيار مزود SMS/WhatsApp أو قالب بعينه لم يحدث تلقائيًا. |
| `OTP_PROVIDER_TOKEN` | Bearer token خاص بالخادم لهذه البوابة؛ مفتاح شركة أخرى قد يحتاج محولًا مناسبًا لعقدها. |
| `R2_ACCOUNT_ID` | معرّف حساب R2. |
| `R2_ACCESS_KEY_ID` | مفتاح S3 محدود بالوعاءين المطلوبين. |
| `R2_SECRET_ACCESS_KEY` | السر المقابل، في الخادم فقط. |
| `R2_PUBLIC_BUCKET` | وعاء الصور العامة المعالجة للمنتجات/الأقسام. |
| `R2_PRIVATE_BUCKET` | وعاء خاص للإيصالات والشكاوى وstaging، مختلف عن العام؛ لا تفعّل public access له. |
| `R2_PUBLIC_BASE_URL` | نطاق HTTPS العام لجذر وعاء الصور العامة، دون query أو credentials. |

يلزم أيضًا إعداد CORS على وعاء R2 الخاص للرفع المباشر من **مصادر الويب المحددة**: PUT وContent-Type/Content-Length، وGET عند الحاجة لعرض الصور الخاصة. لا تستخدم مصدرًا عامًا `*` لمجرد تجاوز خطأ. روابط Expo الأصلية لا تحتاج CORS المتصفح، أما مراجعة الويب فتحتاج أصلها الحقيقي. جهّز lifecycle لحذف `staging/` بعد يوم؛ لا تطبقه على `private/` الذي يحوي إيصالات متحققًا منها. توكن R2 يحتاج قراءة/كتابة/حذف الكائنات في الوعاءين، لا إدارة الحساب. إعداد الدومين العام وbucket policies ورفع/قراءة فعلية سيُختبر بعد إسناد المفاتيح وطلب المالك.

`DATABASE_URL` المحدود و`JWT_PRIVATE_KEY` و`JWT_PUBLIC_KEY` و`OTP_HMAC_SECRET` مولدة محليًا وجاهزة في `.env.runtime.local`، ولا يلزم استبدالها لملء OTP/R2. القيم الفارغة في `.env` تتركها كما هي. اتصال مالك migrations موجود في `.env.local` للمشغل فقط ولا يحمّله HTTP. `PUBLIC_BASE_URL/CORS_ALLOWED_ORIGINS` إعدادات عامة للخادم؛ اضبطهما للنطاق المعتمد عند تشغيل مستقل. لا تجعل `.env` نسخة من ملف المالك.

أسماء محجوزة لمراحل لاحقة وليست خدمات منفذة في06: `ROUTING_BASE_URL` في07، `EXPO_ACCESS_TOKEN` في10، `STORE_SUPPORT_PHONE/PRIVACY_CONTACT_EMAIL` لنصوص التشغيل، وقرار الاحتفاظ في11. `OTP_SENDER_ID/WHATSAPP_AUTH_TEMPLATE` في المثال معلومات محول مستقبلي إن تطلبها المزود؛ العقد العام لا يستهلكها.

## التحميل وإعادة التشغيل

`node dist/server.js` يقرأ `.env.runtime.local` كإعداد أساسي، ثم القيم غير الفارغة من `.env`، ثم متغيرات العملية المصدرة إن وجدت. لا تبدأ HTTP باستخدام `--env-file=.env.local` أو اتصال مالك migrations. الخدمة الحالية بدأت دون `--env-file=.env.runtime.local` كي لا يحجب تحميله المسبق القيم الجديدة من `.env`.

بعد إضافة المفاتيح أخبر الوكيل لاختبار الخدمات كما اتفقنا. إعادة تشغيل `tazweed-backend-8084` تعيد قراءة `.env`؛ التهيئة ليست إثبات إرسال OTP أو نجاح R2. `GET /health/ready` يذكر OTP وstorage ويرجع503 عند نقص أيهما؛ حتى200 يثبت التهيئة وDB فقط، لا نجاح مزود خارجي.

التطبيقات تتلقى access/refresh خاصين بجلسة المستخدم بعد OTP. تحفظ النسخة الأصلية بيانات الجلسة في SecureStore، والويب يحتفظ بها في الذاكرة فقط؛ لا تُحفظ كلمات المرور أو OTP. هذه بيانات جلسة ضرورية وليست مفاتيح خدمة أو صلاحيات خادم.

مراجع: [R2 presigned URLs](https://developers.cloudflare.com/r2/api/s3/presigned-urls/)، [R2 CORS](https://developers.cloudflare.com/r2/buckets/cors/)، [Expo SecureStore](https://docs.expo.dev/versions/v57.0.0/sdk/securestore/). الروابط الموقعة تُنشأ من الخادم، وهي صلاحية مؤقتة لكائن واحد؛ قد تحمل معرّف access key في التوقيع، دون نقل secret access key إلى التطبيق.
