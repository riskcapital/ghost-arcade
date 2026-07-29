// Splat module - Point Cloud and Gaussian Splat layer support
// Exports PLY loader, native .splat loader, and Splat renderer

export {
  DEFAULT_SPLAT_POINT_BUDGET,
  loadPLY,
  loadPLYFromFile,
  parsePLYBuffer,
  parsePLYBufferProgressive,
} from './plyLoader';
export { loadSplatFromFile, loadSplatFromUrl, parseSplatBuffer } from './splatLoader';
export type { PLYData, PLYVertex } from './plyLoader';
export { SplatRenderer } from './SplatRenderer';
export {
  SPLAT_IMPORT_ORIENTATION_OPTIONS,
  bakeSplatManualRotationAsUpright,
  composeSplatRotationRadians,
  resolveSplatImportRotation,
  splatImportOrientationRotation,
  suggestSplatAutoLevel,
} from './splatTransform';
