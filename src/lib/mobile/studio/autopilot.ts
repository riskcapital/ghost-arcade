import type {Clip,Show} from './model';
import type {ISFInput} from '../../isf/parser';
export function nextAutoClip(show:Show,row:number,random:boolean,rng=Math.random):Clip|undefined{
 const ids=[...new Set(show.launchGrid[row]||[])];
 const candidates=ids.map(id=>show.clips.find(c=>c.id===id)).filter((c):c is Clip=>!!c&&!['camera','depth'].includes(c.kind));
 if(!candidates.length)return;
 const current=show.layers[row].clipId,other=candidates.filter(c=>c.id!==current);
 if(!other.length)return;
 if(random)return other[Math.min(other.length-1,Math.floor(rng()*other.length))];
 const i=candidates.findIndex(c=>c.id===current);return candidates[(i+1)%candidates.length];
}
export function varyAutoParams(inputs:ISFInput[],params:Record<string,number|boolean|number[]>,amount:number,rng=Math.random){
 const next={...params};
 // Continuous controls only: no events, image inputs, hold switches or source changes.
 for(const p of inputs)if(p.TYPE==='float'&&Number.isFinite(p.MIN??0)&&Number.isFinite(p.MAX??1)){
  const min=p.MIN??0,max=p.MAX??1;if(max<=min)continue;
  const current=typeof params[p.NAME]==='number'?params[p.NAME] as number:typeof p.DEFAULT==='number'?p.DEFAULT:(min+max)/2;
  next[p.NAME]=Math.max(min,Math.min(max,current+(rng()-.5)*2*(max-min)*Math.max(0,Math.min(1,amount))));
 }
 return next;
}
