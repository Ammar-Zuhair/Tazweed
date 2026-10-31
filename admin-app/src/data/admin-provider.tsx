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
import { transition } from "../domain/admin-model";
import { createAdminState } from "../fixtures/admin-fixtures";
import type { AdminState, Command } from "../domain/types";
type Store = {
  state: AdminState;
  send: (command: Command) => boolean;
  message: string;
  clear: () => void;
  reset: () => void;
};
const Context = createContext<Store | null>(null);
const ClockContext = createContext(0);
export function AdminProvider({ children }: PropsWithChildren) {
  const [state, setState] = useState(createAdminState);
  const ref = useRef(state);
  const [message, setMessage] = useState("");
  const offset = useRef(0);
  const [clock, setClock] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(
      () => setClock(Date.now() + offset.current),
      1000,
    );
    return () => clearInterval(timer);
  }, []);
  const send = useCallback((command: Command) => {
    try {
      const next = transition(
        ref.current,
        command,
        Date.now() + offset.current,
      );
      if (command.type === "preview-time") {
        offset.current = next.state.now - Date.now();
        setClock(next.state.now);
      }
      ref.current = next.state;
      setState(next.state);
      setMessage(next.message);
      return true;
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "تعذر تنفيذ العملية.");
      return false;
    }
  }, []);
  useEffect(() => {
    const due = state.reservations
      .filter((r) => r.state === "active" && r.kind === "timed")
      .map((r) => r.expiresAt!)
      .sort((a, b) => a - b)[0];
    if (due === undefined) return;
    const timer = setTimeout(
      () => {
        const next = transition(
          ref.current,
          { type: "clock" },
          Date.now() + offset.current,
        );
        ref.current = next.state;
        setState(next.state);
      },
      Math.max(0, due - Date.now() - offset.current),
    );
    return () => clearTimeout(timer);
  }, [state.reservations]);
  const reset = useCallback(() => {
    const next = createAdminState();
    ref.current = next;
    setState(next);
    offset.current = 0;
    setClock(Date.now());
    setMessage("أعيدت بيانات المعاينة وسجل الخروج.");
  }, []);
  const clear = useCallback(() => setMessage(""), []);
  // Clock ticks must notify clock consumers without rerendering every form/router.
  const value = useMemo(
    () => ({ state, send, message, clear, reset }),
    [state, send, message, clear, reset],
  );
  return (
    <Context.Provider value={value}>
      <ClockContext.Provider value={clock}>{children}</ClockContext.Provider>
    </Context.Provider>
  );
}
export const useAdminClock = () => useContext(ClockContext);
export function useAdmin() {
  const value = useContext(Context);
  if (!value) throw new Error("AdminProvider required");
  return value;
}
