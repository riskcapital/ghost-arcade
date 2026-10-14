'use strict';
// What a Linux machine offers the render core, read straight from the
// system: the distribution and kernel, each GPU with the kernel driver bound
// to it, the Vulkan drivers installed, and what Chromium's OpenGL reports.
// The render core draws through Vulkan only, so when it falls back to the
// software rasterizer this tells the user why (src/lib/linuxGpuSetup.ts).
const fs = require('fs');
const os = require('os');
const path = require('path');

const ICD_DIRS = ['/usr/share/vulkan/icd.d', '/etc/vulkan/icd.d', '/usr/local/share/vulkan/icd.d'];
const VENDORS = { '0x1002': 'amd', '0x8086': 'intel', '0x10de': 'nvidia' };

function read(file) {
  try { return fs.readFileSync(file, 'utf8').trim(); } catch { return ''; }
}

function osRelease() {
  const out = {};
  for (const line of read('/etc/os-release').split('\n')) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m) out[m[1]] = m[2].replace(/^"(.*)"$/, '$1');
  }
  return { id: out.ID ?? '', idLike: out.ID_LIKE ?? '', name: out.PRETTY_NAME ?? out.NAME ?? '' };
}

/** Display adapters on the PCI bus and the kernel driver each one uses. */
function gpus() {
  const list = [];
  let cards = [];
  try { cards = fs.readdirSync('/sys/class/drm').filter((n) => /^card\d+$/.test(n)); } catch { return list; }
  for (const card of cards) {
    const dev = `/sys/class/drm/${card}/device`;
    const vendorId = read(`${dev}/vendor`).toLowerCase();
    if (!vendorId) continue;
    let driver = '';
    try { driver = path.basename(fs.readlinkSync(`${dev}/driver`)); } catch { /* no driver bound */ }
    list.push({ vendor: VENDORS[vendorId] ?? 'other', vendorId, deviceId: read(`${dev}/device`).toLowerCase(), driver });
  }
  return list;
}

/** Installed Vulkan driver manifests, by file name (radeon_icd.x86_64.json...). */
function vulkanDrivers() {
  const found = new Set();
  for (const dir of ICD_DIRS) {
    try { for (const f of fs.readdirSync(dir)) if (f.endsWith('.json')) found.add(f); } catch { /* absent */ }
  }
  return [...found].sort();
}

async function collectLinuxGpuSetup(app) {
  let glRenderer = '';
  try {
    const info = await app.getGPUInfo('complete');
    glRenderer = String(info?.auxAttributes?.glRenderer ?? '');
  } catch { /* GPU process unavailable */ }
  return {
    distro: osRelease(),
    kernel: os.release(),
    session: process.env.XDG_SESSION_TYPE ?? '',
    gpus: gpus(),
    vulkanDrivers: vulkanDrivers(),
    glRenderer,
  };
}

module.exports = { collectLinuxGpuSetup };
