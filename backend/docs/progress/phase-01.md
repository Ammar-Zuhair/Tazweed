> الحالة الحالية: طلب المالك SDK57 وExpo Go ووفر slug=tazweed بعد هذا التسليم. راجع [متابعة SDK57 وروابط الهاتف ونتائجها](phase-01-sdk57.md). تفاصيل58 ونقصslug أدناه تاريخ التسليم الأول، وليست وصف الإعداد الحالي.

# تقرير المرحلة01 — تهيئة التطبيقات والهوية

## النتيجة والنطاق

نفذت01 فقط بطلب المالك بعد قراءة الذاكرة وتقرير00. أصبح كل من `customer-app` و`admin-app` و`courier-app` مشروع Expo/React Native مستقلًا قابلًا للتشغيل والتصدير، وأضيف هيكل Express بفحص صحة العملية فقط. واجهات أساس للهوية والمظهر والمكونات، بلا تسجيل دخول أو كتالوج أو طلبات أو أرصدة أو خدمات تجارية. لا قاعدة بيانات فعلية أو migrations. توقفت قبل02؛ الانتقال يحتاج طلبًا منفصلًا.

اكتملت فحوص المصدر والتصدير وتشغيل معاينات الواجهات داخل الحاوية. **اعتماد الهوية على أجهزة Android/iOS ومشاهدة splash/launcher وسماع الصوت ما زال مطلوبًا**؛ لا APK/AAB/IPA أو بناء سحابي نُفذ. الرابط الخارجي ينتظر Project slug الموثق، كما هو مسجل في P01-06. لا نعد نجاح التصدير أو صحة العملية إثبات تشغيل أصلي أو ربط خدمات.

التاريخ التفصيلي للفحوص في [phase-01-checks.json](phase-01-checks.json) و[فحوص المتصفح](phase-01-preview-checks.json) بصيغة UTC؛ امتد التنفيذ من28 إلى29 أكتوبر2026. التزام الأساس قبل العمل `ea50b89b82b11d962807c8527b97f3b633d770f0`.

## المراجع المقروءة

`remember.md` وتقرير `phase-00.md`، ثم `phases/01.md` وجميع مراجعها: `MASTER_PROMPT.md`، `REQUIREMENTS.md`، `DECISIONS.md`، `OWNER_DECISIONS_PHASE00.md`، `ISSUES.md`، `customer-app/brand-source/BRAND.md`، tokens التطبيقات، `customer-app/integration/README.md` و`IntroScreen.tsx` وconfig fragments للتطبيقات الثلاثة، `customer-app/media/STORYBOARD.md`، `backend/docs/ARCHITECTURE.md`. راجعت أيضًا مرجع updates وEAS وسياق README/دليل البدء. قرارات00 نافذة دون اختلاق بيانات تشغيلية أو إعادة فتح قواعدها.

## التنفيذ والملفات

| المجموعة | ما تغير والغرض |
|---|---|
| كل تطبيق | `package.json` و`package-lock.json` و`tsconfig.json` و`expo-env.d.ts`؛ استقلال الاعتماديات وفحص الأنواع. `app.config.ts` و`eas.json` لاسم وأيقونة وsplash وRTL وdevelopment client ومعرفات preview. |
| التوجيه والتهيئة | `src/app/_layout.tsx`، `(tabs)/_layout.tsx` وindex/about/settings، `+not-found.tsx`، `+html.tsx`، `src/bootstrap/AppBootstrap.tsx`. جذر ثابت، خط محلي وتفضيل محفوظ قبل إخفاء splash، وتوجيه RTL. |
| الهوية والمكونات | `src/config.ts` يخصص النص والأيقونة لكل دور؛ `src/ui/theme-model.ts` و`theme-provider.tsx` و`components.tsx` و`screens.tsx`. نص Tajawal، زر وبطاقة ورأس صفحة وتبويبات، وحالات تحميل/فراغ/خطأ وإعادة محاولة فعلية. |
| البيانات | `src/data/foundation-repository.ts` و`foundation-provider.tsx`: عقد وتنفيذ fake معلّم، تأخير وإلغاء للطلب عند الاستبدال/الخروج، واسترداد بعد الخطأ. لا بيانات متجر أو اتصالات خارجية. أزرار تجربة الحالات ضمن معاينة الهوية فقط. |
| العميل | إصلاح require في `integration/IntroScreen.tsx` إلى `../video` واستعماله من bootstrap. تثبيت الثيم عند بدء الافتتاح، مهلة4.75ث، تخطي، فشل مفتوح، تقليل الحركة والخلفية، دون تخزين introDone بين تشغيلين أو إعادته عند التنقل. `media/rebuild_intro.py` يخرج إلى video؛ لم ينفذ. |
| الخادم | `src/app.ts` و`server.ts` و`tests/health.test.ts`، package/lock/tsconfig. `GET /health` يصرح بـdatabase=not-configured وbusinessServices=not-implemented؛ بقية المسارات404. loopback8084 افتراضيًا وإغلاق منظم. |
| أدوات التحقق | `tests/foundation.test.ts` في كل تطبيق. `backend/scripts/serve-preview.mjs` يخدم تصدير المعاينة مع Host allowlist وrange، و`test-previews.mjs` يشغّل اختبارات Chromium ويولد الصور وJSON. |
| التوثيق | هذا التقرير وأدلته، `PHASE01_BUILD.md`، README الجذر والمجلدات، `ARCHITECTURE.md`، `VALIDATION.md`، `ISSUES.md`، `remember.md`، وتوضيح integration README. `setup.sh` للتثبيت وإعادة تجهيز المتصفح بعد إعادة تهيئة الحاوية، و`.gitignore` للمخرجات المولدة. |

لم تتغير ملفات SQL/القاموس/اختبارات00 أو قراراتها. لم يُفك ZIP فوق العمل القائم. تحققت بايتات37 أصلًا متتبعًا من الهوية والخط والفيديو وطبقات المصدر مقابل Git السابق: **صفر تغييرات**. كلا الفيديوهين الأصليين والخطوط الثلاثة موجودة ببايتاتها نفسها داخل حزم المنصتين؛ المدير والموصل بلا فيديو. بيانات البصمات في JSON.

## قرارات تنفيذ روتينية

- Expo58.0.21، React19.3.0، React Native0.88.0، Expo Router58.0.28؛ TypeScript6.0.3. Express5.3.0 للخادم. جميع الاعتماديات المباشرة exact وأربعة lockfiles مطابقة. يتطلب المشروع Node22.13+ ضمن22؛ استخدمت Node22.23.4 وnpm10.9.9.
- P01-01: المرجع المضمن والقالب يوصيان بـRN0.88.1، بينما فحص Expo المباشر يتطلب0.88.0. اختير0.88.0 لنجاح مصفوفة التوافق المباشرة دون exclude؛ prebuild يصدر تنبيه توصية القالب لكنه ينجح. **الاختلاف لم يُخفَ** ولا يثبت الفحص بناء native؛ يعاد فحص المصفوفة قبل بناء جهاز.
- الافتراضي system، والاختيار light/dark/system محفوظ في AsyncStorage مستقل لكل تطبيق. فشل التخزين يظهر تنبيهًا صريحًا. الألوان من tokens الأصلية؛ الأبيض/الكحلي والبرتقالي المخصص للنص/الزر بحسب الثيم.
- RTL ثابت عبر expo-localization، وLocaleProvider للتنقل؛ HTML ar/rtl للمعاينة. يحتاج SDK58 `useServerDocumentContext` في +html لإدراج موارد CSS/JS؛ أُصلح قالب المعاينة بعد كشف الاختبار لذلك، وفق [التوثيق الرسمي](https://docs.expo.dev/router/web/static-rendering/). إعداد RTL يتبع [دليل Expo](https://docs.expo.dev/guides/localization/).
- identifiers `com.tazweed.preview.customer/admin/courier` وschemes للتجربة فقط؛ ليست هويات إصدار معتمدة. لا EAS projectId أو حسابات/مفاتيح توقيع مختلقة. profiles development وpreview داخليان، والتهيئة ترفض production ما دامت البيانات fake.
- expo-updates مثبت للعميل حتى يفحص مرجع integration لكن معطل وغير مستدعى؛ بوابات الإصدار والصيانة والخرائط والخدمات ليست منفذة في01. MapLibre يضاف في مرحلته بدل تفعيل plugin لمكتبة غير مستعملة. تهيئة الفصل البيئي لا تعني ربط staging حقيقي.
- نسخة المتصفح تصدير لنفس كل تطبيق، وليست تطبيق ويب خامسًا. لم ينشر شيء على استضافة خارجية. لم تُطلب أسرار إضافية لهذه المرحلة.

## الفحوص والنتائج

| الفحص | النتيجة الفعلية |
|---|---|
| `npm run typecheck` في المشاريع الأربعة | نجح؛ عولج نوع لون Ionicons دون cast يخفي الخطأ. |
| `npm test` في التطبيقات الثلاثة والخادم |13 اختبارًا ناجحًا:4×3 للتفضيل وfake والخطأ/الاسترداد والإلغاء ومنع production، و1 لفحص الصحة و404 الخدمات غير المنفذة. |
| `npx --no-install expo install --check` في التطبيقات |3 نجاحات ضد مصفوفة Expo المباشرة؛ اختلاف توصية القالب موثق أعلاه. |
| `npm run export:web` |3 تصديرات ناجحة، وتشغيل فعلي بعدها بالمتصفح؛ النجاح الأول للتصدير وحده لم يعتمد كدليل تشغيل. |
| `npm run export:native` |6 حزم Hermes Android/iOS مع الأصول؛ لكل منصة4 ملفات خط (3 Tajawal + Ionicons)، والفيديوهان في العميل فقط. **ليست ملفات APK/IPA**. |
| `expo prebuild --no-install --platform all` في نسخ مؤقتة | توليد3×Android+iOS؛ supportsRtl=true وforcesRTL=true وar على المنصتين، وأيقونات Android17 ملفًا لكل تطبيق. OTA العميل معطل وصوت الخلفية غير مفعل. لم يشغل Gradle أو CocoaPods/Xcode. |
| `npm run build` في backend | نجح. الخدمة المحلية ترد `/health` دون قاعدة بيانات أو API تجاري. |
| `npm run test:preview` |7 سيناريوهات شاملة ناجحة في Chromium؛3 تطبيقات وافتتاحيتان وخلفية اصطناعية وفشل فيديو. التفاصيل أدناه وJSON. |
| سلامة الملفات |4 lockfiles متوافقة، تثبيت exact، فحص syntax لأداة المعاينة وsetup ومولد الفيديو دون تنفيذه، وبصمات الأصول الأصلية سليمة. |

اختبار كل تطبيق تحقق من: `lang=ar/dir=rtl` واتجاه العرض، تحميل Tajawal محليًا، الثيمين، بقاء الاختيار والراديو المحدد بعد reload، متابعة مظهر الجهاز، التنقل، error→retry وempty→عرض وloading→ready، وعرض390 و1024 دون overflow أفقي، وغياب أخطاء pageerror وطلبات خدمات/خطوط خارجية. عُولج غياب aria-checked في نسخة الويب؛ لم يعتبر تلوين الاختيار وحده نجاح إتاحة.

في العميل تحقق تجاوز الافتتاح مع reduce-motion قبل مهلة الفيديو (زمن البدء في JSON)، واختيار ملف كل ثيم ومدته4ث وmuted=false/volume0.45، والتخطي/الخروج بعد الانتهاء أو المهلة، وعدم إعادته بالتنقل/focus. اختبر حدث خلفية ويب اصطناعيًا وفشل طلب MP4. **اللقطتان التاليتان للفيديو عند seek إلى1.6ث لعرض الهوية بوضوح**، وليستا دليل سماع صوت أو اختبار خلفية على هاتف. Chromium headless يكتم الصوت على مستوى المتصفح؛ سلامة خصائص player لا تثبت audibility.

## صور المراجعة

صور أصلية من المعاينات المشغلة بحجم390×844، مع حفظ8 صور في المستودع:

| التطبيق | فاتح | مظلم |
|---|---|---|
| العميل | [عرض الصورة](phase-01-evidence/customer-light.png) | [عرض الصورة](phase-01-evidence/customer-dark.png) |
| الإدارة | [عرض الصورة](phase-01-evidence/admin-light.png) | [عرض الصورة](phase-01-evidence/admin-dark.png) |
| الموصل | [عرض الصورة](phase-01-evidence/courier-light.png) | [عرض الصورة](phase-01-evidence/courier-dark.png) |
| افتتاحية العميل | [لقطة الفاتح](phase-01-evidence/customer-intro-light.png) | [لقطة المظلم](phase-01-evidence/customer-intro-dark.png) |

## التشغيل والخدمات الحالية

[دليل التشغيل الكامل وإعادة إنتاج الفحوص](../PHASE01_BUILD.md). خدمات systemd transient تعمل بعد انتهاء أوامر الوكيل، وتحتاج إعادة إنشاء بعد reboot:

| الخدمة | المنفذ/الربط | المسار والفحوص |
|---|---|---|
| `tazweed-customer-preview-8081` |8081 على0.0.0.0| `/`، active/running، HTTP200 ومحتوى Expo ar/rtl، range206 للفيديو. |
| `tazweed-admin-preview-8082` |8082 على0.0.0.0| `/`، active/running، HTTP200، بلا ملفات MP4. |
| `tazweed-courier-preview-8083` |8083 على0.0.0.0| `/`، active/running، HTTP200، بلا ملفات MP4. |
| `tazweed-backend-health-8084` |8084 على127.0.0.1 فقط| `/health` يرد200 ويصرح بعدم تهيئة DB/الخدمات؛ غير معروض خارجيًا. |

تحققت `systemctl` و`ss` وHTTP وسجلات الخدمات بعد بدء الأوامر من نداء منفصل؛ لا restart loop. خوادم المعاينة ترفض Host غير مسموح403 وطرق الكتابة405. **لم يتحقق HTTPS ingress**: Project slug غير موجود في السياق وقد طلب من المالك، ولم تصل قيمته وقت التقرير. عند وصوله يمرر hostname الصحيح لكل خدمة ثم يفحص ingress، دون تخمين الاسم أو تعطيل Host validation. لا تعطي localhost كرابط وصول للمالك.

## النواقص ومراجعة المالك

1. راجع الصور والهوية والعربية والاختيارين؛ تعديلات الهوية تعالج داخل01 قبل بناء الشاشات التجارية. شغّل التطبيقات الثلاثة على Android/iOS عبر development build وفق الدليل؛ اختبر Tajawal/RTL على جهاز عربي وآخر بلغة أخرى، الأيقونات وsplash، safe area وتكبير الخط، وصوت الافتتاح والتخطي والخلفية وتقليل الحركة على العميل فقط.
2. وفّر Project slug الموثق لاستكمال روابط المعاينة وفحص HTTPS. هذا يستكمل تشغيل01 ولا يبدأ02.
3. حسابات Expo والهويات النهائية ومزودو الخدمات وQ01–Q06 ومدد الاحتفاظ مؤجلة لمراحلها. لا بيانات أو موافقات تجارية جديدة مفترضة هنا. يبقى اختلاف مصفوفة RN موثقًا للمراجعة عند البناء الأصلي.

حالة الملاحظات في [ISSUES.md](../../../ISSUES.md)؛ F11 أصلح في01. الذاكرة محدثة. **لا بدء للمرحلة02 دون طلب جديد من المالك.**
