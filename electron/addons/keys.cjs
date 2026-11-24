'use strict';
/**
 * Public keys that sign add-on entitlements, by key id (`kid`). Public keys
 * are not secrets: they only check a signature, they cannot make one.
 *
 * Add the production key here before a release that sells add-ons (the
 * website prints it with scripts/generate-licence-key.mjs). Keep an old kid
 * listed after a rotation until every entitlement it signed has expired
 * (30 days).
 *
 * `dev: true` keys sign entitlements on a developer's own licence server.
 * A packaged app never accepts them.
 */

const LICENCE_KEYS = Object.freeze({
  'lic-dev': Object.freeze({ publicKey: 'fa6352c1acc9d9b0191f384d52ebdc4c194befc6aee3c0989fd986531d57ac82', dev: true }),
  'lic-2026-11': Object.freeze({ publicKey: '65a93a86c2d1b3825f2a3aba3684d3be1dbe111bf7dd0da528a5d01613c6f375' }),
});

/** kid → 64-hex public key, for this kind of build. */
function trustedLicenceKeys({ isPackaged }) {
  const out = {};
  for (const [kid, key] of Object.entries(LICENCE_KEYS)) {
    if (key.dev && isPackaged) continue;
    if (!/^[0-9a-f]{64}$/i.test(key.publicKey)) continue;
    out[kid] = key.publicKey.toLowerCase();
  }
  return out;
}

/** Key ids a packaged app trusts (the release check needs at least one). */
function productionLicenceKids() {
  return Object.keys(trustedLicenceKeys({ isPackaged: true }));
}

module.exports = { LICENCE_KEYS, trustedLicenceKeys, productionLicenceKids };
