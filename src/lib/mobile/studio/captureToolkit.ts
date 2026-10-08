export type CaptureCapabilities = { lidar: boolean; dualCamera: boolean; platform: string };
export type SavedScan = { id: string; name: string; points: number; bytes: number; created: string; mode: string; url: string; thumbnail: string; file?: string; preset?: string; voxelMm?: number; sizeM?: [number, number, number]; cropped?: boolean };
export type CameraShot = { name: string; url: string };
type CaptureBridge = { getPlatform?:()=>string; nativePromise?:(plugin:string,method:string,args:Record<string,unknown>)=>Promise<unknown>; convertFileSrc?:(url:string)=>string };
function bridge():CaptureBridge|undefined { return (window as unknown as {Capacitor?:CaptureBridge}).Capacitor; }
export function captureFileURL(url:string):string { return bridge()?.convertFileSrc?.(url) ?? url; }
async function call<T>(method:string,args:Record<string,unknown>={}):Promise<T> {
 const cap=bridge();
 if(cap?.getPlatform?.()!=='ios'||!cap.nativePromise)throw new Error('Native capture tools require the installed iPhone or iPad app.');
 return cap.nativePromise('StudioCapture',method,args) as Promise<T>;
}
export async function captureCapabilities():Promise<CaptureCapabilities> {
 const platform=bridge()?.getPlatform?.()??'web';
 if(platform!=='ios')return {lidar:false,dualCamera:false,platform};
 return call<CaptureCapabilities>('capabilities');
}
export const listScans=()=>call<{scans:SavedScan[]}>('listScans');
export const openScanner=(mode:'scan'|'live')=>call<void>('openScanner',{mode});
export const openDualCamera=()=>call<{shots:CameraShot[]}>('openDualCamera');
export const shareScan=(id:string)=>call<void>('shareScan',{id});
export const deleteScan=(id:string)=>call<void>('deleteScan',{id});

export const captureCalibrationReference=()=>call<import('./calibration').Reference>('calibrationReference');

export async function shareCalibrationPreparation(json:string):Promise<boolean>{
 if(bridge()?.getPlatform?.()!=='ios')return false;
 await call('shareCalibrationPreparation',{json});return true;
}

export async function shareInteractiveScene(json:string){if(bridge()?.getPlatform?.()!=='ios')return false;await call('shareInteractiveScene',{json});return true;}
