export type EdgeEffectReact = {
  mode: string;
  source: string;
  amount: number;
  decay?: number;
  chaseBeats?: number;
  hueStep?: number;
};
export type EdgeEffect = {
  id: string;
  enabled: boolean;
  fill: Record<string, any>;
  stroke: Record<string, any>;
  animation: Record<string, any>;
  opacity: number;
  blendMode: string;
  chaseMode?: string;
  chaseSpread?: number;
  react?: EdgeEffectReact;
};
export type LookConfig = {
  id: string;
  palette: string;
  enabled: boolean;
  amount: number;
  speed: number;
  width: number;
  stroke?: string;
  fill?: string;
};
