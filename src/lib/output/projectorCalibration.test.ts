import { describe, it, expect } from 'vitest';
import { defaultProjectorCorners, inverseProjectorHomography, projectorCalibrationUniforms } from './projectorCalibration';
describe('projector calibration',()=>{
  it('maps all four destination corners back to their source corners with perspective correction',()=>{
    const corners=[{x:.2,y:.1},{x:.85,y:.2},{x:.95,y:.9},{x:.05,y:.95}];
    const h=inverseProjectorHomography(corners)!;
    corners.forEach((p,i)=>{const z=h[6]*p.x+h[7]*p.y+h[8]; const q=defaultProjectorCorners()[i];expect((h[0]*p.x+h[1]*p.y+h[2])/z).toBeCloseTo(q.x,8);expect((h[3]*p.x+h[4]*p.y+h[5])/z).toBeCloseTo(q.y,8);});
  });
  it('keeps old projects unchanged and rejects folds instead of projecting invalid content',()=>{
    expect(projectorCalibrationUniforms({})[2][3]).toBe(0);
    expect(projectorCalibrationUniforms({projectorCalibration:{enabled:true,corners:[{x:0,y:0},{x:1,y:1},{x:1,y:0},{x:0,y:1}]}})[2][3]).toBe(-1);
    expect(inverseProjectorHomography(Array(4).fill({x:0,y:0}))).toBeNull();
  });
});
