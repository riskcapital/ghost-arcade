import {describe,it,expect} from 'vitest';
import {readMobileCalibration} from './mobileCalibrationImport';
const quad=[{x:.1,y:.1},{x:.9,y:.1},{x:.9,y:.9},{x:.1,y:.9}];
const fixture=()=>({schema:'ghost-calibration',version:1,status:'prepared',name:'Stage',reference:{image:'data:image/jpeg;base64,AAAA'},projectors:[{id:'p',name:'Portrait',width:1080,height:1920,corners:structuredClone(quad),photoToProjector:[999]}],surfaces:[{id:'s',name:'Wall',points:structuredClone(quad)}]});
describe('phone calibration import',()=>{
 it('recomputes geometry from correspondences rather than trusting imported matrices',()=>{const p=readMobileCalibration(JSON.stringify(fixture())).projectors[0];expect(p.width).toBe(1080);expect(p.surfaces[0].corners![0].x).toBeCloseTo(0);expect(p.surfaces[0].corners![2].y).toBeCloseTo(1);});
 it('rejects degenerate projector geometry',()=>{const c=fixture();c.projectors[0].corners=quad.map(()=>({x:0,y:0}));expect(()=>readMobileCalibration(JSON.stringify(c))).toThrow();});
 it('keeps a polygon reviewable but does not offer corner calibration',()=>{const c=fixture();c.surfaces[0].points=quad.slice(0,3);expect(readMobileCalibration(JSON.stringify(c)).projectors[0].surfaces[0].corners).toBeNull();});
 it('does not accept remote images or unsupported versions',()=>{const c=fixture();c.reference.image='https://example.org/photo';expect(()=>readMobileCalibration(JSON.stringify(c))).toThrow();c.reference.image='data:image/jpeg;base64,AAAA';c.version=2;expect(()=>readMobileCalibration(JSON.stringify(c))).toThrow();});
 it('rejects invalid point payloads',()=>{const c=fixture();c.surfaces[0].points[0]={x:3,y:0};expect(()=>readMobileCalibration(JSON.stringify(c))).toThrow();});
 it('does not apply a crossed surface',()=>{const c=fixture();c.surfaces[0].points=[quad[0],quad[2],quad[1],quad[3]];expect(readMobileCalibration(JSON.stringify(c)).projectors[0].surfaces[0].corners).toBeNull();});
});
