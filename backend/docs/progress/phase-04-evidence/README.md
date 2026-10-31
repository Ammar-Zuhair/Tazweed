# أدلة المرحلة04

أربع جولات على بصمة المصدر `ef9db59cb306a7ba3b15fdc586c61170ed5ccf0c20e3e88853840f215ba40ef9`. مجموع لقطات الموصل 69؛ 24 للرحلة الكاملة فاتح390 و15 لكل مراجعة أخرى. ليست اختبارات أجهزة أصلية. [النتائج](browser-results.json) و[ملخص الفحوص](../phase-04-checks.json) و[التقرير](../phase-04.md).

الجولة الكاملة تختبر النقد24400 والنقص400 والتسليم والبلاغ والرد والانقطاع/retry والتحويل. الثلاث الأخرى تراجع الشاشات والثيم والحالات والملاحة وانتهاء الإسناد والخروج؛ لا تنسب إليها كامل رحلة المال.

| المشهد | فاتح390 | مظلم390 | فاتح1024 | مظلم1024 |
|---|---|---|---|---|
| المظهر | [فتح](appearance-light-390.png) | [فتح](appearance-dark-390.png) | [فتح](appearance-light-1024.png) | [فتح](appearance-dark-1024.png) |
| الإسناد المنتهي بلا تفاصيل خاصة | [فتح](assignment-expired-light-390.png) | [فتح](assignment-expired-dark-390.png) | [فتح](assignment-expired-light-1024.png) | [فتح](assignment-expired-dark-1024.png) |
| تحصيل مستقل | [فتح](cash-collected-light-390.png) | — | — | — |
| عهدة النقد المستقلة | [فتح](cash-ledger-light-390.png) | [فتح](cash-ledger-dark-390.png) | [فتح](cash-ledger-light-1024.png) | [فتح](cash-ledger-dark-1024.png) |
| منع التسليم قبل النقد | [فتح](cash-required-light-390.png) | — | — | — |
| نقص واستثناء | [فتح](cash-shortfall-light-390.png) | — | — | — |
| تسليم مقر | [فتح](delivered-light-390.png) | — | — | — |
| العمولات وتسوياتها | [فتح](earnings-light-390.png) | [فتح](earnings-dark-390.png) | [فتح](earnings-light-1024.png) | [فتح](earnings-dark-1024.png) |
| فارغ | [فتح](empty-light-390.png) | [فتح](empty-dark-390.png) | [فتح](empty-light-1024.png) | [فتح](empty-dark-1024.png) |
| خطأ واستعادة | [فتح](error-light-390.png) | [فتح](error-dark-390.png) | [فتح](error-light-1024.png) | [فتح](error-dark-1024.png) |
| مختبر المعاينة | [فتح](lab-light-390.png) | [فتح](lab-dark-390.png) | [فتح](lab-light-1024.png) | [فتح](lab-dark-1024.png) |
| دخول الموصل | [فتح](login-light-390.png) | [فتح](login-dark-390.png) | [فتح](login-light-1024.png) | [فتح](login-dark-1024.png) |
| وجهة الملاحة | [فتح](navigation-light-390.png) | [فتح](navigation-dark-390.png) | [فتح](navigation-light-1024.png) | [فتح](navigation-dark-1024.png) |
| الإشعارات والصوت | [فتح](notifications-light-390.png) | [فتح](notifications-dark-390.png) | [فتح](notifications-light-1024.png) | [فتح](notifications-dark-1024.png) |
| بدء التوصيل | [فتح](on-the-way-light-390.png) | [فتح](on-the-way-dark-390.png) | [فتح](on-the-way-light-1024.png) | [فتح](on-the-way-dark-1024.png) |
| انقطاع دون نجاح | [فتح](pending-offline-light-390.png) | — | — | — |
| مسودة السياسات | [فتح](policies-light-390.png) | [فتح](policies-dark-390.png) | [فتح](policies-light-1024.png) | [فتح](policies-dark-1024.png) |
| إعادة المحاولة بالمفتاح نفسه | [فتح](queue-light-390.png) | — | — | — |
| مسودة البلاغ وصورته | [فتح](report-compose-light-390.png) | — | — | — |
| رد إداري تجريبي | [فتح](report-reply-light-390.png) | — | — | — |
| بلاغ مفتوح | [فتح](report-sent-light-390.png) | — | — | — |
| مسح النسخة والخروج | [فتح](signed-out-light-390.png) | [فتح](signed-out-dark-390.png) | [فتح](signed-out-light-1024.png) | [فتح](signed-out-dark-1024.png) |
| تفاصيل وعنوان ثابت | [فتح](task-address-light-390.png) | [فتح](task-address-dark-390.png) | [فتح](task-address-light-1024.png) | [فتح](task-address-dark-1024.png) |
| المهام المتعددة | [فتح](tasks-light-390.png) | [فتح](tasks-dark-390.png) | [فتح](tasks-light-1024.png) | [فتح](tasks-dark-1024.png) |

روابط الهاتف: [QR العميل](customer-qr.png)، [QR الإدارة](admin-qr.png)، [QR الموصل](courier-qr.png). [وقت فحص الأنفاق](../phase-04-tunnels.json).

إعادة مراجعة التطبيقات السابقة: [صور العميل ورحلته](../phase-04-customer-evidence/README.md)، [صور الإدارة ومراجعتها](../phase-04-admin-evidence/README.md). تراجع افتتاحية العميل: [النتائج](../phase-04-preview-checks.json)، [فاتح](customer-intro-light.png)، [مظلم](customer-intro-dark.png).

سجلات المنطق والأنواع: [courier اختبارات](courier-tests.txt) · [أنواع](courier-types.txt)، [customer اختبارات](customer-tests.txt) · [أنواع](customer-types.txt)، [admin اختبارات](admin-tests.txt) · [أنواع](admin-types.txt)، [backend اختبارات](backend-tests.txt) · [أنواع](backend-types.txt).

سجلات البناء والتوافق: [ويب](courier-web.txt)، [Hermes](courier-native.txt)، [Expo](courier-compat.txt)، [شجرةnpm](courier-deps.txt)، [تنسيق المصدر](format-check.txt)، [حظر الإنتاج](production-block.txt). لا APK/IPA أو ربط خدمات أو سماع صوت على جهاز مثبت.
