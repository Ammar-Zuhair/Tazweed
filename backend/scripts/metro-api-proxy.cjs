// Development only. Fixed loopback upstream; never an open URL proxy and never reads service secrets.
const http = require("node:http");
module.exports = function apiProxy(next) {
  return (req, res, nextMiddleware) => {
    const path=(req.url??'').split('?')[0];
    const legal=['/privacy','/terms','/support','/delete-account','/assets/tajawal.ttf'].includes(path)||path.startsWith('/assets/legal/')||path.startsWith('/web/account-deletion/');
    if (!req.url?.startsWith("/api/v1/") && !legal) return next(req, res, nextMiddleware);
    const headers = { ...req.headers, host: "127.0.0.1:8084" };
    delete headers.origin;
    delete headers.cookie;
    const upstream = http.request(
      {
        host: "127.0.0.1",
        port: 8084,
        path: req.url,
        method: req.method,
        headers,
      },
      (r) => {
        res.writeHead(r.statusCode, r.headers);
        r.pipe(res);
      },
    );
    upstream.setTimeout(15000, () => upstream.destroy());
    upstream.on("error", () => {
      if (!res.headersSent)
        res.writeHead(503, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          error: { code: "API_UNAVAILABLE", message: "الخادم غير متاح" },
        }),
      );
    });
    req.pipe(upstream);
    req.on("aborted", () => upstream.destroy());
  };
};
