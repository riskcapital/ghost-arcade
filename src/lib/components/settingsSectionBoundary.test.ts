import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * One broken Settings section must not take the whole panel down.
 *
 * Reported as: opened Settings after installing, clicked through the tabs,
 * and the panel went black with every control gone. Reopening it stayed
 * black, and reinstalling did not help.
 *
 * Two things combined to make that permanent. Sections rendered with no error
 * boundary, so any exception while rendering one unwound the component and
 * left nothing. And the selected section is persisted to localStorage and
 * restored on open, so the panel reopened straight into the section that had
 * just failed, while a reinstall left user data untouched.
 *
 * The first boundary rendered its fallback through `{#snippet failed}`. Svelte
 * builds that in a microtask per error, and a bad value used in several
 * expressions throws several times in one flush, so fallbacks stacked on
 * screen and Try again left stale copies beside the recovered section. The
 * fallback now renders from component state, once, outside the boundary.
 */

const panel = readFileSync(join(process.cwd(), 'src', 'lib', 'components', 'SettingsPanel.svelte'), 'utf8');
const reporter = readFileSync(join(process.cwd(), 'src', 'lib', 'utils', 'errorReporter.ts'), 'utf8');

const keyOpen = panel.indexOf('{#key selectedSection}');
const boundaryOpen = panel.indexOf('<svelte:boundary onerror={handleSectionError}>');
const boundaryClose = panel.indexOf('</svelte:boundary>');
const fallbackOpen = panel.indexOf('{#if sectionFailure && sectionFailure.section === selectedSection}');
const keyClose = panel.indexOf('{/key}', fallbackOpen);

function fnBody(name: string): string {
  const start = panel.indexOf(`function ${name}`);
  expect(start, `${name} not found`).toBeGreaterThan(-1);
  return panel.slice(start, panel.indexOf('\n  }', start));
}

describe('settings section error boundary', () => {
  it('wraps the sections in a boundary keyed on the selected section', () => {
    expect(boundaryOpen, 'no boundary around the sections').toBeGreaterThan(-1);
    // Keyed so that moving to another section gets a fresh boundary.
    expect(keyOpen).toBeGreaterThan(-1);
    expect(keyOpen).toBeLessThan(boundaryOpen);
    expect(boundaryClose).toBeGreaterThan(boundaryOpen);
    expect(keyClose).toBeGreaterThan(boundaryClose);
  });

  it('puts every section inside the boundary', () => {
    const sections = [...panel.matchAll(/\{(?:#if|:else if) selectedSection === '([a-z:-]+)'\}/g)];
    expect(sections.length, 'no section blocks found').toBeGreaterThan(10);
    const outside = sections
      .filter((m) => (m.index ?? 0) < boundaryOpen || (m.index ?? 0) > boundaryClose)
      .map((m) => m[1]);
    expect(outside, `sections rendered outside the boundary:\n  ${outside.join('\n  ')}`).toEqual([]);
  });

  it('keeps the sidebar outside the boundary so navigation survives a failure', () => {
    const sidebar = panel.indexOf('{#each SIDEBAR as cat (cat.id)}');
    expect(sidebar).toBeGreaterThan(-1);
    expect(sidebar).toBeLessThan(boundaryOpen);
  });

  it('does not render the fallback through the boundary snippet', () => {
    // The snippet is built once per error in a microtask; several throws in
    // one flush stacked duplicate fallbacks that reset could not all clear.
    expect(panel).not.toContain('{#snippet failed');
  });

  it('renders one fallback, outside the boundary, only for the section that failed', () => {
    expect(fallbackOpen, 'no state-driven fallback').toBeGreaterThan(-1);
    // Outside the boundary, so the boundary can neither duplicate nor tear it down.
    expect(fallbackOpen).toBeGreaterThan(boundaryClose);
    // Inside the key block, and gated on the section, so it cannot follow the
    // user into a different section.
    expect(fallbackOpen).toBeLessThan(keyClose);
    const fallback = panel.slice(fallbackOpen, panel.indexOf('{/if}', fallbackOpen));
    expect(fallback).toContain('onclick={retrySection}');
    expect(fallback).toContain('onclick={leaveFailedSection}');
    expect(fallback).toMatch(/sectionFailure\.error instanceof Error \? sectionFailure\.error\.message : String\(sectionFailure\.error\)/);
  });

  it('records the failure once, keeps the reset, and clears the section it would reopen into', () => {
    const handler = fnBody('handleSectionError');
    // A boundary swallows the error before window.onerror sees it.
    expect(handler).toContain('recordError(');
    // One failure arrives as several calls; record only the first.
    expect(handler).toContain('sectionFailure?.section !== selectedSection');
    expect(handler).toMatch(/sectionFailure = \{ section: selectedSection, error, reset \}/);
    expect(handler).toContain("localStorage.removeItem('ghostarcade-settings-section')");
    expect(reporter).toMatch(/export function recordError\(/);
  });

  it('clears the failure before retrying, so a success leaves no fallback behind', () => {
    const retry = fnBody('retrySection');
    const clearAt = retry.indexOf('sectionFailure = null');
    const resetAt = retry.indexOf('reset()');
    expect(clearAt).toBeGreaterThan(-1);
    expect(resetAt).toBeGreaterThan(clearAt);
  });

  it('keys MCP recent calls on something that cannot collide', () => {
    expect(panel).toContain('as call (call.seq)');
    expect(panel).not.toContain('as call (call.at)');
  });
});
