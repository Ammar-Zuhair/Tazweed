# أدلة المرحلة08

الرحلات تستعمل API وقاعدة PostgreSQL مؤقتة حقيقيين. الحسابات والمنتجات والمواقع والجهة البنكية بيانات اختبار صريحة وغير قابلة للدفع. OTP وRouting والتخزين محولات معزولة؛ معالجة بايتات الصور فعلية. لم تختبر خدمات OTP/R2/Routing الحقيقية أو هاتفًا فعليًا.

نجح186اختبارًا و10جولات واجهة. الصور23لقطة من المتصفح بثيمين ومقاسات360/390/1024، ومعها3رموزQR للتشغيل. صورة التسوية تعرض نموذجها ومرجعها وإثباتها؛ إثبات الالتزام والإغلاق والتأكيد في رحلةAPI/UI وسجل فحوصها.

- [تقرير التنفيذ والحدود](../phase-08.md)
- [ملخص الفحوص والخدمات وبصمات المصادر](../phase-08-checks.json)
- [107اختبارات الخادم والنقل و73حارسSQL](acceptance.txt)
- [6اختبارات لطابور العمليات بمحولات تخزين/نقل](client-operations.txt)
- [9جولات الواجهة الرئيسية و22لقطة](ui-checks.json)
- [فحص تبديل الحساب وإقرارrefresh المتأخر ولقطته](auth-ui-checks.json)
- [سجل إجراءات الرحلة الرئيسية](ui-actions.txt)
- [سجل إجراءات فحص الحساب](auth-ui-actions.txt)
- [الأنفاق وSHA حزم التطوير](../phase-08-tunnels.json)

لا تعني حزمHermes أوmanifest/WebSocket اختبارًا على Android/iPhone. فحص التخزين المعزول ليس دليلKeychain/Keystore. استجابة302 من روابطremote تؤكد بوابة الدخول فقط؛ الواجهات المعزولة اختبرت محليًا.

## Expo Go — SDK57

آخر جمع للفحوص: `2026-11-01T21:40:20.868Z`.

| التطبيق | رابط التشغيل | QR |
|---|---|---|
| العميل | [فتح العميل](exp://sfs3nam-anonymous-8091.exp.direct) | [QR العميل](customer-qr.png) |
| الإدارة | [فتح الإدارة](exp://utjz9oi-anonymous-8092.exp.direct) | [QR الإدارة](admin-qr.png) |
| الموصل | [فتح الموصل](exp://vsfhyqu-anonymous-8093.exp.direct) | [QR الموصل](courier-qr.png) |

تطبيق الموصل ينتظر خدمة09؛ لا مهام أو نقد أو عمولات محلية نشطة. بيانات تشغيل فعلية تتطلب إعداد المزودات والكتالوج من المالك. مرحلة08 لا تزرع حساب دخول أو مستفيدًا افتراضيًا في قاعدة المراجعة.

## لقطات المراجعة

| الصورة | ما تعرضه |
|---|---|
| [admin-confirmed-transfer-light-390](admin-confirmed-transfer-light-390.png) | طلب تحويل مؤكد بعد التحقق |
| [admin-external-settlement-light-390](admin-external-settlement-light-390.png) | نموذج تسوية خارجية ومرجع وإثبات خاص |
| [admin-image-rejected-protected-light-390](admin-image-rejected-protected-light-390.png) | قرار تصحيح الصورة وإبقاء الحجز محميًا |
| [admin-payment-methods-dark-1024](admin-payment-methods-dark-1024.png) | إدارة جهات التحويل في الثيم المظلم |
| [admin-quote-awaiting-accept-light-390](admin-quote-awaiting-accept-light-390.png) | عرض الإدارة ورفض التأكيد قبل قبول العميل |
| [admin-review-dark-1024](admin-review-dark-1024.png) | مراجعة طلب الإدارة · مظلم · 1024بكسل |
| [admin-review-dark-360](admin-review-dark-360.png) | مراجعة طلب الإدارة · مظلم · 360بكسل |
| [admin-review-dark-390](admin-review-dark-390.png) | مراجعة طلب الإدارة · مظلم · 390بكسل |
| [admin-review-light-1024](admin-review-light-1024.png) | مراجعة طلب الإدارة · فاتح · 1024بكسل |
| [admin-review-light-360](admin-review-light-360.png) | مراجعة طلب الإدارة · فاتح · 360بكسل |
| [admin-review-light-390](admin-review-light-390.png) | مراجعة طلب الإدارة · فاتح · 390بكسل |
| [customer-confirmed-transfer-light-390](customer-confirmed-transfer-light-390.png) | حالة العميل بعد تأكيد التحويل |
| [customer-corrected-image-light-390](customer-corrected-image-light-390.png) | محاولة صورة ثانية للتحويل نفسه |
| [customer-frozen-instructions-light-390](customer-frozen-instructions-light-390.png) | تعليمات تحويل محفوظة قبل عرضها |
| [customer-late-refresh-account-isolation-light-390](customer-late-refresh-account-isolation-light-390.png) | الحساب الثاني بعد إقرار جلسة الأول المتأخر |
| [customer-pending-dark-1024](customer-pending-dark-1024.png) | عرض العميل وقبوله · مظلم · 1024بكسل |
| [customer-pending-dark-360](customer-pending-dark-360.png) | عرض العميل وقبوله · مظلم · 360بكسل |
| [customer-pending-dark-390](customer-pending-dark-390.png) | عرض العميل وقبوله · مظلم · 390بكسل |
| [customer-pending-light-1024](customer-pending-light-1024.png) | عرض العميل وقبوله · فاتح · 1024بكسل |
| [customer-pending-light-360](customer-pending-light-360.png) | عرض العميل وقبوله · فاتح · 360بكسل |
| [customer-pending-light-390](customer-pending-light-390.png) | عرض العميل وقبوله · فاتح · 390بكسل |
| [customer-quote-revision-light-390](customer-quote-revision-light-390.png) | نسخة فرع بديلة بالمبلغ نفسه تحتاج قبولًا جديدًا |
| [customer-wholesale-cod-accepted-light-390](customer-wholesale-cod-accepted-light-390.png) | عرض جملة مقبول بالنقد دون إيصال |
