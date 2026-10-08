import { describe, it, expect } from 'vitest';
import { defaultProjectorCorners, inverseProjectorHomography, projectorCalibrationUniforms, pairedOverlapPatches, overlapPartner, overlapPairInStep, nudgeProjectorCorner, overlapGamma } from './projectorCalibration';
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
  const band={enabled:true,side:'left' as const,startTop:.46,startBottom:.4,endTop:.54,endBottom:.6};
  it('keeps both Screens of a pair on one band, with crops that cover it and opposite sides',()=>{
    const patches=pairedOverlapPatches({...band,gamma:2.6},'a','b');
    expect(patches.a).toMatchObject({cropX:0,cropW:.6,overlapBand:{side:'left',partnerId:'b',startTop:.46,endBottom:.6,gamma:2.6}});
    expect(patches.b.cropX).toBeCloseTo(.4,10); expect(patches.b.cropW).toBeCloseTo(.6,10);
    expect(patches.b.overlapBand).toMatchObject({side:'right',partnerId:'a',startTop:.46,endBottom:.6,gamma:2.6});
    // Pairing from the right-hand Screen gives the same two patches.
    expect(pairedOverlapPatches({...band,side:'right',gamma:2.6},'b','a')).toEqual(patches);
    const screens=[{id:'a',...patches.a},{id:'b',...patches.b},{id:'c'}];
    expect(overlapPartner(screens[0],screens)?.id).toBe('b');
    expect(overlapPairInStep(screens[0],screens[1])).toBe(true);
    // A boundary edit on one Screen alone, or a moved crop, is out of step.
    expect(overlapPairInStep({...screens[0],overlapBand:{...patches.a.overlapBand,endTop:.56}},screens[1])).toBe(false);
    expect(overlapPairInStep(screens[0],{...screens[1],cropX:.3})).toBe(false);
  });
  it('finds the partner of a pair made before partner ids were stored, and none once it is deleted',()=>{
    const a={id:'a',overlapBand:{...band}}, b={id:'b',overlapBand:{...band,side:'right' as const}};
    expect(overlapPartner(a,[a,b])?.id).toBe('b');
    expect(overlapPartner(a,[a])).toBeNull();
    expect(overlapPartner({id:'a',overlapBand:{...band,partnerId:'gone'}},[a,b])).toBeNull();
    // A disabled band still remembers its partner, so re-enabling restores the pair.
    expect(overlapPartner({id:'a',overlapBand:{...band,enabled:false,partnerId:'b'}},[a,b])?.id).toBe('b');
  });
  it('sends the blend shape only for a non-default gamma, so existing projects render unchanged',()=>{
    expect(projectorCalibrationUniforms({overlapBand:band})[4]).toEqual([1,0,0,0]);
    expect(projectorCalibrationUniforms({overlapBand:{...band,gamma:2.2}})[4]).toEqual([1,0,0,0]);
    expect(projectorCalibrationUniforms({overlapBand:{...band,side:'right',gamma:2.75}})[4][2]).toBeCloseTo(.8,10);
    expect(overlapGamma({gamma:NaN})).toBe(2.2); expect(overlapGamma({gamma:9})).toBe(4);
  });
  it('nudges one corner by exact output pixels',()=>{
    const moved=nudgeProjectorCorner(defaultProjectorCorners(),1,-1,10,1080,1920);
    expect(moved[1].x).toBeCloseTo(1-1/1080,12); expect(moved[1].y).toBeCloseTo(10/1920,12);
    expect(moved[0]).toEqual({x:0,y:0}); expect(moved[2]).toEqual({x:1,y:1});
  });
});
