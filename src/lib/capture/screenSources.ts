export interface ScreenCaptureSource {
  id: string;
  name: string;
  display_id: string | null;
  thumbnailDataUrl: string | null;
  appIconDataUrl: string | null;
  kind: 'screen' | 'window';
}

interface ScreenSourceListOptions {
  preferFast?: boolean;
  timeoutMs?: number;
}

interface ScreenSourcesIpcOptions {
  thumbnailSize?: { width: number; height: number };
  fetchWindowIcons?: boolean;
  timeoutMs?: number;
}

const FULL_PREVIEW_OPTIONS: ScreenSourcesIpcOptions = {
  thumbnailSize: { width: 320, height: 180 },
  fetchWindowIcons: true,
  timeoutMs: 3600,
};

const FAST_PREVIEW_OPTIONS: ScreenSourcesIpcOptions = {
  thumbnailSize: { width: 0, height: 0 },
  fetchWindowIcons: false,
  timeoutMs: 2200,
};

export function screenCaptureSourcePickerAvailable(): boolean {
  return typeof window !== 'undefined' && !!(window as any).electronAPI?.invoke;
}

function normalizeScreenCaptureSource(source: any): ScreenCaptureSource | null {
  const id = typeof source?.id === 'string' ? source.id : '';
  if (!id) return null;
  return {
    id,
    name: typeof source?.name === 'string' && source.name.trim() ? source.name : 'Untitled source',
    display_id: typeof source?.display_id === 'string' ? source.display_id : null,
    thumbnailDataUrl: typeof source?.thumbnailDataUrl === 'string' ? source.thumbnailDataUrl : null,
    appIconDataUrl: typeof source?.appIconDataUrl === 'string' ? source.appIconDataUrl : null,
    kind: source?.kind === 'screen' || id.startsWith('screen:') ? 'screen' : 'window',
  };
}

function normalizeScreenCaptureSources(list: any): ScreenCaptureSource[] {
  if (!Array.isArray(list)) return [];
  return list
    .map(normalizeScreenCaptureSource)
    .filter((source): source is ScreenCaptureSource => !!source);
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs);
  });

  return Promise.race([promise, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  }) as Promise<T>;
}

async function invokeScreenSourceList(
  ipcOptions: ScreenSourcesIpcOptions,
  rendererTimeoutMs: number,
): Promise<ScreenCaptureSource[]> {
  const api = (window as any).electronAPI;
  if (!api?.invoke) throw new Error('Electron capture source picker is unavailable');
  const list = await withTimeout(
    api.invoke('screen_sources_list', ipcOptions),
    rendererTimeoutMs,
    'screen_sources_list',
  );
  return normalizeScreenCaptureSources(list);
}

export async function listScreenCaptureSources(
  options: ScreenSourceListOptions = {},
): Promise<ScreenCaptureSource[]> {
  const timeoutMs = options.timeoutMs ?? 4200;
  if (options.preferFast) {
    return invokeScreenSourceList(FAST_PREVIEW_OPTIONS, Math.max(2400, Math.floor(timeoutMs * 0.75)));
  }

  try {
    const sources = await invokeScreenSourceList(FULL_PREVIEW_OPTIONS, timeoutMs);
    if (sources.length > 0) return sources;
  } catch (err) {
    console.warn('[CaptureSources] Full preview source enumeration failed; retrying fast path.', err);
  }

  const fastTimeoutMs = Math.max(2400, Math.floor(timeoutMs * 0.75));
  return invokeScreenSourceList(FAST_PREVIEW_OPTIONS, fastTimeoutMs);
}
