import { createApp } from './app.js';
const port = Number(process.env.PORT ?? 8084);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('PORT must be an integer between 1024 and 65535');
// Private by default. No mobile services are exposed in this phase.
const host = process.env.HOST ?? '127.0.0.1';
const server = createApp().listen(port, host, () => console.log(`Tazweed phase 01 health listening on ${host}:${port}`));
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => {
  server.close(error => { process.exitCode = error ? 1 : 0; });
  setTimeout(() => process.exit(1), 5000).unref();
});
