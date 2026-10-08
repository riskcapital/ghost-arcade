/** Uses the paired socket only for signaling; pixels travel over WebRTC. */
export class DesktopSender {
 private peer?:RTCPeerConnection; private stream?:MediaStream; private session='';
 private pending:RTCIceCandidateInit[]=[]; private timer?:ReturnType<typeof setTimeout>;
 private acknowledged=false; private connected=false; private generation=0;
 constructor(private socket:WebSocket,private status:(text:string)=>void){}
 async start(canvas:HTMLCanvasElement,kind:string){
  this.stop();const epoch=this.generation;this.status('Checking desktop support…');
  if(this.socket.readyState!==WebSocket.OPEN)throw Error('Desktop disconnected. Reconnect before sending.');
  if(typeof canvas.captureStream!=='function')throw Error('This device cannot stream its canvas.');
  this.session=crypto.randomUUID();
  this.socket.addEventListener('message',this.receive);this.socket.addEventListener('close',this.closed);
  this.send({type:'studio_capabilities_request'});
  try{
   await new Promise<void>((resolve,reject)=>{let waited=0;const poll=setInterval(()=>{waited+=50;if(epoch!==this.generation){clearInterval(poll);reject(Error('Sending cancelled.'));}else if(this.acknowledged){clearInterval(poll);resolve();}else if(waited>=10000){clearInterval(poll);reject(Error('Desktop is not ready or needs an update with Studio feed support.'));}else if(waited%500===0)this.send({type:'studio_capabilities_request'});},50);});
   if(epoch!==this.generation)return;
   const peer=new RTCPeerConnection();this.peer=peer;this.stream=canvas.captureStream(24);
   this.stream.getTracks().forEach(t=>peer.addTrack(t,this.stream!));
   const sessionId=this.session;let offered=false;const localIce:RTCIceCandidateInit[]=[];
   peer.onicecandidate=e=>{if(!e.candidate)return;const candidate=e.candidate.toJSON();if(offered)this.send({type:'phone_camera_ice',sessionId,candidate});else localIce.push(candidate);};
   peer.onconnectionstatechange=()=>{if(this.peer!==peer)return;this.connected=peer.connectionState==='connected';if(this.connected)this.status('Connected · waiting for desktop source…');if(peer.connectionState==='failed'||peer.connectionState==='disconnected'){this.stop();this.status('Feed disconnected. Tap Send to reconnect.');}};
   await peer.setLocalDescription(await peer.createOffer());if(epoch!==this.generation)return;
   this.send({type:'phone_camera_offer',sessionId,sdp:peer.localDescription,studioFeed:{schema:'ghost-mobile-feed',version:1,kind,content:'visual-rgba',metricDepth:false},capabilities:{width:canvas.width,height:canvas.height,frameRate:24,depth:false,nativeDepth:false}});
   offered=true;for(const candidate of localIce)this.send({type:'phone_camera_ice',sessionId,candidate});
   this.status('Connecting feed…');this.timer=setTimeout(()=>{this.stop();this.status('Desktop did not confirm receiving the feed. Try again.');},15000);
  }catch(e){if(epoch===this.generation){this.stop();this.status((e as Error).message);}throw e;}
 }
 private send(payload:Record<string,unknown>){if(this.socket.readyState===WebSocket.OPEN)this.socket.send(JSON.stringify(payload));}
 private closed=()=>{this.stop();this.status('Desktop disconnected.');};
 private receive=(event:MessageEvent)=>{void this.handle(event).catch(e=>{this.stop();this.status('Feed failed: '+(e as Error).message);});};
 private async handle(event:MessageEvent){
  let msg:any;try{msg=JSON.parse(String(event.data));}catch{return;}
  if(msg.type==='studio_capabilities'){this.acknowledged=msg.version===1&&msg.visualFeeds===true;return;}
  if(msg.sessionId!==this.session)return;const peer=this.peer;
  if(msg.type==='phone_camera_answer'&&peer){await peer.setRemoteDescription(msg.sdp);if(this.peer!==peer)return;for(const c of this.pending.splice(0))await peer.addIceCandidate(c);}
  if(msg.type==='phone_camera_ice'){if(peer?.remoteDescription)await peer.addIceCandidate(msg.candidate);else if(this.pending.length<128)this.pending.push(msg.candidate);}
  if(msg.type==='phone_vision_status'&&msg.status==='live'&&msg.sourceReady===true){clearTimeout(this.timer);this.status('Live on desktop · Sources → '+String(msg.label||'Mobile Studio'));}
  if(msg.type==='phone_vision_status'&&msg.status==='failed'){this.stop();this.status(String(msg.error||'Desktop rejected the feed.'));}
 }
 stop(){this.generation++;clearTimeout(this.timer);if(this.session)this.send({type:'phone_camera_stop',sessionId:this.session});this.session='';this.socket.removeEventListener('message',this.receive);this.socket.removeEventListener('close',this.closed);const peer=this.peer;this.peer=undefined;if(peer){peer.onconnectionstatechange=null;peer.onicecandidate=null;peer.close();}this.stream?.getTracks().forEach(t=>t.stop());this.stream=undefined;this.pending=[];this.acknowledged=false;this.connected=false;}
}
