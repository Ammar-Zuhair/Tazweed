import type { Config } from "../config.js";
import { ApiError } from "../http.js";
export type OtpMessage = {
  phone: string;
  code: string;
  purpose: string;
  app: string;
  challengeId: string;
};
export interface OtpProvider {
  readonly mode: "unconfigured" | "https-gateway" | "test";
  send(message: OtpMessage): Promise<void>;
}
export class UnconfiguredOtpProvider implements OtpProvider {
  readonly mode = "unconfigured" as const;
  async send(_message: OtpMessage): Promise<void> {
    throw new ApiError(503, "OTP_UNAVAILABLE", "خدمة التحقق غير مهيأة");
  }
}
// A vendor-independent HTTPS transport contract, not evidence that a real vendor is integrated.
export class HttpsOtpProvider implements OtpProvider {
  readonly mode = "https-gateway" as const;
  constructor(
    private url: string,
    private token: string,
  ) {
    if (!url.startsWith("https://")) throw new Error("HTTPS required");
  }
  async send(message: OtpMessage) {
    try {
      const response = await fetch(this.url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.token}`,
        },
        body: JSON.stringify(message),
        signal: AbortSignal.timeout(5000),
        redirect: "error",
      });
      // Only the status is consumed; provider response bodies may contain sensitive data.
      if (!response.ok) throw new Error("Gateway rejected");
      await response.body?.cancel();
    } catch {
      throw new ApiError(503, "OTP_UNAVAILABLE", "تعذر إرسال رمز التحقق");
    }
  }
}
export function providerFromConfig(config: Config): OtpProvider {
  return config.OTP_PROVIDER === "https-gateway"
    ? new HttpsOtpProvider(config.OTP_PROVIDER_URL!, config.OTP_PROVIDER_TOKEN!)
    : new UnconfiguredOtpProvider();
}
