/**
 * Reading a p5.js page as code.
 *
 * A sketch layer holds a whole HTML page. The learning notes and the Ghost
 * Arcade tips look at the JavaScript inside its inline <script> blocks, parsed
 * with the same Lezer grammar the code editor highlights with, so strings and
 * comments are never mistaken for code. Every position here is an offset into
 * the full page, which is also what the editor shows.
 */
import { parser } from '@lezer/javascript';
import type { SyntaxNode, Tree } from '@lezer/common';

export interface ScriptBlock {
  /** Offset of the first character inside the <script> element. */
  from: number;
  /** Offset just past the last character before </script>. */
  to: number;
  code: string;
  tree: Tree;
}

/** A node of one script block, with page offsets. */
export interface CodeNode {
  node: SyntaxNode;
  block: ScriptBlock;
  from: number;
  to: number;
}

export interface TextChange {
  from: number;
  to: number;
  insert: string;
}

export interface SketchSource {
  /** The file's whole text: a page, or a script. */
  text: string;
  scripts: ScriptBlock[];
}

const SCRIPT_RE = /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi;
const JS_TYPES = new Set(['', 'text/javascript', 'application/javascript', 'module', 'text/babel']);

function scriptType(attrs: string): string {
  const match = /\btype\s*=\s*["']?([^"'\s>]+)/i.exec(attrs);
  return match ? match[1].toLowerCase() : '';
}

/** What a sketch file holds: JavaScript (sketch.js) or a page with inline scripts (index.html). */
export type SketchLanguage = 'js' | 'html';

export function languageOf(path: string): SketchLanguage | null {
  if (/\.(m?js)$/i.test(path)) return 'js';
  if (/\.html?$/i.test(path)) return 'html';
  return null;
}

/** A file's JavaScript: the whole file for a script, the inline scripts for a page. */
export function readSketchFile(text: string, language: SketchLanguage): SketchSource {
  if (language === 'html') return readSketch(text);
  return { text, scripts: [{ from: 0, to: text.length, code: text, tree: parser.parse(text) }] };
}

/** The page's inline JavaScript: scripts without a `src`, of a JavaScript type. */
export function readSketch(html: string): SketchSource {
  const scripts: ScriptBlock[] = [];
  SCRIPT_RE.lastIndex = 0;
  for (let match = SCRIPT_RE.exec(html); match; match = SCRIPT_RE.exec(html)) {
    const attrs = match[1] ?? '';
    if (/\bsrc\s*=/i.test(attrs) || !JS_TYPES.has(scriptType(attrs))) continue;
    const code = match[2] ?? '';
    const from = match.index + match[0].indexOf('>') + 1;
    scripts.push({ from, to: from + code.length, code, tree: parser.parse(code) });
  }
  return { text: html, scripts };
}

/** Visit every node of every script, in page order. Return false to skip a node's children. */
export function walkCode(source: SketchSource, visit: (n: CodeNode) => boolean | void): void {
  for (const block of source.scripts) {
    const cursor = block.tree.cursor();
    for (;;) {
      const node = cursor.node;
      const descend = visit({ node, block, from: block.from + node.from, to: block.from + node.to }) !== false;
      if (descend && cursor.firstChild()) continue;
      while (!cursor.nextSibling()) {
        if (!cursor.parent()) break;
      }
      if (cursor.node.type.isTop) break;
    }
  }
}

export function nodeText(n: { block: ScriptBlock; node: SyntaxNode }): string {
  return n.block.code.slice(n.node.from, n.node.to);
}

export function textOf(block: ScriptBlock, node: SyntaxNode | null | undefined): string {
  return node ? block.code.slice(node.from, node.to) : '';
}

export function codeNode(block: ScriptBlock, node: SyntaxNode): CodeNode {
  return { node, block, from: block.from + node.from, to: block.from + node.to };
}

/** 1-based line number of an offset. */
export function lineAt(text: string, offset: number): number {
  let line = 1;
  const end = Math.min(offset, text.length);
  for (let i = 0; i < end; i++) if (text.charCodeAt(i) === 10) line++;
  return line;
}

/** The leading whitespace of the line holding `offset`. */
export function indentAt(text: string, offset: number): string {
  const start = text.lastIndexOf('\n', offset - 1) + 1;
  return /^[ \t]*/.exec(text.slice(start))?.[0] ?? '';
}

/** One indentation step in the page's own style. */
export function indentUnit(text: string): string {
  const match = /\n(\t+|[ ]{2,8})\S/.exec(text);
  if (!match) return '  ';
  return match[1].startsWith('\t') ? '\t' : match[1].length >= 4 ? '    ' : '  ';
}

/** Apply non-overlapping changes, all given against the original text. */
export function applyChanges(text: string, changes: TextChange[]): string {
  const sorted = [...changes].sort((a, b) => a.from - b.from || a.to - b.to);
  let out = '';
  let at = 0;
  for (const change of sorted) {
    if (change.from < at) throw new Error('overlapping changes');
    out += text.slice(at, change.from) + change.insert;
    at = change.to;
  }
  return out + text.slice(at);
}

/** The JavaScript has a syntax error the parser had to recover from. */
export function firstSyntaxError(source: SketchSource): number | null {
  let found: number | null = null;
  walkCode(source, (n) => {
    if (found !== null) return false;
    if (n.node.type.isError) {
      found = n.from;
      return false;
    }
    return true;
  });
  return found;
}

// ─── Small tree helpers ────────────────────────────────────────────────────

/** Lezer makes a new node object on every visit, so nodes are compared by place and type. */
export function sameNode(a: SyntaxNode | null | undefined, b: SyntaxNode | null | undefined): boolean {
  return !!a && !!b && a.from === b.from && a.to === b.to && a.type === b.type;
}

/** The called name of a CallExpression: `noise` for `noise(x)`, `p.noise` gives `noise` with object `p`. */
export function callee(block: ScriptBlock, call: SyntaxNode): { name: string; object: string | null; node: SyntaxNode } | null {
  const target = call.firstChild;
  if (!target) return null;
  if (target.name === 'VariableName') return { name: textOf(block, target), object: null, node: target };
  if (target.name === 'MemberExpression') {
    const property = target.lastChild;
    const object = target.firstChild;
    if (property?.name !== 'PropertyName') return null;
    return {
      name: textOf(block, property),
      object: object?.name === 'VariableName' ? textOf(block, object) : textOf(block, object),
      node: target,
    };
  }
  return null;
}

/** Argument expressions of a CallExpression or NewExpression, without punctuation. */
export function callArgs(call: SyntaxNode): SyntaxNode[] {
  const list = call.getChild('ArgList');
  if (!list) return [];
  const args: SyntaxNode[] = [];
  for (let child = list.firstChild; child; child = child.nextSibling) {
    if (child.name === '(' || child.name === ')' || child.name === ',' || child.type.isError) continue;
    if (child.name === 'LineComment' || child.name === 'BlockComment') continue;
    args.push(child);
  }
  return args;
}

/** A number literal, with an optional leading minus. */
export function numberValue(block: ScriptBlock, node: SyntaxNode): number | null {
  if (node.name === 'Number') {
    const value = Number(textOf(block, node).replace(/_/g, ''));
    return Number.isFinite(value) ? value : null;
  }
  if (node.name === 'UnaryExpression') {
    const op = node.firstChild;
    const operand = node.lastChild;
    if (op && operand && operand.name === 'Number' && textOf(block, op) === '-') {
      const value = numberValue(block, operand);
      return value === null ? null : -value;
    }
  }
  return null;
}

/** A string literal's value (quotes removed, no escapes interpreted beyond the basics). */
export function stringValue(block: ScriptBlock, node: SyntaxNode): string | null {
  if (node.name !== 'String') return null;
  const raw = textOf(block, node);
  return raw.slice(1, -1);
}

/** Function declarations by name, top level or nested, in page order. */
export function functionDeclarations(source: SketchSource): Map<string, CodeNode[]> {
  const found = new Map<string, CodeNode[]>();
  walkCode(source, (n) => {
    if (n.node.name !== 'FunctionDeclaration') return;
    const name = n.node.getChild('VariableDefinition');
    if (!name) return;
    const key = textOf(n.block, name);
    found.set(key, [...(found.get(key) ?? []), n]);
  });
  return found;
}

/** The first function declaration with this name. */
export function findFunction(source: SketchSource, name: string): CodeNode | null {
  return functionDeclarations(source).get(name)?.[0] ?? null;
}

/** Whether a node sits inside the body of `fn`. */
export function isInside(n: CodeNode, fn: CodeNode | null): boolean {
  return !!fn && n.block === fn.block && n.from >= fn.from && n.to <= fn.to;
}

/** The nearest enclosing function declaration's name, or null at top level. */
export function enclosingFunctionName(block: ScriptBlock, node: SyntaxNode): string | null {
  for (let p: SyntaxNode | null = node.parent; p; p = p.parent) {
    if (p.name === 'FunctionDeclaration') {
      const name = p.getChild('VariableDefinition');
      return name ? textOf(block, name) : null;
    }
  }
  return null;
}

/** Every name the sketch declares: variables, functions, classes and parameters. */
export function declaredNames(source: SketchSource): Set<string> {
  const names = new Set<string>();
  walkCode(source, (n) => {
    if (n.node.name === 'VariableDefinition' || n.node.name === 'Definition') names.add(nodeText(n));
  });
  return names;
}

/** A free name for something new, `base`, then `base2`, `base3`, ... */
export function freeName(taken: Set<string>, base: string): string {
  if (!taken.has(base)) return base;
  for (let i = 2; ; i++) if (!taken.has(`${base}${i}`)) return `${base}${i}`;
}

/** Why a file cannot be saved: where, and what the JavaScript engine says is wrong. */
export interface SaveProblem {
  line: number | null;
  message: string;
}

/**
 * Check a file before it is saved. The parser finds where the code stops
 * reading; for a script, the JavaScript engine (compiling, never running it)
 * says what is wrong there. Module-only syntax (import, export, top-level
 * await) is left to the parser, since a sketch file may legitimately use it.
 */
export function saveProblem(text: string, language: SketchLanguage): SaveProblem | null {
  const at = firstSyntaxError(readSketchFile(text, language));
  let engine: string | null = null;
  if (language === 'js') {
    try {
      // Compiles the code without running it.
      new Function(text);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const moduleOnly = /\b(import|export)\b|await is only valid|Cannot use import/i.test(message);
      if (err instanceof SyntaxError && !moduleOnly) engine = message;
    }
  }
  if (at === null && engine === null) return null;
  return {
    line: at !== null ? lineAt(text, at) : engineLine(text, engine!),
    message: engine ?? 'The code cannot be read here: look for a missing bracket, comma or quote.',
  };
}

/**
 * Where the engine's error is, when the parser did not mark it: compile the
 * file a line at a time; the first prefix that fails with the same error (not
 * just "the code ended early") ends on the line at fault.
 */
function engineLine(text: string, message: string): number | null {
  const lines = text.split('\n');
  for (let n = 1; n <= lines.length; n++) {
    try {
      new Function(lines.slice(0, n).join('\n'));
    } catch (err) {
      const m = err instanceof Error ? err.message : '';
      if (m === message && !/Unexpected end of input|missing \) after|Unterminated/i.test(m)) return n;
    }
  }
  return null;
}
