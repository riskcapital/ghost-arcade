import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Guards the Spout input freeze.
 *
 * A live shared-texture sender keeps a stable handle, size and format, so the
 * only field in the upload signature that can change per frame is the frame
 * number. macOS got away with it because the Syphon addon returns its OWN
 * counter and bumps it on every receive. Windows did not: the Spout addon
 * returns the sender's counter, and the Spout SDK leaves that at zero unless
 * the user has enabled frame counting in SpoutSettings.exe. The signature
 * therefore never changed, exactly one upload was emitted, and the input
 * froze on the frame it was added.
 *
 * The fix counts receives host-side. These tests are deliberately source-level
 * rather than behavioural: the failure is Windows-only and needs a real Spout
 * sender, so there is no way to reproduce it on the machine this suite runs
 * on. What can be checked anywhere is that the signature no longer depends on
 * a number the sender may never increment.
 */

const syncSource = readFileSync(
  join(process.cwd(), 'src', 'lib', 'sync', 'nativeRendererSync.ts'),
  'utf8',
);

function sharedTextureSignatureBlock(): string {
  const start = syncSource.indexOf("const signature = [\n      'shared',");
  expect(start, 'shared-texture signature block not found').toBeGreaterThan(-1);
  const end = syncSource.indexOf('].join(', start);
  return syncSource.slice(start, end);
}

describe('shared-texture upload signature', () => {
  it('does not key on the sender-reported frame number', () => {
    const block = sharedTextureSignatureBlock();
    const code = block
      .split('\n')
      .filter((line) => !line.trim().startsWith('//'))
      .join('\n');
    expect(
      /\binfo\.frame\b/.test(code),
      'signature reads info.frame again — Spout senders often report 0 forever, '
        + 'which freezes the input on its first frame',
    ).toBe(false);
  });

  it('keys on a host-side receive count instead', () => {
    expect(sharedTextureSignatureBlock()).toContain('revision');
  });

  it('increments that count on every successful receive', () => {
    // Without the increment the signature is just as constant as before.
    expect(syncSource).toMatch(
      /const revision = \(this\.sharedTextureInfoCache\.get\(key\)\?\.revision \?\? 0\) \+ 1/,
    );
    expect(syncSource).toMatch(/updatedAt: performance\.now\(\), revision/);
  });
});
