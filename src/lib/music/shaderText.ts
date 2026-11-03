/**
 * Text for the visuals that draw lettering (a neon sign, a TV station ident).
 *
 * A shader cannot take a string, so the text goes in as numbers: each
 * character is a 6-bit code, three to a float (18 bits: well inside what
 * survives the trip to the GPU exactly), four floats for up to 12 characters. A visual can hold several phrases
 * and cycle through them every few bars or on each hit; the shader hears
 * the phrase showing now, which phrase it is (for a strike-up when it
 * changes) and how many there are.
 *
 * Codes: 0 space, 1-26 A-Z, 27-36 0-9, then . ! ? - + ' : / &
 */

export const SHADER_TEXT_MAX = 12;
export const SHADER_TEXT_PHRASES = 16;
const MARKS = ".!?-+':/&";

/** The text inputs a lettering shader declares (hidden from the knobs; the studio fills them). */
export const SHADER_TEXT_INPUTS = ['vxTxt0', 'vxTxt1', 'vxTxt2', 'vxTxt3', 'vxTxtLen', 'vxTxtId', 'vxTxtN'] as const;
const TEXT_INPUT_SET = new Set<string>(SHADER_TEXT_INPUTS);
export function isShaderTextInput(name: string): boolean {
  return TEXT_INPUT_SET.has(name);
}

/** How often a visual's phrases change: on each hit, or every so many bars. */
export const TEXT_EVERY: readonly { id: number; label: string }[] = [
  { id: 0, label: 'On each hit' },
  { id: 1, label: 'Every bar' },
  { id: 2, label: 'Every 2 bars' },
  { id: 4, label: 'Every 4 bars' },
  { id: 8, label: 'Every 8 bars' },
  { id: 16, label: 'Every 16 bars' },
];
export const DEFAULT_TEXT_EVERY = 4;

function charCode(ch: string): number | null {
  if (ch === ' ') return 0;
  const c = ch.toUpperCase();
  if (c >= 'A' && c <= 'Z') return c.charCodeAt(0) - 64;
  if (c >= '0' && c <= '9') return 27 + c.charCodeAt(0) - 48;
  const m = MARKS.indexOf(c);
  return m >= 0 ? 37 + m : null;
}

/** A phrase as the shaders can draw it: capitals, digits and the few marks, up to 12 characters. */
export function cleanPhrase(raw: string): string {
  let kept = '';
  for (const ch of String(raw ?? '').normalize('NFKD')) if (charCode(ch) !== null || /\s/.test(ch)) kept += /\s/.test(ch) ? ' ' : ch.toUpperCase();
  return kept.replace(/ +/g, ' ').trim().slice(0, SHADER_TEXT_MAX).trimEnd();
}

/** A visual's saved phrases, checked. */
export function normalizePhrases(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((p) => cleanPhrase(String(p))).filter(Boolean).slice(0, SHADER_TEXT_PHRASES);
}

export function normalizeTextEvery(raw: unknown): number {
  const n = Number(raw);
  return TEXT_EVERY.some((e) => e.id === n) ? n : DEFAULT_TEXT_EVERY;
}

/** The four packed floats for a phrase, three characters each, first character lowest. */
export function packPhrase(phrase: string): [number, number, number, number] {
  const codes = [...cleanPhrase(phrase)].map((ch) => charCode(ch) ?? 0);
  const out: [number, number, number, number] = [0, 0, 0, 0];
  codes.forEach((c, i) => {
    out[Math.floor(i / 3)] += c * 64 ** (i % 3);
  });
  return out;
}

/**
 * The text inputs for this frame: which phrase shows (by bar or by hit) and
 * its packed characters. No phrases: length 0, so the shader shows its own.
 */
export function shaderTextValues(phrases: readonly string[], every: number, bars: number, count: number): Record<string, number> {
  const n = phrases.length;
  if (!n) return { vxTxt0: 0, vxTxt1: 0, vxTxt2: 0, vxTxt3: 0, vxTxtLen: 0, vxTxtId: 0, vxTxtN: 0 };
  const step = every > 0 ? Math.floor((Number(bars) || 0) / every) : Math.floor(Number(count) || 0);
  const id = ((step % n) + n) % n;
  const phrase = cleanPhrase(phrases[id]);
  const [a, b, c, d] = packPhrase(phrase);
  return { vxTxt0: a, vxTxt1: b, vxTxt2: c, vxTxt3: d, vxTxtLen: phrase.length, vxTxtId: id, vxTxtN: n };
}
