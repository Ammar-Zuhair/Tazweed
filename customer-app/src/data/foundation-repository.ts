export type Scenario = 'ready' | 'empty' | 'error' | 'loading';
export type FoundationOverview = {
  source: 'fake';
  message: string;
  highlights: readonly { title: string; body: string }[];
};
export interface FoundationRepository {
  readonly source: 'fake';
  getOverview(signal?: AbortSignal): Promise<FoundationOverview>;
}

export function assertPreviewEnvironment(environment: string) {
  if (environment === 'production') throw new Error('Fake repositories cannot run in production');
}

export function createFakeFoundationRepository(scenario: Scenario = 'ready', latencyMs = scenario === 'loading' ? 2400 : 160): FoundationRepository {
  return { source: 'fake', async getOverview(signal) {
    await new Promise<void>((resolve, reject) => {
      if (signal?.aborted) { reject(new Error('aborted')); return; }
      const abort = () => { clearTimeout(timer); reject(new Error('aborted')); };
      const timer = setTimeout(() => { signal?.removeEventListener('abort', abort); resolve(); }, latencyMs);
      signal?.addEventListener('abort', abort, { once: true });
    });
    if (scenario === 'error') throw new Error('تعذر تحميل المعاينة. يمكنك المحاولة مجددًا.');
    return { source: 'fake', message: 'بيانات تجريبية — غير متصل بالخدمات', highlights: scenario === 'empty' ? [] : [
      { title: 'هوية واحدة. تجربة متكاملة.', body: 'زيوت وبطاريات وإطارات وطاقة شمسية، تحت اسم تزويد.' },
      { title: 'وضوح في كل خطوة', body: 'لغة عربية، تفاصيل مقروءة، وتجربة تتكيف مع تفضيلاتك.' },
    ] };
  } };
}
