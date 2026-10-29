# تطبيق تزويد — العميل

أساس Expo/React Native للمرحلة01: Tajawal محلي، RTL، مظهر فاتح/مظلم/حسب الجهاز محفوظ، وثلاث تبويبات تأسيسية. البيانات fake معلّمة ولا توجد خدمات تجارية متصلة. الشاشات التجارية في `docs/SCREENS.md` تبقى متطلبات لمراحلها، وليست منفذة هنا.

```bash
npm ci
npm run typecheck
npm test
npm run web
# يتطلب development client وأدوات المنصة للبناء الأصلي:
npm start
```

[دليل البناء والمعاينة وحدود الفحص](../backend/docs/PHASE01_BUILD.md) — [تقرير01 وأدلتها](../backend/docs/progress/phase-01.md).

أصول `assets` الأصلية مدمجة عبر `app.config.ts`. معرفات الحزم للمعاينة مؤقتة، وملفات integration مراجع للمواءمة وليست مشاريع إضافية. لا أسرار خادم في الموبايل ولا EAS projectId مختلق. بناء production موقوف ما دامت البيانات fake.

العميل وحده يستخدم `video/intro-light.mp4` و`intro-dark.mp4` عبر `integration/IntroScreen.tsx` في جذر التشغيل. `expo-updates` مثبت لمرجع التكامل لكنه معطل حتى مرحلة10.
