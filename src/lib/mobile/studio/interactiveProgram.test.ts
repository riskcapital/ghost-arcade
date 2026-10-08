import {describe,it,expect,vi} from 'vitest';
import {InteractiveProgram} from './interactiveProgram';
describe('interactive program master safety',()=>{
 it('holds source frames but still permits blackout, master dimming and recovery',()=>{
  let captures=0,draws:number[]=[];const ctx={globalAlpha:1,globalCompositeOperation:'',fillStyle:'',fillRect:vi.fn(),drawImage(){draws.push(this.globalAlpha);}};
  const buffer={width:0,height:0,getContext:()=>({drawImage(){captures++;}})};
  vi.stubGlobal('document',{createElement:()=>buffer});
  try{const program=new InteractiveProgram(),source={width:960,height:540} as HTMLCanvasElement,target={width:960,height:540,getContext:()=>ctx} as unknown as HTMLCanvasElement;
   program.draw(source,target,{held:false,blackout:false,level:1});
   program.draw(source,target,{held:true,blackout:true,level:1});expect(draws).toEqual([1]);expect(captures).toBe(1);
   program.draw(source,target,{held:true,blackout:false,level:.3});expect(draws).toEqual([1,.3]);expect(captures).toBe(1);
   program.draw(source,target,{held:false,blackout:false,level:1});expect(captures).toBe(2);expect(ctx.fillRect).toHaveBeenCalledTimes(4);program.dispose();expect(buffer.width).toBe(0);
  }finally{vi.unstubAllGlobals();}
 });
});
