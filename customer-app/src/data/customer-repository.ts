import { filterCatalog, PreviewError, type CatalogQuery } from '../domain/catalog';
import type { PreviewScenario, Product } from '../domain/types';

/** Local preview adapter. No HTTP, GPS, OTP delivery, payment or backend side effects. */
export const customerRepository = {
  source: 'local-preview' as const,
  catalog(query: CatalogQuery, scenario: PreviewScenario, signal?: AbortSignal): Promise<Product[]> {
    return new Promise((resolve, reject) => {
      const abort = () => { clearTimeout(timer); reject(new PreviewError('ألغيت القراءة القديمة.', 'ABORTED')); };
      const timer = setTimeout(() => {
        signal?.removeEventListener('abort', abort);
        if (scenario === 'error' || scenario === 'offline') reject(new PreviewError(scenario === 'offline' ? 'الاتصال التجريبي غير متاح.' : 'تعذر تحميل كتالوج المعاينة.'));
        else resolve(scenario === 'empty' ? [] : filterCatalog(query));
      }, scenario === 'loading' ? 2200 : 120);
      if (signal?.aborted) abort(); else signal?.addEventListener('abort', abort, { once: true });
    });
  },
};
