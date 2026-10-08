/** Final clean-output controls apply after simulation, including while held.
 * Keep a source frame separate so blackout/level never destroy the held image. */
export class InteractiveProgram {
 private frame:HTMLCanvasElement|undefined;
 private captured=false;
 draw(source:HTMLCanvasElement,target:HTMLCanvasElement,options:{held:boolean;blackout:boolean;level:number}){
  this.frame??=document.createElement('canvas');
  if(this.frame.width!==source.width||this.frame.height!==source.height){this.frame.width=source.width;this.frame.height=source.height;this.captured=false;}
  if(!options.held||!this.captured){this.frame.getContext('2d')!.drawImage(source,0,0);this.captured=true;}
  const ctx=target.getContext('2d')!;ctx.globalCompositeOperation='source-over';ctx.globalAlpha=1;ctx.fillStyle='#000';ctx.fillRect(0,0,target.width,target.height);
  if(!options.blackout){ctx.globalAlpha=Number.isFinite(options.level)?Math.max(0,Math.min(1,options.level)):0;ctx.drawImage(this.frame,0,0,target.width,target.height);}
  ctx.globalAlpha=1;
 }
 dispose(){if(this.frame){this.frame.width=0;this.frame.height=0;}this.frame=undefined;this.captured=false;}
}
