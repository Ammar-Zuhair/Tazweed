# أدلة09 والتشغيل

الدليل يخص09 فقط. [التقرير](../phase-09.md)، [الفحوص النهائية](../phase-09-checks.json)، [سجل القبول](acceptance.txt)، [نتائج الواجهة](ui-checks.json)، [فحص الأنفاق](../phase-09-tunnels.json). الصور من Chromium لواجهات Expo web مع API/PostgreSQL فعليين في قواعد مؤقتة، وCaptureProvider/TestRouting/TestStore بدل مزودات خارجية؛ ليست بيانات متجر أو جهاز هاتف أو نجاح OTP/R2/Routing حقيقي.

12جولة واجهة،33لقطة، بلاpageErrors أوطلب مزود حقيقي. تشمل إسناد500−100 عند20%=عمولة100، عدة مهام، التحصيل المنفصل، فقد إقرار التسليم بعدcommit ثم نفس المفتاح، بلاغًا مع مرفق وتنبيهه قبل قبول طلب لاحق، تقييمًا وشكوى خاصة ورد الإدارة، صرفًا وعكسًا وcredit يعاد مرة، وتوريد500 كاملًا دون طرح100، ثم400 نقد فعلي+استثناء100 قبل التسليم. المصفوفة360/390/1024 بالثيمين للتطبيقات الثلاثة.

## لقطات رحلة العمل

- [إعداد الموصل وسجل تعديلاته](admin-courier-configuration-history.png)، [إسناد المدير](admin-dispatch-light-390.png)، [عدة مهام](courier-multiple-tasks-light-390.png)، [عنوان وبنود المهمة](courier-task-light-390.png)، [أساس العمولة والنسبة والخصم](courier-commission-snapshot-light-390.png).
- [فقد إقرار التسليم](courier-delivery-lost-ack.png)، [نقص النقد والاستثناء](courier-shortfall-delivered.png)، [بلاغ وصورة متحقق منها](courier-report-attachment.png)، [تنبيه طلب العميل التالي](admin-next-order-warning.png).
- [التقييم](customer-review.png)، [الشكوى](customer-complaint.png)، [المرفق الخاص لدى الإدارة](admin-complaint-attachment.png).
- [صرف العمولة](admin-commission-paid.png)، [العكس وإعادةcredit](admin-reversal-credit-repaid.png)، [توريد نقد المتجر كاملًا](admin-cash-remitted.png).

## الثيمان والمقاسات

| التطبيق | فاتح360 /390 /1024 | مظلم360 /390 /1024 |
|---|---|---|
| العميل | [360](customer-light-360.png) / [390](customer-light-390.png) / [1024](customer-light-1024.png) | [360](customer-dark-360.png) / [390](customer-dark-390.png) / [1024](customer-dark-1024.png) |
| الإدارة | [360](admin-light-360.png) / [390](admin-light-390.png) / [1024](admin-light-1024.png) | [360](admin-dark-360.png) / [390](admin-dark-390.png) / [1024](admin-dark-1024.png) |
| الموصل | [360](courier-light-360.png) / [390](courier-light-390.png) / [1024](courier-light-1024.png) | [360](courier-dark-360.png) / [390](courier-dark-390.png) / [1024](courier-dark-1024.png) |

## المراجعة والتشغيل

| التطبيق | المعاينة عبرremote | الوحدة والport | المسار |
|---|---|---|---|
| العميل | [المعاينة](https://tazweed--8081.dev.remote-ammar.duckdns.org/) | `tazweed-customer-preview-8081`،8081 | `/` ثم الحساب/طلباتي |
| الإدارة | [المعاينة](https://tazweed--8082.dev.remote-ammar.duckdns.org/) | `tazweed-admin-preview-8082`،8082 | `/orders`،`/couriers`،`/finance`،`/quality` |
| الموصل | [المعاينة](https://tazweed--8083.dev.remote-ammar.duckdns.org/) | `tazweed-courier-preview-8083`،8083 | `/account` ثم `/` و`/earnings` و`/cash` |
| API | [live](https://tazweed--8084.dev.remote-ammar.duckdns.org/health/live) | `tazweed-backend-8084`،8084 | `/health/live` و`/health/ready` |

الخدمات durable عبرsystemd وHTTP على0.0.0.0؛ PostgreSQL خاص127.0.0.1:55432 بوحدة `tazweed-postgres-55432`. قاعدة المراجعة فارغة من حسابات/طلبات/بيانات متجر تجريبية؛ لا كلمة مرور أوOTP ثابت في هذه الصفحات. لإجراء التجربة التشغيلية لاحقًا يلزم ملء المزودات وبيانات المتجر وإنشاء حساب موصل وتحديد نسبة وفروع، بعد طلب المالك فحص الخدمات.

التحقق التشغيلي النهائي موثق فيphase-09-checks.json: حالة الوحدات، المستمعون،local routes ومطابقة HTML للتصدير ورفضHost غير موثوق، logs وOpenAPI، وHTTPS ingress. إعادة توجيه302 تعني بوابةremote فقط ولا تثبت دخول مستخدم مصادقًا. جاهزية503 متوقعة حتى إعداد المزودات، ولا تسمى نجاح ربطها.

روابط Expo Go57 المفحوصة:

| التطبيق | الرابط | الوحدة والport | QR |
|---|---|---|---|
| العميل | `exp://sfs3nam-anonymous-8091.exp.direct` | `tazweed-customer-expo-8091`،8091 | [QR](customer-qr.png) |
| الإدارة | `exp://utjz9oi-anonymous-8092.exp.direct` | `tazweed-admin-expo-8092`،8092 | [QR](admin-qr.png) |
| الموصل | `exp://vsfhyqu-anonymous-8093.exp.direct` | `tazweed-courier-expo-8093`،8093 | [QR](courier-qr.png) |

نجح لكل تطبيق `/status` العام ومانيفستAndroid/iOS وحزمتهما واتصالWebSocket ومرورAPI عبر الوسيط، مع ثبات الوحدات ودون إعادة تشغيل؛ التفاصيل والتوقيت في فحص الأنفاق والفحوص النهائية. Hermes/manifests/HMR ليست تجربة هاتف. لا تتبع خلفي أوPush في09، ولا اختبار خدمات حقيقية أو دخول بيانات متجر افتراضية. التوقف قبل10.
