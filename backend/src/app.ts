import express from 'express';

/** Phase 01: process health only; no business routes or database connection. */
export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.get('/health', (_request, response) => {
    response.json({ service: 'tazweed-backend', status: 'ok', phase: '01', database: 'not-configured', businessServices: 'not-implemented' });
  });
  app.use((_request, response) => { response.status(404).json({ error: { code: 'NOT_FOUND', message: 'المسار غير متاح' } }); });
  return app;
}
