import noise from './noise.wgsl?raw';
import color from './color.wgsl?raw';
import tonemap from './tonemap.wgsl?raw';
import camera from './camera.wgsl?raw';
import sdf from './sdf.wgsl?raw';
import lighting from './lighting.wgsl?raw';
import simulation from './simulation.wgsl?raw';
import audio from './audio.wgsl?raw';

export type WgslStdlibName =
  | 'noise'
  | 'color'
  | 'tonemap'
  | 'camera'
  | 'sdf'
  | 'lighting'
  | 'simulation'
  | 'audio';

export const WGSL_STDLIB: Readonly<Record<WgslStdlibName, string>> = Object.freeze({
  noise,
  color,
  tonemap,
  camera,
  sdf,
  lighting,
  simulation,
  audio,
});

export function getWgslStdlibModule(name: string): string | undefined {
  const normalized = name.trim().replace(/^\.?\//, '').replace(/\.wgsl$/i, '');
  return (WGSL_STDLIB as Record<string, string>)[normalized];
}
