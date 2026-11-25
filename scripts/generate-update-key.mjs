#!/usr/bin/env node
// Makes the key pair that signs app-code updates. Run once, on your own
// computer, and keep the private key only in the GitHub secret:
//
//   node scripts/generate-update-key.mjs [kid]      (kid defaults to code-2026-11)
//
// 1. Private key → GitHub repository secret CODE_UPDATE_SIGNING_KEY
//    (riskcapital/ghost-arcade → Settings → Secrets and variables → Actions).
//    If you pick a kid other than code-2026-11, also add the secret
//    CODE_UPDATE_KID with it.
// 2. Public key → electron/updates/keys.cjs under the same kid, committed
//    and released. Apps install only updates signed by a key they carry, so
//    the first release with this key installs no code update itself; the
//    one after it can be delivered as one.
//
// Nothing is written to disk.
import { generateKeyPairSync } from 'node:crypto';

const kid = process.argv[2] || 'code-2026-11';
if (!/^[a-z0-9-]{3,40}$/.test(kid)) {
  console.error('kid: lower-case letters, digits and dashes');
  process.exit(1);
}
const { privateKey, publicKey } = generateKeyPairSync('ed25519');
const priv = privateKey.export({ format: 'der', type: 'pkcs8' }).toString('base64');
const der = publicKey.export({ format: 'der', type: 'spki' });
const pub = der.subarray(der.length - 32).toString('hex');

console.log(`Key id: ${kid}\n`);
console.log('PRIVATE key (secret CODE_UPDATE_SIGNING_KEY; never commit, never paste anywhere else):');
console.log(priv);
console.log('\nPublic key for electron/updates/keys.cjs:');
console.log(`  '${kid}': Object.freeze({ publicKey: '${pub}' }),`);
