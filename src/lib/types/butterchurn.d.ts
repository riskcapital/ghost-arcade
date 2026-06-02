// Ambient type stubs for butterchurn + butterchurn-presets.
// Both packages ship as UMD bundles with no shipped .d.ts. Marking them
// `any` keeps the rest of the codebase strict-mode clean without us
// hand-writing the full butterchurn surface (which is undocumented in
// detail and stable enough that runtime use is the contract).

declare module 'butterchurn' {
  const butterchurn: any;
  export default butterchurn;
}

declare module 'butterchurn-presets' {
  const butterchurnPresets: any;
  export default butterchurnPresets;
  export const getPresets: (() => Record<string, any>) | undefined;
}

declare module 'butterchurn-presets/lib/butterchurnPresetsMinimal.min.js' {
  export const getPresets: () => Record<string, any>;
  const _default: { getPresets: () => Record<string, any> };
  export default _default;
}
declare module 'butterchurn-presets/lib/butterchurnPresets.min.js' {
  export const getPresets: () => Record<string, any>;
  const _default: { getPresets: () => Record<string, any> };
  export default _default;
}
declare module 'butterchurn-presets/lib/butterchurnPresetsExtra.min.js' {
  export const getPresets: () => Record<string, any>;
  const _default: { getPresets: () => Record<string, any> };
  export default _default;
}
declare module 'butterchurn-presets/lib/butterchurnPresetsExtra2.min.js' {
  export const getPresets: () => Record<string, any>;
  const _default: { getPresets: () => Record<string, any> };
  export default _default;
}
declare module 'butterchurn-presets/lib/butterchurnPresetsMD1.min.js' {
  export const getPresets: () => Record<string, any>;
  const _default: { getPresets: () => Record<string, any> };
  export default _default;
}

// hydra-synth ships as CJS with no .d.ts. Same any-stub treatment as
// butterchurn — runtime use is the contract; we patch synth.a directly
// after construction so most surface is untyped on purpose.
declare module 'hydra-synth' {
  const HydraSynth: any;
  export default HydraSynth;
}
