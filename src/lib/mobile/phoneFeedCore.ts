/*
 * Where phone feed frames go: the render core, through the broker, the way
 * three.js / p5 page frames do (raw bytes, written to the slot as sent).
 */
import { invoke } from '$lib/bridge';
import type { NativeCommandApplySummary, NativeLayerSourceReadiness } from '$lib/api/native-renderer';
import { getActiveNativeRendererSync } from '$lib/sync/nativeRendererSync';
import type { PumpSink } from './phoneFeedPump';

/** The core's default source slot edge, until a sync has started. */
const DEFAULT_SLOT_EDGE = 2048;

export function phoneFeedCoreSink(): PumpSink {
  return {
    async upload(command) {
      // Straight to the broker: a failed frame must not reset the sync's LUT bookkeeping.
      const result = await invoke<NativeCommandApplySummary | null>('native_renderer_submit_commands', { commands: [command] });
      return !!result && !result.dropped && !result.invalid_payload && !result.errors?.length;
    },
    async shown(sourceId) {
      const readiness = await invoke<NativeLayerSourceReadiness | null>('native_renderer_get_source_frame_readiness', { source_id: sourceId });
      return readiness?.ready === true;
    },
  };
}

export function phoneFeedSlotEdge(): number {
  return getActiveNativeRendererSync()?.sourceFrameEdge() ?? DEFAULT_SLOT_EDGE;
}
