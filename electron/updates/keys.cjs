'use strict';
/**
 * Public keys that sign app-code updates, by key id (`kid`). Separate from
 * the licence keys (electron/addons/keys.cjs): a leaked licence key must not
 * be able to push code, and the other way round.
 *
 * Add the production key here (scripts/generate-update-key.mjs prints it)
 * in the release before the first one that ships a code update: an app can
 * only install updates signed by a key it already carries. Keep an old kid
 * listed after a rotation until no release that still needs it is current.
 *
 * `code-dev` is derived from a fixed, published seed
 * (scripts/pack-code-update.mjs --dev), so anyone can sign with it. That is
 * on purpose: only a development run (not packaged) accepts it.
 */

const CODE_UPDATE_KEYS = Object.freeze({
  'code-dev': Object.freeze({ publicKey: '39e075c994ea8c9503e71711db8273ed67460006ec187e40dad32e175175ac73', dev: true }),
  // 'code-2026-11': Object.freeze({ publicKey: '<64 hex from scripts/generate-update-key.mjs>' }),
});

/** kid → 64-hex public key, for this kind of build. */
function trustedCodeUpdateKeys({ isPackaged }) {
  const out = {};
  for (const [kid, key] of Object.entries(CODE_UPDATE_KEYS)) {
    if (key.dev && isPackaged) continue;
    if (!/^[0-9a-f]{64}$/i.test(key.publicKey)) continue;
    out[kid] = key.publicKey.toLowerCase();
  }
  return out;
}

/** Key ids a packaged app trusts. None means a packaged app installs no code updates. */
function productionCodeUpdateKids() {
  return Object.keys(trustedCodeUpdateKeys({ isPackaged: true }));
}

module.exports = { CODE_UPDATE_KEYS, trustedCodeUpdateKeys, productionCodeUpdateKids };
