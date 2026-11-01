import { Router } from "express";
import { fileURLToPath } from "node:url";
export function mapsRouter() {
  const r = Router(),
    publicDir = fileURLToPath(new URL("../../public/maps/", import.meta.url));
  // Explicit files only: no URL/file proxy. Assets are pinned and served from this backend.
  r.use("/maps", (_req, res, next) => {
    res.set(
      "Content-Security-Policy",
      "default-src 'none'; font-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https://tiles.openfreemap.org; connect-src 'self' https://tiles.openfreemap.org https://fonts.openmaptiles.org; worker-src 'self' blob:; child-src blob:; frame-ancestors 'self'; base-uri 'none'; form-action 'none'",
    );
    res.set("Referrer-Policy", "no-referrer");
    next();
  });
  r.get("/maps/picker", (_req, res) => res.sendFile(publicDir + "picker.html"));
  for (const name of [
    "picker.js",
    "picker.css",
    "Tajawal-Medium.ttf",
    "OFL.txt",
  ])
    r.get("/maps/" + name, (_req, res) => res.sendFile(publicDir + name));
  for (const name of [
    "maplibre-gl.mjs",
    "maplibre-gl-shared.mjs",
    "maplibre-gl-worker.mjs",
    "maplibre-gl.css",
  ])
    r.get("/maps/assets/" + name, (_req, res) =>
      res.sendFile(
        fileURLToPath(
          new URL(
            "../../node_modules/maplibre-gl/dist/" + name,
            import.meta.url,
          ),
        ),
      ),
    );
  return r;
}
