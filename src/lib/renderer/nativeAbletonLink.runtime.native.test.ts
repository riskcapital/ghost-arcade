import { execFileSync, spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { closeNativeTestCore, hardwareTestPlatform as platform } from './nativeHardwareTestPlatform';
const binary = platform.binary;
type Command = Record<string, unknown>;
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
function core() {
  const child = spawn(binary, [], {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, GA_NATIVE_VIDEO_BACKEND: 'hardware' },
  });
  let nextId = 0;
  let stderr = '';
  let stopped: Error | undefined;
  const pending = new Map<number, { resolve(value: any): void; reject(error: Error): void }>();
  const fail = (error: Error) => {
    stopped = error;
    for (const request of pending.values()) request.reject(error);
    pending.clear();
  };
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', data => { stderr = (stderr + data).slice(-16000); });
  child.on('error', fail);
  child.on('exit', (code, signal) => fail(new Error(`native core exited (${code ?? signal}): ${stderr}`)));
  createInterface({ input: child.stdout }).on('line', line => {
    if (!line.trim()) return;
    try {
      const message = JSON.parse(line);
      const request = pending.get(message.id);
      if (!request) return;
      pending.delete(message.id);
      if (message.ok) request.resolve(message.result);
      else request.reject(new Error(`${message.error}: ${stderr}`));
    } catch (error) {
      fail(new Error(`invalid native core response: ${String(error)}: ${line}`));
    }
  });
  const send = (method: string, params: Command = {}, timeoutMs = 15000): Promise<any> => {
    if (stopped) return Promise.reject(stopped);
    const id = ++nextId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`${method} timed out: ${stderr}`));
      }, timeoutMs);
      pending.set(id, {
        resolve: value => { clearTimeout(timer); resolve(value); },
        reject: error => { clearTimeout(timer); reject(error); },
      });
      child.stdin.write(`${JSON.stringify({ id, method, params })}\n`, error => {
        if (error) fail(error);
      });
    });
  };
  return {
    send,
    commands: (commands: Command[]) => send('submit_commands', { commands }),
    async close() {
      try { await send('shutdown', {}, 1000); } catch { /* already exited */ }
      await closeNativeTestCore(child);
    },
  };
}


// Explicit opt-in: this test joins the real LAN Link session and requires another application.
const suite = process.env.GA_REAL_LINK_TEST === '1' && platform.runnable ? describe : describe.skip;
suite('Real Ableton Link native video acceptance', () => {
  it('follows a live external Link peer with three hardware directions', async () => {
    const { LinkSession } = createRequire(import.meta.url)(join(process.cwd(), 'electron/native/build/Release/link_addon.node'));
    const link = new LinkSession(92); link.enableStartStopSync(true); link.enable(true);
    const dir = mkdtempSync(join(tmpdir(), 'ghost-link-soak-'));
    const uri = join(dir, 'clock.mp4'); const rpc = core();
    const seconds = Number(process.env.GA_LINK_SOAK_SECONDS || 600);
    const observations: any[] = []; let lastTempo = 0; let tempoChangedAt = 0;
    const configurations = [{ id: 'forward', reverse: false, bounce: false }, { id: 'reverse', reverse: true, bounce: false }, { id: 'bounce', reverse: false, bounce: true }];
    const playback = (c: typeof configurations[number], tempo: number) => ({ type: 'set_media_source_playback',
      source_id: c.id, uri, source_type: 'video', duration_seconds: 8, time_seconds: c.reverse ? 8 : 0,
      trim_start: 0, trim_end: 1, playback_rate: (c.reverse ? -1 : 1) * (c.bounce ? 16 : 8) * tempo / 960,
      bounce_enabled: c.bounce, loop_enabled: true, paused: false, seek_generation: 1 });
    try {
      for (let n = 0; n < 100 && link.getState().peers === 0; n++) await sleep(100);
      expect(link.getState().peers, 'Start Ableton Live and enable Link before this test').toBeGreaterThan(0);
      execFileSync(process.env.GA_FFMPEG_PATH || 'ffmpeg', ['-v','error','-f','lavfi','-i','testsrc2=s=128x96:r=30:d=8','-c:v','libx264','-pix_fmt','yuv420p',uri]);
      await rpc.send('start', { config: { backend: platform.rendererBackend, width: 384, height: 96, target_fps: 60 } });
      const initial = link.getState(); lastTempo = initial.tempo;
      const startBeat = initial.beat;
      await rpc.commands(configurations.flatMap((c,index) => [
        { type:'upsert_layer', layer_id:c.id, opacity:1,z_index:index,blend_mode:'normal', corners:{topLeft:{x:index/3,y:1},topRight:{x:(index+1)/3,y:1},bottomRight:{x:(index+1)/3,y:0},bottomLeft:{x:index/3,y:0}} },
        playback(c,initial.tempo), { type:'bind_media_source',layer_id:c.id,source_id:c.id,uri,source_type:'video' }
      ]));
      const started = performance.now(); let lastReport = -30; let lastSample = -1;
      while (performance.now()-started < seconds*1000) {
        const elapsed = (performance.now()-started)/1000; const state=link.getState();
        if (Math.abs(state.tempo-lastTempo)>.001) {
          lastTempo=state.tempo;tempoChangedAt=elapsed;
          await rpc.commands(configurations.map(c=>playback(c,state.tempo)));
        }
        await rpc.commands(configurations.map(c=>{
          const cycle=c.bounce?16:8; const phase=(((state.beat-startBeat)/16*cycle)%cycle+cycle)%cycle;
          const reverse=c.bounce?phase>=8:c.reverse;
          return {type:'set_media_source_phase',source_id:c.id,uri,seek_generation:1,time_seconds:reverse?cycle-phase:phase,reverse};
        }));
        if (elapsed-lastSample>=1) {
          lastSample=elapsed; const native=await rpc.send('status');
          observations.push({seconds:elapsed,tempo:state.tempo,peers:state.peers,playing:state.playing,settled:elapsed>15&&elapsed-tempoChangedAt>15,
            sessions:native.native_video_sessions.filter((s:any)=>configurations.some(c=>c.id===s.source_id)).map((s:any)=>({id:s.source_id,backend:s.backend,frames:s.frames_presented,error:s.phase_error_seconds,time:s.source_time_seconds}))});
        }
        if(elapsed-lastReport>=30){lastReport=elapsed;console.log('Link soak',Math.round(elapsed),'seconds',state.tempo,'BPM',state.peers,'peers');}
        await sleep(100);
      }
      const settled=observations.filter(o=>o.settled);
      expect(settled.length).toBeGreaterThan(10);
      for(const c of configurations){
        const samples=settled.flatMap(o=>o.sessions.filter((s:any)=>s.id===c.id));
        expect(samples.every((s:any)=>s.backend===platform.decoderBackend)).toBe(true);
        expect(samples.every((s:any)=>s.error!=null)).toBe(true);
        const errors=samples.map((s:any)=>Math.abs(s.error)).sort((a:number,b:number)=>a-b);
        console.log(c.id,'phase p95',errors[Math.floor(errors.length*.95)],'max',errors.at(-1));
        expect(errors[Math.floor(errors.length*.95)]).toBeLessThan(.04);
        expect(samples.at(-1).frames).toBeGreaterThan(seconds*10);
      }
    } finally {
      writeFileSync(join(process.cwd(),'reports/ableton-link-live-soak-2026-09-19.json'),JSON.stringify({seconds,observations},null,2));
      link.enable(false);await rpc.close();rmSync(dir,{recursive:true,force:true});
    }
  }, 660000);
});
