# الإصدارات والبيئات
كل تطبيق Expo مشروع مستقل وله Android package وiOS bundle identifier وEAS projectId وFirebase registration وAPNs المناسبة. يحدد المالك أسماء الحزم المتاحة؛ لا تستخدم اقتراح اسم حزمة غير محجوز كهوية فعلية.
مثال ملفات eas.example.json يربط channel staging ببيئة EAS المسماة preview، والإنتاج بproduction؛ أسماء قناة التحديث وبيئة المتغيرات شيئان مستقلان. لا تعتمد أن اسم staging موجود كبيئة EAS افتراضية. يمكن إنشاء بيئة مخصصة وفق حساب المالك ثم تحديث المثال.

## إعداد لأول مرة
من كل مجلد تطبيق بعد إنشاء المشروع: اربطه بحساب Expo الصحيح ثم `eas update:configure` وسجل projectId وupdates.url الفعليين. ادمج fragment واحفظ runtime fingerprint. ضع متغير API العام الصحيح في EAS environment؛ لا أي سر خادم في EXPO_PUBLIC_. ادعم Android وiOS credential setup لكل تطبيق.

## Build واختبار ثم OTA
بناء staging: `eas build --platform all --profile staging` بعد استيفاء حسابات وأجهزة التوزيع.
OTA تجريبي: `eas update --channel staging --environment preview --message "وصف التغيير"` من مجلد التطبيق الصحيح.
بناء إنتاج: `eas build --platform all --profile production`.
OTA إنتاج: `eas update --channel production --environment production --message "وصف التغيير"` فقط إذا runtime متوافق وبعد اختبار. راجع الأوامر مع إصدار EAS CLI المثبت وقت التنفيذ.
لا يتم نشر أو شراء أو تقديم للمتاجر تلقائيًا من هذه الحزمة. وجود accounts لا يعني أن credentials مربوطة بالفعل.

## بوابة تحديث المتجر
GET public/config يعيد maintenance customer وrelease حسب app/platform/build/بيئة موثوقة من الخادم. minimum_build إجبار، latest_build إشعار اختياري. اختبر الروابط وتوفر binary قبل زيادة minimum. لا تستخدم runtimeVersion بدل buildNumber للتحقق من نسخة المتجر. Android versionCode وiOS buildNumber أعداد متزايدة؛ version تسمية عرض.

## OTA عند الفتح التالي
الإعداد المرجعي يعطل الفحص native الآلي ويجري check+fetch في JavaScript بعد بدء التشغيل، دون reload. التحديث المحلي المتوافق يعمل عند cold start التالي. لا يعاد تشغيل التطبيق أثناء الطلب أو الدفع ولا كل رجوع من الخلفية. اختبر behavior في build إصدار؛ Expo Go ليس التحقق المطلوب.
أي تعديل native/أذونات/أيقونة/مكتبة مضافة يستلزم build جديدًا، ويمنع fingerprint توزيعه على runtime القديم. دعم الخادم للإصدارات الأقدم وexpand-contract مطلوبان حتى تكتمل الترقية.
