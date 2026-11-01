import { createElement, useEffect, useRef } from "react";
import { apiBase } from "./connection";
import type { MapProps } from "./MapPicker";
export default function MapPicker({
  latitude,
  longitude,
  route,
  readOnly = false,
  onPoint,
  onError,
}: MapProps) {
  const ref = useRef<HTMLIFrameElement>(null),
    url = apiBase() + "/maps/picker";
  useEffect(() => {
    const handler = (e: MessageEvent) => {
      if (
        e.origin !== window.location.origin ||
        e.source !== ref.current?.contentWindow ||
        e.data?.type !== "tazweed-map"
      )
        return;
      const v = e.data;
      if (v.event === "ready") send();
      if (v.event === "error") onError();
      if (
        v.event === "point" &&
        Number.isFinite(v.latitude) &&
        Math.abs(v.latitude) <= 90 &&
        Number.isFinite(v.longitude) &&
        Math.abs(v.longitude) <= 180
      )
        onPoint(v.latitude, v.longitude);
    };
    const send = () =>
      ref.current?.contentWindow?.postMessage(
        { type: "tazweed-position", latitude, longitude, route, readOnly },
        window.location.origin,
      );
    window.addEventListener("message", handler);
    send();
    return () => window.removeEventListener("message", handler);
  }, [latitude, longitude, route, readOnly, onPoint, onError]);
  return createElement("iframe", {
    ref,
    src: url,
    title: "خريطة عنوان التوصيل",
    style: { height: 330, width: "100%", border: 0, borderRadius: 14 },
    sandbox:
      "allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox",
    onError,
  });
}
