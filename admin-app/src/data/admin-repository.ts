import { visibleOrders } from "../domain/admin-model";
import type { AdminState } from "../domain/types";
export type ReadScenario = "ready" | "loading" | "empty" | "error" | "offline";
export async function readOrders(
  s: AdminState,
  query: string,
  status: string,
  scenario: ReadScenario,
  signal?: AbortSignal,
  latency = scenario === "loading" ? 2200 : 120,
) {
  await new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error("aborted"));
      return;
    }
    const abort = () => {
      clearTimeout(t);
      reject(new Error("aborted"));
    };
    const t = setTimeout(() => {
      signal?.removeEventListener("abort", abort);
      resolve();
    }, latency);
    signal?.addEventListener("abort", abort, { once: true });
  });
  if (scenario === "error" || scenario === "offline") throw new Error(scenario);
  return scenario === "empty"
    ? []
    : visibleOrders(s).filter(
        (o) =>
          (status === "all" || o.status === status) &&
          (!query || `${o.id} ${o.customer}`.includes(query.trim())),
      );
}
