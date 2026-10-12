/** Bounded arithmetic only: never evaluates JavaScript or accepts partial numbers. */
export function numericExpression(text: string): number | null {
  if (!text.trim() || text.length > 256) return null;
  text = text.replace(/−/g, '-').replace(/×/g, '*').replace(/÷/g, '/');
  let position = 0;
  let depth = 0;
  const space = () => { while (/\s/.test(text[position] ?? '') && position < text.length) position++; };
  function atom(): number {
    space();
    if (++depth > 32) throw new Error('Expression too deep');
    let value: number;
    const char = text[position];
    if (char === '+' || char === '-') {
      position++;
      value = (char === '-' ? -1 : 1) * atom();
    } else if (char === '(') {
      position++;
      value = sum();
      space();
      if (text[position++] !== ')') throw new Error('Missing closing parenthesis');
    } else {
      const match = /^(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/.exec(text.slice(position));
      if (!match) throw new Error('Expected a number');
      position += match[0].length;
      value = Number(match[0]);
    }
    depth--;
    return value;
  }
  function product(): number {
    let value = atom();
    for (;;) {
      space();
      const operator = text[position];
      if (operator !== '*' && operator !== '/') return value;
      position++;
      const right = atom();
      value = operator === '*' ? value * right : value / right;
      if (!Number.isFinite(value)) throw new Error('Nonfinite result');
    }
  }
  function sum(): number {
    let value = product();
    for (;;) {
      space();
      const operator = text[position];
      if (operator !== '+' && operator !== '-') return value;
      position++;
      const right = product();
      value = operator === '+' ? value + right : value - right;
      if (!Number.isFinite(value)) throw new Error('Nonfinite result');
    }
  }
  try {
    const result = sum();
    space();
    return position === text.length && Number.isFinite(result) ? result : null;
  } catch { return null; }
}
