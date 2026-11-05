# الإصدارات والبيئات
كل تطبيق Expo مشروع مستقل وله Android package وiOS bundle identifier وEAS projectId وFirebase registration وAPNs المناسبة. يحدد المالك أسماء الحزم المتاحة؛ لا تستخدم اقتراح اسم حزمة غير محجوز كهوية فعلية.
مثال ملفات eas.example.json يربط channel staging ببيئة EAS المسماة preview، والإنتاج بproduction؛ أسماء قناة التحديث وبيئة المتغيرات شيئان مستقلان. لا تعتمد أن اسم staging موجود كبيئة EAS افتراضية. يمكن إنشاء بيئة مخصصة وفق حساب المالك ثم تحديث المثال.

## إعداد لأول مرة
من كل مجلد تطبيق بعد إنشاء المشروع: اربطه بحساب Expo الصحيح ثم `eas update:configure` وسجل projectId وupdates.url الفعليين. ادمج fragment واحفظ runtime fingerprint. ضع متغير API العام الصحيح في EAS environment؛ لا أي سر خادم في EXPO_PUBLIC_. ادعم Android وiOS credential setup لكل تطبيق.

## Build واختبار ثم OTA
بناء staging: `eas build --platform all --profile staging` بعد استيفاء حسابات وأجهزة التوزيع.
OTA تجريبي: `EXPO_PUBLIC_APP_ENV=staging eas update --channel staging --environment preview --message "وصف التغيير"` من مجلد التطبيق الصحيح.
بناء إنتاج: `eas build --platform all --profile production`.
OTA إنتاج: `EXPO_PUBLIC_APP_ENV=production eas update --channel production --environment production --message "وصف التغيير"` فقط إذا runtime متوافق وبعد اختبار. راجع الأوامر مع إصدار EAS CLI المثبت وقت التنفيذ.
لا يتم نشر أو شراء أو تقديم للمتاجر تلقائيًا من هذه الحزمة. وجود accounts لا يعني أن credentials مربوطة بالفعل.

## بوابة تحديث المتجر
GET public/config يعيد maintenance customer وrelease حسب app/platform/build/بيئة موثوقة من الخادم. minimum_build إجبار، latest_build إشعار اختياري. اختبر الروابط وتوفر binary قبل زيادة minimum. لا تستخدم runtimeVersion بدل buildNumber للتحقق من نسخة المتجر. Android versionCode وiOS buildNumber أعداد متزايدة؛ version تسمية عرض.

## OTA عند الفتح التالي
الإعداد المرجعي يعطل الفحص native الآلي ويجري check+fetch في JavaScript بعد بدء التشغيل، دون reload. التحديث المحلي المتوافق يعمل عند cold start التالي. لا يعاد تشغيل التطبيق أثناء الطلب أو الدفع ولا كل رجوع من الخلفية. اختبر behavior في build إصدار؛ Expo Go ليس التحقق المطلوب.
أي تعديل native/أذونات/أيقونة/مكتبة مضافة يستلزم build جديدًا، ويمنع fingerprint توزيعه على runtime القديم. دعم الخادم للإصدارات الأقدم وexpand-contract مطلوبان حتى تكتمل الترقية.

## التنفيذ10 الحالي

- `eas.json` فعليلكلتطبيق، وpreview هوالمسارالمحليGo57؛ staging/production لايمرانبمعرّفحزمةتجريبيأوبمشروعمخترع. بياناتالبناءالعامةتأتيمنbackend/.env عبر `node backend/scripts/prepare-native-config.mjs --app customer --environment staging` (كررadmin/courier). لملفبيئةمنفصلاستخدم `NATIVE_CONFIG_ENV_FILE`؛ الأداةلاتنشئأوتربطمشروعEAS خارجيًا.
- app.config يقرأintegration/release.staging.local.json أوproduction.local.json حسبEXPO_PUBLIC_APP_ENV. الملفمهملGit لكن`.easignore` فيجذرالمستودعيسمحبتضمينmetadata العامةفيأرشيفEAS ويستبعدdotenv. package/bundle IDs منالمالكفقط. Android versionCode وiOS buildNumber لهماقيمةأولية1، وproduction autoIncrement؛ راجعالرقمالمعتمدالموجودقبلأولرفعولا تعِدبناءرقممتجريمستخدم.
- Expo Push عبرFCM/APNs: اعتمادFCMv1 الخاصومفتاحAPNs فيEAS Credentials، enhanced push security فعال، EXPO_ACCESS_TOKEN فيbackend فقط. GOOGLE_SERVICES_JSON متغيرملففيبيئةالبناءلملفAndroid العام. [المصدر](https://docs.expo.dev/push-notifications/push-notifications-setup/). لاتجربةremotePush فيExpoGo؛ inbox يعملفيه. [حدودGo](https://docs.expo.dev/push-notifications/faq/).
- `integration/updates.ts` فيالتطبيقاتالثلاثةيفحصمرةعندبدءroot وfetch فقط، دونreload. NEVER/fallback0 تمنعفحصالإقلاعالآليالمنتظر؛ المنزلالمتوافقيعملفيcold start لاحق. runtime fingerprint يطابقالتغييراتالأصلية. [سلوكالتنزيل](https://docs.expo.dev/eas-update/download-updates/)، [runtime](https://docs.expo.dev/eas-update/runtime-versions/).
- لا EAS build/update/submit أُرسل، ولاأيإصدارمتجريفعليموجودفيDB. screenshotsبوابةالإصدار تستخدمAPI حقيقيًامعbuildأصليصريحيفرضهhelper المتصفح؛ ليستجهازًاولاOTA متجريًا.

## الجولة المؤجلة بعدالإعداد وطلبالمالك

1. تحقق منمعرّفمشروعكلتطبيق والقنواتوالبيئةوالAPI منbinary staging موقّع؛ ثبتعلىAndroid وiOS فعليين. اختبررفض/قبولالإذن، foreground/background/closed وتبديلالرمزوالحسابوالخروجوالصوتوقناتهواستلامreceipt. سجلالجهازوالنسخةوالوقت؛ ticket/receipt لايكفيكدليلظهور. [نقلالExpo وتفاصيلالأخطاء](https://docs.expo.dev/push-notifications/sending-notifications/).
2. جرّبالصيانةعلىالعميل معطلبجارٍ، وتأكداستمرارالإدارةوالموصل. اضبطإصدارًااختياريًاثمإجباريًابعقدbuild صحيحورابطمتجر/توزيعمعتمدمتاحبالفعل. لاترفعمينيمومالإنتاجمنبياناتاختبار.
3. انشرOTA staging متوافقًافقطبعدطلبالنشر، وافتحالنسخةA لتنزيلB دونreload، ثمcold start لإثباتB. غيّراعتمادًاnative لruntimeC وتحققأنbinaryA لايجلبC. احتفظبإثباتالقنواتوالمشروعوالfingerprint؛ فحصالوحدةللإعدادلايثبتهذاالتسليم.
4. production لهAPI/DB/secrets والقناةوهويةالمتجرالمعتمدة، واعتمادمنفصلقبلأيbuild/update/submit فعلي. نقصالمفاتيحوالهاتفمعلنلايستبدلباختبارمحول. التوقفبعد10 وقبل11.


أرشيفEAS: ملف`.easignore` فيجذرGit هوالمعتمدللـmonorepo، ينسخقواعدgitignore ثميسمحبالـmetadata العامةالمولدةفقط، ويستبعدbackendكاملًاوالأسراروقواعدالحاوية. الإعدادالعاميولدمسبقًاقبلالأرشفة؛ لااستيرادbackend داخلJS. لميرفعأرشيفإلىEAS؛ فحص`eas build:inspect --stage archive` بعدتسجيلالمالكمؤجل. [مرجعموضعالملفوقواعدالأرشفة](https://docs.expo.dev/build-reference/easignore/).


أرقام البناء فيEAS: `cli.appVersionSource=remote` وautoIncrement فيstaging/production؛ لا تحاولCLI تعديلدالةapp.config محليًا. القيمالأولية1 ليستمرجعالمتجر؛ يجبمزامنةآخررقممتجريمعEAS قبلأولبناءعبر `eas build:version:set` بعدطلبالمالك. التطبيق يقرأالرقمالأصليمنexpo-application، لا رقمmanifest قابلًاللتغييربOTA. [مرجعإدارةالأرقام](https://docs.expo.dev/build-reference/app-versions/).

لثبات fingerprint بين البناء وOTA: وفّر نفس بيانات المشروع العامة وملفAndroid العام نفسه عند كليهما، مع GOOGLE_SERVICES_JSON يشير إلى الملف المتاح في بيئة الأمر. متغير ملفEAS قد يتوفر فيbuilder فقط؛ يجب تجهيز نسخة الملف العامة محليًا أوفيCI قبلأمرupdate، لا service-account الخاص. المصدرالمثبت لـ@expo/fingerprint يضممحتوىgoogleServicesFile ضمنالبصمةويستبعدمسارهالمطلق منconfig؛ غيابالملفيعطيruntime مختلفًا. لاتتجاوزالتوافق؛ أكملبيئةالإعدادالمطابقة ثم اختبرstaging علىالجهاز.


اضبطEXPO_PUBLIC_APP_ENV فيبيئةEAS المسماةpreview علىstaging، وفيproduction علىproduction أيضًا؛ قيمenv داخلbuild profile لاتغنيعنبيئةأمرupdate. الأوامرأعلاهتحددالهدفصراحةلكييقرأنفسmetadata وfingerprint، ولا تنشرمنإعدادGo الافتراضيpreview. غيابالمشروع/الملفأواختلافبيئةالمصدريُعالجقبلأينشر، دونتهيئةتلقائيةلمشروعغيرمصرح.
