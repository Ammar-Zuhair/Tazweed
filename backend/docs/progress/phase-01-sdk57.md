# متابعة المرحلة01 — SDK57 وExpo Go عبر الإنترنت

## النتيجة

استجيب لطلب المالك اعتماد **Expo SDK57** وتوفير Project slug=`tazweed` وتشغيل المشاريع عبر `npx expo start --tunnel` ليجربها من هاتفه. حُولت التطبيقات الثلاثة، وأصبحت أنفاقها تعمل بخدمات systemd مستقلة. لم تبدأ02 أو خدمات الأعمال. التزام البداية لهذه المتابعة `18503321df0a818cef937b46e58f7a2a4c6d5651`؛ أدلة التسليم الأول على58 محفوظة كتاريخ، وهذه أحدث حالة01.

**الأمر في SDK57 يستخدم ngrok، وليس Cloudflare.** أبلغ المالك بالاختلاف ثم نفذ الأمر الذي طلبه ونجح بمزوده الفعلي. لا خدمة Cloudflare أو حساب أو نشر خارجي أنشئ، ولا أنفاق مزدوجة أضيفت. [مرجع Expo للأمر والمزود](https://docs.expo.dev/more/expo-cli/#tunneling).

## افتح التطبيقات الآن

استخدم Expo Go متوافقًا مع SDK57. من الهاتف افتح الرابط أو امسح QR. الروابط مؤقتة، وتحتاج استمرار الخدمة والنفق وقد تتغير عند إعادة إنشائهما. [دليل الهاتف والخدمات وإعادة التشغيل](../EXPO_GO.md).

| التطبيق | Expo Go | QR | الخدمة والمنفذ |
|---|---|---|---|
| العميل | [فتح العميل](exp://sfs3nam-anonymous-8091.exp.direct) | [رمز العميل](phase-01-sdk57-evidence/customer-qr.png) | `tazweed-customer-expo-8091` /8091 |
| الإدارة | [فتح الإدارة](exp://utjz9oi-anonymous-8092.exp.direct) | [رمز الإدارة](phase-01-sdk57-evidence/admin-qr.png) | `tazweed-admin-expo-8092` /8092 |
| الموصل | [فتح الموصل](exp://vsfhyqu-anonymous-8093.exp.direct) | [رمز الموصل](phase-01-sdk57-evidence/courier-qr.png) | `tazweed-courier-expo-8093` /8093 |

آخر تحقق وروابط HTTPS الأصلية في [phase-01-sdk57-tunnels.json](phase-01-sdk57-tunnels.json). افحصه أو أعد تشغيل أداة التحقق عند استئناف جلسة لاحقة بدل افتراض صلاحية هذه الروابط للأبد. Android: [اختيار Expo Go لـSDK57](https://expo.dev/go?sdkVersion=57&platform=android&device=true). iPhone: راجع [مسار تثبيت نسخة متوافقة](https://docs.expo.dev/troubleshooting/expo-go-version-mismatch/)؛ نسخة المتجر لا تكفي دليلاً على التطابق، وقد يحتاج حساب Expo وإعدادًا خاصًا على الجهاز.

## ما تغير

- `package.json` وlockfiles للتطبيقات الثلاثة: Expo57.0.31، React/React DOM19.2.3، RN0.86.3، Router57.0.29، web0.21.2، Reanimated4.5.1، Worklets0.10.1، types/react19.2.4؛ TS6.0.3 باقٍ. الإصدارات المباشرة exact وفحوص المصفوفة وشجرة npm ناجحة دون force أو legacy-peer-deps.
- حذف expo-dev-client وplugin، وprofile الخاص ببنائه غير الجاهز. `npm start` يختار `--tunnel --go` ومنفذ التطبيق8091/8092/8093؛ `start:local` يتيح LAN. بقي EAS preview فقط دون حسابات أو projectIds مختلقة. إنشاء بناء مستقل لاحقًا له إعداداته الخاصة.
- `app.config.ts`: `extra.supportsRTL/forcesRTL` بجانب plugin لدعم manifestSDK57، مع إبقاء LocaleProvider واتجاه المحتوى. أزيل runtime fingerprint من العميل أثناء استخدام Go ليعلن `exposdk:57.0.0`؛ OTA ما زال معطلًا ومرجع integration محفوظ لمرحلة10.
- CLI57 أعاد تنظيم tsconfig include وأزال expo-env.d.ts غير اللازم في هذه التهيئة؛ فحص الأنواع ناجح بعد ذلك. API HTML الحالي موجود في Router57.0.29 وبقي دون استبدال غير لازم؛ التشغيل الفعلي اختبر JS/CSS.
- `use-system-theme.web.ts` يستخدم useSyncExternalStore وmatchMedia بدل ثبات مظهر النظام الذي كشفته تجربة web0.21.2. الملف `.ts` الأصلي للهاتف يعيد استخدام useColorScheme من RN. لم يغير الاختيار المحفوظ أو يجبر إعادة تشغيل التطبيق. اختبار تغيير المظهر الحي نجح بعد الإصلاح، مع بقاء snapshot SSR ثابتًا.
- `backend/scripts/start-expo-tunnels.sh`: خدمات دائمة بعد أمر الوكيل، تتحقق من ملكية المنفذ، وتستخدم npx المحلي و`--tunnel --go --port ... --max-workers 2`. headless دون CI حتى لا يحاول Electron فتح نافذة كـroot أو يعطل watch. فحوص الاعتماديات وNew Architecture مفعلة صراحة.
- `verify-expo-tunnels.mjs`: تحقق فعلي من الخدمة والمسار المحلي والعام وmanifest وحزمة المنصتين وWebSocket، ثم JSON وQR. مكتبة qrcode اعتماد تطوير مثبت في backend، ولا تستخدم في خدمات تجارية.
- `test-previews.mjs`: مسار أدلة اختياري `PHASE01_EVIDENCE_PREFIX` يحفظ أدلة هذه المتابعة دون محو الأولى، واختيار عنصر المظهر المرئي من التبويبات المحتفظة في DOM.
- عُدلت الأدلة الحالية وREADME ودليل البناء والذاكرة وسجل المشكلات. لم تتغير بيانات00 أو SQL أو أصول الهوية الأصلية. لا فيديو مكرر أو مولد؛37 أصلًا قورنت دون تغيير، والخطوط والفيديوهات الأصلية موجودة داخل حزم native.

## الفحوص الفعلية

| الفحص | النتيجة |
|---|---|
| `npm run typecheck` للتطبيقات الثلاثة |3 نجاحات، بما فيها مسار web الجديد. |
| `npm test` للتطبيقات |12 اختبارًا ناجحًا؛ لم تنسب إعادة تشغيل لاختبار الخادم القديم. |
| `expo install --check` و`npm ls --all` | نجاح الثلاثة؛ اختلاف RN السابق الخاص58 لا ينطبق على التثبيت الحالي. |
| `export:web` |3 تصديرات ناجحة، ثم تشغيل واختبار فعلي. |
| `export:native` |6 حزم Hermes Android/iOS بالاعتماديات الجديدة؛ ليست APK/IPA. |
| اختبار Chromium |7 سيناريوهات شاملة ناجحة: RTL/Tajawal محلي والثيمان والحفظ وتغيير النظام والتنقل وحالات البيانات والاسترداد وعدم طلب خدمات خارجية، والافتتاحيتان والتخطي/فشل الفيديو والخلفية الاصطناعية. |
| خدمات Expo |3 active/running، تستمع على wildcard وتشمل IPv4؛ `/status` المحلي والعام يرد200 وpackager-status:running، دون restart loop. |
| الهاتف عبر النفق |6 manifests عامة Android/iOS بـSDK57 وruntime Expo Go وRTL صحيح؛6 launchAsset أصلية نزلت HTTP200 من نفس النطاق؛ فتحت3 اتصالات WebSocket عامة. `availableRuntimes=[expo]`. لم تضف headers خاصة لتجاوز صفحة تحذير ngrok في هذه الفحوص. |
| معاينات remote.futrx | hostname صحيح للـslug المقدم على8081/8082/8083؛ المحتوى وفحوص المتصفح ناجحة محليًا، وHTTPS العام302 إلى بوابة المنصة. هذا إثبات ingress/auth وليس جلسة متصفح مالك موثقة. |

[أدلة المصدر والتصدير والبصمات](phase-01-sdk57-checks.json)، [تفاصيل المتصفح](phase-01-sdk57-preview-checks.json)، [تفاصيل الأنفاق وبصمات الحزم العامة](phase-01-sdk57-tunnels.json). استخرج تاريخ الفحص UTC من JSON؛ اكتمال تحميل الحزم يأتي بعد checkedAt الذي يحدد بدء الجولة.

الصور الحالية: [العميل فاتح](phase-01-sdk57-evidence/customer-light.png) / [مظلم](phase-01-sdk57-evidence/customer-dark.png)، [الإدارة فاتح](phase-01-sdk57-evidence/admin-light.png) / [مظلم](phase-01-sdk57-evidence/admin-dark.png)، [الموصل فاتح](phase-01-sdk57-evidence/courier-light.png) / [مظلم](phase-01-sdk57-evidence/courier-dark.png)، و[افتتاحية العميل فاتح](phase-01-sdk57-evidence/customer-intro-light.png) / [مظلم](phase-01-sdk57-evidence/customer-intro-dark.png). صور الافتتاح عند seek إلى1.6ث للفحص البصري، وليست دليل سماع صوت.

## المشكلات والحدود

P01-06 حُل بتقديم slug؛ P01-07 الفرق بين ngrok وCloudflare موضح؛ P01-08 انقطاع تنزيل npm والـpeers عولجا بإعادة تثبيت نظيفة ونسخ SDK المناسبة؛ P01-09 DevTools/CI عولج بوضع headless؛ P01-10 runtime العميل وP01-11 متابعة مظهر الويب أصلحا واختبرا. [السجل الكامل](../../../ISSUES.md) يحفظ الدليل والحالة.

فشل أخذ لقطة seek مرة تحت حمل التصدير المتزامن؛ معاينة مستقلة أثبتت تشغيل الفيديو وتقدم الوقت بلا أخطاء، وأعيد الفحص نفسه بعد اكتمال البناء دون تغيير شرطه فنجح. لم تعتبر مهلة اختبار اللقطة دليل فشل تطبيق الهاتف أو تخف بتجاوز الاختبار.

**لا هاتف أصلي متصل بهذه البيئة**؛ الفحوص تثبت وصول Go للبيانات والحزم وWebSocket، ولا تثبت أن المالك فتحها بعد أو سمع الصوت أو اختبر RTL على جهازه. المطلوب الآن تجربة الروابط من هاتفه بنسخة Go57 وإبلاغ نتيجة العرض. أيقونة launcher وnative splash النهائيتان تحتاجان بناء التطبيق المستقل؛ Expo Go لا يعاد بناؤه بتغيير config. الخدمات التجارية تبقى fake معلّمة. لا حاجة لأسرار إضافية لإنشاء الأنفاق الحالية.

التوقف عند01 مستمر؛ لا بدء02 دون طلب منفصل.
