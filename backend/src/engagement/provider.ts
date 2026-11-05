import { z } from "zod";
import type { Config } from "../config.js";
export type PushMessage = {
  to: string;
  title: string;
  body: string;
  data: Record<string, unknown>;
  sound?: string;
  channelId?: string;
};
export type PushResult =
  | { status: "ok"; id?: string }
  | { status: "error"; code: string; retryable: boolean };
export interface PushProvider {
  readonly mode: "unconfigured" | "expo" | "test";
  send(message: PushMessage): Promise<PushResult>;
  receipt(id: string): Promise<PushResult | null>;
}
const codes = new Set([
  "DeviceNotRegistered",
  "MessageTooBig",
  "MessageRateExceeded",
  "MismatchSenderId",
  "InvalidCredentials",
  "UNAUTHORIZED",
  "TOO_MANY_REQUESTS",
]);
const result = z.object({
  status: z.enum(["ok", "error"]),
  id: z.string().max(200).optional(),
  details: z.object({ error: z.string().max(100).optional() }).optional(),
});
const normalize = (v: z.infer<typeof result>): PushResult =>
  v.status === "ok"
    ? { status: "ok", id: v.id }
    : {
        status: "error",
        code: codes.has(v.details?.error ?? "")
          ? v.details!.error!
          : "PROVIDER_REJECTED",
        retryable: v.details?.error === "MessageRateExceeded",
      };
export class ExpoPush implements PushProvider {
  readonly mode = "expo" as const;
  constructor(
    private accessToken: string,
    private timeout: number,
    private transport: typeof fetch = fetch,
  ) {}
  private async call(path: string, body: unknown) {
    const controller = new AbortController(),
      timer = setTimeout(() => controller.abort(), this.timeout);
    try {
      const r = await this.transport(
        "https://exp.host/--/api/v2/push/" + path,
        {
          method: "POST",
          redirect: "error",
          signal: controller.signal,
          headers: {
            "Content-Type": "application/json",
            Authorization: "Bearer " + this.accessToken,
          },
          body: JSON.stringify(body),
        },
      );
      if (!r.ok)
        return {
          error: {
            status: "error",
            code:
              r.status === 429
                ? "TOO_MANY_REQUESTS"
                : r.status === 401 || r.status === 403
                  ? "UNAUTHORIZED"
                  : "PROVIDER_HTTP",
            retryable: r.status === 429 || r.status >= 500,
          } as PushResult,
        };
      return { body: (await r.json()) as any };
    } catch {
      return {
        error: {
          status: "error",
          code: "TRANSPORT_UNKNOWN",
          retryable: true,
        } as PushResult,
      };
    } finally {
      clearTimeout(timer);
    }
  }
  async send(message: PushMessage): Promise<PushResult> {
    const r = await this.call("send", message);
    if (r.error) return r.error;
    const v = result.safeParse(r.body?.data);
    return v.success && v.data.status === "ok" && v.data.id
      ? normalize(v.data)
      : v.success && v.data.status === "error"
        ? normalize(v.data)
        : { status: "error", code: "PROVIDER_RESPONSE", retryable: true };
  }
  async receipt(ticket: string): Promise<PushResult | null> {
    const r = await this.call("getReceipts", { ids: [ticket] });
    if (r.error) return r.error;
    const value = r.body?.data?.[ticket];
    if (value === undefined) return null;
    const v = result.safeParse(value);
    return v.success
      ? normalize(v.data)
      : { status: "error", code: "PROVIDER_RESPONSE", retryable: true };
  }
}
export function pushFromConfig(c: Config): PushProvider {
  if (c.PUSH_PROVIDER === "expo")
    return new ExpoPush(c.EXPO_ACCESS_TOKEN!, c.PUSH_TIMEOUT_MS);
  return {
    mode: "unconfigured",
    async send() {
      throw Error("Push unconfigured");
    },
    async receipt() {
      throw Error("Push unconfigured");
    },
  };
}
export const deployment = (c: Config) =>
  c.APP_ENV === "production" ? "production" : "staging";
export function projectFor(c: Config, app: string) {
  return app === "customer"
    ? c.EXPO_CUSTOMER_PROJECT_ID
    : app === "admin"
      ? c.EXPO_ADMIN_PROJECT_ID
      : c.EXPO_COURIER_PROJECT_ID;
}
