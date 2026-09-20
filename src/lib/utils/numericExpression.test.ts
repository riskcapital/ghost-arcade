import { describe, expect, it } from 'vitest';
import { numericExpression } from './numericExpression';
describe('numeric expressions', () => {
  it.each([
    ['1920/3', 640], ['6×4÷2', 12], ['−2+4', 2], ['120*2', 240], ['2+3*4', 14], ['(2+3)*4', 20],
    ['8/2/2', 2], ['10-3-2', 5], ['-.5 * -2', 1], ['1e3 / 2E+1', 50],
    [' ( 2 + 4 ) / +3 ', 2], ['0', 0], ['1.', 1], ['2--3', 5],
  ])('evaluates %s', (text, expected) => expect(numericExpression(text)).toBe(expected));
  it.each(['', ' ', '1/0', '0/0', '1e999', '1e308*2', '12px', '1+', '2(3)',
    'Math.random()', 'alert(1)', '1;2', '1,5', '2**3', '()', '(1+2', '1+2)', '1e', '.',
    '1 '.repeat(200), '('.repeat(40)+'1'+')'.repeat(40)])('rejects %s without partial application', text => {
    expect(numericExpression(text)).toBeNull();
  });
});
