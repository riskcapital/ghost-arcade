import { describe, expect, it } from 'vitest';
import {
  azElOf,
  directionAt,
  directionOf,
  domeLensOf,
  domePointToFrame,
  domeSourceOf,
  framePointToDome,
  insideViewDirection,
  insideViewPoint,
  lensRadius,
  lensTheta,
  nativeDomeStage,
  placedCanvasDirection,
  placedCanvasUv,
  pointOf,
  type DomeLens,
} from './domeMath';

const close = (a: number, b: number, eps = 1e-6) => expect(Math.abs(a - b)).toBeLessThan(eps);

describe('dome settings', () => {
  it('reads the old Equirectangular 360 mode as a panorama wrap with an angular lens', () => {
    expect(domeSourceOf({ domeMode: 'equirectangular' })).toBe('panorama');
    expect(domeLensOf({ domeMode: 'equirectangular' })).toBe('angular');
    const stage = nativeDomeStage({ domeEnabled: true, domeMode: 'equirectangular' });
    expect(stage.domeSource).toBe(1);
    expect(stage.domeMode).toBe(0);
  });

  it('keeps older angular settings as the flat view they always were', () => {
    expect(domeSourceOf({ domeMode: 'angular' })).toBe('flat');
    expect(domeSourceOf({ domeMode: 'stereographic', domeSource: 'domemaster' })).toBe('domemaster');
    expect(nativeDomeStage({ domeMode: 'orthographic' }).domeMode).toBe(2);
  });

  it('sends the grid as a strength and the canvas angle that suits the kind', () => {
    expect(nativeDomeStage({ domeGrid: true }).domeGrid).toBeGreaterThan(0);
    expect(nativeDomeStage({}).domeGrid).toBe(0);
    expect(nativeDomeStage({ domeSource: 'domemaster' }).domeSourceAngle).toBe(180);
    expect(nativeDomeStage({ domeSource: 'flat', domeSourceAngle: 120 }).domeSourceAngle).toBe(120);
  });
});

describe('dome lens', () => {
  it.each<DomeLens>(['angular', 'stereographic', 'orthographic'])('%s radius and angle invert each other', (lens) => {
    for (const fov of [180, 210]) {
      for (const r of [0, 0.2, 0.55, 0.9]) {
        close(lensRadius(lensTheta(r, lens, fov), lens, fov), r, 1e-5);
      }
    }
  });

  it('puts the rim of a 180 degree angular dome on the horizon and the center at the zenith', () => {
    close(directionAt({ x: 0, y: 0 }, 'angular', 180)[2], 1);
    close(directionAt({ x: 0, y: -1 }, 'angular', 180)[2], 0);
    // -y in the dome picture is the front.
    const front = azElOf(directionAt({ x: 0, y: -0.5 }, 'angular', 180));
    close(front.azimuth, 0);
    close(front.elevation, 45);
    // +x is the audience's right.
    close(azElOf(directionAt({ x: 0.5, y: 0 }, 'angular', 180)).azimuth, 90);
  });

  it('finds a direction back in the dome picture', () => {
    const m = pointOf(directionOf(30, 40), 'angular', 180)!;
    const back = azElOf(directionAt(m, 'angular', 180));
    close(back.azimuth, 30, 1e-5);
    close(back.elevation, 40, 1e-5);
    expect(pointOf(directionOf(0, -20), 'angular', 180)).toBeNull();
  });
});

describe('dome picture in the frame', () => {
  it('maps frame UV to the dome picture and back, with offset and rotation', () => {
    const out = { domeOffsetX: 0.1, domeOffsetY: -0.2, domeRotation: 33 };
    for (const aspect of [16 / 9, 0.75]) {
      const uv = { x: 0.31, y: 0.62 };
      const back = domePointToFrame(framePointToDome(uv, aspect, out), aspect, out);
      close(back.x, uv.x);
      close(back.y, uv.y);
    }
  });

  it('fits the circle to the short side of the frame', () => {
    const top = domePointToFrame({ x: 0, y: 1 }, 16 / 9, {});
    close(top.y, 1);
    close(top.x, 0.5);
  });
});

describe('layers placed on the dome', () => {
  const place = { azimuth: 40, elevation: 55, size: 50, roll: 20 };

  it('sees a placed canvas point back where it was put', () => {
    for (const uv of [{ x: 0.5, y: 0.5 }, { x: 0, y: 1 }, { x: 0.8, y: 0.2 }]) {
      const back = placedCanvasUv(placedCanvasDirection(uv, place, 16 / 9), place, 16 / 9)!;
      close(back.x, uv.x, 1e-6);
      close(back.y, uv.y, 1e-6);
    }
  });

  it('centers the canvas on the placement', () => {
    const center = azElOf(placedCanvasDirection({ x: 0.5, y: 0.5 }, place, 16 / 9));
    close(center.azimuth, 40, 1e-6);
    close(center.elevation, 55, 1e-6);
  });

  it('spans its size across the canvas width', () => {
    const level = { ...place, roll: 0, elevation: 0, azimuth: 0 };
    const left = azElOf(placedCanvasDirection({ x: 0, y: 0.5 }, level, 16 / 9));
    const right = azElOf(placedCanvasDirection({ x: 1, y: 0.5 }, level, 16 / 9));
    close(right.azimuth - left.azimuth, 50, 1e-6);
  });

  it('keeps the canvas top towards the zenith when it sits in front', () => {
    const front = { azimuth: 0, elevation: 20, size: 40, roll: 0 };
    const top = azElOf(placedCanvasDirection({ x: 0.5, y: 1 }, front, 1));
    const bottom = azElOf(placedCanvasDirection({ x: 0.5, y: 0 }, front, 1));
    expect(top.elevation).toBeGreaterThan(bottom.elevation);
  });

  it('sees nothing behind the placement', () => {
    expect(placedCanvasUv(directionOf(220, -55), place, 1)).toBeNull();
  });
});

describe('the Inside view camera', () => {
  const camera = { azimuth: 25, elevation: 40, fov: 80 };

  it('looks where it is pointed, through the middle of the frame', () => {
    const middle = azElOf(insideViewDirection({ x: 0.5, y: 0.5 }, camera, 16 / 9));
    close(middle.azimuth, 25, 1e-6);
    close(middle.elevation, 40, 1e-6);
  });

  it('finds a point of the frame again from its direction', () => {
    for (const uv of [{ x: 0.1, y: 0.9 }, { x: 0.7, y: 0.3 }]) {
      const back = insideViewPoint(insideViewDirection(uv, camera, 16 / 9), camera, 16 / 9)!;
      close(back.x, uv.x, 1e-9);
      close(back.y, uv.y, 1e-9);
    }
  });

  it('puts up at the top and the audience’s right on the right', () => {
    const top = azElOf(insideViewDirection({ x: 0.5, y: 1 }, camera, 1));
    expect(top.elevation).toBeGreaterThan(40);
    const right = azElOf(insideViewDirection({ x: 1, y: 0.5 }, { azimuth: 0, elevation: 0, fov: 60 }, 1));
    expect(right.azimuth).toBeGreaterThan(0);
  });

  it('sees nothing behind the camera', () => {
    expect(insideViewPoint(directionOf(205, -40), camera, 1)).toBeNull();
  });
});
