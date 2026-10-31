import { AppState } from "react-native";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PropsWithChildren,
} from "react";
import {
  COURIER_ID,
  active,
  login,
  prune,
  resend,
  verify,
} from "../domain/courier-model";
import type {
  Challenge,
  Command,
  Pending,
  Scenario,
  Snapshot,
} from "../domain/types";
import { fixtures } from "../fixtures/courier-fixtures";
import { FakeCourierRepository } from "./courier-repository";
const uid = () =>
  `local-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
type Draft = Command extends infer C
  ? C extends Command
    ? Omit<C, "key" | "assignmentId" | "expectedVersion">
    : never
  : never;
function useStore() {
  const repo = useRef<FakeCourierRepository | null>(null);
  if (!repo.current)
    repo.current = new FakeCourierRepository(
      fixtures(),
      process.env.EXPO_PUBLIC_APP_ENV,
    );
  const [signedIn, setSignedIn] = useState(false);
  const signed = useRef(false);
  const [challenge, setChallenge] = useState<Challenge | null>(null);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const cache = useRef<Snapshot | null>(null);
  const [pending, setPending] = useState<Pending[]>([]);
  const pendingRef = useRef<Pending[]>([]);
  const [scenario, setScenario] = useState<Scenario>("ready");
  const [network, setNetwork] = useState<"online" | "offline" | "lost_ack">(
    "online",
  );
  const [status, setStatus] = useState<"ready" | "loading" | "error">(
    "loading",
  );
  const [message, setMessage] = useState("");
  const generation = useRef(0);
  const controller = useRef<AbortController | null>(null);
  const publish = useCallback((s: Snapshot | null) => {
    cache.current = s;
    setSnapshot(s);
  }, []);
  const queue = useCallback((xs: Pending[]) => {
    pendingRef.current = xs;
    setPending(xs);
  }, []);
  const refresh = useCallback(async () => {
    if (!signed.current) return;
    controller.current?.abort();
    const abort = new AbortController();
    controller.current = abort;
    const gen = generation.current;
    setStatus("loading");
    try {
      const result = await repo.current!.read(
        COURIER_ID,
        network === "offline" ? "offline" : scenario,
        Date.now(),
        abort.signal,
      );
      if (
        signed.current &&
        gen === generation.current &&
        !abort.signal.aborted
      ) {
        publish(result);
        setStatus("ready");
      }
    } catch (e) {
      if (abort.signal.aborted || gen !== generation.current) return;
      publish(cache.current ? prune(cache.current, Date.now()) : null);
      setStatus("error");
      setMessage((e as Error).message);
    }
  }, [network, scenario, publish]);
  useEffect(() => {
    if (signedIn) void refresh();
    return () => controller.current?.abort();
  }, [signedIn, refresh]);
  useEffect(() => {
    const pruneNow = () => {
      if (!signed.current) return;
      const now = Date.now();
      const current = cache.current;
      if (
        current &&
        (now >= current.validUntil ||
          current.tasks.some((t) => !active(t, COURIER_ID, now)))
      ) {
        publish(prune(current, now));
        queue(
          pendingRef.current.filter((p) =>
            repo.current!.state.tasks.some(
              (t) => t.id === p.command.orderId && active(t, COURIER_ID, now),
            ),
          ),
        );
        setMessage(
          "انتهت صلاحية نسخة الإسناد؛ أزيلت التفاصيل المحلية. حدّث المهام.",
        );
      }
    };
    const timer = setInterval(pruneNow, 1000);
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") {
        pruneNow();
        void refresh();
      }
    });
    return () => {
      clearInterval(timer);
      sub.remove();
    };
  }, [publish, queue, refresh]);
  const logout = useCallback(() => {
    signed.current = false;
    generation.current++;
    controller.current?.abort();
    setSignedIn(false);
    setChallenge(null);
    publish(null);
    queue([]);
    setMessage("");
    setStatus("loading");
  }, [publish, queue]);
  const send = useCallback(
    async (command: Command) => {
      const gen = generation.current;
      queue(
        pendingRef.current.map((p) =>
          p.command.key === command.key ? { command, status: "sending" } : p,
        ),
      );
      try {
        // Fake acknowledgement, never an HTTP/backend success claim.
        const result = await repo.current!.send(
          COURIER_ID,
          command,
          network,
          Date.now(),
        );
        if (!signed.current || gen !== generation.current) return;
        publish(result);
        queue(pendingRef.current.filter((p) => p.command.key !== command.key));
        setStatus("ready");
        setMessage("أقرت المحاكاة المحلية العملية. لا خادم أعمال متصل.");
      } catch (e) {
        if (!signed.current || gen !== generation.current) return;
        const text = (e as Error).message;
        queue(
          pendingRef.current.map((p) =>
            p.command.key === command.key
              ? {
                  command,
                  status:
                    text === "pending_network" ? "pending_network" : "failed",
                  error: text,
                }
              : p,
          ),
        );
        setMessage(
          text === "pending_network"
            ? "بانتظار الشبكة — لم يصل إقرار؛ الحالة المعروضة لم تتغير. أعد المحاولة بالمفتاح نفسه."
            : text,
        );
      }
    },
    [network, publish, queue],
  );
  const submit = useCallback(
    (draft: Draft) => {
      const task = cache.current?.tasks.find(
        (t) => t.id === draft.orderId && active(t, COURIER_ID, Date.now()),
      );
      if (
        !signed.current ||
        !task ||
        !cache.current ||
        Date.now() >= cache.current.validUntil
      ) {
        setMessage("التفاصيل غير صالحة؛ حدّث الإسناد.");
        return false;
      }
      if (pendingRef.current.some((p) => p.command.orderId === draft.orderId)) {
        setMessage("توجد عملية لهذا الطلب؛ أعد محاولتها أو راجعها أولًا.");
        return false;
      }
      const command = {
        ...draft,
        key: uid(),
        assignmentId: task.assignmentId,
        expectedVersion: task.version,
      } as Command;
      queue([...pendingRef.current, { command, status: "sending" }]);
      void send(command);
      return true;
    },
    [queue, send],
  );
  return useMemo(
    () => ({
      signedIn,
      challenge,
      snapshot,
      pending,
      scenario,
      network,
      status,
      message,
      clear: () => setMessage(""),
      logout,
      refresh,
      submit,
      setScenario,
      setNetwork,
      startLogin: (phone: string, password: string) => {
        try {
          setChallenge(login(phone, password, Date.now()));
          setMessage("");
        } catch (e) {
          setMessage((e as Error).message);
        }
      },
      verifyOtp: (code: string) => {
        if (!challenge) return;
        try {
          const copy = { ...challenge };
          const ok = verify(copy, code, Date.now());
          setChallenge(copy);
          if (!ok) {
            setMessage("رمز غير صحيح.");
            return;
          }
          signed.current = true;
          generation.current++;
          setSignedIn(true);
          setChallenge(null);
          setMessage("");
        } catch (e) {
          setMessage((e as Error).message);
        }
      },
      resend: () => {
        if (!challenge) return;
        try {
          setChallenge(resend(challenge, Date.now()));
          setMessage("أعيد رمز المعاينة.");
        } catch (e) {
          setMessage((e as Error).message);
        }
      },
      retry: (key: string) => {
        const p = pendingRef.current.find((x) => x.command.key === key);
        if (p && p.status !== "sending") void send(p.command);
      },
      discardFailed: (key: string) =>
        queue(
          pendingRef.current.filter(
            (x) => x.command.key !== key || x.status !== "failed",
          ),
        ),
      markRead: (id: string) => {
        repo.current!.state.notices = repo.current!.state.notices.map((x) =>
          x.id === id ? { ...x, read: true } : x,
        );
        if (cache.current)
          publish({
            ...cache.current,
            notices: cache.current.notices.map((x) =>
              x.id === id ? { ...x, read: true } : x,
            ),
          });
      },
      markSeen: (id: string) => {
        const task = repo.current!.state.tasks.find(
          (x) => x.id === id && active(x, COURIER_ID, Date.now()),
        );
        if (task) task.seen = true;
        if (cache.current)
          publish({
            ...cache.current,
            tasks: cache.current.tasks.map((t) =>
              t.id === id ? { ...t, seen: true } : t,
            ),
          });
      },
      lab: (action: "reset" | "expire" | "reply" | "maintenance") => {
        if (action === "reset") {
          logout();
          repo.current = new FakeCourierRepository(fixtures());
          setScenario("ready");
          setNetwork("online");
        }
        if (action === "expire") {
          const t = repo.current!.state.tasks.find((x) => x.id === "t1");
          if (t) t.expiresAt = Date.now() - 1;
          publish(
            cache.current
              ? prune(
                  {
                    ...cache.current,
                    tasks: cache.current.tasks.map((x) =>
                      x.id === "t1" ? { ...x, expiresAt: Date.now() - 1 } : x,
                    ),
                  },
                  Date.now(),
                )
              : null,
          );
          queue(pendingRef.current.filter((p) => p.command.orderId !== "t1"));
        }
        if (action === "reply") {
          repo.current!.state.reports.forEach((r) => {
            r.status = "processing";
            r.response =
              "رد إداري تجريبي: تواصل مع الفرع لترتيب المعالجة؛ لا تغيير لمبلغ الطلب.";
          });
          void refresh();
        }
        if (action === "maintenance")
          setMessage(
            "صيانة العميل تجريبية؛ تبقى مهام الموصل متاحة. التطبيقات محلية مستقلة.",
          );
      },
    }),
    [
      signedIn,
      challenge,
      snapshot,
      pending,
      scenario,
      network,
      status,
      message,
      logout,
      refresh,
      submit,
      send,
      queue,
      publish,
    ],
  );
}
const Context = createContext<ReturnType<typeof useStore> | null>(null);
export function CourierProvider({ children }: PropsWithChildren) {
  const store = useStore();
  return <Context.Provider value={store}>{children}</Context.Provider>;
}
export function useCourier() {
  const value = useContext(Context);
  if (!value) throw new Error("CourierProvider required");
  return value;
}
