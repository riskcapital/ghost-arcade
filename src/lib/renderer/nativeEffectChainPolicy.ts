/** Shared by layer, clip, VJ mix and mapping composition chains. */
export const NATIVE_EFFECT_PASS_LIMIT = 16;

export function nativeEffectChainWarning(effects: readonly { enabled?: boolean }[] = []): string | null {
  const enabled = effects.filter(effect => effect && effect.enabled !== false).length;
  return enabled > NATIVE_EFFECT_PASS_LIMIT
    ? `Only the first ${NATIVE_EFFECT_PASS_LIMIT} enabled effects render. ${enabled - NATIVE_EFFECT_PASS_LIMIT} extra effect${enabled - NATIVE_EFFECT_PASS_LIMIT === 1 ? ' is' : 's are'} bypassed; disable or remove earlier effects to use them.`
    : null;
}
