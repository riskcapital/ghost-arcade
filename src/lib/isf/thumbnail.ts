// Shader Thumbnail Generator
// Renders shader to an offscreen canvas to create thumbnail previews
// Uses a shared WebGL context to avoid exhausting GPU resources

import { parseISF, getInputDefault } from './parser';

const THUMBNAIL_WIDTH = 120;
const THUMBNAIL_HEIGHT = 68;

// Simple vertex shader
const vertexShaderSource = `
attribute vec2 position;
varying vec2 vUv;
void main() {
  vUv = position * 0.5 + 0.5;
  gl_Position = vec4(position, 0.0, 1.0);
}
`;

// Shared WebGL context for all thumbnail generation
// This avoids creating multiple contexts which can cause context loss
let sharedCanvas: HTMLCanvasElement | null = null;
let sharedGl: WebGLRenderingContext | null = null;
let sharedPositionBuffer: WebGLBuffer | null = null;

// Queue for thumbnail generation to avoid overwhelming GPU
let isGenerating = false;
const thumbnailQueue: Array<{
  shaderCode: string;
  time: number;
  resolve: (url: string) => void;
}> = [];

/**
 * Initialize or get the shared WebGL context
 */
function getSharedContext(): { canvas: HTMLCanvasElement; gl: WebGLRenderingContext; positionBuffer: WebGLBuffer } | null {
  // Check if context was lost
  if (sharedGl && sharedGl.isContextLost()) {
    console.warn('[Thumbnail] Shared context was lost, recreating');
    sharedCanvas = null;
    sharedGl = null;
    sharedPositionBuffer = null;
  }

  if (!sharedCanvas || !sharedGl) {
    sharedCanvas = document.createElement('canvas');
    sharedCanvas.width = THUMBNAIL_WIDTH;
    sharedCanvas.height = THUMBNAIL_HEIGHT;

    sharedGl = sharedCanvas.getContext('webgl', {
      preserveDrawingBuffer: true,
      alpha: false,
      antialias: false,
      powerPreference: 'low-power', // Use low power to reduce GPU strain
    });

    if (!sharedGl) {
      return null;
    }

    // Enable derivatives extension for shaders that need it
    sharedGl.getExtension('OES_standard_derivatives');

    // Create shared position buffer (fullscreen quad)
    sharedPositionBuffer = sharedGl.createBuffer();
    if (sharedPositionBuffer) {
      sharedGl.bindBuffer(sharedGl.ARRAY_BUFFER, sharedPositionBuffer);
      sharedGl.bufferData(
        sharedGl.ARRAY_BUFFER,
        new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]),
        sharedGl.STATIC_DRAW
      );
    }
  }

  if (!sharedPositionBuffer) {
    return null;
  }

  return { canvas: sharedCanvas, gl: sharedGl, positionBuffer: sharedPositionBuffer };
}

/**
 * Process the next item in the thumbnail queue
 */
async function processQueue() {
  if (isGenerating || thumbnailQueue.length === 0) {
    return;
  }

  isGenerating = true;

  const item = thumbnailQueue.shift()!;
  try {
    // Add a 5 second timeout to prevent any single shader from blocking the queue
    const thumbnail = await Promise.race([
      generateThumbnailInternal(item.shaderCode, item.time),
      new Promise<string>((resolve) => setTimeout(() => resolve(createFallbackThumbnail('#663399')), 5000))
    ]);
    item.resolve(thumbnail);
  } catch {
    item.resolve(createFallbackThumbnail('#ff0066'));
  }

  isGenerating = false;

  // Process next item after a short delay to let GPU breathe
  if (thumbnailQueue.length > 0) {
    setTimeout(processQueue, 16);
  }
}

/**
 * Generate a thumbnail image for a shader
 * @param shaderCode The ISF shader source code
 * @param time Optional time value for animation (default 0.5)
 * @returns Data URL of the thumbnail image
 */
export async function generateShaderThumbnail(
  shaderCode: string,
  time: number = 0.5
): Promise<string> {
  return new Promise((resolve) => {
    thumbnailQueue.push({ shaderCode, time, resolve });
    processQueue();
  });
}

/**
 * Internal function to generate thumbnail using shared context
 */
async function generateThumbnailInternal(
  shaderCode: string,
  time: number
): Promise<string> {
  try {
    const context = getSharedContext();
    if (!context) {
      return createFallbackThumbnail('#ff00aa');
    }

    const { canvas, gl, positionBuffer } = context;

    // Parse the shader
    const parsed = parseISF(shaderCode);
    const fragmentShaderSource = parsed.fragmentShader;

    // Create and compile vertex shader
    const vertexShader = gl.createShader(gl.VERTEX_SHADER);
    if (!vertexShader) {
      return createFallbackThumbnail('#ff00aa');
    }
    gl.shaderSource(vertexShader, vertexShaderSource);
    gl.compileShader(vertexShader);

    if (!gl.getShaderParameter(vertexShader, gl.COMPILE_STATUS)) {
      console.warn('Vertex shader error:', gl.getShaderInfoLog(vertexShader));
      gl.deleteShader(vertexShader);
      return createFallbackThumbnail('#ff00aa');
    }

    // Create and compile fragment shader
    const fragmentShader = gl.createShader(gl.FRAGMENT_SHADER);
    if (!fragmentShader) {
      gl.deleteShader(vertexShader);
      return createFallbackThumbnail('#ff00aa');
    }
    gl.shaderSource(fragmentShader, fragmentShaderSource);
    gl.compileShader(fragmentShader);

    if (!gl.getShaderParameter(fragmentShader, gl.COMPILE_STATUS)) {
      console.warn('Fragment shader error:', gl.getShaderInfoLog(fragmentShader));
      gl.deleteShader(vertexShader);
      gl.deleteShader(fragmentShader);
      return createFallbackThumbnail('#ff6600');
    }

    // Create program
    const program = gl.createProgram();
    if (!program) {
      gl.deleteShader(vertexShader);
      gl.deleteShader(fragmentShader);
      return createFallbackThumbnail('#ff00aa');
    }

    gl.attachShader(program, vertexShader);
    gl.attachShader(program, fragmentShader);
    gl.linkProgram(program);

    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      console.warn('Program link error:', gl.getProgramInfoLog(program));
      gl.deleteProgram(program);
      gl.deleteShader(vertexShader);
      gl.deleteShader(fragmentShader);
      return createFallbackThumbnail('#ff6600');
    }

    gl.useProgram(program);

    // Set up position attribute
    gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
    const positionLocation = gl.getAttribLocation(program, 'position');
    gl.enableVertexAttribArray(positionLocation);
    gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, 0, 0);

    // Set uniforms
    const renderSizeLocation = gl.getUniformLocation(program, 'RENDERSIZE');
    if (renderSizeLocation) {
      gl.uniform2f(renderSizeLocation, THUMBNAIL_WIDTH, THUMBNAIL_HEIGHT);
    }

    const timeLocation = gl.getUniformLocation(program, 'TIME');
    if (timeLocation) {
      gl.uniform1f(timeLocation, time);
    }

    const timeDeltaLocation = gl.getUniformLocation(program, 'TIMEDELTA');
    if (timeDeltaLocation) {
      gl.uniform1f(timeDeltaLocation, 0.016);
    }

    const frameIndexLocation = gl.getUniformLocation(program, 'FRAMEINDEX');
    if (frameIndexLocation) {
      gl.uniform1i(frameIndexLocation, Math.floor(time * 60));
    }

    const dateLocation = gl.getUniformLocation(program, 'DATE');
    if (dateLocation) {
      const now = new Date();
      gl.uniform4f(dateLocation, now.getFullYear(), now.getMonth(), now.getDate(), now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds());
    }

    // Set input uniforms with default values
    let nextTextureUnit = 0;
    const texturesToCleanup: WebGLTexture[] = [];

    for (const input of parsed.metadata.INPUTS) {
      const location = gl.getUniformLocation(program, input.NAME);
      if (!location) continue;

      const defaultValue = getInputDefault(input);

      switch (input.TYPE) {
        case 'float':
        case 'event':
          gl.uniform1f(location, defaultValue as number);
          break;
        case 'bool':
          gl.uniform1i(location, (defaultValue as boolean) ? 1 : 0);
          break;
        case 'long':
          gl.uniform1i(location, defaultValue as number);
          break;
        case 'point2D':
          const p2d = defaultValue as number[];
          gl.uniform2f(location, p2d[0], p2d[1]);
          break;
        case 'color':
          const col = defaultValue as number[];
          gl.uniform4f(location, col[0], col[1], col[2], col[3] ?? 1.0);
          break;
        case 'image': {
          // Create a gradient test texture so image-processing shaders render something
          const tex = gl.createTexture();
          if (tex) {
            const texUnit = nextTextureUnit++;
            gl.activeTexture(gl.TEXTURE0 + texUnit);
            gl.bindTexture(gl.TEXTURE_2D, tex);
            // Generate a 16x16 gradient test pattern
            const size = 16;
            const pixels = new Uint8Array(size * size * 4);
            for (let y = 0; y < size; y++) {
              for (let x = 0; x < size; x++) {
                const i = (y * size + x) * 4;
                pixels[i]     = Math.floor((x / size) * 200 + 55); // R: horizontal gradient
                pixels[i + 1] = Math.floor((y / size) * 200 + 55); // G: vertical gradient
                pixels[i + 2] = Math.floor(((x + y) / (size * 2)) * 200 + 55); // B: diagonal
                pixels[i + 3] = 255;
              }
            }
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, size, size, 0, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
            gl.uniform1i(location, texUnit);
            texturesToCleanup.push(tex);

            // Also set the _imgSize uniform if present
            const imgSizeLocation = gl.getUniformLocation(program, `_${input.NAME}_imgSize`);
            if (imgSizeLocation) {
              gl.uniform2f(imgSizeLocation, THUMBNAIL_WIDTH, THUMBNAIL_HEIGHT);
            }
          }
          break;
        }
      }
    }

    // Set audio uniforms to 0 (injected by parser for all ISF shaders)
    const audioFloatNames = [
      'audioLevel', 'audioBass', 'audioMid', 'audioHigh',
      'audioBeat', 'audioBeatPhase', 'audioBPM', 'audioSpectralCentroid'
    ];
    for (const name of audioFloatNames) {
      const loc = gl.getUniformLocation(program, name);
      if (loc) gl.uniform1f(loc, 0.0);
    }

    // Create tiny black textures for audio sampler2D uniforms
    for (const samplerName of ['audioFFT', 'audioWaveform']) {
      const loc = gl.getUniformLocation(program, samplerName);
      if (loc) {
        const tex = gl.createTexture();
        if (tex) {
          const texUnit = nextTextureUnit++;
          gl.activeTexture(gl.TEXTURE0 + texUnit);
          gl.bindTexture(gl.TEXTURE_2D, tex);
          gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 255]));
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
          gl.uniform1i(loc, texUnit);
          texturesToCleanup.push(tex);
        }
      }
    }

    // Render
    gl.viewport(0, 0, THUMBNAIL_WIDTH, THUMBNAIL_HEIGHT);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    // Get data URL
    const dataUrl = canvas.toDataURL('image/jpeg', 0.8);

    // Cleanup shader resources (but keep shared context)
    for (const tex of texturesToCleanup) {
      gl.deleteTexture(tex);
    }
    gl.deleteProgram(program);
    gl.deleteShader(vertexShader);
    gl.deleteShader(fragmentShader);

    return dataUrl;
  } catch (err) {
    console.warn('Failed to generate shader thumbnail:', err);
    return createFallbackThumbnail('#ff00aa');
  }
}

/**
 * Create a simple gradient fallback thumbnail
 */
function createFallbackThumbnail(color: string): string {
  const canvas = document.createElement('canvas');
  canvas.width = THUMBNAIL_WIDTH;
  canvas.height = THUMBNAIL_HEIGHT;
  const ctx = canvas.getContext('2d');

  if (ctx) {
    // Create gradient background
    const gradient = ctx.createLinearGradient(0, 0, THUMBNAIL_WIDTH, THUMBNAIL_HEIGHT);
    gradient.addColorStop(0, color + '33');
    gradient.addColorStop(1, color + '88');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, THUMBNAIL_WIDTH, THUMBNAIL_HEIGHT);

    // Draw shader icon
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2;
    ctx.beginPath();
    const cx = THUMBNAIL_WIDTH / 2;
    const cy = THUMBNAIL_HEIGHT / 2;
    const size = 16;
    // Hexagon shape
    for (let i = 0; i < 6; i++) {
      const angle = (i * Math.PI) / 3 - Math.PI / 6;
      const x = cx + Math.cos(angle) * size;
      const y = cy + Math.sin(angle) * size;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.stroke();
  }

  return canvas.toDataURL('image/jpeg', 0.8);
}

// ── Thumbnail Cache (IndexedDB) ──────────────────────────────────
const CACHE_DB_NAME = 'sv-thumbnail-cache';
const CACHE_STORE_NAME = 'thumbnails';
const CACHE_DB_VERSION = 1;

let cacheDb: IDBDatabase | null = null;

function openCacheDB(): Promise<IDBDatabase> {
  if (cacheDb) return Promise.resolve(cacheDb);
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(CACHE_DB_NAME, CACHE_DB_VERSION);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(CACHE_STORE_NAME);
    };
    req.onsuccess = () => { cacheDb = req.result; resolve(cacheDb); };
    req.onerror = () => reject(req.error);
  });
}

/** Simple hash for cache keys — fast, not cryptographic */
function hashCode(str: string): string {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = ((h << 5) - h + str.charCodeAt(i)) | 0;
  }
  return 'thumb_' + (h >>> 0).toString(36);
}

async function getCachedThumbnail(key: string): Promise<string | null> {
  try {
    const db = await openCacheDB();
    return new Promise((resolve) => {
      const tx = db.transaction(CACHE_STORE_NAME, 'readonly');
      const req = tx.objectStore(CACHE_STORE_NAME).get(key);
      req.onsuccess = () => resolve(req.result ?? null);
      req.onerror = () => resolve(null);
    });
  } catch { return null; }
}

async function setCachedThumbnail(key: string, dataUrl: string): Promise<void> {
  try {
    const db = await openCacheDB();
    const tx = db.transaction(CACHE_STORE_NAME, 'readwrite');
    tx.objectStore(CACHE_STORE_NAME).put(dataUrl, key);
  } catch { /* ignore cache write failures */ }
}

/**
 * Generate a thumbnail with cache support.
 * Returns cached version if available, otherwise generates and caches.
 */
export async function generateCachedThumbnail(
  shaderCode: string,
  time: number = 0.5
): Promise<string> {
  const key = hashCode(shaderCode);
  const cached = await getCachedThumbnail(key);
  if (cached) return cached;
  const thumb = await generateShaderThumbnail(shaderCode, time);
  await setCachedThumbnail(key, thumb);
  return thumb;
}

/**
 * Generate thumbnails for multiple shaders with a delay between each
 * to avoid overwhelming the GPU
 */
export async function generateShaderThumbnails(
  shaders: Array<{ id: string; shaderCode: string }>,
  onProgress?: (id: string, thumbnail: string) => void
): Promise<Map<string, string>> {
  const thumbnails = new Map<string, string>();

  for (const shader of shaders) {
    const thumbnail = await generateCachedThumbnail(shader.shaderCode);
    thumbnails.set(shader.id, thumbnail);

    if (onProgress) {
      onProgress(shader.id, thumbnail);
    }

    // Small delay between renders to not block the main thread
    await new Promise((resolve) => setTimeout(resolve, 10));
  }

  return thumbnails;
}

/**
 * Dispose of shared thumbnail resources
 * Call this when the app is being destroyed
 */
export function disposeThumbnailResources(): void {
  if (sharedGl && sharedPositionBuffer) {
    sharedGl.deleteBuffer(sharedPositionBuffer);
  }
  sharedCanvas = null;
  sharedGl = null;
  sharedPositionBuffer = null;
  thumbnailQueue.length = 0;
}
