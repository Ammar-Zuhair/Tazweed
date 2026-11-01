import { Linking } from "react-native";
import { useRef, useEffect } from "react";
import { WebView } from "react-native-webview";
import { apiBase } from "./connection";
export type MapProps = {
  latitude: number;
  longitude: number;
  route?: any;
  readOnly?: boolean;
  onPoint: (latitude: number, longitude: number) => void;
  onError: () => void;
};
export default function MapPicker({
  latitude,
  longitude,
  route,
  readOnly = false,
  onPoint,
  onError,
}: MapProps) {
  const ref = useRef<WebView>(null),
    url = apiBase() + "/maps/picker";
  const inject = () =>
    ref.current?.injectJavaScript(
      `window.tazweedPosition&&window.tazweedPosition(${JSON.stringify({ type: "tazweed-position", latitude, longitude, route, readOnly })});true;`,
    );
  useEffect(() => {
    inject();
  }, [latitude, longitude, route, readOnly]);
  return (
    <WebView
      ref={ref}
      source={{ uri: url }}
      style={{ height: 330, flex: 0 }}
      originWhitelist={[new URL(url).origin]}
      javaScriptEnabled
      geolocationEnabled={false}
      allowsInlineMediaPlayback={false}
      setSupportMultipleWindows={false}
      onShouldStartLoadWithRequest={(r) => {
        if (r.url === "about:blank" || r.url === url) return true;
        if (
          [
            "https://openfreemap.org/",
            "https://www.openmaptiles.org/",
            "https://www.openstreetmap.org/copyright",
          ].includes(r.url)
        )
          void Linking.openURL(r.url).catch(onError);
        return false;
      }}
      onError={onError}
      onMessage={(e) => {
        try {
          const v = JSON.parse(e.nativeEvent.data);
          if (v.type !== "tazweed-map") return;
          if (v.event === "ready") inject();
          if (v.event === "error") onError();
          if (
            v.event === "point" &&
            Number.isFinite(v.latitude) &&
            Math.abs(v.latitude) <= 90 &&
            Number.isFinite(v.longitude) &&
            Math.abs(v.longitude) <= 180
          )
            onPoint(v.latitude, v.longitude);
        } catch {
          onError();
        }
      }}
    />
  );
}
