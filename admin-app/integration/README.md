# ربط الإصدارات الأصلية في10

ملف `app.config.ts` هو الإعداد الفعلي. تشغيل المعاينة الافتراضي `preview` يبقي Expo Go57، دون ادعاء remote Push أوOTA فيGo. ملفfragment مرجع للهوية فقط؛ لا تنسخه فوق الإعداد الفعلي.

سجّل بيانات المشروع العامة المعتمدة فيbackend/.env، ثم شغّل `node backend/scripts/prepare-native-config.mjs --app admin --environment staging` من الجذر. يكتب فقط projectId وAPI HTTPS ومعرّفات الحزم العامة إلى `release.staging.local.json`؛ لا ينقل أي مفتاح. يرفض بناءstaging/production بلا هذا الملف. لبيئة أخرى استخدم ملف إعداد خادمي منفصلًا عبر `NATIVE_CONFIG_ENV_FILE`؛ لا تعِد استخدام قاعدة/أسرارstaging للإنتاج.

ملفeas.json يربط channel staging ببيئةEAS preview، وproduction ببيئةproduction. ملف `.easignore` فيجذرالمستودع يبقي metadata العامة ضمن أرشيفالبناء رغمgitignore، ويستبعدdotenv والحزم والمخرجات. FCMv1 service-account وAPNs signing key فيEAS Credentials، وملفGoogle Services العام للبناء عبرمتغير ملفEAS `GOOGLE_SERVICES_JSON` عند تجهيزAndroid. لا أسرارخادم أوservice-account فيJS.

OTA يفحص مرة عندبدءroot، وينزّل فقط، دونreload أوفحصكلforeground؛ يستخدمالتحديث المتوافق فيcold start لاحق. fingerprint يغيرruntime عندتغييرnative؛ البناءالأصلي واختبارforeground/background/closed والصوت وتبديلالرمز وOTA علىAndroid/iOS باقيةبعدالمفاتيح. لا نشرأوإنشاءحسابأوتقديممتاجر ضمن10. [دليلالإصدارات](../../backend/docs/RELEASES.md).
