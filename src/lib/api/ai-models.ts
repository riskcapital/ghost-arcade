// The AI models Ghost Arcade offers, and how an older saved choice maps onto
// them. The list itself is ai-models.json, which `npm run check:ai-models`
// also reads to compare it with the providers before a release.
import catalog from './ai-models.json';

export interface AIModelOption {
  id: string;
  label: string;
}

export const DEFAULT_CLAUDE_MODEL = catalog.claude.default;
export const DEFAULT_GEMINI_MODEL = catalog.gemini.default;
export const DEFAULT_OMNI_MODEL = 'gemini-omni-1.2-flash';
export const DEFAULT_LUMA_MODEL = 'ray-3.2';

const options = (models: Array<{ id: string; label: string }>): readonly AIModelOption[] =>
  models.map(({ id, label }) => ({ id, label }));

export const CLAUDE_MODELS = options(catalog.claude.models);
export const GEMINI_MODELS = options(catalog.gemini.models);
export const OMNI_MODELS = options(catalog.omni.models);
export const LUMA_MODELS = options(catalog.luma.models);

export type OmniModel = typeof DEFAULT_OMNI_MODEL;
export type LumaModel = typeof DEFAULT_LUMA_MODEL | 'ray-2' | 'ray-flash-2';

const ALL_MODELS = [...CLAUDE_MODELS, ...GEMINI_MODELS, ...OMNI_MODELS, ...LUMA_MODELS];

export function modelLabel(id: string): string {
  return ALL_MODELS.find((m) => m.id === id)?.label ?? id;
}

/** Ray 3.2 runs on the Luma Agents API; Ray 2 and Ray 2 Flash on the older Dream Machine API. */
export function isLumaAgentsModel(model: string): boolean {
  return catalog.luma.models.find((m) => m.id === model)?.service !== 'dream-machine';
}

/** A saved Claude model, or the current model of the same family (Opus 4.8 becomes Opus 5.5). */
export function restoreClaudeModel(saved: unknown): string {
  if (typeof saved !== 'string') return DEFAULT_CLAUDE_MODEL;
  if (CLAUDE_MODELS.some(({ id }) => id === saved)) return saved;
  const line = /^claude-(fable|opus|sonnet|haiku)-/.exec(saved)?.[1];
  return catalog.claude.models.find((m) => m.line === line)?.id ?? DEFAULT_CLAUDE_MODEL;
}

const GEMINI_REPLACEMENTS: Record<string, string> = catalog.gemini.replacements;

/** A saved Gemini model, or Google's recommended replacement for a retired one. */
export function restoreGeminiModel(saved: unknown): string {
  if (typeof saved !== 'string') return DEFAULT_GEMINI_MODEL;
  if (GEMINI_MODELS.some(({ id }) => id === saved)) return saved;
  const next = GEMINI_REPLACEMENTS[saved];
  return next && GEMINI_MODELS.some(({ id }) => id === next) ? next : DEFAULT_GEMINI_MODEL;
}

/** Google video has one model now: every older Veo choice becomes Gemini Omni. */
export function restoreOmniModel(saved: unknown): string {
  return OMNI_MODELS.some(({ id }) => id === saved) ? (saved as string) : DEFAULT_OMNI_MODEL;
}

/** Ray 2 stays for keys that only reach Dream Machine; anything unknown becomes Ray 3.2. */
export function restoreLumaModel(saved: unknown): string {
  return LUMA_MODELS.some(({ id }) => id === saved) ? (saved as string) : DEFAULT_LUMA_MODEL;
}

/**
 * The thinking level a Gemini 4 request names. Google asks for one on every
 * Gemini 4 request; these are its documented defaults, so the answer is the
 * same as leaving it out. Older models take their own default.
 */
export function geminiThinkingLevel(model: string): string | undefined {
  return catalog.gemini.models.find((m) => m.id === model)?.thinkingLevel;
}

export interface AIModelChoices {
  claudeModel: string;
  geminiModel: string;
  veoModel: string;
  lumaModel: string;
}

/** Saved model choices with every retired model swapped for its current replacement. */
export function restoreAIModelChoices(saved: Partial<Record<keyof AIModelChoices, unknown>> | null | undefined): AIModelChoices {
  return {
    claudeModel: restoreClaudeModel(saved?.claudeModel),
    geminiModel: restoreGeminiModel(saved?.geminiModel),
    veoModel: restoreOmniModel(saved?.veoModel),
    lumaModel: restoreLumaModel(saved?.lumaModel),
  };
}
