export type CaptureAdapter = {
  luid?: string;
  name?: string;
  vendorId?: number;
  deviceId?: number;
  software?: boolean;
};
export type CoreAdapter = { luid: string; vendorId: number; deviceId: number; name: string };
export type CaptureAdapterPick = {
  luid: string;
  match: 'luid' | 'vendor-device' | 'none';
  adapter: CaptureAdapter | null;
  reason: string;
};
export function normalizeAdapterLuid(value: unknown): string;
export function coreAdapterFromStatus(status: unknown): CoreAdapter | null;
export function pickCaptureAdapter(adapters: unknown, core: CoreAdapter | null): CaptureAdapterPick;
export function describeAdapter(adapter: CaptureAdapter | CoreAdapter | null | undefined): string;
