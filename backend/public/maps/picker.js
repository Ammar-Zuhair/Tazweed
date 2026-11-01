import * as maplibregl from "/api/v1/maps/assets/maplibre-gl.mjs";
maplibregl.setWorkerUrl("/api/v1/maps/assets/maplibre-gl-worker.mjs");
/* No session or provider secrets enter this frame. Only validated coordinate/geometry messages. */
(async () => {
  const status = document.getElementById("status");
  let map,
    marker,
    ready = false,
    pending = null,
    readOnly = false;
  const send = (data) => {
    const value = { type: "tazweed-map", ...data };
    if (window.ReactNativeWebView)
      window.ReactNativeWebView.postMessage(JSON.stringify(value));
    else window.parent.postMessage(value, location.origin);
  };
  const point = (v) =>
    Number.isFinite(v.latitude) &&
    v.latitude >= -90 &&
    v.latitude <= 90 &&
    Number.isFinite(v.longitude) &&
    v.longitude >= -180 &&
    v.longitude <= 180;
  const apply = (v) => {
    if (!ready) {
      pending = v;
      return;
    }
    readOnly = !!v.readOnly;
    marker.setDraggable(!readOnly);
    status.textContent = readOnly
      ? "جارٍ رسم مسار التوصيل…"
      : "اسحب الدبوس أو اضغط موقع العنوان";
    if (point(v)) {
      marker.setLngLat([v.longitude, v.latitude]);
      map.jumpTo({ center: [v.longitude, v.latitude], zoom: 14 });
    }
    const route = v.route;
    if (
      route &&
      route.type === "LineString" &&
      Array.isArray(route.coordinates) &&
      route.coordinates.length <= 10000
    ) {
      const bounds = route.coordinates.reduce(
        (bounds, p) => bounds.extend(p),
        new maplibregl.LngLatBounds(route.coordinates[0], route.coordinates[0]),
      );
      map.fitBounds(bounds, { padding: 45, maxZoom: 15, duration: 0 });
      const data = { type: "Feature", properties: {}, geometry: route };
      if (map.getSource("road")) map.getSource("road").setData(data);
      else {
        map.addSource("road", { type: "geojson", data });
        map.addLayer({
          id: "road",
          type: "line",
          source: "road",
          paint: { "line-color": "#e56b08", "line-width": 5 },
        });
      }
      map.once("idle", () => {
        if (readOnly) {
          status.textContent = "مسار توصيل تقديري · العنوان المحفوظ";
          send({ event: "route-ready" });
        }
      });
    } else if (map.getSource("road"))
      map
        .getSource("road")
        .setData({ type: "FeatureCollection", features: [] });
  };
  const receive = (e) => {
    if (e.source && e.source !== window.parent) return;
    if (e.origin && e.origin !== location.origin) return;
    try {
      const data = typeof e.data === "string" ? JSON.parse(e.data) : e.data;
      if (data?.type === "tazweed-position") apply(data);
    } catch {}
  };
  window.addEventListener("message", receive);
  document.addEventListener("message", receive);
  // Native injection calls this fixed bridge, with JSON-encoded numbers only.
  window.tazweedPosition = (v) => {
    if (v?.type === "tazweed-position") apply(v);
  };
  try {
    const config = await fetch("/api/v1/public/maps").then((r) => {
      if (!r.ok) throw Error();
      return r.json();
    });
    map = new maplibregl.Map({
      container: "map",
      style: config.styleUrl,
      center: [44, 15],
      zoom: 5,
      attributionControl: false,
    });
    marker = new maplibregl.Marker({ draggable: true, color: "#df690a" })
      .setLngLat([44, 15])
      .addTo(map);
    const changed = () => {
      const p = marker.getLngLat();
      send({ event: "point", latitude: p.lat, longitude: p.lng });
    };
    marker.on("dragend", changed);
    map.on("click", (e) => {
      if (readOnly) return;
      marker.setLngLat(e.lngLat);
      changed();
    });
    map.on("load", () => {
      ready = true;
      status.textContent = "اسحب الدبوس أو اضغط موقع العنوان";
      if (pending) apply(pending);
      send({ event: "ready" });
    });
    map.on("error", () => {
      status.textContent =
        "تعذر تحميل بعض بيانات الخريطة؛ يمكنك إدخال الإحداثيات";
      send({ event: "error" });
    });
    map.addControl(new maplibregl.NavigationControl(), "top-left");
  } catch {
    status.textContent = "تعذر تحميل الخريطة؛ أدخل الإحداثيات في النموذج";
    send({ event: "error" });
  }
})();
