import * as ImagePicker from "expo-image-picker";
import { api } from "./connection";
export async function pickUpload(purpose: string, userId: string) {
  const p = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ["images"],
    quality: 0.9,
  });
  if (p.canceled) return null;
  const a = p.assets[0];
  if (!a) throw Error("لم تختر صورة");
  const blob = await (await fetch(a.uri)).blob();
  if (blob.size > 8388608) throw Error("حد الصورة8ميغابايت");
  const mime = a.mimeType ?? blob.type,
    m = await api(
      "/media/uploads",
      { purpose, mime, size: blob.size },
      "POST",
      undefined,
      userId,
    );
  const controller = new AbortController(),
    timer = setTimeout(() => controller.abort(), 15000);
  try {
    const r = await fetch(m.putUrl, {
      method: "PUT",
      headers: { "Content-Type": mime },
      body: blob,
      signal: controller.signal,
    });
    if (!r.ok) throw Error("تعذر رفع الصورة");
  } finally {
    clearTimeout(timer);
  }
  await api(
    "/media/uploads/" + m.uploadId + "/complete",
    {},
    "POST",
    undefined,
    userId,
  );
  return m.uploadId as string;
}
