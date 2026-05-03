// license.js — Node.js port of src-tauri/src/license.rs
// Ed25519-signed license system with machine fingerprinting and grace periods.

import { createHash, createPublicKey, verify } from 'node:crypto';
import { execSync } from 'node:child_process';
import { hostname } from 'node:os';
import { readFileSync, writeFileSync, unlinkSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

// ─── XOR-obfuscated Ed25519 public key ──────────────────────────────────────
const XOR_MASK = Buffer.from([
  0x5A, 0x3C, 0x7E, 0x1D, 0x9B, 0xF2, 0x48, 0xA6,
  0xD1, 0x0E, 0x73, 0xB5, 0x2F, 0x84, 0xC9, 0x61,
  0xE7, 0x15, 0x8D, 0x4A, 0xF0, 0x36, 0x6B, 0xD8,
  0x93, 0x57, 0xAC, 0x1F, 0x42, 0xBE, 0x09, 0x74,
]);

const OBFUSCATED_PUBLIC_KEY = Buffer.from([
  0x34, 0x90, 0x87, 0xC2, 0xC2, 0x35, 0x66, 0x1F,
  0xA1, 0x60, 0x8B, 0x58, 0xCB, 0x36, 0xC1, 0x21,
  0x09, 0x60, 0x48, 0x07, 0x56, 0x10, 0x5D, 0x32,
  0x98, 0x2E, 0x98, 0xF8, 0x38, 0xF1, 0x79, 0x83,
]);

function getPublicKeyBytes() {
  const key = Buffer.alloc(32);
  for (let i = 0; i < 32; i++) {
    key[i] = OBFUSCATED_PUBLIC_KEY[i] ^ XOR_MASK[i];
  }
  return key;
}

// ─── Admin Test Keys (dev-only, disabled in production) ─────────────────────
const ADMIN_SIGNATURE = 'ADMIN_TEST_KEY_INTERNAL';

// Test keys only available when ILL_VISUALS_DEV env var is set
const ADMIN_TEST_KEYS = process.env.ILL_VISUALS_DEV ? [
  { key: 'SW-TEST-STARTER-0000-ADMIN', tier: 'starter' },
  { key: 'SW-TEST-PRO-0000-ADMIN', tier: 'pro' },
] : [];

// ─── API Base ───────────────────────────────────────────────────────────────
// Security: enforce HTTPS for license API
const _apiBase = process.env.ILL_VISUALS_API_BASE || 'https://ghostarcade.live';
const API_BASE = _apiBase.startsWith('https://') ? _apiBase : 'https://ghostarcade.live';

// ─── Machine ID cache ───────────────────────────────────────────────────────
let cachedMachineId = null;

// ─── Machine Fingerprint ────────────────────────────────────────────────────

function getCpuId() {
  try {
    if (process.platform === 'darwin') {
      // macOS: use IOPlatformSerialNumber as CPU identifier
      const output = execSync('ioreg -rd1 -c IOPlatformExpertDevice | grep IOPlatformSerialNumber', { encoding: 'utf8' });
      const match = output.match(/"IOPlatformSerialNumber"\s*=\s*"([^"]+)"/);
      if (match) return match[1];
    } else {
      const output = execSync('wmic cpu get processorid', { encoding: 'utf8' });
      const lines = output.split(/\r?\n/);
      const line = lines[1];
      if (line) {
        const trimmed = line.trim();
        if (trimmed.length > 0) return trimmed;
      }
    }
  } catch { /* ignore */ }
  return 'unknown-cpu';
}

function getVolumeSerial() {
  try {
    if (process.platform === 'darwin') {
      // macOS: use disk UUID of the boot volume
      const output = execSync('diskutil info / | grep "Volume UUID"', { encoding: 'utf8' });
      const match = output.match(/Volume UUID:\s*(\S+)/);
      if (match) return match[1];
    } else {
      const output = execSync('cmd /c vol C:', { encoding: 'utf8' });
      for (const line of output.split(/\r?\n/)) {
        const pos = line.indexOf('Serial Number is');
        if (pos !== -1) {
          const serial = line.slice(pos + 17).trim();
          if (serial.length > 0) return serial;
        }
      }
    }
  } catch { /* ignore */ }
  return 'unknown-vol';
}

function generateMachineId() {
  const cpuId = getCpuId();
  const volumeSerial = getVolumeSerial();
  const host = hostname();

  const fingerprint = `${cpuId}|${volumeSerial}|${host}`;
  return createHash('sha256').update(fingerprint).digest('hex');
}

// ─── License File I/O ───────────────────────────────────────────────────────

function licenseDir() {
  let base;
  if (process.platform === 'darwin') {
    base = join(process.env.HOME || '/tmp', 'Library', 'Application Support');
  } else {
    base = process.env.LOCALAPPDATA || join(process.env.USERPROFILE || '.', 'AppData', 'Local');
  }
  const dir = join(base, 'live.ghostarcade.app');
  mkdirSync(dir, { recursive: true });
  return dir;
}

// Legacy path for migration from ShrinkWrap branding
function legacyLicenseDir() {
  let base;
  if (process.platform === 'darwin') {
    base = join(process.env.HOME || '/tmp', 'Library', 'Application Support');
  } else {
    base = process.env.LOCALAPPDATA || join(process.env.USERPROFILE || '.', 'AppData', 'Local');
  }
  return join(base, 'com.shrinkwrap.app');
}

function licenseFilePath() {
  return join(licenseDir(), 'license.json');
}

function metadataFilePath() {
  return join(licenseDir(), 'license_meta.json');
}

function readLicenseFile() {
  // Try new path first
  try {
    const content = readFileSync(licenseFilePath(), 'utf8');
    return JSON.parse(content);
  } catch { /* not found at new path */ }

  // Fall back to legacy ShrinkWrap path and migrate if found
  try {
    const legacyPath = join(legacyLicenseDir(), 'license.json');
    const content = readFileSync(legacyPath, 'utf8');
    const license = JSON.parse(content);
    // Migrate: copy to new location
    writeLicenseFile(license);
    console.log('[License] Migrated license from legacy ShrinkWrap path');
    // Also migrate metadata if it exists
    try {
      const legacyMeta = readFileSync(join(legacyLicenseDir(), 'license_meta.json'), 'utf8');
      writeFileSync(metadataFilePath(), legacyMeta, 'utf8');
    } catch { /* no metadata to migrate */ }
    return license;
  } catch {
    return null;
  }
}

function writeLicenseFile(license) {
  writeFileSync(licenseFilePath(), JSON.stringify(license, null, 2), 'utf8');
}

function deleteLicenseFile() {
  const lp = licenseFilePath();
  if (existsSync(lp)) unlinkSync(lp);
  const mp = metadataFilePath();
  if (existsSync(mp)) unlinkSync(mp);
}

function readMetadata() {
  try {
    const content = readFileSync(metadataFilePath(), 'utf8');
    return JSON.parse(content);
  } catch {
    return { last_validated_at: null };
  }
}

function writeMetadata(meta) {
  writeFileSync(metadataFilePath(), JSON.stringify(meta, null, 2), 'utf8');
}

// ─── Signature Verification ─────────────────────────────────────────────────

function verifyLicenseSignature(license) {
  // Admin test keys bypass Ed25519 verification (dev-only)
  if (process.env.ILL_VISUALS_DEV && license.signature === ADMIN_SIGNATURE) {
    return true;
  }

  const pubKeyBytes = getPublicKeyBytes();

  // If XOR produced the mask itself the embedded key is a placeholder
  if (pubKeyBytes.equals(XOR_MASK)) {
    console.warn('License verification skipped: placeholder public key');
    return false;
  }

  try {
    // Build DER-encoded SPKI wrapper for Ed25519 public key
    const spkiPrefix = Buffer.from('302a300506032b6570032100', 'hex');
    const spkiDer = Buffer.concat([spkiPrefix, pubKeyBytes]);

    const key = createPublicKey({ key: spkiDer, format: 'der', type: 'spki' });

    // Signature may be hex (from Next.js @noble/ed25519) or base64 (from Rust)
    let sigBytes;
    if (/^[0-9a-f]+$/i.test(license.signature) && license.signature.length === 128) {
      // Hex-encoded Ed25519 signature (64 bytes = 128 hex chars)
      sigBytes = Buffer.from(license.signature, 'hex');
    } else {
      // Base64-encoded signature
      sigBytes = Buffer.from(license.signature, 'base64');
    }

    // Build the canonical sign payload — must match exactly what the server signs
    // Server signs the full LicensePayload (including license_key and type)
    const signPayload = JSON.stringify({
      license_id: license.license_id,
      license_key: license.license_key,
      user_email: license.user_email,
      tier: license.tier,
      type: license.type,
      machine_id: license.machine_id,
      issued_at: license.issued_at,
      expires_at: license.expires_at ?? null,
    });

    return verify(null, Buffer.from(signPayload), key, sigBytes);
  } catch (err) {
    console.error('Signature verification error:', err.message);
    return false;
  }
}

function isLicenseExpired(license) {
  if (license.expires_at == null) return false; // perpetual
  const expires = new Date(license.expires_at);
  if (isNaN(expires.getTime())) {
    console.warn('Invalid expires_at format:', license.expires_at);
    return true; // treat unparseable dates as expired
  }
  return Date.now() > expires.getTime();
}

// ─── Grace Period Logic ─────────────────────────────────────────────────────

function gracePeriodStatus(meta) {
  if (!meta.last_validated_at) {
    // Never validated — treat as newly activated
    return { daysSinceCheck: 0, graceWarning: false, graceExpired: false };
  }
  const lastCheck = new Date(meta.last_validated_at);
  if (isNaN(lastCheck.getTime())) {
    return { daysSinceCheck: 0, graceWarning: false, graceExpired: false };
  }
  const days = Math.floor((Date.now() - lastCheck.getTime()) / (1000 * 60 * 60 * 24));
  return {
    daysSinceCheck: days,
    graceWarning: days >= 7 && days < 30,
    graceExpired: days >= 30,
  };
}

// ─── Admin Activation ───────────────────────────────────────────────────────

function tryAdminActivate(licenseKey, machineId) {
  const normalized = licenseKey.trim().toUpperCase();
  for (const entry of ADMIN_TEST_KEYS) {
    if (normalized === entry.key) {
      return {
        license_id: `admin-test-${entry.tier}`,
        user_email: 'admin@ghostarcade.dev',
        tier: entry.tier,
        machine_id: machineId,
        issued_at: new Date().toISOString(),
        expires_at: null, // perpetual
        subscription_id: null,
        signature: ADMIN_SIGNATURE,
      };
    }
  }
  return null;
}

// ─── Exported IPC handlers ──────────────────────────────────────────────────

/** Get the machine's unique hardware fingerprint. */
export function getMachineId() {
  if (cachedMachineId) return cachedMachineId;
  cachedMachineId = generateMachineId();
  return cachedMachineId;
}

/** Build a demo-tier LicenseStatus for the given machineId. */
function demoStatus(machineId, license) {
  return {
    tier: 'demo',
    user_email: license?.user_email ?? null,
    license_id: license?.license_id ?? null,
    expires_at: license?.expires_at ?? null,
    is_perpetual: false,
    machine_id: machineId,
    days_until_check_required: 0,
    grace_warning: false,
    grace_expired: false,
  };
}

/** Get the current license status (called on app startup and periodically). */
export function getStatus() {
  const machineId = getMachineId();

  const license = readLicenseFile();
  if (!license) return demoStatus(machineId);

  // Verify signature offline
  const sigValid = verifyLicenseSignature(license);
  if (!sigValid) {
    console.warn('[License] Signature verification failed — falling back to demo');
    console.warn('[License]   tier:', license.tier, 'email:', license.user_email);
    console.warn('[License]   sig length:', license.signature?.length);
    return demoStatus(machineId, license);
  }

  // Check machine ID matches
  if (license.machine_id !== machineId) {
    console.warn('License machine ID mismatch — falling back to demo');
    return demoStatus(machineId, license);
  }

  // Check expiry
  if (isLicenseExpired(license)) {
    console.info('License has expired — falling back to demo');
    return demoStatus(machineId, license);
  }

  // Check grace period
  const meta = readMetadata();
  const { daysSinceCheck, graceWarning, graceExpired } = gracePeriodStatus(meta);
  const daysUntilCheck = Math.max(7 - daysSinceCheck, 0);

  // If grace period expired (30+ days no online check), downgrade to demo
  const effectiveTier = graceExpired ? 'demo' : license.tier;

  return {
    tier: effectiveTier,
    user_email: license.user_email,
    license_id: license.license_id,
    expires_at: license.expires_at ?? null,
    is_perpetual: license.expires_at == null,
    machine_id: machineId,
    days_until_check_required: daysUntilCheck,
    grace_warning: graceWarning,
    grace_expired: graceExpired,
  };
}

/** Activate a license key on this machine. */
export async function activate(licenseKey) {
  const machineId = getMachineId();

  // Check admin test keys first (bypasses server)
  const adminLicense = tryAdminActivate(licenseKey, machineId);
  if (adminLicense) {
    console.info('Admin test key activated: tier=' + adminLicense.tier);
    writeLicenseFile(adminLicense);
    writeMetadata({ last_validated_at: new Date().toISOString() });
    return getStatus();
  }

  const machineName = hostname();
  const url = `${API_BASE}/api/license/activate`;

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      license_key: licenseKey,
      machine_id: machineId,
      machine_name: machineName,
    }),
  });

  const body = await res.json();

  if (!res.ok) {
    throw new Error(body.error || 'License activation failed');
  }

  const licenseFile = body.license_file || body.license;
  if (!licenseFile) throw new Error('Invalid license data from server');

  writeLicenseFile(licenseFile);
  writeMetadata({ last_validated_at: new Date().toISOString() });

  console.info(`License activated: tier=${licenseFile.tier}, email=${licenseFile.user_email}`);

  // Return status directly from the server-provided license data
  // (avoids signature verification issues with freshly-activated licenses)
  const machId = getMachineId();
  return {
    tier: licenseFile.tier || 'pro',
    user_email: licenseFile.user_email || null,
    license_id: licenseFile.license_id || null,
    expires_at: licenseFile.expires_at ?? null,
    is_perpetual: licenseFile.expires_at == null,
    machine_id: machId,
    days_until_check_required: 7,
    grace_warning: false,
    grace_expired: false,
  };
}

/** Deactivate the license on this machine (release machine slot). */
export async function deactivate() {
  const license = readLicenseFile();
  if (!license) throw new Error('No active license found');

  const machineId = getMachineId();
  const url = `${API_BASE}/api/license/deactivate`;

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      license_key: license.license_key || license.license_id,
      machine_id: machineId,
    }),
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || 'Deactivation failed');
  }

  deleteLicenseFile();
  console.info('License deactivated for machine', machineId);
}

/** Perform online license validation (called periodically in background). */
export async function validateOnline() {
  const license = readLicenseFile();
  if (!license) throw new Error('No active license to validate');

  const machineId = getMachineId();
  const url = `${API_BASE}/api/license/validate`;

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      license_key: license.license_key || license.license_id,
      license_id: license.license_id,
      machine_id: machineId,
    }),
  });

  if (res.ok) {
    const body = await res.json();

    // If server returns a fresh license file, update local copy
    if (body.license_file) {
      writeLicenseFile(body.license_file);
      console.info('License refreshed from server: tier=' + body.license_file.tier);
    }

    // Update validation timestamp
    writeMetadata({ last_validated_at: new Date().toISOString() });
  } else {
    console.warn('Online validation returned non-success status:', res.status);
    // Don't fail — just don't update the timestamp. Grace period continues.
  }

  return getStatus();
}
