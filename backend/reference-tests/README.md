# اختبارات مرجع البيانات بعد قرارات متابعة00

PGlite 0.5.12 من lockfile موجود، وNode22، ومكتبات Python القياسية اختيارية لتجميع التقرير. لا قاعدة إنتاج أو حساب خدمة أو OTP أو Docker مطلوبة. كل fixtures وهمية في الذاكرة وتغلق بنهاية السكربت؛ لا تنتقل إلى تشغيل فعلي.

```bash
cd /workspace/backend/reference-tests
npm ci --ignore-scripts --no-audit --no-fund
npm test
node phase-00-review.mjs
node generate-database-doc.mjs --check
```

- `schema.test.mjs`: اختبارات قيود وحراسSQL؛ S01–S22 تبقي تغطية الحالات المرجعية الأصلية مع fixtures محدثة، وO01–O51 تغطي قرارات المالك وإصلاحات00. كل حالة معاملة يتراجع عنها؛ كل رفض متوقع savepoint مستقل، وتفحص القيود المؤجلة قبل rollback.
- `phase-00-review.mjs`: أربعة تشخيصاتSV01–SV04 تبين قواعد تحتاج الخدمات اللاحقة ولا يكفي SQL لإثباتها، وفحصاوقتT01/T02 يعبران معاملات فعلية لإثبات بقاء حجز/سعر التحويل بعد انتهاء مهلة العرض، ووجوب إعادة التحقق والحجز للنقد. `observed=allowed` للـSV يعني حدًا موثقًا للمرجع، وليس نجاح خدمة. يخرج JSON بالبصمة وpg_catalog والنتائج.
- `helpers.mjs`: إدخال fixtures مشتركة وحالات اختبار SQL فقط، وقراءة metadata. ليس تنفيذًا لخدمات checkout أو confirm أو provider؛ لا يختبر صلاحيات موظفين أو موصلين على API.
- `generate-database-doc.mjs`: ينفذ schema.sql في DB جديدة ويولد قسم القاموس من الأنواع والحقول والقيود والحراس الحقيقية. `--check` يفشل عند اختلاف DATABASE.md، وبدونه يعيد توليد الجزء المعلّم فقط. عدل الوصف اليدوي خارج الجزء المولد.

النطاق: المخطط المرجعي الحالي69 جدولًا، ولاحقًا تحول إلى migrations بعد طلب05. لا اختباراتAPI/RBAC أو التزامن متعدد الاتصالات أو R2/OTP/Maps/Push أو أجهزة أو nativebuild نفذت هنا. حساب أهلية العرض وأكبر توفير، counters/ledger، والسعر الحي عند revalidation مسؤوليات خدمات لاحقة، وليست انتصارات اختبار مختلقة.
دليل التنفيذ الحالي في [phase-00-checks.json](../docs/progress/phase-00-checks.json)، والتقرير في [phase-00.md](../docs/progress/phase-00.md)، والمشكلات في [ISSUES.md](../../ISSUES.md). نتائج22/17 السابقة محفوظة تحت progress/phase-00-initial للتاريخ؛ لا تطبق توقعات فجواتها القديمة على المرجع المصحح.
