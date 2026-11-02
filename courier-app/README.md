# تطبيق تزويد — الموصل

Expo SDK57/React Native مع Tajawal وRTL وثيمين. نُفذت09: مهام الخادم والإسناد المتعدد وبدء الطريق والتسليم والتحصيل المستقل والعمولات والبلاغات، دون بيانات تشغيل بديلة. الحساب تنشئه الإدارة بنسبته وفروعه، والدخول يحتاج OTP. [السلوك والعقد](../backend/docs/DELIVERY.md)، [تقرير09](../backend/docs/progress/phase-09.md)، [روابط Go والأدلة](../backend/docs/progress/phase-09-evidence/README.md). لا Push أوتتبع خلفي في09؛ اختبار المزودات والهاتف مؤجل.

```bash
npm ci
npm run typecheck
# اختبارات الخادم والصلاحيات والدفاتر والطابور الحالي:
npm run test:phase09 --prefix ../backend
npm run web
# Expo Go الموافقSDK57 عبر نفق الإنترنت، على منفذ التطبيق8091/8092/8093:
npm start
```

[دليل Expo Go الحالي](../backend/docs/EXPO_GO.md). ملفات المحاكاة وunit tests من04 محفوظة للتاريخ، ولا تُستعمل كخدمة أعمال عند انقطاع API.

أصول `assets` الأصلية مدمجة عبر `app.config.ts`. معرفات الحزم للمعاينة مؤقتة، وملفات integration مراجع للمواءمة وليست مشاريع إضافية. لا أسرار خادم في الموبايل ولا EAS projectId مختلق. بناء production موقوف ما دامت البيانات fake.

لا افتتاحية فيديو أو أصول فيديو في هذا التطبيق.

التشغيل الحالي عبر [Expo Go وروابط الهاتف وQR](../backend/docs/EXPO_GO.md)؛ `npm start` يختار tunnel وGo تلقائيًا. `expo-dev-client` غير مثبت، وnative launcher/splash يفحصان لاحقًا ببناء مستقل.
