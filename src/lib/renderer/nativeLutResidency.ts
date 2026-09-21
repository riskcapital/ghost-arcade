/** Only acknowledged uploads are omitted. Failed submissions and renderer resets retry in full. */
export class NativeLutResidency {
  private resident = new Set<string>();
  private generation = 0;
  reset() { this.resident.clear(); this.generation++; }
  prepare<T extends { type: string }>(commands: T[]) {
    const generation = this.generation;
    const uploads = new Set<string>();
    const prepared = commands.map(command => {
      const graph = command as T & { buffers?: Array<Record<string, unknown>> };
      if (graph.type !== 'queue_compute_graph' || !graph.buffers?.some(b => b.immutable_lut === true)) return command;
      return { ...graph, buffers: graph.buffers.map(buffer => {
        if (buffer.immutable_lut !== true) return buffer;
        const id = String(buffer.id);
        if (!this.resident.has(id)) { uploads.add(id); return buffer; }
        const { initial_f32: _data, initial_b64: _binary, ...reference } = buffer;
        return reference;
      }) };
    });
    return {
      commands: prepared,
      finish: (success: boolean) => {
        if (!success) { this.reset(); return; }
        if (generation === this.generation) for (const id of uploads) this.resident.add(id);
      },
    };
  }
}
