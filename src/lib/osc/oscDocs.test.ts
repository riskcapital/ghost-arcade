import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createVjOscTemplateBindings } from './oscBindings';

/**
 * The OSC reference is the answer to the problem that started this work: a
 * user concluded a feature did not exist because the only address the app
 * showed them was the per-clip one. Documentation that silently falls behind
 * the template recreates exactly that, so the two are checked against each
 * other rather than kept in step by hand.
 */

const docs = readFileSync(join(process.cwd(), 'docs', 'osc.md'), 'utf8');

/** Collapse concrete indices so /ghost/vj/a/layer/3/opacity matches the doc's
 *  /ghost/vj/{deck}/layer/{L}/opacity. */
function family(address: string): string {
  return address
    .replace(/^\/ghost\/vj\/[ab]\//, '/ghost/vj/{deck}/')
    .replace(/\/\d+/g, '/{n}');
}

function documentedFamilies(): Set<string> {
  const found = new Set<string>();
  for (const match of docs.matchAll(/`(\/ghost\/[^`]+)`/g)) {
    // {L}, {C}, {N} are all just indices; {deck} is not — keep it, because
    // the template's a/b is normalized to {deck} on the other side.
    found.add(match[1].replace(/\/\{(?!deck\})[A-Za-z]+\}/g, '/{n}'));
  }
  return found;
}

describe('OSC documentation', () => {
  it('documents every address family the template installs', () => {
    const documented = documentedFamilies();
    const missing = [...new Set(
      createVjOscTemplateBindings(4, 8).map((b) => family(b.address)),
    )].filter((f) => !documented.has(f));

    expect(
      missing,
      'template addresses with no entry in docs/osc.md — users cannot bind what '
      + `they cannot find:\n  ${missing.join('\n  ')}`,
    ).toEqual([]);
  });

  it('does not document addresses the template does not install', () => {
    // A doc that promises an address the app never generates sends people
    // hunting for a binding that is not there.
    const generated = new Set(
      createVjOscTemplateBindings(4, 8).map((b) => family(b.address)),
    );
    const phantom = [...documentedFamilies()].filter((f) => !generated.has(f));
    expect(phantom, `documented but never installed:\n  ${phantom.join('\n  ')}`).toEqual([]);
  });

  it('says which way indices are counted', () => {
    // The addresses are 1-based and the internal paths are 0-based. Getting
    // that wrong silently fires the wrong clip, so it has to be stated.
    expect(docs).toMatch(/1-based/i);
  });
});
