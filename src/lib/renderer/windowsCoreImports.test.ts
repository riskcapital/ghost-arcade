import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
// @ts-expect-error plain .mjs script without type declarations
import { coreImportProblems, readPeImports } from '../../../scripts/windows-core-imports.mjs';

/**
 * A minimal 64-bit Windows program: headers, one section holding the import
 * and delay-load tables, and the DLL names.
 */
function fakeProgram(imports: string[], delayed: string[] = []): Buffer {
  const file = Buffer.alloc(0x1000);
  const sectionAddress = 0x2000;
  const sectionOffset = 0x200;
  // Low enough that the old absolute-address delay-load form fits 32 bits.
  const imageBase = 0x10000000n;
  file.write('MZ', 0, 'latin1');
  file.writeUInt32LE(0x40, 0x3c);
  file.write('PE\0\0', 0x40, 'latin1');
  const coff = 0x44;
  file.writeUInt16LE(0x8664, coff);
  file.writeUInt16LE(1, coff + 2);
  file.writeUInt16LE(240, coff + 16);
  const optional = coff + 20;
  file.writeUInt16LE(0x20b, optional);
  file.writeBigUInt64LE(imageBase, optional + 24);
  file.writeUInt32LE(16, optional + 108);
  const directories = optional + 112;
  const section = optional + 240;
  file.write('.idata', section, 'latin1');
  file.writeUInt32LE(0xe00, section + 8);
  file.writeUInt32LE(sectionAddress, section + 12);
  file.writeUInt32LE(0xe00, section + 16);
  file.writeUInt32LE(sectionOffset, section + 20);

  const importTable = 0;
  const delayTable = (imports.length + 1) * 20;
  let names = delayTable + (delayed.length + 1) * 32;
  const putName = (name: string) => {
    const rva = sectionAddress + names;
    file.write(`${name}\0`, sectionOffset + names, 'latin1');
    names += name.length + 1;
    return rva;
  };
  imports.forEach((name, i) => file.writeUInt32LE(putName(name), sectionOffset + importTable + i * 20 + 12));
  delayed.forEach((name, i) => {
    const at = sectionOffset + delayTable + i * 32;
    // One entry uses the old absolute-address form, the rest RVAs.
    if (i === 0) file.writeUInt32LE(Number(BigInt(putName(name)) + imageBase), at + 4);
    else { file.writeUInt32LE(1, at); file.writeUInt32LE(putName(name), at + 4); }
  });
  file.writeUInt32LE(sectionAddress + importTable, directories + 8);
  file.writeUInt32LE((imports.length + 1) * 20, directories + 12);
  if (delayed.length) {
    file.writeUInt32LE(sectionAddress + delayTable, directories + 13 * 8);
    file.writeUInt32LE((delayed.length + 1) * 32, directories + 13 * 8 + 4);
  }
  return file;
}

describe('render core imports on Windows', () => {
  it('reads the DLLs a program loads at start and on first use', () => {
    const program = fakeProgram(['KERNEL32.dll', 'd3d12.dll', 'dxgi.dll'], ['dwmapi.dll', 'USER32.dll']);
    expect(readPeImports(program)).toEqual({
      machine: 'x64',
      imports: ['KERNEL32.dll', 'd3d12.dll', 'dxgi.dll'],
      delayed: ['dwmapi.dll', 'USER32.dll'],
    });
  });

  it('passes a core that needs only what every Windows edition ships', () => {
    expect(coreImportProblems(['KERNEL32.dll', 'USER32.dll', 'd3d12.dll', 'dxgi.dll', 'ole32.dll', 'msvcrt.dll', 'ntdll.dll'])).toEqual([]);
  });

  it('fails a core that needs the Visual C++ Redistributable', () => {
    for (const name of ['VCRUNTIME140.dll', 'vcruntime140_1.dll', 'MSVCP140.dll', 'VCRUNTIME140D.dll', 'ucrtbased.dll']) {
      const problems = coreImportProblems(['KERNEL32.dll', 'api-ms-win-crt-heap-l1-1-0.dll', name]);
      expect(problems, name).toHaveLength(1);
      expect(problems[0]).toContain('Visual C++ Redistributable');
    }
  });

  it('fails a core that stopped building the C runtime in', () => {
    // The Universal C runtime ships with Windows 10 and 11, so this alone
    // would still start; it means +crt-static was lost.
    for (const name of ['ucrtbase.dll', 'api-ms-win-crt-runtime-l1-1-0.dll']) {
      const problems = coreImportProblems(['KERNEL32.dll', name]);
      expect(problems, name).toHaveLength(1);
      expect(problems[0]).toContain('+crt-static');
    }
  });

  it('allows the Windows API sets that are not the C runtime', () => {
    expect(coreImportProblems(['api-ms-win-core-synch-l1-2-0.dll', 'api-ms-win-core-winrt-error-l1-1-0.dll', 'combase.dll'])).toEqual([]);
  });

  it('fails a core that imports Media Foundation, which N and KN editions lack', () => {
    const problems = coreImportProblems(['KERNEL32.dll', 'MFPlat.DLL', 'MFReadWrite.dll']);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('N or KN');
  });

  it('rejects a file that is not a Windows program', () => {
    expect(() => readPeImports(Buffer.from('not a program at all, just some text here'.repeat(4)))).toThrow(/not a Windows program/);
  });

  const sample = path.resolve('node_modules/electron-winstaller/vendor/7z-x64.exe');
  it.skipIf(!existsSync(sample))('reads a real 64-bit Windows program', () => {
    const { machine, imports } = readPeImports(readFileSync(sample));
    expect(machine).toBe('x64');
    expect(imports).toContain('KERNEL32.dll');
    expect(coreImportProblems(imports)).toEqual([]);
  });
});
