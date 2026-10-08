import {invoke} from '$lib/bridge';
export type SourceSnapshot={width:number;height:number;rgba_b64?:string;jpeg_b64?:string;format?:string;bytes_per_row?:number;padded_bytes_per_row?:number};
function base64Bytes(b64:string):Uint8Array{
 const decode=(Uint8Array as any).fromBase64;
 return decode?decode(b64):Uint8Array.from(atob(b64),c=>c.charCodeAt(0));
}
/** Decode a source readback, retaining alpha. Both Metal and Windows formats work.
 * The core sends rows either packed or padded to the GPU copy alignment and
 * reports both strides, so the stride is taken from the data length. */
export function sourceSnapshotPixels(s:SourceSnapshot):Uint8ClampedArray<ArrayBuffer>|null{
 if(!s.rgba_b64||!s.width||!s.height)return null;
 const raw=base64Bytes(s.rgba_b64),row=s.width*4;
 const fits=(stride:number|undefined)=>!!stride&&stride>=row&&raw.length>=stride*(s.height-1)+row;
 const stride=fits(s.padded_bytes_per_row)?s.padded_bytes_per_row!:fits(s.bytes_per_row)?s.bytes_per_row!:fits(row)?row:0;
 if(!stride)return null;
 const out=new Uint8ClampedArray(s.width*s.height*4),bgra=/bgra/i.test(s.format??'');
 for(let y=0;y<s.height;y++)for(let x=0;x<s.width;x++){
  const a=y*stride+x*4,b=(y*s.width+x)*4;
  out[b]=raw[a+(bgra?2:0)];out[b+1]=raw[a+1];out[b+2]=raw[a+(bgra?0:2)];out[b+3]=raw[a+3];
 }
 return out;
}
/** Longest side the editor ever asks for (the old fixed request). */
export const PREVIEW_MAX_DIM=960;
/** The snapshot size for a preview shown at `cssWidth` x `cssHeight`: what is
 * on screen, with a little extra on dense displays, never more than the old
 * fixed 960 and never the square source texture. */
export function previewRequestSize(cssWidth:number,cssHeight:number,pixelRatio=1):{width:number;height:number}{
 if(!(cssWidth>0)||!(cssHeight>0))return {width:480,height:270};
 const density=Math.max(1,Math.min(1.5,pixelRatio||1));
 const scale=Math.min(density,PREVIEW_MAX_DIM/Math.max(cssWidth,cssHeight));
 const even=(v:number)=>Math.max(64,Math.round(v*scale/2)*2);
 return {width:even(cssWidth),height:even(cssHeight)};
}
/** Fastest the preview refreshes, and the slowest it backs off to. */
export const PREVIEW_MIN_INTERVAL_MS=1000/30,PREVIEW_MAX_INTERVAL_MS=250;
/** Wait at least twice the last round trip, so the readback never takes more
 * than about half of the render core's attention however slow it gets. */
export function previewInterval(roundTripMs:number):number{
 return Math.max(PREVIEW_MIN_INTERVAL_MS,Math.min(PREVIEW_MAX_INTERVAL_MS,roundTripMs*2));
}
const STILL_READS=3,STILL_READ_GAP_MS=150;
export type NativeSourcePreviewOptions={
 /** Layer whose source is shown; empty when there is none. */
 layerId:()=>string;
 /** False while there is nothing worth reading: the editor is hidden, the
  * layer is stopped or gone. No request is made. */
 live?:()=>boolean;
 /** Non-null while the picture cannot change by itself (paused, empty). It is
  * then read once per distinct key instead of continuously. */
 stillKey?:()=>string|null;
};
type PreviewCanvas=Pick<HTMLCanvasElement,'width'|'height'|'isConnected'|'clientWidth'|'clientHeight'|'getContext'>;
async function paintSnapshot(canvas:PreviewCanvas,s:SourceSnapshot):Promise<boolean>{
 const context=canvas.getContext('2d') as CanvasRenderingContext2D|null;if(!context)return false;
 const size=()=>{if(canvas.width!==s.width)canvas.width=s.width;if(canvas.height!==s.height)canvas.height=s.height;};
 if(s.jpeg_b64){
  const bitmap=await createImageBitmap(new Blob([base64Bytes(s.jpeg_b64) as Uint8Array<ArrayBuffer>],{type:'image/jpeg'}));
  if(!canvas.isConnected){bitmap.close();return false;}
  size();context.drawImage(bitmap,0,0);bitmap.close();return true;
 }
 const pixels=sourceSnapshotPixels(s);if(!pixels)return false;
 // The source frame is premultiplied: over the editor's black stage its
 // colour is already right, so show it opaque instead of dimming it twice.
 for(let i=3;i<pixels.length;i+=4)pixels[i]=255;
 size();context.putImageData(new ImageData(pixels,s.width,s.height),0,0);return true;
}
/** Samples the selected source BEFORE output warp, from the existing GPU simulation.
 * One request in flight per editor, sized to the preview on screen, paced by
 * its own round-trip time, and none at all while there is nothing to show.
 * Resolves true while the canvas shows a current picture. */
export function createNativeSourcePreview(target:(()=>string)|NativeSourcePreviewOptions){
 const options:NativeSourcePreviewOptions=typeof target==='function'?{layerId:target}:target;
 let busy=false,nextAt=0,shownId='',shownStill:string|null=null,stillReads=0;
 return async(canvas:PreviewCanvas):Promise<boolean>=>{
  const id=options.layerId();
  if(!id||options.live?.()===false){shownId='';shownStill=null;return false;}
  const shown=shownId===id;
  if(busy)return shown;
  const now=performance.now();if(now<nextAt)return shown;
  const still=options.stillKey?.()??null;
  // An edit reaches the output a frame or two after it is made, so a still
  // picture is read a few times before the preview settles on it.
  const settling=shown&&still!==null&&still===shownStill;
  if(settling&&stillReads>=STILL_READS)return true;
  busy=true;
  try{
   const size=previewRequestSize(canvas.clientWidth,canvas.clientHeight,globalThis.devicePixelRatio);
   const s=await invoke('native_renderer_get_frame_snapshot',{layer_id:id,include_pixels:true,...size,max_dim:Math.max(size.width,size.height),encoding:'jpeg',quality:82}) as SourceSnapshot|null;
   if(id!==options.layerId()||!canvas.isConnected||!s||!await paintSnapshot(canvas,s)){if(shownId!==id)shownId='';return shownId===id;}
   shownId=id;stillReads=settling?stillReads+1:1;shownStill=still;
   nextAt=now+Math.max(still!==null?STILL_READ_GAP_MS:0,previewInterval(performance.now()-now));
   return true;
  }catch{nextAt=performance.now()+1000;shownId='';return false;}finally{busy=false;}
 };
}
