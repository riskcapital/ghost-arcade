/**
 * Sketch errors in plain words.
 *
 * The browser's messages are precise but terse ("Cannot read properties of
 * undefined (reading 'x')"). Each one the editor shows comes with a sentence
 * on what usually causes it and where to look.
 */

export interface SketchError {
  message: string;
  /** The sketch file it happened in (`sketch.js`, `index.html`), or null inside p5 itself. */
  file: string | null;
  /** Line in that file as written, or null when unknown. */
  line: number | null;
  count: number;
}

const RULES: Array<[RegExp, (m: RegExpMatchArray) => string]> = [
  [/Cannot access '([^']+)' before initialization/, (m) =>
    `${m[1]} is used before the line that creates it has run. Move its let or const above the first use, or give it its value inside setup().`],
  [/^ReferenceError: (\S+) is not defined/, (m) => /^p5\./.test(m[1]) || m[1] === 'userStartAudio'
    ? `${m[1]} belongs to p5.sound, which Ghost Arcade does not load. Read window.ghostAudio for the music instead.`
    : `${m[1]} is used but never created. Check the spelling (capitals count), or declare it with let before using it.`],
  [/(p5\.(?:AudioIn|FFT|Amplitude|SoundFile|Oscillator)) is not a constructor/, (m) =>
    `${m[1]} comes from p5.sound, which Ghost Arcade does not load. Read window.ghostAudio for the music instead; the Ghost Arcade tips can swap it for you.`],
  [/(\S+) is not a constructor/, (m) => `${m[1]} cannot be used with new. Check the name, and that the class is declared before it is used.`],
  [/(\S+) is not a function/, (m) =>
    `${m[1]} is called like a function but is not one. Check the spelling and the brackets; if it comes from a library such as p5.sound, Ghost Arcade does not load it.`],
  [/Cannot read propert(?:y|ies) of (undefined|null)(?: \(reading '([^']+)'\))?/, (m) =>
    `Something is ${m[1]} where the code expects an object${m[2] ? `, so .${m[2]} cannot be read` : ''}. Usually an array read past its end, or a variable used before it has been given a value.`],
  [/Cannot set propert(?:y|ies) of (undefined|null)(?: \(setting '([^']+)'\))?/, (m) =>
    `Something is ${m[1]} where the code expects an object${m[2] ? `, so .${m[2]} cannot be set` : ''}. Check that the object or array exists before writing into it.`],
  [/Assignment to constant variable/, () => 'A const is being changed. Declare it with let if its value needs to change.'],
  [/Identifier '([^']+)' has already been declared/, (m) => `${m[1]} is declared twice with let, const or class. Remove one, or give one a different name.`],
  [/Unexpected end of input/, () => 'The code ends before every bracket is closed. Look for a missing } ) or ], often at the end of a function.'],
  [/missing \) after argument list/, () => 'A function call is missing its closing bracket, or a comma between two of its values.'],
  [/Unexpected (?:token|identifier|string|number)/, () =>
    'The browser cannot read the code here. Look for a missing comma, bracket or quote on this line or just before it.'],
  [/Invalid or unexpected token/, () => 'There is a character the browser cannot read, often an unclosed quote or a stray symbol.'],
  [/Maximum call stack size exceeded/, () => 'A function keeps calling itself and never stops. Give it a condition that ends the repeat.'],
  [/Invalid array length/, () => 'An array was made with a negative or fractional size. Round the size with floor() and keep it above zero.'],
  [/is not iterable/, () => 'A for...of loop (or ...spread) was given something that is not a list.'],
  [/Failed to execute '[^']+' on 'CanvasRenderingContext2D'|non-finite/, () =>
    'A drawing call got a number that is not a number: NaN or Infinity, often from dividing by zero. Check the math feeding it.'],
];

/** The message without the browser's "Uncaught" prefix. */
export function cleanErrorMessage(message: string): string {
  return message.replace(/^Uncaught\s+(?:\(in promise\)\s+)?/, '').trim();
}

/** A plain-words explanation of a browser error, or null when there is nothing to add. */
export function explainSketchError(message: string): string | null {
  const clean = cleanErrorMessage(message);
  for (const [pattern, explain] of RULES) {
    const match = clean.match(pattern);
    if (match) return explain(match);
  }
  return null;
}
