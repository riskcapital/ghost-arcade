import { parseCubeLut } from './cubeLut';
self.onmessage = (event: MessageEvent<{ text: string; name: string }>) => {
  try { self.postMessage({ lut: parseCubeLut(event.data.text, event.data.name) }); }
  catch (error) { self.postMessage({ error: error instanceof Error ? error.message : 'Could not read this LUT.' }); }
};
