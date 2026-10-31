import type { Command, Scenario, ServerState } from "../domain/types";
import { execute, project } from "../domain/courier-model";
import { assertPreviewEnvironment } from "./foundation-repository";
export const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
export function delay(ms: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error("aborted"));
      return;
    }
    const abort = () => {
      clearTimeout(timer);
      reject(new Error("aborted"));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", abort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", abort, { once: true });
  });
}
export class FakeCourierRepository {
  constructor(
    public state: ServerState,
    environment = "preview",
  ) {
    assertPreviewEnvironment(environment);
  }
  async read(
    actor: string,
    scenario: Scenario,
    now: number,
    signal?: AbortSignal,
    ms = 350,
  ) {
    await delay(scenario === "loading" ? 1800 : ms, signal);
    if (scenario === "offline")
      throw new Error("انقطاع شبكة تجريبي؛ لم يصل طلب التحديث.");
    if (scenario === "error") throw new Error("تعذر تحميل المهام التجريبية.");
    const snapshot = project(this.state, actor, now);
    if (scenario === "empty") {
      snapshot.tasks = [];
      snapshot.notices = snapshot.notices.filter((x) => !x.orderId);
      snapshot.reports = [];
      snapshot.exceptions = [];
    }
    return snapshot;
  }
  async send(
    actor: string,
    command: Command,
    mode: "online" | "offline" | "lost_ack",
    now: number,
    ms = 450,
  ) {
    await delay(ms);
    if (mode === "offline") throw new Error("pending_network");
    this.state = execute(this.state, actor, command, now);
    if (mode === "lost_ack") throw new Error("pending_network");
    return project(this.state, actor, now);
  }
}
