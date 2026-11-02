// React Native's AbortSignal polyfill does not provide the static timeout() helper.
export async function jsonRequest(
  url: string,
  init: RequestInit,
  timeoutMs = 15000,
) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const r = await fetch(url, { ...init, signal: controller.signal });
    const data = r.status === 204 ? null : await r.json();
    return { r, data };
  } catch (error) {
    if (controller.signal.aborted)
      throw new Error("انتهت مهلة الاتصال؛ حاول مجددًا");
    if (error instanceof SyntaxError) throw new Error("تعذر قراءة رد الخادم");
    throw error instanceof Error ? error : new Error("تعذر الاتصال بالخادم");
  } finally {
    clearTimeout(timer);
  }
}
