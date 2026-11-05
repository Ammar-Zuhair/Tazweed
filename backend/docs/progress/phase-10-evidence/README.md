# أدلة10 وروابط التشغيل

[التقرير](../phase-10.md)، [الفحوص النهائية](../phase-10-checks.json)، [القبول](acceptance.txt)، [الواجهة](ui-checks.json)، [الأنفاق](../phase-10-tunnels.json)، [طابور العميل](client-operations.txt)، [النقل](client-transport.txt)، [سياسة الإصدارات](client-release.txt).

نجح237اختبارًا فريدًا:164 في الجولة الكاملة و73حارسSQL. بعدpatches SDK57 أُعيد18فحصًا للنقل والطابور والإصدارات دون إضافتها للعدد الفريد. نجحت8جولات واجهة و31لقطة؛ الثيمان وعروض360/390/1024، بلاpageErrors أوطلبات مزود حقيقي أوتمدد أفقي، ومع فقد إقرار حملة محفوظة ثم إعادة مفتاحها نفسه. ليست الصور بيانات متجر أو جهازًا حقيقيًا: Chromium وAPI/PostgreSQL مؤقتان ودور محدود وCaptureOTP/TestRouting/TestStore معزولة. لاOTP/R2/Routing/Expo/FCM/APNs حقيقي أوOTA منشور.

## رحلة العمل

- [فقد إقرار حفظ حملة](campaign-lost-ack.png)، [الجدولة](campaign-scheduled.png)، [اكتمال إنشاء المركز](campaign-projected.png).
- [قراءة العميل](customer-inbox-read.png)، [إشعار إسناد الموصل](courier-assignment-inbox.png)، [إشعار الطلب للموظف](admin-order-inbox.png).
- [تفعيل الصيانة](maintenance-admin-enabled.png)، [بوابة العميل](customer-maintenance.png)، [الجاري أثناء الصيانة](customer-ongoing-during-maintenance.png)، [الموصل مستمر](courier-unaffected.png).
- [حدود إصدارstaging](release-bounds-staging.png)، [الإجباري](required-update-native-build-simulation.png)، [الاختياري](optional-update-native-build-simulation.png). الصورتان الأخيرتان تختبران العرض فيالمتصفح بأرقامbuild أصلية صريحة يمررهاhelper إلىAPI الحقيقي؛ لا تعنيانbinary مثبتة أومتجرًا أوOTA فعليًا.

## الثيمان والمقاسات

| التطبيق | فاتح360 /390 /1024 | مظلم360 /390 /1024 |
|---|---|---|
| العميل | [360](customer-light-360.png) / [390](customer-light-390.png) / [1024](customer-light-1024.png) | [360](customer-dark-360.png) / [390](customer-dark-390.png) / [1024](customer-dark-1024.png) |
| الإدارة | [360](admin-light-360.png) / [390](admin-light-390.png) / [1024](admin-light-1024.png) | [360](admin-dark-360.png) / [390](admin-dark-390.png) / [1024](admin-dark-1024.png) |
| الموصل | [360](courier-light-360.png) / [390](courier-light-390.png) / [1024](courier-light-1024.png) | [360](courier-dark-360.png) / [390](courier-dark-390.png) / [1024](courier-dark-1024.png) |

## المراجعة والتشغيل

| التطبيق | HTTPS عبرremote | الوحدة والمنفذ | المسار المتوقع |
|---|---|---|---|
| العميل | [المعاينة](https://tazweed--8081.dev.remote-ammar.duckdns.org/) | `tazweed-customer-preview-8081`،8081 | `/auth` ثم `/notifications` و`/orders` |
| الإدارة | [المعاينة](https://tazweed--8082.dev.remote-ammar.duckdns.org/) | `tazweed-admin-preview-8082`،8082 | `/campaigns`،`/operations`،`/notifications` |
| الموصل | [المعاينة](https://tazweed--8083.dev.remote-ammar.duckdns.org/) | `tazweed-courier-preview-8083`،8083 | `/account` ثم `/notifications` و`/` |
| API | [live](https://tazweed--8084.dev.remote-ammar.duckdns.org/health/live) | `tazweed-backend-8084`،8084 | `/health/live` و`/health/ready` |

الخدمات durable عبرsystemd. HTTP علىكلالواجهات، وPostgreSQL خاص127.0.0.1:55432 بوحدة`tazweed-postgres-55432`. الفحوص تثبت نشاط الوحدات الثماني والمستمعين وعدم وجودفشل بدء في السجل الحديث، ومطابقةHTML للصادرات ورفضHost غيرموثوق وOpenAPI. HTTPS8081–8084 أعاد302 لبوابةremote؛ يثبت ingress فقط، لا جلسة مالك مصادقًا. live10=200؛ ready=503 معDBconnected/current/limited وOTP/storage/routing/push غيرمهيأة. لا بيانات اختبار فيstaging أوحساب تشغيل أورمزOTP ثابت. لا تسمِّي503 نجاح ربط خدمة.

Expo Go علىSDK57 وحزمةexpo57.0.32، و6مانيفستات وحزمAndroid/iOS تحتويMetro/Hermes فعلًا، و3WebSocket وAPI عبرالنفق العام، بثبات الوحدات ودون إعادة تشغيل أثناء الفحص:

| التطبيق | رابطGo الفعلي | الوحدة والمنفذ | QR |
|---|---|---|---|
| العميل | `exps://sfs3nam-anonymous-8091.exp.direct` | `tazweed-customer-expo-8091`،8091 | [QR](customer-qr.png) |
| الإدارة | `exps://utjz9oi-anonymous-8092.exp.direct` | `tazweed-admin-expo-8092`،8092 | [QR](admin-qr.png) |
| الموصل | `exps://vsfhyqu-anonymous-8093.exp.direct` | `tazweed-courier-expo-8093`،8093 | [QR](courier-qr.png) |

الصيغةexps تفتحHTTPS عبرGo بشهادةموثوقة. الحزم وmanifest وHMR ليست تجربة هاتف. إعدادEAS/FCM/APNs ورفعbinary/OTA وفحوصforeground/background/closed مؤجلةبعدالمفاتيح وطلبالمالك؛ التوقفقبل11.
