/**
 * Learning mode's notes: which p5.js ideas a sketch uses, and where.
 *
 * One note per idea, placed at its first appearance and listing every other
 * place it shows up, so the editor can underline them all and the side panel
 * can read top to bottom like a guided tour of the code.
 */
import type { SyntaxNode } from '@lezer/common';
import { CONCEPTS, THEMES, type Concept, type ConceptCategory, type SketchLink } from './sketchConcepts';
import { callee, lineAt, readSketchFile, sameNode, textOf, walkCode, type CodeNode, type ScriptBlock, type SketchLanguage, type SketchSource } from './sketchSource';

export interface SketchNote {
  id: string;
  category: ConceptCategory;
  title: string;
  body: string;
  links: SketchLink[];
  /** Every place the idea appears, as page offsets. */
  ranges: Array<{ from: number; to: number }>;
  /** Line of the first appearance. */
  line: number;
  /** The names that triggered it, in order of appearance (`circle`, `line`). */
  names: string[];
}

export interface SketchAnnotations {
  notes: SketchNote[];
  /** Further reading picked from what the sketch is made of. */
  reading: SketchLink[];
}

const BY_TRIGGER = new Map<string, Concept>();
for (const concept of CONCEPTS) for (const trigger of concept.triggers) BY_TRIGGER.set(trigger, concept);

// Member calls on these objects are plain JavaScript, never p5 in instance mode.
const NOT_P5_OBJECTS = new Set(['Math', 'console', 'window', 'document', 'JSON', 'Object', 'Array', 'Number', 'String', 'Promise', 'drawingContext', 'ctx', 'this']);

/** A function defined under `name`: `function name() {}` or `const name = (p) => {}`. */
function functionNamed(source: SketchSource, name: string): { node: SyntaxNode; block: ScriptBlock } | null {
  let found: { node: SyntaxNode; block: ScriptBlock } | null = null;
  walkCode(source, ({ node, block }) => {
    if (found) return false;
    if (node.name === 'FunctionDeclaration' && textOf(block, node.getChild('VariableDefinition')) === name) {
      found = { node, block };
    } else if (node.name === 'VariableDefinition' && textOf(block, node) === name) {
      const value = node.nextSibling?.nextSibling;
      if (value && (value.name === 'ArrowFunction' || value.name === 'FunctionExpression')) found = { node: value, block };
    }
    return true;
  });
  return found;
}

/** The parameter name of `new p5((p) => { ... })`, when the sketch uses instance mode. */
function instanceNames(source: SketchSource): Set<string> {
  const names = new Set<string>();
  walkCode(source, ({ node, block }) => {
    if (node.name !== 'NewExpression') return;
    const target = node.getChild('VariableName');
    if (!target || textOf(block, target) !== 'p5') return;
    const arg = node.getChild('ArgList')?.firstChild?.nextSibling ?? null;
    const fn = arg?.name === 'VariableName' ? functionNamed(source, textOf(block, arg)) : arg ? { node: arg, block } : null;
    const param = fn?.node.getChild('ParamList')?.getChild('VariableDefinition');
    if (fn && param) names.add(textOf(fn.block, param));
  });
  return names;
}

function isCallTarget(node: SyntaxNode): boolean {
  const parent = node.parent;
  if (!parent) return false;
  if (parent.name === 'CallExpression') return sameNode(parent.firstChild, node);
  // `new` comes first, then what is being constructed.
  if (parent.name === 'NewExpression') return sameNode(parent.firstChild?.nextSibling, node);
  return false;
}

function isAssignmentTarget(node: SyntaxNode): boolean {
  const parent = node.parent;
  return !!parent && parent.name === 'AssignmentExpression' && sameNode(parent.firstChild, node);
}

interface Hit {
  trigger: string;
  name: string;
  node: CodeNode;
}

function loopDepth(node: SyntaxNode): number {
  let depth = 0;
  for (let p = node.parent; p; p = p.parent) {
    if (p.name === 'ForStatement' || p.name === 'WhileStatement' || p.name === 'DoStatement') depth++;
  }
  return depth;
}

function collectHits(source: SketchSource): Hit[] {
  const instances = instanceNames(source);
  const hits: Hit[] = [];
  const hit = (trigger: string, name: string, block: ScriptBlock, node: SyntaxNode) => {
    if (BY_TRIGGER.has(trigger)) hits.push({ trigger, name, node: { node, block, from: block.from + node.from, to: block.from + node.to } });
  };

  walkCode(source, ({ node, block }) => {
    switch (node.name) {
      case 'FunctionDeclaration': {
        const name = node.getChild('VariableDefinition');
        if (name) hit(`fn:${textOf(block, name)}`, textOf(block, name), block, name);
        break;
      }
      case 'CallExpression': {
        const target = callee(block, node);
        if (!target) break;
        if (target.object === null) {
          hit(`call:${target.name}`, target.name, block, target.node);
        } else if (target.object === 'Math') {
          hit(`math:${target.name}`, `Math.${target.name}`, block, target.node);
        } else if (instances.has(target.object)) {
          hit(`call:${target.name}`, target.name, block, target.node.lastChild ?? target.node);
        } else if (!NOT_P5_OBJECTS.has(target.object)) {
          hit(`method:${target.name}`, `.${target.name}()`, block, target.node.lastChild ?? target.node);
        }
        break;
      }
      case 'NewExpression': {
        const target = node.firstChild?.nextSibling;
        if (target) hit(`new:${textOf(block, target)}`, `new ${textOf(block, target)}`, block, target);
        break;
      }
      case 'MemberExpression': {
        if (isCallTarget(node)) break;
        const text = textOf(block, node);
        const object = node.firstChild;
        const property = node.lastChild;
        if (BY_TRIGGER.has(`member:${text}`)) {
          hit(`member:${text}`, text, block, node);
        } else if (object && property && property.name === 'PropertyName' && instances.has(textOf(block, object))) {
          const name = textOf(block, property);
          // `p.draw = () => {}` defines a function p5 calls, as `function draw()` does.
          if (isAssignmentTarget(node)) hit(`fn:${name}`, name, block, property);
          else hit(`name:${name}`, name, block, property);
        }
        break;
      }
      case 'VariableName': {
        if (isCallTarget(node)) break;
        const parent = node.parent;
        // The object of `a.b` is a value read like any other, except for `window`.
        if (parent?.name === 'MemberExpression' && sameNode(parent.firstChild, node) && textOf(block, node) === 'window') break;
        const name = textOf(block, node);
        hit(`name:${name}`, name, block, node);
        break;
      }
      case 'ForStatement': {
        const keyword = node.firstChild;
        if (!keyword) break;
        hit(node.getChild('ForOfSpec') ? 'syntax:for-of' : 'syntax:for', 'for', block, keyword);
        if (loopDepth(node) > 0) hit('syntax:nested-for', 'for', block, keyword);
        break;
      }
      case 'WhileStatement':
      case 'DoStatement': {
        const keyword = node.firstChild;
        if (keyword) hit('syntax:while', 'while', block, keyword);
        break;
      }
      case 'ClassDeclaration': {
        const name = node.getChild('VariableDefinition');
        hit('syntax:class', name ? textOf(block, name) : 'class', block, name ?? node);
        break;
      }
    }
  });
  return hits;
}

function titleFor(concept: Concept, names: string[]): string {
  if (!concept.title.includes('{names}')) return concept.title;
  return concept.title.replace('{names}', names.map((n) => (/^[A-Za-z_$][\w$]*$/.test(n) ? `${n}()` : n)).join(', '));
}

/** The notes for one sketch file (a script, or a page's inline scripts), in the order their ideas first appear. */
export function annotateSketch(text: string, language: SketchLanguage = 'html'): SketchAnnotations {
  const source = readSketchFile(text, language);
  const byConcept = new Map<string, { concept: Concept; hits: Hit[] }>();
  for (const h of collectHits(source)) {
    const concept = BY_TRIGGER.get(h.trigger)!;
    const entry = byConcept.get(concept.id) ?? { concept, hits: [] };
    entry.hits.push(h);
    byConcept.set(concept.id, entry);
  }

  const notes: SketchNote[] = [];
  for (const { concept, hits } of byConcept.values()) {
    hits.sort((a, b) => a.node.from - b.node.from);
    const names: string[] = [];
    for (const h of hits) if (!names.includes(h.name)) names.push(h.name);
    notes.push({
      id: concept.id,
      category: concept.category,
      title: titleFor(concept, names),
      body: concept.body,
      links: concept.links,
      ranges: hits.map((h) => ({ from: h.node.from, to: h.node.to })),
      line: lineAt(text, hits[0].node.from),
      names,
    });
  }
  notes.sort((a, b) => a.ranges[0].from - b.ranges[0].from);

  const found = new Set(notes.map((n) => n.id));
  const reading: SketchLink[] = [];
  for (const theme of THEMES) {
    if (theme.when.every((id) => found.has(id)) && !reading.some((l) => l.url === theme.link.url)) reading.push(theme.link);
  }
  return { notes, reading };
}

/** The note whose underlined text covers `pos`, for the editor's hover card. */
export function noteAt(notes: SketchNote[], pos: number): SketchNote | null {
  for (const note of notes) {
    for (const range of note.ranges) if (pos >= range.from && pos <= range.to) return note;
  }
  return null;
}
