> أحدث واجهات: العميل02 والإدارة03 والموصل04. [تقرير04](progress/phase-04.md) و[روابط التطبيقات الثلاثة الحالية](progress/phase-04-tunnels.json) وQR داخل phase-04-evidence؛ مراجعة الاتساق في UI_REVIEW.md.

> طلب المالك الأحدث أعاد التطبيقات الثلاثة إلى Expo Go على SDK57؛ أزيل إعداد development client للعميل وأبقي إصلاح الفيديو. [التقرير وروابط التشغيل المفحوصة](progress/phase-02-native-fix.md).

# تشغيل SDK57 على الهاتف عبر الإنترنت

طلب المالك اعتماد **Expo SDK57** واستخدام Expo Go. المشاريع الثلاثة مثبتة على Expo57.0.31 وReact19.2.3 وReact Native0.86.3 وRouter57.0.29. واجهات العميل02 منفذة محليًا؛ اكتملت الواجهات02–04 محليًا؛ انتظر اعتمادها وطلب05 منفصلًا.

## الروابط الحالية

الروابط ووقت آخر فحص في [دليل الأنفاق الحالي JSON](progress/phase-04-tunnels.json)، ورموز QR في [تقرير04](progress/phase-04.md). افتح رابط `exp://` من الهاتف مع نسخة Expo Go الموافقة لـSDK57، أو امسح QR من داخل Expo Go. يجب أن يبقى الخادم والنفق يعملان؛ هذه ليست إصدارات منشورة أو روابط دائمة.

تحقق من توافق نسخة الهاتف عبر [صفحة Expo Go الرسمية](https://expo.dev/go?sdkVersion=57&platform=android&device=true). على Android يمكن اختيار بناء SDK57 من الصفحة. على iPhone قد تحتاج نسخة Go مناسبة عبر مسار Expo الرسمي لـiOS؛ لا تفترض أن نسخة المتجر تطابق SDK57. [إرشادات اختلاف الإصدارات](https://docs.expo.dev/troubleshooting/expo-go-version-mismatch/) تشرح الخيارات. لا نحتاج حسابات أو مفاتيح EAS لإنشاء نفق Android الحالي؛ لا ندعي تجهيز توقيع/نسخة iOS على هاتف المالك.

## أمر التشغيل

من مجلد التطبيق:

```bash
npx expo start --tunnel --go --port 8091
# للمدير8092 وللموصل8093. package.json يحدد منفذ التطبيق تلقائيًا:
npm start
```

أزل `expo-dev-client` من المشاريع وplugin الخاصة به، حتى يختار الأمر Expo Go افتراضيًا. مثبت `@expo/ngrok` محليًا وبإصدار محدد، فلا يحتاج CLI إلى تنزيل تفاعلي عالمي. ملف EAS الحالي يترك preview الداخلي فقط؛ بناء development client يحتاج إعدادًا صريحًا لاحقًا ولا يستخدم لهذه المعاينة.

**الفرق بين الأمر ومزود النفق:** SDK57 يستخدم ngrok عند `--tunnel`، وليس Cloudflare. جرب الأمر ونجح بمزوده الفعلي؛ لم يغير اسمه أو يصفه كـCloudflare. انظر [مرجع Expo CLI](https://docs.expo.dev/more/expo-cli/#tunneling). Cloudflare Quick Tunnel طريقة مختلفة بوسيط `cloudflared` وتهيئة عنوان Metro، ولم تضف طبقة نفق ثانية غير لازمة. لا نشر خارجي أو حساب Cloudflare أنشئ.

المنافذ8091/8092/8093 مخصصة للعميل/الإدارة/الموصل، لأن8081–8083 للمعاينات المتصفحية. أمر الخدمات يضيف `--go --port ... --max-workers 2` لتثبيت نوع العميل والمنفذ. ليس من الضروري أن يكون الهاتف على شبكة الحاوية.

## خدمات تبقى بعد انتهاء جلسة الوكيل

من جذر المشروع، بعد `bash setup.sh`:

```bash
bash backend/scripts/start-expo-tunnels.sh
```

| التطبيق | خدمة systemd | المنفذ |
|---|---|---|
| العميل | `tazweed-customer-expo-8091` |8091|
| الإدارة | `tazweed-admin-expo-8092` |8092|
| الموصل | `tazweed-courier-expo-8093` |8093|

يمنع السكربت أخذ منفذ مملوك لخدمة أخرى ويعيد استخدام وحدته إن كانت تعمل. يستخدم `/usr/bin/npx --no-install` ومجلد عمل مطلقًا، وRestart=on-failure. الخدمات transient تبقى بعد انتهاء الأمر، لكنها تحتاج إعادة إنشاء بعد إعادة تشغيل الحاوية. الروابط قد تتغير عند إعادة إنشاء النفق؛ استخرجها مجددًا ولا تعتمد سجلًا قديمًا.

العملية headless: `EXPO_UNSTABLE_HEADLESS=1` يمنع محاولة تشغيل نافذة Electron DevTools داخل حاوية root دون شاشة. أبقي فحص الاعتماديات وNew Architecture مفعّلين صراحة. لا `CI=1` في خدمات التطوير النهائية حتى لا يعطل وضع المشاهدة. هذه إعدادات CLI المحلي المثبت، وليست أسرارًا أو تغييرات داخل node_modules.

```bash
systemctl status tazweed-customer-expo-8091 --no-pager
journalctl -u tazweed-customer-expo-8091 -n 30 --no-pager
systemctl restart tazweed-customer-expo-8091
systemctl stop tazweed-customer-expo-8091
```

## فحص النفق وإعادة إنشاء QR

```bash
node backend/scripts/verify-expo-tunnels.mjs
```

يتحقق من الخدمات و`/status` محليًا وعبر HTTPS العام، واختيار runtime=expo فقط، وmanifest Android/iOS بـSDK57 وRTL، وتحميل launchAsset الفعلي من النفق للمنصتين، وفتح WebSocket العام. يحفظ JSON وصور QR. نجاح ذلك دليل وصول الشبكة والحزمة، وليس ادعاء تشغيلها على هاتف فعلي. لا يحتاج السكربت أسرارًا ولا يطبع credentials.

لفحص واجهات التصدير بعد تعديل SDK دون محو أدلة التسليم الأول:

```bash
cd backend
PHASE01_EVIDENCE_PREFIX=phase-01-sdk57 npm run test:preview
```

## العربية والأصول داخل Expo Go

أضيف `extra.supportsRTL/forcesRTL` للتطبيقات الثلاثة إلى جانب config plugin، بما يناسب manifest SDK57؛ LocaleProvider واتجاه محتوى الصفحات باقٍ. لا استدعاء forceRTL أو إعادة تحميل دورية من runtime. تحتاج مراجعة الاتجاه على الهاتف كما هو موضح في التقرير. فيديو العميل محلي، ولا فيديو في الإدارة أو الموصل. لا تغيير أو إعادة توليد لأصول الهوية الأصلية.

Expo Go يشغل المشروع داخل تطبيقه الأصلي؛ تغيير الأيقونة وnative splash وconfig plugins لا يعيد بناء تطبيق Go. فحص أيقونة التثبيت وsplash النهائيين يتطلب لاحقًا بناء التطبيق المستقل. اختبر الخط والثيمين والتخطي والفيديو على الهاتف الآن؛ ما زالت الخدمات التجارية fake معلّمة.

## معاينات المتصفح داخل remote.futrx

الـProject slug المعتمد من المالك: `tazweed`. مسار المراجعة `/`:

- العميل: https://tazweed--8081.dev.remote-ammar.duckdns.org/
- الإدارة: https://tazweed--8082.dev.remote-ammar.duckdns.org/
- الموصل: https://tazweed--8083.dev.remote-ammar.duckdns.org/

هذه روابط المتصفح وليست روابط Expo Go. خوادمها `tazweed-{role}-preview-{port}` على0.0.0.0، مع سماح hostname المطابق فقط بالإضافة إلى loopback. قد تتطلب تسجيل الدخول إلى remote.futrx؛302 إلى بوابة المنصة يثبت ingress/auth فقط. اختبرت محتوى التطبيق والمتصفح محليًا، ولم تدّع عبور متصفح المالك لجلسة الدخول. نفق Expo Go العام مستقل عن هذه البوابة.

في02 أضيفت للعميل expo-image-picker57.0.20 وexpo-clipboard57.0.2 وreact-native-svg15.15.4، وهي ضمن Expo Go57. الصورة محلية بلا رفع، والخريطة تخطيطية تجريبية. لا dev-client جديد أو تغيير SDK. لتسجيل دليل جديد مستقل: `TAZWEED_EVIDENCE_PREFIX=phase-02 node backend/scripts/verify-expo-tunnels.mjs`. الدليل الافتراضي أصبح04 لحفظ أدلة01/02 التاريخية؛ لا تكتب فوقها بفحص جديد.


مع الإدارة03، فحص شاشاتها الحالي: `npm --prefix backend run test:admin`، وفحص تراجع افتتاح العميل: `node backend/scripts/test-previews.mjs`. لا تعتمد اختبار شاشة الإدارة التأسيسية01 بعد استبدالها. تحفظ الجولات الحالية وQR تحت phase-03-evidence. الدخول محلي:770000001 وكلمة Tazweed123! ثم000000؛ تغير JavaScript يعيد بيانات المعاينة ولا يمثل فقد جلسة خادم.

مع الموصل04: `npm --prefix backend run test:courier` يراجع المهام والدفترين والبلاغ والشبكة والثيمين والمقاسين، ويحفظ phase-04-evidence. حسابه770000012 وكلمة Tazweed123! ثم000000. إضافاته exact ضمن Go57: expo-audio57.0.5 وimage-picker57.0.20 وclipboard57.0.2. الصوت محلي اختياري؛ لا إذن موقع/ميكروفون أو فيديو أو تتبع خلفي. إعدادات plugins تحلل فقط ولا تعيد بناء Go.
