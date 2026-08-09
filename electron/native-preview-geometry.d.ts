export interface NativePreviewRect {
  x: number;
  y: number;
  width: number;
  height: number;
  contentX: number;
  contentY: number;
  contentWidth: number;
  contentHeight: number;
  generation: number;
}

export interface NativePreviewGeometryStatus {
  attached?: boolean;
  geometryGeneration?: number;
  viewX?: number;
  viewY?: number;
  viewWidth?: number;
  viewHeight?: number;
  contentX?: number;
  contentY?: number;
  contentWidth?: number;
  contentHeight?: number;
}

export function normalizeNativePreviewRect(
  rect?: Partial<NativePreviewRect>,
  generation?: number,
): NativePreviewRect;

export function nativePreviewRectSignature(rect: NativePreviewRect): string;

export function nativePreviewGeometryMatches(
  rect: NativePreviewRect,
  status: NativePreviewGeometryStatus | null | undefined,
  tolerance?: number,
): boolean;
