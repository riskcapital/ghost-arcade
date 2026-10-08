import {describe,it,expect} from 'vitest';
import {newSurface} from './model';
import {hitMappingScreens,snapMappingPoint} from './mappingInteraction';
describe('mapping interaction',()=>{
 it('selects rendered shapes top first, including locked but excluding hidden screens',()=>{
  const a=newSurface(0), b=newSurface(1);a.points=a.points.map(p=>({x:p.x*.4,y:p.y}));b.points=a.points.map(p=>({...p}));b.locked=true;
  expect(hitMappingScreens({x:.2,y:.5},[a,b])).toEqual([1,0]);
  expect(hitMappingScreens({x:.9,y:.5},[a,b])).toEqual([]);
  b.enabled=false;expect(hitMappingScreens({x:.2,y:.5},[a,b])).toEqual([0]);
 });
 it('snaps within a visual threshold and leaves distant points alone',()=>{
  expect(snapMappingPoint({x:.255,y:.45},[],0,1000,562.5)).toEqual({x:.25,y:4/9});
  expect(snapMappingPoint({x:.28,y:.48},[],0,1000,562.5)).toEqual({x:.28,y:.48});
 });
});
