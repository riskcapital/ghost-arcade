//! Native clip audio: bounded decode cache, off-thread mixing, nonblocking output.
use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use serde_json::{json, Value};
use std::{collections::HashMap, fs::{File, OpenOptions}, io::{Read, Seek, SeekFrom, Write},
    path::PathBuf, process::{Child, Command, Stdio}, sync::{Arc, Mutex, atomic::{AtomicBool, AtomicU32, AtomicU64, AtomicUsize, Ordering}},
    thread, time::{Duration, Instant}};
const RATE: f64 = 48_000.0;
const CACHE_BUDGET: u64 = 2 * 1024 * 1024 * 1024;
const FILE_BUDGET: u64 = 512 * 1024 * 1024;
const RING: usize = 32768;

struct Ring { data: Vec<AtomicU32>, read: AtomicUsize, write: AtomicUsize }
impl Ring {
    fn new() -> Self { Self { data: (0..RING).map(|_| AtomicU32::new(0)).collect(), read: AtomicUsize::new(0), write: AtomicUsize::new(0) } }
    fn len(&self) -> usize { self.write.load(Ordering::Acquire).wrapping_sub(self.read.load(Ordering::Acquire)) }
    fn push(&self, left: f32, right: f32) {
        let w = self.write.load(Ordering::Relaxed);
        self.data[w % RING].store(left.to_bits(), Ordering::Relaxed);
        self.data[(w + 1) % RING].store(right.to_bits(), Ordering::Relaxed);
        self.write.store(w.wrapping_add(2), Ordering::Release);
    }
    fn pop(&self) -> Option<(f32, f32)> {
        let r = self.read.load(Ordering::Relaxed);
        if self.write.load(Ordering::Acquire).wrapping_sub(r) < 2 { return None; }
        let pair = (f32::from_bits(self.data[r % RING].load(Ordering::Relaxed)), f32::from_bits(self.data[(r + 1) % RING].load(Ordering::Relaxed)));
        self.read.store(r.wrapping_add(2), Ordering::Release); Some(pair)
    }
}
struct Asset {
    path: PathBuf, frames: AtomicU64, bytes: AtomicU64, done: AtomicBool,
    cancelled: AtomicBool, error: Mutex<String>, child: Mutex<Option<Child>>, budget: Arc<AtomicU64>,
}
impl Drop for Asset {
    fn drop(&mut self) {
        if let Ok(child) = self.child.get_mut() { if let Some(child) = child.as_mut() { let _ = child.kill(); let _ = child.wait(); } }
        let _ = std::fs::remove_file(&self.path);
        self.budget.fetch_sub(self.bytes.load(Ordering::Relaxed), Ordering::AcqRel);
    }
}
impl Asset {
    fn cancel(&self) { self.cancelled.store(true, Ordering::Release); if let Ok(mut child) = self.child.lock() { if let Some(child) = child.as_mut() { let _ = child.kill(); } } }
}
#[derive(Clone)]
pub struct Voice {
    pub id: String, pub uri: String, pub time: f64, pub rate: f64,
    pub lo: f64, pub hi: f64, pub looping: bool, pub bounce: bool,
    pub gain: f32, pub pan: f32, pub playing: bool,
}
#[derive(Clone)]
struct MixVoice { voice: Voice, asset: Arc<Asset> }
struct MixState { voices: Vec<MixVoice>, at: Instant }
struct Reader { file: File, start: u64, samples: Vec<[f32; 2]>, bytes: Vec<u8> }
impl Reader {
    fn sample(&mut self, asset: &Asset, frame: u64) -> [f32; 2] {
        let available = asset.frames.load(Ordering::Acquire);
        if frame >= available { return [0.0; 2]; }
        if frame < self.start || frame >= self.start + self.samples.len() as u64 {
            self.start = frame / 4096 * 4096;
            let count = (available - self.start).min(8192) as usize;
            self.bytes.resize(count * 8, 0);
            if self.file.seek(SeekFrom::Start(self.start * 8)).is_err() || self.file.read_exact(&mut self.bytes).is_err() { self.samples.clear(); return [0.0; 2]; }
            self.samples.clear();
            self.samples.extend(self.bytes.chunks_exact(8).map(|v| [f32::from_le_bytes(v[..4].try_into().unwrap()), f32::from_le_bytes(v[4..].try_into().unwrap())]));
        }
        self.samples.get((frame - self.start) as usize).copied().unwrap_or([0.0; 2])
    }
}
pub fn transport_time(time: f64, lo: f64, hi: f64, looping: bool, bounce: bool) -> Option<f64> {
    let span = hi - lo;
    if !time.is_finite() || span <= 0.0 { return None; }
    if bounce { let phase = (time - lo).rem_euclid(span * 2.0); Some(lo + if phase <= span { phase } else { 2.0 * span - phase }) }
    else if looping { Some(lo + (time - lo).rem_euclid(span)) }
    else if time >= lo && time < hi { Some(time) } else { None }
}
pub fn balance(pan: f32) -> (f32, f32) {
    // Stereo balance retains both channels at center; full pan attenuates the opposite channel.
    let p = pan.clamp(-1.0, 1.0); ((1.0 - p.max(0.0)).sqrt(), (1.0 + p.min(0.0)).sqrt())
}
fn decode(asset: Arc<Asset>, input: PathBuf) {
    let result = (|| -> Result<(), String> {
        if asset.cancelled.load(Ordering::Acquire) { return Ok(()); }
        let mut output = OpenOptions::new().write(true).create_new(true).open(&asset.path).map_err(|e| e.to_string())?;
        let binary = std::env::var("GA_FFMPEG_PATH").unwrap_or_else(|_| "ffmpeg".into());
        let mut child = Command::new(binary).args(["-nostdin", "-hide_banner", "-loglevel", "error", "-i"]).arg(input)
            .args(["-map", "0:a:0", "-vn", "-ac", "2", "-ar", "48000", "-f", "f32le", "pipe:1"])
            .stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::null()).spawn().map_err(|e| e.to_string())?;
        let mut stdout = child.stdout.take().ok_or("Audio decoder stdout unavailable")?;
        *asset.child.lock().unwrap() = Some(child);
        let mut bytes = [0_u8; 32768];
        loop {
            if asset.cancelled.load(Ordering::Acquire) { break; }
            let count = stdout.read(&mut bytes).map_err(|e| e.to_string())?;
            if count == 0 { break; }
            let n = count as u64;
            if asset.bytes.load(Ordering::Acquire) + n > FILE_BUDGET { return Err("Clip exceeds the 512 MiB decoded-audio cache limit".into()); }
            if asset.budget.fetch_update(Ordering::AcqRel, Ordering::Acquire, |used| (used + n <= CACHE_BUDGET).then_some(used + n)).is_err() { return Err("Decoded-audio cache budget exhausted (2 GiB)".into()); }
            asset.bytes.fetch_add(n, Ordering::AcqRel);
            output.write_all(&bytes[..count]).map_err(|e| e.to_string())?;
            asset.frames.store(asset.bytes.load(Ordering::Acquire) / 8, Ordering::Release);
        }
        if let Some(child) = asset.child.lock().unwrap().as_mut() {
            if asset.cancelled.load(Ordering::Acquire) { let _ = child.kill(); }
            if !child.wait().map_err(|e| e.to_string())?.success() && !asset.cancelled.load(Ordering::Acquire) { return Err("No decodable audio track, or audio decoding failed".into()); }
        }
        Ok(())
    })();
    if let Err(error) = result { *asset.error.lock().unwrap() = error; asset.cancel(); }
    asset.done.store(true, Ordering::Release);
}

pub struct ClipAudio {
    assets: HashMap<String, Arc<Asset>>, budget: Arc<AtomicU64>, serial: u64, directory: PathBuf,
    jobs: Option<std::sync::mpsc::SyncSender<(Arc<Asset>, PathBuf)>>,
    mix: Arc<Mutex<MixState>>, stop: Arc<AtomicBool>, ring: Arc<Ring>,
    stream: Option<cpal::Stream>, output_rate: u32, device: String,
    error: Arc<Mutex<String>>, underflows: Arc<AtomicU64>, callbacks: Arc<AtomicU64>,
    latency: Arc<AtomicU64>, peak_left: Arc<AtomicU32>, peak_right: Arc<AtomicU32>, callback_frames: Arc<AtomicUsize>, last_attempt: Option<Instant>, decoders: Vec<thread::JoinHandle<()>>, worker: Option<thread::JoinHandle<()>>,
}
impl ClipAudio {
    pub fn new() -> Self {
        let directory = std::env::temp_dir().join(format!("ghost-audio-{}-{}", std::process::id(), std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_nanos()));
        let _ = std::fs::create_dir_all(&directory);
        let (tx, rx) = std::sync::mpsc::sync_channel::<(Arc<Asset>, PathBuf)>(64);
        let rx = Arc::new(Mutex::new(rx));
        let mut decoders = Vec::new();
        for _ in 0..2 { let rx = rx.clone(); decoders.push(thread::spawn(move || loop { let job = rx.lock().unwrap().recv(); match job { Ok((asset, input)) => decode(asset, input), Err(_) => break } })); }
        Self { assets: HashMap::new(), budget: Arc::new(AtomicU64::new(0)), serial: 0, directory, jobs: Some(tx),
            mix: Arc::new(Mutex::new(MixState { voices: Vec::new(), at: Instant::now() })), stop: Arc::new(AtomicBool::new(false)), ring: Arc::new(Ring::new()),
            stream: None, output_rate: 48000, device: "default".into(), error: Arc::new(Mutex::new(String::new())),
            underflows: Arc::new(AtomicU64::new(0)), callbacks: Arc::new(AtomicU64::new(0)), latency: Arc::new(AtomicU64::new(0)), peak_left: Arc::new(AtomicU32::new(0)), peak_right: Arc::new(AtomicU32::new(0)), callback_frames: Arc::new(AtomicUsize::new(256)), last_attempt: None, decoders, worker: None }
    }
    pub fn devices() -> Value {
        let host = cpal::default_host();
        let mut names = Vec::new();
        if let Ok(devices) = host.output_devices() { for device in devices { if let Ok(name) = device.name() { if !names.contains(&name) { names.push(name); } } } }
        json!(names)
    }
    pub fn select_output(&mut self, name: &str) -> Result<(), String> {
        self.stop_output(); self.device = name.to_string(); self.start_output()
    }
    fn start_output(&mut self) -> Result<(), String> {
        if self.stream.is_some() { return Ok(()); }
        let host = cpal::default_host();
        let device = if self.device == "default" { host.default_output_device() }
            else { host.output_devices().ok().and_then(|mut devices| devices.find(|d| d.name().ok().as_deref() == Some(&self.device))) }.ok_or("Audio output device unavailable")?;
        self.last_attempt = Some(Instant::now());
        let config = device.default_output_config().map_err(|e| e.to_string())?;
        self.output_rate = config.sample_rate().0;
        let channels = config.channels() as usize;
        let mut stream_config = config.config();
        if let cpal::SupportedBufferSize::Range { min, max } = config.buffer_size() {
            stream_config.buffer_size = cpal::BufferSize::Fixed(256_u32.clamp(*min, *max));
        }
        let callback_frames = self.callback_frames.clone();
        let ring = self.ring.clone(); let underflows = self.underflows.clone(); let callbacks = self.callbacks.clone(); let latency = self.latency.clone();
        let error = self.error.clone(); let peak_left = self.peak_left.clone(); let peak_right = self.peak_right.clone();
        macro_rules! stream { ($sample:ty) => {{
            device.build_output_stream(&stream_config, move |output: &mut [$sample], info: &cpal::OutputCallbackInfo| {
                callbacks.fetch_add(1, Ordering::Relaxed);
                callback_frames.store(output.len() / channels, Ordering::Relaxed);
                if let Some(delay) = info.timestamp().playback.duration_since(&info.timestamp().callback) { latency.store(delay.as_nanos().min(u64::MAX as u128) as u64, Ordering::Release); }
                let mut peaks = [0.0_f32; 2];
                for frame in output.chunks_mut(channels) {
                    let (left, right) = ring.pop().unwrap_or_else(|| { underflows.fetch_add(1, Ordering::Relaxed); (0.0, 0.0) });
                    peaks[0] = peaks[0].max(left.abs()); peaks[1] = peaks[1].max(right.abs());
                    for (channel, value) in frame.iter_mut().enumerate() {
                        let sample = if channels == 1 { (left + right) * 0.5 } else if channel == 0 { left } else if channel == 1 { right } else { 0.0 };
                        *value = <$sample as cpal::FromSample<f32>>::from_sample_(sample.clamp(-1.0, 1.0));
                    }
                }
                peak_left.store(peaks[0].to_bits(), Ordering::Relaxed); peak_right.store(peaks[1].to_bits(), Ordering::Relaxed);
            }, move |err| { if let Ok(mut value) = error.try_lock() { *value = err.to_string(); } }, None)
        }}; }
        let output = match config.sample_format() {
            cpal::SampleFormat::F32 => stream!(f32), cpal::SampleFormat::I16 => stream!(i16), cpal::SampleFormat::U16 => stream!(u16),
            format => return Err(format!("Unsupported audio output format: {format:?}")),
        }.map_err(|e| e.to_string())?;
        self.stop.store(false, Ordering::Release);
        let stop = self.stop.clone(); let ring = self.ring.clone(); let mix = self.mix.clone(); let latency = self.latency.clone(); let rate = self.output_rate as f64; let callback_frames = self.callback_frames.clone();
        self.worker = Some(thread::spawn(move || {
            let mut readers: HashMap<PathBuf, Reader> = HashMap::new();
            let mut gains: HashMap<String, (f32, f32)> = HashMap::new();
            while !stop.load(Ordering::Acquire) {
                if ring.len() >= (callback_frames.load(Ordering::Relaxed).saturating_mul(4).max(1024)).min(RING - 256) { thread::sleep(Duration::from_millis(1)); continue; }
                let snapshot = mix.lock().ok().map(|s| (s.voices.clone(), s.at));
                let Some((voices, at)) = snapshot else { continue; };
                readers.retain(|path, _| voices.iter().any(|v| v.asset.path == *path));
                gains.retain(|id, _| voices.iter().any(|v| v.voice.id == *id));
                for entry in &voices { gains.entry(entry.voice.id.clone()).or_insert((0.0, 0.0)); }
                let age = at.elapsed().as_secs_f64();
                let ahead = ring.len() as f64 / 2.0 / rate + latency.load(Ordering::Acquire) as f64 / 1e9;
                for frame in 0..128 {
                    let mut sum = [0.0_f32; 2];
                    for entry in &voices {
                        let voice = &entry.voice;
                        // A stale render clock must not leave sound running after app/output loss.
                        let (left, right) = balance(voice.pan);
                        let target = if voice.playing && age <= 0.5 { voice.gain } else { 0.0 };
                        let gain = gains.get_mut(&voice.id).unwrap();
                        let smoothing = (1.0 / (rate * 0.003)) as f32;
                        gain.0 += (target * left - gain.0) * smoothing;
                        gain.1 += (target * right - gain.1) * smoothing;
                        if gain.0.abs() + gain.1.abs() < 0.00001 { continue; }
                        let Some(time) = transport_time(voice.time + (age + ahead + frame as f64 / rate) * voice.rate, voice.lo, voice.hi, voice.looping, voice.bounce) else { continue; };
                        if !readers.contains_key(&entry.asset.path) {
                            if let Ok(file) = File::open(&entry.asset.path) { readers.insert(entry.asset.path.clone(), Reader { file, start: 0, samples: Vec::new(), bytes: Vec::new() }); } else { continue; }
                        }
                        let reader = readers.get_mut(&entry.asset.path).unwrap();
                        let position = time.max(0.0) * RATE;
                        let a = reader.sample(&entry.asset, position.floor() as u64);
                        let next_time = transport_time(time + 1.0 / RATE, voice.lo, voice.hi, voice.looping, voice.bounce).unwrap_or(time);
                        let b = reader.sample(&entry.asset, (next_time.max(0.0) * RATE).floor() as u64);
                        let fraction = position.fract() as f32;
                        sum[0] += (a[0] + (b[0] - a[0]) * fraction) * gain.0;
                        sum[1] += (a[1] + (b[1] - a[1]) * fraction) * gain.1;
                    }
                    // Linked stereo peak protection preserves balance when layers sum above unity.
                    let peak = sum[0].abs().max(sum[1].abs()).max(1.0);
                    ring.push(sum[0] / peak, sum[1] / peak);
                }
            }
        }));
        if let Err(error) = output.play() { self.stop_output(); return Err(error.to_string()); } self.stream = Some(output); *self.error.lock().unwrap() = String::new(); Ok(())
    }
    fn stop_output(&mut self) {
        self.stream = None; self.stop.store(true, Ordering::Release);
        if let Some(worker) = self.worker.take() { let _ = worker.join(); }
        self.ring = Arc::new(Ring::new());
    }
    pub fn prepare(&mut self, sources: Vec<(String, PathBuf)>) {
        self.assets.retain(|uri, asset| { let keep = sources.iter().any(|(source, _)| source == uri); if !keep { asset.cancel(); } keep });
        for (uri, path) in sources.into_iter().take(64) {
            if self.assets.contains_key(&uri) { continue; }
            self.serial += 1;
            let asset = Arc::new(Asset { path: self.directory.join(format!("{}.pcm", self.serial)), frames: AtomicU64::new(0), bytes: AtomicU64::new(0), done: AtomicBool::new(false), cancelled: AtomicBool::new(false), error: Mutex::new(String::new()), child: Mutex::new(None), budget: self.budget.clone() });
            if self.jobs.as_ref().is_some_and(|jobs| jobs.try_send((asset.clone(), path)).is_ok()) { self.assets.insert(uri, asset); }
        }
    }
    pub fn update(&mut self, voices: Vec<Voice>) {
        let voices: Vec<_> = voices.into_iter().filter_map(|voice| self.assets.get(&voice.uri).map(|asset| MixVoice { voice, asset: asset.clone() })).collect();
        if self.stream.is_none() && self.last_attempt.is_none_or(|at| at.elapsed() >= Duration::from_secs(2)) && voices.iter().any(|v| v.voice.playing && v.voice.gain > 0.0 && v.asset.frames.load(Ordering::Acquire) > 0) {
            self.last_attempt = Some(Instant::now());
            if let Err(error) = self.start_output() { *self.error.lock().unwrap() = error; }
        }
        if let Ok(mut mix) = self.mix.try_lock() { mix.voices = voices; mix.at = Instant::now(); }
    }
    pub fn status(&self) -> Value {
        json!({ "running": self.stream.is_some(), "device": self.device, "sample_rate": self.output_rate,
            "peak_left": f32::from_bits(self.peak_left.load(Ordering::Relaxed)), "peak_right": f32::from_bits(self.peak_right.load(Ordering::Relaxed)),
            "voices": self.mix.lock().map(|s| s.voices.iter().map(|v| json!({"id": v.voice.id, "time": v.voice.time, "rate": v.voice.rate, "playing": v.voice.playing, "gain": v.voice.gain, "pan": v.voice.pan})).collect::<Vec<_>>()).unwrap_or_default(),
            "callbacks": self.callbacks.load(Ordering::Relaxed), "underflow_frames": self.underflows.load(Ordering::Relaxed),
            "latency_ms": self.latency.load(Ordering::Acquire) as f64 / 1e6,
            "cache_bytes": self.budget.load(Ordering::Acquire), "error": self.error.lock().map(|s| s.clone()).unwrap_or_default(),
            "assets": self.assets.iter().map(|(uri, a)| json!({ "uri": uri, "seconds_ready": a.frames.load(Ordering::Acquire) as f64 / RATE,
                "complete": a.done.load(Ordering::Acquire), "error": a.error.lock().map(|s| s.clone()).unwrap_or_default() })).collect::<Vec<_>>() })
    }
}
impl Drop for ClipAudio {
    fn drop(&mut self) { self.stop_output(); for asset in self.assets.values() { asset.cancel(); } self.jobs.take(); for worker in self.decoders.drain(..) { let _ = worker.join(); } self.assets.clear(); if let Ok(mut mix) = self.mix.lock() { mix.voices.clear(); } let _ = std::fs::remove_dir(&self.directory); }
}
#[cfg(test)] mod tests {
    use super::*;
    #[test] fn reverse_bounce_and_trim_coordinates() {
        assert_eq!(transport_time(1.5, 2.0, 6.0, true, false), Some(5.5));
        assert_eq!(transport_time(6.5, 2.0, 6.0, true, true), Some(5.5));
        assert_eq!(transport_time(6.5, 2.0, 6.0, false, false), None);
        assert_eq!(balance(0.0), (1.0, 1.0)); assert_eq!(balance(1.0), (0.0, 1.0));
    }
    #[test] fn ring_is_ordered_and_nonblocking() {
        let ring = Ring::new(); assert_eq!(ring.pop(), None);
        for index in 0..1000 { ring.push(index as f32, -(index as f32)); }
        for index in 0..1000 { assert_eq!(ring.pop(), Some((index as f32, -(index as f32)))); }
        assert_eq!(ring.len(), 0);
    }
}
