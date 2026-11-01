# أدلة المرحلة07

فُحصت واجهات Expo المصدرة مع API وقاعدة PostgreSQL مؤقتين حقيقيين. OTP التقاط داخل process، وRouting محول TestRouting، وstyle الخريطة فارغ ومعزول؛ محرك MapLibre وأصوله فعليان. الخط المرسوم هندسة اختبار، وإحداثيات Playwright ليست GPS هاتف أو موقع متجر. لم تُرسل طلبات إلى مزود خارجي.

النتيجة: **150 اختبارًا و7 جولات UI و27 لقطة و3QR**. وقت جمع الفحوص `2026-11-01T11:15:31.283Z`، ووقت UI `2026-11-01T11:13:25.977Z`. لا أخطاء تشغيل؛ بعد رحلة السلة orders=quotes=holds=reserved=0.

[ملخص الفحوص](../phase-07-checks.json) · [نتائج القبول](acceptance.txt) · [نتائج UI](ui-checks.json) · [الأنفاق وSHA الحزم](../phase-07-tunnels.json) · [التقرير](../phase-07.md)

## اللقطات

| الدليل | ما يظهر |
|---|---|
| [address-maplibre-pin-light-390](address-maplibre-pin-light-390.png) | خريطة MapLibre والدبوس والإحداثيات |
| [address-permission-denied-light-390](address-permission-denied-light-390.png) | رفض إذن الموقع في المتصفح |
| [addresses-dark-1024](addresses-dark-1024.png) | خريطة العنوان · مظلم · عرض1024 |
| [addresses-dark-360](addresses-dark-360.png) | خريطة العنوان · مظلم · عرض360 |
| [addresses-dark-390](addresses-dark-390.png) | خريطة العنوان · مظلم · عرض390 |
| [addresses-light-1024](addresses-light-1024.png) | خريطة العنوان · فاتح · عرض1024 |
| [addresses-light-360](addresses-light-360.png) | خريطة العنوان · فاتح · عرض360 |
| [addresses-light-390](addresses-light-390.png) | خريطة العنوان · فاتح · عرض390 |
| [admin-promotion-light-390](admin-promotion-light-390.png) | حفظ عرض فعلي من واجهة الإدارة |
| [admin-promotions-dark-1024](admin-promotions-dark-1024.png) | محرر العروض · مظلم · عرض1024 |
| [admin-promotions-dark-360](admin-promotions-dark-360.png) | محرر العروض · مظلم · عرض360 |
| [admin-promotions-dark-390](admin-promotions-dark-390.png) | محرر العروض · مظلم · عرض390 |
| [admin-promotions-light-1024](admin-promotions-light-1024.png) | محرر العروض · فاتح · عرض1024 |
| [admin-promotions-light-360](admin-promotions-light-360.png) | محرر العروض · فاتح · عرض360 |
| [admin-promotions-light-390](admin-promotions-light-390.png) | محرر العروض · فاتح · عرض390 |
| [catalog-promotion-light-390](catalog-promotion-light-390.png) | عرض الخادم في الشريط الأفقي |
| [catalog-promotion-quantities-light-390](catalog-promotion-quantities-light-390.png) | اختيار الحبة والكرتون |
| [checkout-dark-1024](checkout-dark-1024.png) | معاينة السلة والمسار · مظلم · عرض1024 |
| [checkout-dark-360](checkout-dark-360.png) | معاينة السلة والمسار · مظلم · عرض360 |
| [checkout-dark-390](checkout-dark-390.png) | معاينة السلة والمسار · مظلم · عرض390 |
| [checkout-governorate-repriced-light-390](checkout-governorate-repriced-light-390.png) | إعادة التسعير من فرع المحافظة الثانية |
| [checkout-light-1024](checkout-light-1024.png) | معاينة السلة والمسار · فاتح · عرض1024 |
| [checkout-light-360](checkout-light-360.png) | معاينة السلة والمسار · فاتح · عرض360 |
| [checkout-light-390](checkout-light-390.png) | معاينة السلة والمسار · فاتح · عرض390 |
| [checkout-no-route-light-390](checkout-no-route-light-390.png) | NoRoute دون سعر بديل أو إجمالي مفترض |
| [checkout-road-promotion-light-390](checkout-road-promotion-light-390.png) | 2800م ←2كم، وتعرفة400 وخصم300، وإجمالي2400 |
| [checkout-wholesale-reference-light-390](checkout-wholesale-reference-light-390.png) | مرجع الجملة دون عرض تجزئة |

## Expo Go57

هذه روابط مراجعة مؤقتة تحتاج بقاء systemd والنفق. لا تعني هاتفًا مختبرًا أو إصدار متجر.

| التطبيق | الرابط | QR | الوحدة والمنفذ |
|---|---|---|---|
| العميل | `exp://sfs3nam-anonymous-8091.exp.direct` | [QR](customer-qr.png) | `tazweed-customer-expo-8091`،8091 |
| الإدارة | `exp://utjz9oi-anonymous-8092.exp.direct` | [QR](admin-qr.png) | `tazweed-admin-expo-8092`،8092 |
| الموصل | `exp://vsfhyqu-anonymous-8093.exp.direct` | [QR](courier-qr.png) | `tazweed-courier-expo-8093`،8093 |

فُحص `/status` وmanifest المنصتين وSDK57/runtime Go/RTL وحزمتا Android/iOS وWebSocket وثبات الخدمة. فحصAPI عبر نفقَي العميل والإدارة نجح؛ لا مفاتيح مزودات في الرد. الموصل باقٍ شاشة انتظار لخدمة09. التفاصيل والتوقيت في JSON الأنفاق.
