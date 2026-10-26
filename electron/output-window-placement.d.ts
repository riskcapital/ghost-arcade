type Rect = { x: number; y: number; width: number; height: number };
export function physicalOutputWindowConfig<T extends Record<string, unknown> | null | undefined>(
  config: T,
  dipToScreenRect: (rect: Rect) => Rect,
): T;
export function physicalOutputWindowArgs<T>(args: T, dipToScreenRect: (rect: Rect) => Rect): T;
