/** Builds surface coverage off the main thread, so finishing a mask edit never stalls the output. */
import { buildCoverage, type CoverageJob } from './coverage';

self.onmessage = (event: MessageEvent<CoverageJob & { surface: string }>) => {
  const job = event.data;
  const result = buildCoverage(job);
  const transfer: Transferable[] = [];
  if (result.coverage) transfer.push(result.coverage.buffer);
  if (result.field) transfer.push(result.field.data.buffer);
  (self as unknown as Worker).postMessage({ ...result, surface: job.surface }, transfer);
};
