# تطبيق تزويد — الإدارة

أساس Expo SDK57/React Native للمرحلة01: Tajawal محلي، RTL، مظهر فاتح/مظلم/حسب الجهاز محفوظ، وثلاث تبويبات تأسيسية. البيانات fake معلّمة ولا توجد خدمات تجارية متصلة. الشاشات التجارية في `docs/SCREENS.md` تبقى متطلبات لمراحلها، وليست منفذة هنا.

```bash
npm ci
npm run typecheck
npm test
npm run web
# Expo Go الموافقSDK57 عبر نفق الإنترنت، على منفذ التطبيق8091/8092/8093:
npm start
```

[دليل البناء والمعاينة وحدود الفحص](../backend/docs/PHASE01_BUILD.md) — [تقرير01 وأدلتها](../backend/docs/progress/phase-01.md).

أصول `assets` الأصلية مدمجة عبر `app.config.ts`. معرفات الحزم للمعاينة مؤقتة، وملفات integration مراجع للمواءمة وليست مشاريع إضافية. لا أسرار خادم في الموبايل ولا EAS projectId مختلق. بناء production موقوف ما دامت البيانات fake.

لا افتتاحية فيديو أو أصول فيديو في هذا التطبيق.

التشغيل الحالي عبر [Expo Go وروابط الهاتف وQR](../backend/docs/EXPO_GO.md)؛ `npm start` يختار tunnel وGo تلقائيًا. `expo-dev-client` غير مثبت، وnative launcher/splash يفحصان لاحقًا ببناء مستقل.
