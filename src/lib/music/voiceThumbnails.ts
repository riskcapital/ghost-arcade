/**
 * Thumbnails for the visual voices. A voice shader at rest waits for a
 * sound and draws next to nothing, so its picture is taken with its sound
 * inputs set as if a phrase were playing: present, mid-energy, a hit just
 * landed, a few notes in. The app's thumbnail cache keys on the shader text,
 * so these are rendered once and kept (and scripts/build-isf-thumbnails.mjs
 * can bake them into the app).
 */

/** The sound inputs as a phrase plays, by input name. */
const PLAYING: Record<string, number> = {
  vxPresence: 1, vxEnergy: 0.75, vxEnv: 0.8, vxHit: 0.9, vxVel: 0.8, vxPitch: 0.55,
  vxGlide: 0.4, vxCount: 6, vxPhase: 3.2, vxBeat: 2.4, vxBar: 1, vxBars: 4,
};

/** The shader's text with its sound inputs' defaults set to a phrase playing. */
export function demoVoiceCode(code: string): string {
  return code.replace(/\{\s*"NAME":\s*"(vx[A-Za-z]+)"([^{}]*?)"DEFAULT":\s*[-\d.eE]+/g, (whole, name: string, middle: string) => {
    const v = PLAYING[name];
    return v === undefined ? whole : `{ "NAME": "${name}"${middle}"DEFAULT": ${v}`;
  });
}

/** What a voice answers to, read from the inputs it uses: "pitch, velocity, hits". */
export function voiceRespondsTo(code: string): string {
  const uses = (name: string) => new RegExp(`\\b${name}\\b`).test(code.slice(code.indexOf('*/')));
  const out: string[] = [];
  if (uses('vxPitch')) out.push('pitch');
  if (uses('vxVel')) out.push('velocity');
  if (uses('vxHit') || uses('vxCount')) out.push('hits');
  if (uses('vxEnergy') || uses('vxEnv')) out.push('level');
  if (uses('vxBeat') || uses('vxBar')) out.push('the beat');
  return out.length ? out.join(', ') : 'the sound';
}
