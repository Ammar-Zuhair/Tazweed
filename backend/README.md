# هيكل خادم تزويد — المرحلة01

Express5 + TypeScript. `src/app.ts` يتيح `GET /health` فقط ويصرح بعدم تهيئة قاعدة البيانات أو الخدمات التجارية. `src/server.ts` يستمع افتراضيًا على loopback8084 مع إغلاق منظم. لا مصادقة أو طلبات أو migrations أو بيانات حقيقية في01.

```bash
npm ci
npm run typecheck
npm test
npm run build
npm start
```

[دليل التشغيل والبنية](docs/PHASE01_BUILD.md) — [تقرير01](docs/progress/phase-01.md). `scripts/serve-preview.mjs` و`test-previews.mjs` أدوات معاينة للتطبيقات الثلاثة، وليسا API تجاريًا.

اقرأ `docs/ARCHITECTURE.md` و`BUSINESS_RULES.md` و`DATABASE.md` و`API.md` قبل مراحل05+. PostgreSQL هو الهدف اللاحق. `database/schema.sql` مرجع المرحلة00 المصحح؛ لا يطبق الآن ولا يحول إلى قاعدة إنتاج في01. اختبارات `reference-tests` وlockfile الخاصة بها مستقلة ومحفوظة.
