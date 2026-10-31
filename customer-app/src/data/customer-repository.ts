import { filterCatalog, PreviewError, type CatalogQuery } from '../domain/catalog';
import type { PreviewScenario } from '../domain/types';
import { previewDailyProducts, previewPromotions } from '../fixtures/home';

function readPreview<T>(read: () => T, empty: () => T, scenario: PreviewScenario, signal?: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => { clearTimeout(timer); reject(new PreviewError('ألغيت القراءة القديمة.', 'ABORTED')); };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', abort);
      if (scenario === 'error' || scenario === 'offline') reject(new PreviewError(scenario === 'offline' ? 'الاتصال التجريبي غير متاح.' : 'تعذر تحميل كتالوج المعاينة.'));
      else resolve(scenario === 'empty' ? empty() : read());
    }, scenario === 'loading' ? 2200 : 120);
    if (signal?.aborted) abort(); else signal?.addEventListener('abort', abort, { once: true });
  });
}
/** Local preview adapter. No HTTP, GPS, OTP delivery, payment or backend side effects. */
export const customerRepository = {
  source: 'local-preview' as const,
  catalog(query: CatalogQuery, scenario: PreviewScenario, signal?: AbortSignal) {
    return readPreview(() => filterCatalog(query), () => [], scenario, signal);
  },
  promotions(governorateId: string | null, scenario: PreviewScenario, signal?: AbortSignal) {
    return readPreview(() => previewPromotions(governorateId), () => [], scenario, signal);
  },
  popularToday(governorateId: string | null, day: string, scenario: PreviewScenario, signal?: AbortSignal) {
    return readPreview(() => previewDailyProducts(governorateId, day), () => ({ day, timezone: 'UTC' as const, source: 'local-preview' as const, rows: [] }), scenario, signal);
  },
};
