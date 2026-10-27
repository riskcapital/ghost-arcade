#!/usr/bin/env node
/**
 * Windows: check which DLLs the render core needs before it can start.
 *
 * Windows loads every DLL in a program's import table before the program runs
 * a single line. One missing DLL ends the process with 0xC0000135, and the app
 * shows no picture. The core has to start on every Windows 10 and 11 PC, so it
 * must not import:
 *   - the Visual C++ runtime (vcruntime, msvcp, ucrtbase, api-ms-win-crt-*).
 *     It is linked in instead; see .cargo/config.toml.
 *   - Media Foundation (mfplat, mfreadwrite, mf). Windows N and KN editions
 *     ship without it, so the core loads it on first use; see
 *     native-renderer/src/windows_media_foundation.rs.
 *
 * Usage:
 *   node scripts/windows-core-imports.mjs <ghost-render-core.exe> [--info <file>...]
 * Exits 1 when the core imports any of those. Files after --info (such as the
 * DXC DLLs that sit beside the core) are only listed in the log.
 *
 * Reads the PE file directly, so it needs no Visual Studio tools.
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const MACHINES = { 0x14c: 'x86', 0x8664: 'x64', 0xaa64: 'arm64' };

/** The DLLs a PE file imports at load time, and the ones it delay-loads. */
export function readPeImports(buffer) {
  const u16 = (offset) => buffer.readUInt16LE(offset);
  const u32 = (offset) => buffer.readUInt32LE(offset);
  if (buffer.length < 0x40 || u16(0) !== 0x5a4d) throw new Error('not a Windows program (no MZ header)');
  const pe = u32(0x3c);
  if (pe + 24 > buffer.length || u32(pe) !== 0x00004550) throw new Error('not a Windows program (no PE signature)');
  const coff = pe + 4;
  const machine = u16(coff);
  const sectionCount = u16(coff + 2);
  const optionalSize = u16(coff + 16);
  const optional = coff + 20;
  const magic = u16(optional);
  if (magic !== 0x10b && magic !== 0x20b) throw new Error(`unknown optional header magic 0x${magic.toString(16)}`);
  const plus = magic === 0x20b;
  const imageBase = plus ? Number(buffer.readBigUInt64LE(optional + 24)) : u32(optional + 28);
  const directoryCount = u32(optional + (plus ? 108 : 92));
  const directories = optional + (plus ? 112 : 96);
  const directory = (index) => (index < directoryCount
    ? { rva: u32(directories + index * 8), size: u32(directories + index * 8 + 4) }
    : { rva: 0, size: 0 });

  const sections = [];
  const table = optional + optionalSize;
  for (let i = 0; i < sectionCount; i++) {
    const at = table + i * 40;
    sections.push({ virtualSize: u32(at + 8), address: u32(at + 12), rawSize: u32(at + 16), rawOffset: u32(at + 20) });
  }
  const fileOffset = (rva) => {
    for (const s of sections) {
      if (rva >= s.address && rva < s.address + Math.max(s.virtualSize, s.rawSize)) return rva - s.address + s.rawOffset;
    }
    throw new Error(`address 0x${rva.toString(16)} is outside every section`);
  };
  const text = (rva) => {
    const start = fileOffset(rva);
    const end = buffer.indexOf(0, start);
    return buffer.toString('latin1', start, end < 0 ? buffer.length : end);
  };

  const imports = [];
  const importDirectory = directory(1);
  if (importDirectory.rva) {
    // IMAGE_IMPORT_DESCRIPTOR: 20 bytes, the DLL name's address at +12; a
    // zeroed entry ends the list.
    for (let at = fileOffset(importDirectory.rva); at + 20 <= buffer.length; at += 20) {
      const name = u32(at + 12);
      if (!name) break;
      imports.push(text(name));
    }
  }
  const delayed = [];
  const delayDirectory = directory(13);
  if (delayDirectory.rva) {
    // IMAGE_DELAYLOAD_DESCRIPTOR: 32 bytes, attributes at +0, the DLL name at
    // +4. Old linkers stored a full address instead of an RVA (attribute bit 0
    // clear).
    for (let at = fileOffset(delayDirectory.rva); at + 32 <= buffer.length; at += 32) {
      const attributes = u32(at);
      const name = u32(at + 4);
      if (!name) break;
      delayed.push(text(attributes & 1 ? name : name - imageBase));
    }
  }
  return { machine: MACHINES[machine] ?? `0x${machine.toString(16)}`, imports, delayed };
}

const RUNTIME = [/^(vcruntime|msvcp|concrt|vccorlib)\d+.*\.dll$/i, /^ucrtbased?\.dll$/i, /^api-ms-win-crt-/i];
const MEDIA_FOUNDATION = /^(mfplat|mfreadwrite|mf|mfcore|evr)\.dll$/i;

/** Plain reasons the core would not start on some PCs; empty when it is fine. */
export function coreImportProblems(imports) {
  const problems = [];
  const runtime = imports.filter((name) => RUNTIME.some((pattern) => pattern.test(name)));
  if (runtime.length) {
    problems.push(`imports the Visual C++ runtime (${runtime.join(', ')}), so it will not start on a PC without the Visual C++ Redistributable. Check that .cargo/config.toml still sets +crt-static and that RUSTFLAGS is not set.`);
  }
  const media = imports.filter((name) => MEDIA_FOUNDATION.test(name));
  if (media.length) {
    problems.push(`imports Media Foundation (${media.join(', ')}), so it will not start on Windows N or KN editions. Load it through windows_media_foundation.rs instead.`);
  }
  return problems;
}

function describe(file) {
  const { machine, imports, delayed } = readPeImports(readFileSync(file));
  console.log(`[core-imports] ${path.basename(file)} (${machine}) imports: ${imports.join(', ') || 'nothing'}`);
  if (delayed.length) console.log(`[core-imports]   loaded on first use: ${delayed.join(', ')}`);
  return imports;
}

function main(argv) {
  const infoAt = argv.indexOf('--info');
  const core = argv[0];
  const extras = infoAt >= 0 ? argv.slice(infoAt + 1) : [];
  if (!core || core === '--info') {
    console.error('usage: node scripts/windows-core-imports.mjs <ghost-render-core.exe> [--info <file>...]');
    return 2;
  }
  const problems = coreImportProblems(describe(core));
  for (const file of extras) {
    if (!existsSync(file)) { console.log(`[core-imports] ${path.basename(file)} is not there`); continue; }
    const runtime = describe(file).filter((name) => RUNTIME.some((pattern) => pattern.test(name)));
    if (runtime.length) console.log(`[core-imports]   note: ${path.basename(file)} needs the Visual C++ runtime (${runtime.join(', ')})`);
  }
  if (problems.length) {
    for (const problem of problems) console.error(`[core-imports] FAIL: ${path.basename(core)} ${problem}`);
    return 1;
  }
  console.log('[core-imports] OK: the core needs no Visual C++ runtime and no Media Foundation to start');
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(main(process.argv.slice(2)));
}
