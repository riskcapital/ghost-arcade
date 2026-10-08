export type OutputPreferences={method:'wireless'|'wired';frameRate:30|60;enabled:boolean};
export function loadOutputPreferences():OutputPreferences {try{const p=JSON.parse(localStorage.getItem('ga-mobile-output-v1')||'{}');return {method:p.method==='wired'?'wired':'wireless',frameRate:p.frameRate===60?60:30,enabled:p.enabled!==false};}catch{return {method:'wireless',frameRate:30,enabled:true};}}
export type OutputStatus = { native:boolean; platform?:'ios'|'android'|'web'; connected:boolean; display?:{name:string;width:number;height:number}; state:'disconnected'|'connecting'|'live'|'off'|'error'; message?:string };
type NativeWindow = Window & { GhostOutputAndroid?:{postMessage:(value:string)=>void}; webkit?: {messageHandlers?:{ghostOutput?:{postMessage:(value:unknown)=>void}}} };
/** One compositor feeds both displays. The secondary WebKit window contains only a video. */
export class ExternalOutput {
  private popup:Window|null=null;
  private stream:MediaStream|null=null;
  private video:HTMLVideoElement|null=null;
  private timeout:ReturnType<typeof setTimeout>|undefined;
  private connected=false;
  private revision=-1;
  private display:OutputStatus['display'];
  private preferences=loadOutputPreferences();
  private generation=0;
  private destroyed=false;
  private android=(window as NativeWindow).GhostOutputAndroid;
  private native=this.android?{postMessage:(value:unknown)=>this.android!.postMessage(JSON.stringify(value))}:(window as NativeWindow).webkit?.messageHandlers?.ghostOutput;
  private changed=(event:Event)=>{
    const detail=(event as CustomEvent<{connected:boolean;revision?:number;display?:OutputStatus['display']}>).detail;
    const changed=detail?.revision!==undefined&&detail.revision!==this.revision;
    this.revision=detail?.revision??this.revision;
    this.display=detail?.display;
    this.connected=!!detail?.connected;
    if(!this.connected){this.close();this.report('disconnected');}
    else if(!this.preferences.enabled){this.close();this.report('off');}
    else if(changed||!this.popup||this.popup.closed)this.start();
    else this.video?.play().catch(()=>this.report('error','TV playback paused. Tap Retry output.'));
  };
  constructor(private canvas:HTMLCanvasElement,private onstatus:(status:OutputStatus)=>void){
    window.addEventListener('ghost-external-display',this.changed);
    this.report('disconnected');
    this.native?.postMessage({type:'ready'});
  }
  private report(state:OutputStatus['state'],message?:string){
    if(this.destroyed)return;
    this.onstatus({native:!!this.native,platform:this.android?'android':this.native?'ios':'web',connected:this.connected,display:this.display,state,message});
    this.native?.postMessage({type:'status',state});
  }
  configure(preferences:OutputPreferences){
    const restart=this.preferences.frameRate!==preferences.frameRate||this.preferences.enabled!==preferences.enabled;
    this.preferences={...preferences};try{localStorage.setItem('ga-mobile-output-v1',JSON.stringify(preferences));}catch{}
    if(this.connected&&restart){if(preferences.enabled)this.start();else{this.close();this.report('off');}}
  }
  chooseWireless(){if(this.android)this.native?.postMessage({type:'chooseWireless'});}
  retry(){if(this.connected&&this.preferences.enabled)this.start();else this.native?.postMessage({type:'ready'});}
  private start(){
    this.close();const generation=++this.generation;
    this.report('connecting');
    try{
      if(typeof this.canvas.captureStream!=='function')throw new Error('This iOS version cannot capture the live output.');
      // Native WKUIDelegate places this same-origin popup on the external scene, not the phone.
      const popup=window.open('about:blank','ghost-arcade-program');
      if(!popup)throw new Error('The TV output window could not open. Reconnect the display and retry.');
      this.popup=popup;
      popup.document.open();
      popup.document.write('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Ghost Arcade Program</title><style>html,body{margin:0;width:100%;height:100%;background:#000;overflow:hidden}video{display:block;width:100%;height:100%;object-fit:contain;background:#000}</style></head><body><video muted autoplay playsinline disablepictureinpicture></video></body></html>');
      popup.document.close();
      const video=popup.document.querySelector('video')!;this.video=video;
      video.muted=true;video.playsInline=true;video.disableRemotePlayback=true;
      // Canvas capture stays inside WebKit's media pipeline; no per-frame JS readback or native bridge transfer.
      this.stream=this.canvas.captureStream(this.preferences.frameRate);
      if(!this.stream.getVideoTracks().length)throw new Error('Live output capture could not start.');
      video.srcObject=this.stream;
      const ready=()=>{if(generation!==this.generation)return;clearTimeout(this.timeout);this.report('live');};
      this.timeout=setTimeout(()=>{if(generation===this.generation)this.report('error','The TV connected but has not received a video frame. Tap Retry output.');},10000);
      if(typeof video.requestVideoFrameCallback==='function')video.requestVideoFrameCallback(ready);
      else video.addEventListener('loadeddata',ready,{once:true});
      video.play().catch(e=>{if(generation===this.generation){clearTimeout(this.timeout);this.report('error',`TV playback could not start: ${e.message}`);}});
    }catch(e){this.close();this.report('error',e instanceof Error?e.message:'Could not start clean output.');}
  }
  private close(){
    this.generation++;clearTimeout(this.timeout);
    try{if(this.video){this.video.pause();this.video.srcObject=null;}}catch{}
    this.video=null;this.stream?.getTracks().forEach(t=>t.stop());this.stream=null;
    try{this.popup?.close();}catch{}this.popup=null;
  }
  destroy(){this.destroyed=true;window.removeEventListener('ghost-external-display',this.changed);this.close();}
}
