import { createContext, useContext, useEffect, useState, type PropsWithChildren } from 'react';
import { assertPreviewEnvironment, createFakeFoundationRepository, type FoundationOverview, type Scenario } from './foundation-repository';

type State = { status: 'loading' | 'ready' | 'empty' | 'error'; data: FoundationOverview | null; scenario: Scenario; setScenario: (scenario: Scenario) => void; retry: () => void };
const Context = createContext<State | null>(null);
export function FoundationProvider({ children }: PropsWithChildren) {
  const [scenario, setScenario] = useState<Scenario>('ready');
  const [attempt, setAttempt] = useState(0);
  const [status, setStatus] = useState<State['status']>('loading');
  const [data, setData] = useState<FoundationOverview | null>(null);
  useEffect(() => {
    assertPreviewEnvironment(process.env.EXPO_PUBLIC_APP_ENV ?? 'preview');
    const controller = new AbortController();
    setStatus('loading'); setData(null);
    createFakeFoundationRepository(scenario).getOverview(controller.signal).then(result => {
      if (controller.signal.aborted) return;
      setData(result); setStatus(result.highlights.length ? 'ready' : 'empty');
    }).catch(() => { if (!controller.signal.aborted) setStatus('error'); });
    return () => controller.abort();
  }, [scenario, attempt]);
  return <Context.Provider value={{ status, data, scenario, setScenario, retry: () => { setScenario('ready'); setAttempt(value => value + 1); } }}>{children}</Context.Provider>;
}
export function useFoundation() {
  const value = useContext(Context);
  if (!value) throw new Error('FoundationProvider is required');
  return value;
}
