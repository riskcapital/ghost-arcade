/**
 * What learning mode says about each p5.js idea it finds in a sketch.
 *
 * Every entry is written for someone reading the code for the first time:
 * what it does, in plain words, and where to read more. The p5.js reference
 * pages live at p5js.org/reference/p5/<name>/; the longer reads are chapters
 * of The Nature of Code (natureofcode.com) and lessons on The Coding Train
 * (thecodingtrain.com).
 */

export interface SketchLink {
  label: string;
  url: string;
}

export type ConceptCategory =
  | 'structure'
  | 'randomness'
  | 'maths'
  | 'time'
  | 'transform'
  | 'loops'
  | 'objects'
  | 'shapes'
  | 'colour'
  | 'pixels'
  | 'input'
  | 'size'
  | 'ghost';

/**
 * How a concept shows up in code:
 *  - call:NAME     a p5 call, `noise(...)` or `p.noise(...)` in instance mode
 *  - name:NAME     a p5 value read, `frameCount`, `width`
 *  - fn:NAME       a function p5 calls for you, `function draw() {}`
 *  - math:NAME     `Math.NAME(...)`
 *  - new:NAME      `new NAME(...)`, `new p5.Vector()`
 *  - member:A.B    the expression `A.B`
 *  - method:NAME   `something.NAME(...)` on an ordinary value (arrays)
 *  - syntax:KIND   for, nested-for, while, for-of, class
 */
export interface Concept {
  id: string;
  category: ConceptCategory;
  /** Shown as the note's heading. `{names}` becomes the names found, e.g. "circle(), line()". */
  title: string;
  body: string;
  triggers: string[];
  links: SketchLink[];
}

export const p5Reference = (name: string): SketchLink => ({
  label: `p5.js reference: ${name}`,
  url: `https://p5js.org/reference/p5/${name}/`,
});

const NOC = {
  random: { label: 'The Nature of Code: Randomness', url: 'https://natureofcode.com/random/' },
  perlin: { label: 'The Nature of Code: Perlin noise', url: 'https://natureofcode.com/random/#a-smoother-approach-with-perlin-noise' },
  vectors: { label: 'The Nature of Code: Vectors', url: 'https://natureofcode.com/vectors/' },
  forces: { label: 'The Nature of Code: Forces', url: 'https://natureofcode.com/forces/' },
  oscillation: { label: 'The Nature of Code: Oscillation', url: 'https://natureofcode.com/oscillation/' },
  particles: { label: 'The Nature of Code: Particle Systems', url: 'https://natureofcode.com/particles/' },
  agents: { label: 'The Nature of Code: Autonomous Agents', url: 'https://natureofcode.com/autonomous-agents/' },
  fractals: { label: 'The Nature of Code: Fractals', url: 'https://natureofcode.com/fractals/' },
} satisfies Record<string, SketchLink>;

const TRAIN = {
  start: { label: 'Coding Train: Code! Programming with p5.js', url: 'https://thecodingtrain.com/tracks/code-programming-with-p5-js' },
  random: { label: 'Coding Train: random()', url: 'https://thecodingtrain.com/tracks/code-programming-with-p5-js/code/2-variables/4-random' },
  map: { label: 'Coding Train: map()', url: 'https://thecodingtrain.com/tracks/code-programming-with-p5-js/code/2-variables/5-map' },
  perlin: { label: 'Coding Train: Introduction to Perlin noise', url: 'https://thecodingtrain.com/tracks/noise/noc/perlin/intro-to-perlin-noise' },
  noiseVsRandom: { label: 'Coding Train: noise() vs random()', url: 'https://thecodingtrain.com/tracks/noise/noc/perlin/noise-vs-random' },
  loops: { label: 'Coding Train: while and for loops', url: 'https://thecodingtrain.com/tracks/code-programming-with-p5-js/code/4-loops/1-while-for' },
  nested: { label: 'Coding Train: nested loops', url: 'https://thecodingtrain.com/tracks/code-programming-with-p5-js/code/4-loops/2-nested' },
  transforms: { label: 'Coding Train: translate, rotate, push and pop', url: 'https://thecodingtrain.com/tracks/transformations-in-p5/transformations/translate-rotate-push-pop' },
  scale: { label: 'Coding Train: scale', url: 'https://thecodingtrain.com/tracks/transformations-in-p5/transformations/scale' },
  harmonic: { label: 'Coding Train: simple harmonic motion', url: 'https://thecodingtrain.com/tracks/the-nature-of-code-2/noc/3-angles/5-harmonic-motion' },
  polar: { label: 'Coding Train: polar coordinates', url: 'https://thecodingtrain.com/tracks/the-nature-of-code-2/noc/3-angles/4-polar-coordinates' },
  classes: { label: 'Coding Train: classes', url: 'https://thecodingtrain.com/tracks/code-programming-with-p5-js/code/6-objects/2-classes' },
  arrays: { label: 'Coding Train: arrays of objects', url: 'https://thecodingtrain.com/tracks/code-programming-with-p5-js/code/7-arrays/3-arrays-objects' },
  flocking: { label: 'Coding Train: flocking simulation', url: 'https://thecodingtrain.com/challenges/124-flocking-simulation' },
} satisfies Record<string, SketchLink>;

/** Where a newcomer can start, shown under the notes. */
export const GETTING_STARTED: SketchLink[] = [
  TRAIN.start,
  { label: 'p5.js reference', url: 'https://p5js.org/reference/' },
  { label: 'The Nature of Code (free online book)', url: 'https://natureofcode.com/' },
];

const ref = p5Reference;

export const CONCEPTS: Concept[] = [
  // ── Structure ──────────────────────────────────────────────────────────
  {
    id: 'setup', category: 'structure', title: 'setup(): runs once at the start',
    body: 'p5 calls setup() once, when the sketch starts. This is where the canvas is made and things are prepared: arrays filled, starting positions chosen.',
    triggers: ['fn:setup'], links: [ref('setup'), TRAIN.start],
  },
  {
    id: 'draw', category: 'structure', title: 'draw(): runs every frame',
    body: 'p5 calls draw() again and again, about 60 times a second. Each run paints one frame, so anything that changes between runs becomes animation.',
    triggers: ['fn:draw'], links: [ref('draw')],
  },
  {
    id: 'windowResized', category: 'structure', title: 'windowResized(): the screen changed size',
    body: 'p5 calls windowResized() when the window changes size. Resizing the canvas here keeps the sketch filling whatever screen it plays on.',
    triggers: ['fn:windowResized', 'call:resizeCanvas'], links: [ref('windowResized'), ref('resizeCanvas')],
  },
  {
    id: 'createCanvas', category: 'structure', title: 'createCanvas(): the drawing surface',
    body: 'createCanvas(w, h) makes the surface everything is drawn on, w pixels wide and h tall. createCanvas(windowWidth, windowHeight) fills the layer, whatever its size.',
    triggers: ['call:createCanvas'], links: [ref('createCanvas')],
  },
  {
    id: 'background', category: 'structure', title: 'background(): paint over the last frame',
    body: 'background() covers the whole canvas in one colour. At the top of draw() it wipes the previous frame. Give it some transparency, as in background(0, 20), and old frames fade out slowly instead, leaving trails.',
    triggers: ['call:background', 'call:clear'], links: [ref('background'), ref('clear')],
  },
  {
    id: 'instanceMode', category: 'structure', title: 'new p5(): instance mode',
    body: 'This sketch runs in instance mode: every p5 function lives on one object (often called p or s), as in p.circle(). It works just like the usual global style, and keeps p5 from adding hundreds of names to the page.',
    triggers: ['new:p5'], links: [{ label: 'p5.js: instance mode', url: 'https://p5js.org/reference/p5/p5/' }],
  },
  {
    id: 'noLoop', category: 'structure', title: 'noLoop(): draw once',
    body: 'noLoop() stops draw() from repeating, so the sketch shows a single still frame. loop() starts it again.',
    triggers: ['call:noLoop', 'call:loop'], links: [ref('noLoop')],
  },

  // ── Randomness ─────────────────────────────────────────────────────────
  {
    id: 'random', category: 'randomness', title: 'random(): a surprise every time',
    body: 'random() returns a new unpredictable number on every call: random(10) gives anything from 0 up to 10, random(a, b) anything between a and b. Called every frame, it makes things jitter; called once in setup(), it makes each run different.',
    triggers: ['call:random', 'math:random', 'call:randomGaussian'], links: [ref('random'), TRAIN.random, NOC.random],
  },
  {
    id: 'noise', category: 'randomness', title: 'noise(): smooth randomness',
    body: 'noise() is Perlin noise: randomness with no sudden jumps. Inputs that are close together give outputs that are close together, so nudging the input a little each frame (noise(t), with t growing slowly) makes a value that wanders gently. It always returns a number from 0 to 1, and a smaller step through the noise makes slower, smoother change.',
    triggers: ['call:noise', 'call:noiseDetail'], links: [ref('noise'), TRAIN.perlin, TRAIN.noiseVsRandom, NOC.perlin],
  },
  {
    id: 'seed', category: 'randomness', title: 'randomSeed() / noiseSeed(): repeatable randomness',
    body: 'A seed fixes the sequence random() or noise() produces, so the sketch makes the same "random" picture every run. Change the seed to get a different one.',
    triggers: ['call:randomSeed', 'call:noiseSeed'], links: [ref('randomSeed'), ref('noiseSeed')],
  },

  // ── Maths ──────────────────────────────────────────────────────────────
  {
    id: 'map', category: 'maths', title: 'map(): convert from one range to another',
    body: 'map(value, inMin, inMax, outMin, outMax) rescales a number. For example map(level, 0, 1, 10, 200) turns a 0-to-1 audio level into a size from 10 to 200 pixels.',
    triggers: ['call:map'], links: [ref('map'), TRAIN.map],
  },
  {
    id: 'lerp', category: 'maths', title: 'lerp(): part of the way there',
    body: 'lerp(a, b, t) finds the point a fraction t of the way from a to b: t = 0 gives a, t = 1 gives b. Moving a value a little towards its target every frame, x = lerp(x, target, 0.1), gives smooth easing instead of a jump. lerpColor() does the same between two colours.',
    triggers: ['call:lerp', 'call:lerpColor'], links: [ref('lerp'), ref('lerpColor')],
  },
  {
    id: 'constrain', category: 'maths', title: 'constrain(): keep a number in bounds',
    body: 'constrain(value, low, high) clamps a number so it never goes below low or above high, for example to keep a shape on screen.',
    triggers: ['call:constrain'], links: [ref('constrain')],
  },
  {
    id: 'dist', category: 'maths', title: 'dist(): how far apart',
    body: 'dist(x1, y1, x2, y2) is the straight-line distance between two points. It is how sketches find neighbours, detect touches and fade things with distance.',
    triggers: ['call:dist'], links: [ref('dist')],
  },
  {
    id: 'trig', category: 'maths', title: 'sin() and cos(): waves and circles',
    body: 'sin() and cos() turn an angle into a smooth wave that swings between -1 and 1. Feed them something that grows with time and you get things that pulse, swing and orbit; cos for x and sin for y together walk around a circle.',
    triggers: ['call:sin', 'call:cos', 'math:sin', 'math:cos', 'call:atan2', 'math:atan2'],
    links: [ref('sin'), TRAIN.harmonic, TRAIN.polar, NOC.oscillation],
  },
  {
    id: 'angles', category: 'maths', title: 'PI and TWO_PI: angles in radians',
    body: 'p5 measures angles in radians unless angleMode(DEGREES) is set: TWO_PI is a full turn, PI half a turn and HALF_PI a quarter.',
    triggers: ['name:TWO_PI', 'name:PI', 'name:HALF_PI', 'name:QUARTER_PI', 'name:TAU', 'call:angleMode'],
    links: [{ label: 'p5.js reference: TWO_PI', url: 'https://p5js.org/reference/p5/constants/TWO_PI/' }, ref('angleMode')],
  },

  // ── Time ───────────────────────────────────────────────────────────────
  {
    id: 'frameCount', category: 'time', title: 'frameCount: frames since the start',
    body: 'frameCount counts how many frames have been drawn. Motion built on it is tied to the frame rate: if frames drop, everything slows down. deltaTime or millis() keep time instead.',
    triggers: ['name:frameCount'], links: [ref('frameCount'), ref('deltaTime')],
  },
  {
    id: 'deltaTime', category: 'time', title: 'deltaTime: time since the last frame',
    body: 'deltaTime is how many milliseconds passed since the previous frame. Multiplying movement by it keeps speed the same whatever the frame rate.',
    triggers: ['name:deltaTime'], links: [ref('deltaTime')],
  },
  {
    id: 'millis', category: 'time', title: 'millis(): the clock',
    body: 'millis() is the time since the sketch started, in milliseconds. millis() / 1000 is seconds: a steady clock for animation.',
    triggers: ['call:millis'], links: [ref('millis')],
  },
  {
    id: 'frameRate', category: 'time', title: 'frameRate(): frames per second',
    body: 'frameRate(n) asks for n frames a second; frameRate() with nothing inside reports the current rate. Ghost Arcade runs sketches at up to 60.',
    triggers: ['call:frameRate'], links: [ref('frameRate')],
  },

  // ── Transformations ────────────────────────────────────────────────────
  {
    id: 'translate', category: 'transform', title: 'translate(): move the origin',
    body: 'translate(x, y) moves the point (0, 0), so everything drawn after it shifts. translate(width / 2, height / 2) is the usual way to draw around the centre of the screen.',
    triggers: ['call:translate'], links: [ref('translate'), TRAIN.transforms],
  },
  {
    id: 'rotate', category: 'transform', title: 'rotate(): turn the drawing',
    body: 'rotate(angle) turns everything drawn after it around the origin. To spin a shape around its own centre, translate() to that centre first, then rotate(), then draw at (0, 0).',
    triggers: ['call:rotate'], links: [ref('rotate'), TRAIN.transforms],
  },
  {
    id: 'scale', category: 'transform', title: 'scale(): grow and shrink',
    body: 'scale(s) makes everything drawn after it s times bigger, around the origin. Negative values mirror.',
    triggers: ['call:scale'], links: [ref('scale'), TRAIN.scale],
  },
  {
    id: 'pushPop', category: 'transform', title: 'push() and pop(): keep changes local',
    body: 'push() saves the current position, rotation and style; pop() puts them back. Wrapping one shape\'s translate, rotate and fill between them stops those changes leaking into everything drawn afterwards.',
    triggers: ['call:push', 'call:pop'], links: [ref('push'), ref('pop'), TRAIN.transforms],
  },

  // ── Loops ──────────────────────────────────────────────────────────────
  {
    id: 'for', category: 'loops', title: 'for loops: do it many times',
    body: 'A for loop repeats its block a set number of times, counting with a variable (often i). It is how one line of drawing code becomes hundreds of shapes.',
    triggers: ['syntax:for'], links: [ref('for'), TRAIN.loops],
  },
  {
    id: 'forOf', category: 'loops', title: 'for...of: visit every item',
    body: 'for (const item of list) runs its block once for each item of an array, in order, without a counter.',
    triggers: ['syntax:for-of'], links: [ref('for'), TRAIN.arrays],
  },
  {
    id: 'nestedFor', category: 'loops', title: 'Nested loops: every row and column',
    body: 'A loop inside a loop visits every combination, like every cell of a grid. The inner block runs (outer count × inner count) times every frame, so keep it light.',
    triggers: ['syntax:nested-for'], links: [TRAIN.nested],
  },
  {
    id: 'while', category: 'loops', title: 'while loops: until a condition changes',
    body: 'A while loop repeats as long as its condition is true. The condition must become false at some point, or the sketch freezes.',
    triggers: ['syntax:while'], links: [ref('while'), TRAIN.loops],
  },

  // ── Objects and data ───────────────────────────────────────────────────
  {
    id: 'class', category: 'objects', title: 'class: a template for things',
    body: 'A class describes a kind of thing that has its own data and behaviour, like a Particle with a position and an update() method. new Particle() makes one; an array of them makes a system.',
    triggers: ['syntax:class'], links: [ref('class'), TRAIN.classes, NOC.particles],
  },
  {
    id: 'arrays', category: 'objects', title: 'Arrays: lists of things',
    body: 'An array holds a list of values or objects. push() adds to the end, and looping over the array updates and draws every item. Removing items that are finished (with splice() or filter()) keeps the list from growing forever.',
    triggers: ['method:push', 'method:splice', 'method:filter', 'method:forEach'], links: [ref('Array'), TRAIN.arrays],
  },
  {
    id: 'vectors', category: 'objects', title: 'Vectors: position and velocity',
    body: 'A vector holds an x and a y (and z) together, with maths built in: add(), mult(), mag(), normalize(). Position plus velocity as vectors is the heart of motion, forces and steering.',
    triggers: ['call:createVector', 'new:p5.Vector', 'member:p5.Vector'], links: [ref('p5.Vector'), NOC.vectors, NOC.forces, NOC.agents],
  },

  // ── Shapes ─────────────────────────────────────────────────────────────
  {
    id: 'shapes', category: 'shapes', title: 'Shapes: {names}',
    body: 'Shapes take a position and a size, in pixels from the top-left corner: circle(x, y, diameter), rect(x, y, w, h), line(x1, y1, x2, y2). They are drawn with the current fill and stroke.',
    triggers: ['call:circle', 'call:ellipse', 'call:rect', 'call:square', 'call:line', 'call:point', 'call:triangle', 'call:quad', 'call:arc'],
    links: [ref('circle'), ref('rect'), ref('line')],
  },
  {
    id: 'customShapes', category: 'shapes', title: 'beginShape() and vertex(): your own outlines',
    body: 'beginShape(), then a vertex(x, y) for every point, then endShape() draws one shape through all of them: waves, ribbons, blobs. One shape with many points is also far faster than many small shapes.',
    triggers: ['call:beginShape', 'call:vertex', 'call:curveVertex', 'call:endShape'], links: [ref('beginShape'), ref('vertex')],
  },
  {
    id: 'text', category: 'shapes', title: 'text(): words on the canvas',
    body: 'text(words, x, y) draws text; textSize(), textFont() and textAlign() set how it looks. textWidth() measures it, for spacing letters by hand.',
    triggers: ['call:text', 'call:textSize', 'call:textFont', 'call:textAlign'], links: [ref('text'), ref('textFont')],
  },
  {
    id: 'image', category: 'shapes', title: 'image(): draw a picture or buffer',
    body: 'image(img, x, y) draws a picture, or another canvas made with createGraphics(), onto this one.',
    triggers: ['call:image'], links: [ref('image')],
  },

  // ── Colour ─────────────────────────────────────────────────────────────
  {
    id: 'fillStroke', category: 'colour', title: 'fill() and stroke(): colour',
    body: 'fill() colours the inside of shapes and stroke() their outline; strokeWeight() sets the outline\'s thickness, and noFill() / noStroke() switch either off. They apply to everything drawn after them. A fourth number, as in fill(255, 0, 0, 100), is transparency.',
    triggers: ['call:fill', 'call:stroke', 'call:strokeWeight', 'call:noFill', 'call:noStroke'], links: [ref('fill'), ref('stroke'), ref('strokeWeight')],
  },
  {
    id: 'colorMode', category: 'colour', title: 'colorMode(): how colours are written',
    body: 'colorMode(HSB) switches colours from red, green, blue to hue, saturation, brightness. Rainbows and palettes become easy: keep saturation and brightness, change only the hue.',
    triggers: ['call:colorMode'], links: [ref('colorMode')],
  },
  {
    id: 'color', category: 'colour', title: 'color(): a colour to keep',
    body: 'color() makes a colour value you can store in a variable and reuse, or blend with lerpColor().',
    triggers: ['call:color'], links: [ref('color')],
  },
  {
    id: 'blendMode', category: 'colour', title: 'blendMode(): how shapes mix',
    body: 'blendMode(ADD) makes overlapping shapes add their light together, so crossings glow. In Ghost Arcade the layer\'s own blend mode does the same job between layers.',
    triggers: ['call:blendMode'], links: [ref('blendMode')],
  },

  // ── Pixels and the canvas underneath ───────────────────────────────────
  {
    id: 'createGraphics', category: 'pixels', title: 'createGraphics(): a canvas off screen',
    body: 'createGraphics(w, h) makes an extra canvas to draw into and later show with image(). Make it once in setup(): making a new one every frame eats memory.',
    triggers: ['call:createGraphics'], links: [ref('createGraphics')],
  },
  {
    id: 'pixels', category: 'pixels', title: 'loadPixels(): pixel by pixel',
    body: 'loadPixels() copies the canvas into the pixels array, four numbers (red, green, blue, alpha) per pixel, so each can be read or changed; updatePixels() puts them back. A full HD canvas has two million pixels, so doing this every frame is slow.',
    triggers: ['call:loadPixels', 'call:updatePixels', 'name:pixels', 'call:get', 'call:set'], links: [ref('loadPixels'), ref('pixels')],
  },
  {
    id: 'filter', category: 'pixels', title: 'filter(): whole-canvas effects',
    body: 'filter(BLUR), filter(INVERT) and the rest process every pixel on the processor, which is slow at full HD. Ghost Arcade\'s effects do the same on the graphics card, much faster.',
    triggers: ['call:filter'], links: [ref('filter')],
  },
  {
    id: 'drawingContext', category: 'pixels', title: 'drawingContext: the browser canvas underneath',
    body: 'drawingContext is the browser\'s own canvas drawing object that p5 uses underneath. It reaches features p5 does not wrap, such as drawing many lines as one Path2D or changing how new paint combines with old.',
    triggers: ['name:drawingContext'], links: [ref('drawingContext')],
  },

  // ── Input ──────────────────────────────────────────────────────────────
  {
    id: 'mouse', category: 'input', title: 'mouseX and mouseY: where the mouse is',
    body: 'mouseX and mouseY are the mouse position over the canvas. At a show nobody moves a mouse over a projection, so in Ghost Arcade they stay put; the Ghost Arcade tips show stand-ins.',
    triggers: ['name:mouseX', 'name:mouseY', 'name:pmouseX', 'name:pmouseY', 'name:mouseIsPressed', 'fn:mousePressed', 'fn:mouseMoved', 'fn:mouseDragged', 'fn:mouseClicked'],
    links: [ref('mouseX'), ref('mouseIsPressed')],
  },
  {
    id: 'keys', category: 'input', title: 'Keyboard input',
    body: 'keyPressed() and keyIsPressed react to the keyboard. Ghost Arcade does not pass keys to sketches during a show; a control or the music can do the same job.',
    triggers: ['fn:keyPressed', 'fn:keyReleased', 'name:keyIsPressed', 'call:keyIsDown'], links: [ref('keyPressed')],
  },

  // ── Size ───────────────────────────────────────────────────────────────
  {
    id: 'widthHeight', category: 'size', title: 'width and height: the canvas size',
    body: 'width and height are the canvas size in pixels. Writing positions as parts of them, width / 2 for the centre, keeps the picture right on any screen.',
    triggers: ['name:width', 'name:height'], links: [ref('width'), ref('height')],
  },
  {
    id: 'windowSize', category: 'size', title: 'windowWidth and windowHeight',
    body: 'The size of the window the sketch runs in. Ghost Arcade sizes that window to the output, so a canvas made from them fills the layer.',
    triggers: ['name:windowWidth', 'name:windowHeight'], links: [ref('windowWidth')],
  },

  // ── Ghost Arcade ───────────────────────────────────────────────────────
  {
    id: 'ghostParams', category: 'ghost', title: 'window.shaderParams: Ghost Arcade controls',
    body: 'window.shaderParams holds the current value of each of this sketch\'s controls. The sliders, switches and colour pickers in Ghost Arcade write into it while the sketch runs, and they can be mapped to MIDI or automated, so read it inside draw() every frame.',
    triggers: ['member:window.shaderParams'], links: [],
  },
  {
    id: 'ghostParamDefs', category: 'ghost', title: 'window.shaderParamDefs: which controls to show',
    body: 'window.shaderParamDefs lists the controls Ghost Arcade shows for this sketch: a name, label, type (number, boolean, color, text or select) and range for each. It must be plain data: numbers, strings, true and false, no maths.',
    triggers: ['member:window.shaderParamDefs'], links: [],
  },
  {
    id: 'ghostAudio', category: 'ghost', title: 'window.ghostAudio: the music',
    body: 'window.ghostAudio is the music Ghost Arcade is hearing, about 30 times a second: level, bass, mid, treble, high, beat, kick and snare from 0 to 1, plus bpm. Everything is 0 when nothing plays, so the sketch should still move without it.',
    triggers: ['member:window.ghostAudio'], links: [],
  },
  {
    id: 'p5sound', category: 'ghost', title: 'p5.sound: microphone and analyser',
    body: 'p5.AudioIn listens to a microphone and p5.FFT splits sound into frequencies. Ghost Arcade does not load p5.sound or give sketches a microphone; it sends its own audio analysis as window.ghostAudio instead.',
    triggers: ['new:p5.AudioIn', 'new:p5.FFT', 'new:p5.Amplitude'],
    links: [
      { label: 'p5.sound reference: p5.AudioIn', url: 'https://p5js.org/reference/p5.sound/p5.AudioIn/' },
      { label: 'p5.sound reference: p5.FFT', url: 'https://p5js.org/reference/p5.sound/p5.FFT/' },
    ],
  },
];

/** Extra reading suggested by what the sketch is made of. */
export const THEMES: Array<{ when: string[]; link: SketchLink }> = [
  { when: ['vectors', 'class'], link: NOC.forces },
  { when: ['class', 'arrays'], link: NOC.particles },
  { when: ['vectors', 'dist'], link: NOC.agents },
  { when: ['vectors', 'dist', 'arrays'], link: TRAIN.flocking },
  { when: ['pushPop', 'rotate', 'scale'], link: NOC.fractals },
];
