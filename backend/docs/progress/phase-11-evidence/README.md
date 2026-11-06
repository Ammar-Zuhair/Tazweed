# أدلة المرحلة 11

الأوامر ونتائجها في[الفحص الجامع](../phase-11-checks.json)، و[التقرير](../phase-11.md) يوضح حدود القبول. **264 اختبارًا فريدًا و 9 جولات UI مع 27 لقطة**. كل بياناتالرحلات والمبيعات ومدد السياسة أدناه اختبار معزول، وليست قيم مالك أو تشغيل أو إثبات مزود حقيقي. لا ملفات إيصالات خام أو أسرار فيالدليل.

## النتائج القابلة للفتح

- [PDF شهري عربي](monthly-sales.pdf):3 صفحات A4 بخط Tajawal مضمن؛ snapshot خاص منقاعدة معزولة، لا تقرير عميل عام. [صورةالصفحةالأولى](monthly-sales-page1.png).
- [الجولة الكاملة 188/188](acceptance.txt) و[جولة الطابور 12/12](client-operations.txt). الأخيرة تضيف 3 حالات فريدة فقط؛9 منها إعادة تحقق.73 حارس SQL مرجعية موثقةفي الفحص الجامع.
- [نتائج UI التسعة](ui-checks.json):0pageErrors و 0 طلباتمزودخارجي، ونتائجفقد الإقرار/OTP/الصلاحية/الحذف المكتمل والمعلق.
- [صفحة الحذف العامة المنشورة فعليًا](public-deletion-unconfigured.png): زيارة مستقلة لنفق Expo دون تطبيقأو دخول، تعرض السياسة و OTP غير مهيأين. تختلف عن بيئة UI التيتحقن سياسة اختبار ومحول OTP معزول. لا يمكن عد الصورة اعتمادًا للسياسة أو إرسال OTP حقيقيًا.

## تفاصيل الرحلات

| الدليل | ما يثبته في الاختبار المعزول |
|---|---|
| [التقرير بعدفقد الإقرار](report-lost-ack.png) | إعادة المفتاح نفسه تؤدي إلى مهمة واحدة وتنزيل مصرح به |
| [الحذف بعدفقد الإقرار](deletion-lost-ack.png) | القدرة على المتابعة محفوظة قبل verify وإعادة البرهان لا تنشئ طلبًا آخر |
| [التزام مفتوح](deletion-open-obligations.png) | قبول الحذف وإبطال جلساته مع حالة تحتاج مراجعة دون إلغاء الطلب الجاري |
| [حذف التطبيق المكتمل](app-deletion-completed.png) | محو هوية حساب بلا التزامات، ثم إعادة الفتح برقم المتابعة ومفتاحه |
| [حذف المتصفح المكتمل](web-deletion-completed.png) | النموذج العام دون تطبيق يقبل رمزًا صحيحًا بعد رفض الخاطئ |
| [تعطل OTP](web-otp-unavailable.png) | خطأ صادق دون إظهار نجاح الحذف |
| [سحب الصلاحية](report-permission-revoked.png) | رفضقراءةالتقرير بعدسحب الصلاحيةالحية |
| [مراجعة الإدارة](admin-deletion-review.png) | الموظف لا يتجاوز التزامًا تشغيليًا قائمًا |
| [خصوصية الموصل](courier-privacy.png) | شاشتهالمتصلةتعرض السياسةالمخدومة |

## الثيمان والمقاسات

| الشاشة/الثيم |360 |390 |1024 |
|---|---|---|---|
| التقرير فاتح | [صورة](report-light-360.png) | [صورة](report-light-390.png) | [صورة](report-light-1024.png) |
| التقرير داكن | [صورة](report-dark-360.png) | [صورة](report-dark-390.png) | [صورة](report-dark-1024.png) |
| خصوصية التطبيق فاتح | [صورة](privacy-light-360.png) | [صورة](privacy-light-390.png) | [صورة](privacy-light-1024.png) |
| خصوصية التطبيق داكن | [صورة](privacy-dark-360.png) | [صورة](privacy-dark-390.png) | [صورة](privacy-dark-1024.png) |
| Express فاتح | [صورة](express-privacy-light-360.png) | [صورة](express-privacy-light-390.png) | [صورة](express-privacy-light-1024.png) |
| Express داكن | [صورة](express-privacy-dark-360.png) | [صورة](express-privacy-dark-390.png) | [صورة](express-privacy-dark-1024.png) |

## Expo Go57

| التطبيق | الرابط المفحوص |QR |
|---|---|---|
| العميل | `exps://sfs3nam-anonymous-8091.exp.direct` | [QR](customer-qr.png) |
| الإدارة | `exps://utjz9oi-anonymous-8092.exp.direct` | [QR](admin-qr.png) |
| الموصل | `exps://vsfhyqu-anonymous-8093.exp.direct` | [QR](courier-qr.png) |

نتيجة 6manifests و 6 حزم Hermes و 3WebSocket والثبات في[فحص الأنفاق](../phase-11-tunnels.json). هذه أنفاق مؤقتة. لا تجربة هاتف فعلي أو Push أو OTA أو SecureStore/Sharing أصليفيهذاالدليل، ولا اختبار OTP/R2/Routing حقيقي. سياسة المالك D19/D20 والدعم و D15 ما زالت معلقة؛ توقف التنفيذ قبل 12.
