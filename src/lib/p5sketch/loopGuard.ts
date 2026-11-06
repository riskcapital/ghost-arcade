/**
 * Loop protection for code that plays in a page.
 *
 * A loop that never ends (`while (y < height) { line(0, y, width, y); }`
 * without the `y += 10`) keeps the page busy forever, and a page that runs
 * next to the editor takes the editor down with it. Every for, while and
 * do-while loop in the author's scripts gets a check that throws once the
 * loop has run for LOOP_LIMIT_MS without finishing, so the page stops with an
 * error on that loop's line instead. The same check the p5.js Web Editor
 * makes; a script with `// noprotect` in it is left alone, as there.
 *
 * The code is parsed with the Lezer grammar the sketch editor uses, never
 * matched with patterns, and nothing is added on a line of its own: every
 * line of the code keeps its number, so errors still point at the author's
 * lines. Loops that wait (`await`, `yield`) give the page back while they
 * run, so they are left as written.
 */
import { parser } from '@lezer/javascript';
import type { SyntaxNode } from '@lezer/common';

/** How long one run of a loop may take before it is stopped. */
export const LOOP_LIMIT_MS = 500;

/** The global the checks call; defined by LOOP_GUARD_RUNTIME. */
const GUARD = '__ghostLoopGuard';

export const LOOP_STOPPED_MESSAGE = 'This loop ran for more than half a second without finishing, so it was stopped. '
  + 'Check that its condition becomes false: the counter has to change on every pass. '
  + 'Add // noprotect to the code to turn this check off.';

/**
 * Defines the checks. One line, so it can go anywhere in a page without
 * moving the lines after it. Once a loop has been stopped every guarded loop
 * stops at its next check, so a page that runs the loop each frame does not
 * spend half a second on it every frame.
 */
export const LOOP_GUARD_RUNTIME = `(function(){var limit=${LOOP_LIMIT_MS},tripped=false;`
  + `window.${GUARD}={m:${JSON.stringify(LOOP_STOPPED_MESSAGE)},`
  + 's:function(){return{t:performance.now(),n:0};},'
  + 'c:function(g){if(tripped)return true;if((++g.n&255)!==0)return false;'
  + 'if(performance.now()-g.t>limit){tripped=true;return true;}return false;}};})();';

const LOOPS = new Set(['ForStatement', 'WhileStatement', 'DoStatement']);
/** Code inside these runs on its own call, not as part of the loop around it. */
const OWN_SCOPE = new Set(['FunctionDeclaration', 'FunctionExpression', 'ArrowFunction', 'MethodDeclaration', 'ClassDeclaration', 'ClassExpression']);

export function hasNoProtect(code: string): boolean {
  return /\/[/*]\s*noprotect\b/i.test(code);
}

function hasErrors(node: SyntaxNode): boolean {
  let found = false;
  node.cursor().iterate((n) => {
    if (found) return false;
    if (n.type.isError) found = true;
    return !found;
  });
  return found;
}

/** True when the loop waits inside itself (await, yield, for await), so it hands the page back as it runs. */
function waits(loop: SyntaxNode): boolean {
  if (loop.getChild('await')) return true;
  let found = false;
  loop.cursor().iterate((n) => {
    if (found) return false;
    if (n.from !== loop.from || n.to !== loop.to) {
      if (OWN_SCOPE.has(n.name)) return false;
    }
    if (n.name === 'AwaitExpression' || n.name === 'YieldExpression') found = true;
    return !found;
  });
  return found;
}

/** The statement a loop repeats. */
function loopBody(loop: SyntaxNode): SyntaxNode | null {
  if (loop.name === 'DoStatement') {
    const keyword = loop.getChild('do');
    return keyword?.nextSibling ?? null;
  }
  const head = loop.getChild(loop.name === 'ForStatement' ? 'ForSpec' : 'ParenthesizedExpression')
    ?? loop.getChild('ForInSpec')
    ?? loop.getChild('ForOfSpec');
  return head?.nextSibling ?? null;
}

interface Insert {
  at: number;
  text: string;
  /** 0 closes a block, 1 opens one or adds a check. */
  order: number;
}

/**
 * The code with a time check in every loop that could keep the page busy,
 * on the lines the loops are on. Code the grammar cannot read comes back as
 * it is: it will not run anyway, and a guess could break it.
 */
export function guardLoops(code: string): string {
  if (!code || hasNoProtect(code) || !/\b(?:for|while|do)\b/.test(code)) return code;
  const tree = parser.parse(code);
  if (hasErrors(tree.topNode)) return code;
  const inserts: Insert[] = [];
  let count = 0;
  tree.cursor().iterate((ref) => {
    if (!LOOPS.has(ref.name)) return;
    const loop = ref.node;
    if (waits(loop)) return;
    const body = loopBody(loop);
    if (!body) return;
    const name = `__ghostLoop${count++}`;
    const check = `if(${GUARD}.c(${name}))throw new RangeError(${GUARD}.m);`;
    // A label belongs to its loop (`continue outer`), so the block holding
    // the start time goes around the labels too.
    let outer: SyntaxNode = loop;
    while (outer.parent?.name === 'LabeledStatement') outer = outer.parent;
    inserts.push({ at: outer.from, text: `{let ${name}=${GUARD}.s();`, order: 1 });
    inserts.push({ at: outer.to, text: '}', order: 0 });
    if (body.name === 'Block') {
      inserts.push({ at: body.from + 1, text: check, order: 1 });
    } else {
      inserts.push({ at: body.from, text: `{${check}`, order: 1 });
      inserts.push({ at: body.to, text: '}', order: 0 });
    }
  });
  if (inserts.length === 0) return code;
  // Back to front, so earlier offsets hold. Text put in at an offset lands
  // before what went in there earlier, so at one offset the openers go in
  // first (a loop ending where the next one starts closes before it opens),
  // inner loops' openers before outer ones', and outer closers before inner.
  const sorted = inserts
    .map((insert, index) => ({ ...insert, index }))
    .sort((a, b) => b.at - a.at || b.order - a.order || (a.order === 0 ? a.index - b.index : b.index - a.index));
  let out = code;
  for (const insert of sorted) out = out.slice(0, insert.at) + insert.text + out.slice(insert.at);
  return out;
}

const SCRIPT_RE = /(<script\b([^>]*)>)([\s\S]*?)(<\/script\s*>)/gi;
const JS_TYPES = new Set(['', 'text/javascript', 'application/javascript', 'module']);

/** Whether a <script> tag's attributes describe inline JavaScript. */
export function isInlineJavaScript(attrs: string): boolean {
  if (/\bsrc\s*=/i.test(attrs)) return false;
  const type = /\btype\s*=\s*["']?([^"'\s>]+)/i.exec(attrs);
  return JS_TYPES.has(type ? type[1].toLowerCase() : '');
}

/** A page with every inline script guarded (see guardLoops), line for line. */
export function guardPageLoops(html: string): string {
  if (hasNoProtect(html)) return html;
  return html.replace(SCRIPT_RE, (match, open: string, attrs: string, code: string, close: string) => (
    isInlineJavaScript(attrs) ? `${open}${guardLoops(code)}${close}` : match
  ));
}

/**
 * Adds the checks' definitions to a page without adding a line: inside its
 * <head> (or at the very top when it has none), before any of its scripts.
 */
export function withLoopGuardRuntime(html: string): string {
  const tag = `<script>${LOOP_GUARD_RUNTIME}</script>`;
  const head = /<head\b[^>]*>/i.exec(html);
  if (head) {
    const at = head.index + head[0].length;
    return html.slice(0, at) + tag + html.slice(at);
  }
  const doctype = /^\s*<!doctype[^>]*>/i.exec(html);
  const at = doctype ? doctype[0].length : 0;
  return html.slice(0, at) + tag + html.slice(at);
}
