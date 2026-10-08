/** A shared live camera prevents duplicate captures when one feed occupies multiple layers. */
let capture: {facing:string;stream:MediaStream;users:number}|undefined;
let opening=false;
let openingStream:Promise<MediaStream>|undefined;
let cameraEpoch=0;
/** Wait out a pending permission/capture request before handing camera ownership to ARKit/MultiCam. */
export async function releaseCamerasForToolkit(){
 cameraEpoch++;
 const pending=openingStream;
 capture?.stream.getTracks().forEach(t=>t.stop());capture=undefined;
 if(pending){try{const stream=await pending;stream.getTracks().forEach(t=>t.stop());}catch{/* Permission denial still releases ownership. */}}
}
export async function acquireCamera(facing:'user'|'environment') {
 if(opening)throw new Error('The camera is opening. Try this pad again in a moment.');
 if(capture?.facing!==facing && capture)throw new Error('Stop the other camera pads before switching front/rear. Simultaneous cameras need the native multi-camera path.');
 if(!capture){
  if(!navigator.mediaDevices?.getUserMedia)throw new Error('Live camera is unavailable here. Open the installed app or a secure browser.');
  opening=true;const epoch=cameraEpoch;
  try{
   openingStream=navigator.mediaDevices.getUserMedia({audio:false,video:{facingMode:{ideal:facing},width:{ideal:1280},height:{ideal:720},frameRate:{ideal:30,max:30}}});
   const stream=await openingStream;
   if(epoch!==cameraEpoch){stream.getTracks().forEach(t=>t.stop());throw new Error('Camera launch canceled for native capture.');}
   capture={facing,users:0,stream};
  }
  catch(e){throw new Error(e instanceof DOMException&&e.name==='NotAllowedError'?'Camera access was denied. Enable camera access in device settings, then launch the pad again.':'Could not open the camera. Close other camera apps and try again.');}
  finally{opening=false;openingStream=undefined;}
 }
 const current=capture;current.users++;let released=false;
 return {stream:current.stream,release:()=>{if(released)return;released=true;if(--current.users===0){current.stream.getTracks().forEach(t=>t.stop());if(capture===current)capture=undefined;}}};
}
