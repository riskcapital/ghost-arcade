export const WIDTH: number;
export const HEIGHT: number;
export const SCENE_SHADER: string;
export const POST_SHADER: string;

export interface SceneState {
  eye: number[];
  view: { m: number[]; right: number[]; up: number[] };
  viewProj: number[];
  lightViewProj: number[];
}
export interface SceneGraph {
  config: Record<string, unknown>;
  state: SceneState;
  out: string;
}
export interface Pixels { w: number; h: number; rgba: Buffer }

export function snapshotPixels(snap: Record<string, unknown>): Pixels;
export function lumaAt(img: Pixels, x: number, y: number, radius?: number): number;
export function shaderSources(): Record<string, string>;

export const SHADOW_TEST_CASES: Record<'lit' | 'shadowed' | 'empty', { shadows: boolean; occluders: boolean }>;
export function shadowTestGraph(name: string): SceneGraph;
export function shadowTestResult(
  shots: Record<string, Pixels>,
  state: SceneState,
  width?: number,
  height?: number,
): {
  shadow_point_lit: number;
  darkening: number;
  control_change: number;
  no_occluder_change: number;
  pass: boolean;
  [key: string]: unknown;
};
