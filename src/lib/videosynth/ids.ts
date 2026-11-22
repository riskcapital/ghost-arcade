/**
 * Analog Synth's resource ids. A module of its own with no imports: the
 * renderer's cleanup, which is in every build, names a synth layer's
 * resources with it and brings in none of the synth's shader or presets.
 */

/** The core's rule for a source id inside a buffer id (native_graph_buffer_safe_id):
 *  one `_` for each character outside [A-Za-z0-9:_-], at most 160 long. */
function coreSafeId(value: string): string {
  let out = '';
  for (const ch of value) {
    out += /^[A-Za-z0-9:_-]$/.test(ch) ? ch : '_';
    if (out.length >= 160) break;
  }
  return out || 'source';
}

/** FNV-1a over the UTF-16 units, as 8 hex digits. */
function hash32(value: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) { h ^= value.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(16).padStart(8, '0');
}

/**
 * The start of every texture and buffer id of one synth layer, ending in `:`.
 * It holds the source id the way the core spells it (so the core's own
 * cleanup, which looks for `:<safe id>:`, still finds the buffers) and a hash
 * of the whole id, so two long ids that only differ past the cut stay apart.
 * The app's cleanup frees the layer by this prefix.
 */
export function videosynthIdPrefix(sourceId: string): string {
  return `videosynth:${coreSafeId(sourceId)}:${hash32(sourceId)}:`;
}
