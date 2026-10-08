import {invoke} from '$lib/bridge';
export type SourceSnapshot={width:number;height:number;rgba_b64?:string;format?:string;bytes_per_row?:number;padded_bytes_per_row?:number};
/** Decode a source readback, retaining alpha. Both Metal and Windows formats work. */
export function sourceSnapshotPixels(s:SourceSnapshot):Uint8ClampedArray<ArrayBuffer>|null{
 if(!s.rgba_b64||!s.width||!s.height)return null;
 const decode=(Uint8Array as any).fromBase64;
 const raw:Uint8Array=decode?decode(s.rgba_b64):Uint8Array.from(atob(s.rgba_b64),c=>c.charCodeAt(0));
 const stride=s.padded_bytes_per_row||s.bytes_per_row||s.width*4;
 if(raw.length<stride*(s.height-1)+s.width*4)return null;
 const out=new Uint8ClampedArray(s.width*s.height*4),bgra=/bgra/i.test(s.format??'');
 for(let y=0;y<s.height;y++)for(let x=0;x<s.width;x++){
  const a=y*stride+x*4,b=(y*s.width+x)*4;
  out[b]=raw[a+(bgra?2:0)];out[b+1]=raw[a+1];out[b+2]=raw[a+(bgra?0:2)];out[b+3]=raw[a+3];
 }
 return out;
}
/** Samples the selected source BEFORE output warp, from the existing GPU simulation.
 * One in-flight request per editor, and no readback when the editor is closed. */
export function createNativeSourcePreview(layerId:()=>string){
 let busy=false,retryAt=0;
 return async(canvas:HTMLCanvasElement):Promise<boolean>=>{
  if(busy||!layerId()||performance.now()<retryAt)return false;busy=true;const id=layerId();
  try{
   const s=await invoke('native_renderer_get_frame_snapshot',{layer_id:id,include_pixels:true,max_dim:960}) as SourceSnapshot|null;
   if(id!==layerId()||!canvas.isConnected||!s)return false;
   const pixels=sourceSnapshotPixels(s);if(!pixels)return false;
   if(canvas.width!==s.width)canvas.width=s.width;if(canvas.height!==s.height)canvas.height=s.height;
   canvas.getContext('2d')?.putImageData(new ImageData(pixels,s.width,s.height),0,0);return true;
  }catch{retryAt=performance.now()+1000;return false;}finally{busy=false;}
 };
}
