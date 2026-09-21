/** Preserve source generation and post-processing in a single retained graph. */
export function composeNativeGraphs(
  source: Record<string, any> | null | undefined,
  effects: Record<string, any> | null | undefined,
): Record<string, any> | null {
  if (!source) return effects ?? null;
  if (!effects) return source;
  return {
    ...source,
    buffers: [...(source.buffers ?? []), ...(effects.buffers ?? [])],
    passes: [...(source.passes ?? []), ...(effects.passes ?? [])],
    // Producers must execute before consumers even when the two builders
    // used independent sequence-number ranges (large groups exceed 16).
    render_passes: [...(source.render_passes ?? []), ...(effects.render_passes ?? [])]
      .map((pass, index) => ({ ...pass, seq: index })),
    readbacks: [...(source.readbacks ?? []), ...(effects.readbacks ?? [])],
  };
}
