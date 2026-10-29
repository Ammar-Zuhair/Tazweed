import AsyncStorage from '@react-native-async-storage/async-storage';
import { createContext, useContext, useEffect, useRef, useState, type PropsWithChildren } from 'react';
import { createInitialState, previewGovernorateKey, transition, type PreviewAction } from '../domain/customer-model';
import { governorateById } from '../fixtures/catalog';
import type { CustomerState } from '../domain/types';

type Result = { ok: boolean; state: CustomerState };
type Value = { state: CustomerState; ready: boolean; message: string; notify: (text: string) => void; send: (action: PreviewAction, success?: string) => Result };
const Context = createContext<Value | null>(null);
const ClockContext = createContext(0);
function PreviewClock({ children }: PropsWithChildren) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, []);
  return <ClockContext.Provider value={now}>{children}</ClockContext.Provider>;
}
export function useCustomerClock() { return useContext(ClockContext); }
export function CustomerProvider({ children }: PropsWithChildren) {
  const [state, setState] = useState(() => createInitialState());
  const latest = useRef(state);
  const [ready, setReady] = useState(false);
  const [message, notify] = useState('');
  useEffect(() => {
    let alive = true;
    AsyncStorage.getItem(previewGovernorateKey).then(value => {
      if (alive && governorateById(value)) { latest.current = { ...latest.current, governorateId: value }; setState(latest.current); }
    }).catch(() => { if (alive) notify('تعذر حفظ المحافظة محليًا؛ يمكنك متابعة المعاينة.'); }).finally(() => { if (alive) setReady(true); });
    return () => { alive = false; };
  }, []);
  useEffect(() => { if (!message) return; const timer = setTimeout(() => notify(''), 7000); return () => clearTimeout(timer); }, [message]);
  const send: Value['send'] = (action, success) => {
    try {
      const next = transition(latest.current, action);
      latest.current = next; setState(next);
      if (action.type === 'governorate') AsyncStorage.setItem(previewGovernorateKey, action.id).catch(() => notify('لم تحفظ المحافظة؛ ستطلب مجددًا عند فتح التطبيق.'));
      if (success) notify(success);
      return { ok: true, state: next };
    } catch (error) { notify(error instanceof Error ? error.message : 'تعذر تنفيذ الإجراء التجريبي.'); return { ok: false, state: latest.current }; }
  };
  return <Context.Provider value={{ state, ready, message, notify, send }}><PreviewClock>{children}</PreviewClock></Context.Provider>;
}
export function useCustomer() { const value = useContext(Context); if (!value) throw new Error('CustomerProvider is required'); return value; }
