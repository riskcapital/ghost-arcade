/**
 * Building a one-click fix: a set of text changes to one of the user's
 * sketch files.
 *
 * Fixes only ever change the sketch the way a person would by hand, in plain
 * p5.js: replace an expression, remove a statement, add a function or a
 * variable at the top. What Ghost Arcade does to run a sketch (sizing its
 * canvas, its controls, its audio) happens when it plays and never appears
 * in the user's code. The result is a list of changes against the original
 * text, so the editor applies it as one step that undo takes back.
 */
import type { SyntaxNode } from '@lezer/common';
import {
  declaredNames,
  findFunction,
  freeName,
  indentAt,
  indentUnit,
  type ScriptBlock,
  type SketchSource,
  type TextChange,
} from './sketchSource';

/** Numbers as people write them: no float noise, at most three decimals. */
export function formatNumber(value: number): string {
  if (!Number.isFinite(value)) return '0';
  return String(Number(value.toFixed(3)));
}

export class SketchEdit {
  private readonly changes: TextChange[] = [];
  private readonly topLevel: string[][] = [];
  private readonly afterFunctions = new Map<string, string[]>();
  readonly taken: Set<string>;
  readonly unit: string;

  constructor(readonly source: SketchSource) {
    this.taken = declaredNames(source);
    this.unit = indentUnit(source.text);
  }

  /** A name nothing in the sketch uses yet: `base`, `base2`, ... */
  freeName(base: string): string {
    const name = freeName(this.taken, base);
    this.taken.add(name);
    return name;
  }

  replace(from: number, to: number, insert: string): this {
    this.changes.push({ from, to, insert });
    return this;
  }

  /** Delete a statement, and its whole line when nothing else is on it. */
  removeStatement(n: { block: ScriptBlock; node: SyntaxNode }): this {
    const text = this.source.text;
    let from = n.block.from + n.node.from;
    let to = n.block.from + n.node.to;
    const lineStart = text.lastIndexOf('\n', from - 1) + 1;
    const lineEnd = text.indexOf('\n', to);
    const before = text.slice(lineStart, from);
    const after = text.slice(to, lineEnd < 0 ? text.length : lineEnd);
    if (/^\s*$/.test(before) && /^\s*(\/\/.*)?$/.test(after)) {
      from = lineStart;
      to = lineEnd < 0 ? text.length : lineEnd + 1;
    }
    this.changes.push({ from, to, insert: '' });
    return this;
  }

  /**
   * Lines to add at the top level, where a sketch keeps its variables: just
   * before its first function (above any comment introducing it), or at the
   * start of the script.
   */
  atTop(lines: string[]): this {
    this.topLevel.push(lines);
    return this;
  }

  /** Code to add after a function's closing brace, as a sibling declaration. */
  afterFunction(name: string, lines: string[]): this {
    this.afterFunctions.set(name, [...(this.afterFunctions.get(name) ?? []), ...lines]);
    return this;
  }

  build(): TextChange[] {
    const text = this.source.text;
    const out = [...this.changes];
    const block = (lines: string[], at: string) => lines.map((l) => (l ? at + l : l)).join('\n');

    if (this.topLevel.length > 0) {
      const script = this.source.scripts[0];
      let first: SyntaxNode | null = null;
      for (let node = script?.tree.topNode.firstChild ?? null; node; node = node.nextSibling) {
        if (node.name === 'FunctionDeclaration' || node.name === 'ClassDeclaration') {
          first = node;
          break;
        }
      }
      if (script && first) {
        const indent = indentAt(text, script.from + first.from);
        let insertAt = text.lastIndexOf('\n', script.from + first.from - 1) + 1;
        for (let prev = first.prevSibling; prev && (prev.name === 'LineComment' || prev.name === 'BlockComment'); prev = prev.prevSibling) {
          insertAt = text.lastIndexOf('\n', script.from + prev.from - 1) + 1;
        }
        out.push({ from: insertAt, to: insertAt, insert: `${this.topLevel.map((l) => block(l, indent)).join('\n')}\n\n` });
      } else if (script) {
        const firstStatement = script.tree.topNode.firstChild;
        const indent = firstStatement ? indentAt(text, script.from + firstStatement.from) : '';
        const lead = script.from === 0 ? '' : '\n';
        out.push({ from: script.from, to: script.from, insert: `${lead}${this.topLevel.map((l) => block(l, indent)).join('\n')}\n` });
      }
    }

    for (const [name, lines] of this.afterFunctions) {
      const fn = findFunction(this.source, name);
      if (!fn) continue;
      out.push({ from: fn.to, to: fn.to, insert: `\n\n${block(lines, indentAt(text, fn.from))}` });
    }
    return mergeInserts(out);
  }
}

/** Inserts at the same point become one, in the order they were made. */
function mergeInserts(changes: TextChange[]): TextChange[] {
  const out: TextChange[] = [];
  for (const change of changes) {
    const same = change.from === change.to ? out.find((c) => c.from === change.from && c.to === change.to) : null;
    if (same) same.insert += change.insert;
    else out.push({ ...change });
  }
  return out.sort((a, b) => a.from - b.from || a.to - b.to);
}
