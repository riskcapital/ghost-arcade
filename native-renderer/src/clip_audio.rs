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
/// Recording tap capacity in f32 slots: 262144 stereo frames, about 5.4 s at 48 kHz.
const TAP_RING: usize = 1 << 19;
const TAP_MAGIC: &[u8; 4] = b"GATP";

pub struct Ring { data: Vec<AtomicU32>, read: AtomicUsize, write: AtomicUsize }
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
/// Post-mix, pre-device stereo tap for recordings. The output callback
/// mirrors every frame it hands the device; a full ring counts the frame as
/// dropped instead of blocking. One producer (the callback), one consumer.
pub struct Tap {
    data: Vec<AtomicU32>, read: AtomicUsize, write: AtomicUsize,
    enabled: AtomicBool, dropped: AtomicU64, pushed: AtomicU64, rate: AtomicU32,
}
impl Tap {
    pub fn new() -> Self {
        Self { data: (0..TAP_RING).map(|_| AtomicU32::new(0)).collect(), read: AtomicUsize::new(0), write: AtomicUsize::new(0),
            enabled: AtomicBool::new(false), dropped: AtomicU64::new(0), pushed: AtomicU64::new(0), rate: AtomicU32::new(48000) }
    }
    pub fn rate(&self) -> u32 { self.rate.load(Ordering::Acquire) }
    pub fn pushed(&self) -> u64 { self.pushed.load(Ordering::Relaxed) }
    pub fn dropped(&self) -> u64 { self.dropped.load(Ordering::Relaxed) }
    pub fn arm(&self, rate: u32) {
        while self.pop().is_some() {}
        self.dropped.store(0, Ordering::Relaxed); self.pushed.store(0, Ordering::Relaxed);
        self.rate.store(rate, Ordering::Release); self.enabled.store(true, Ordering::Release);
    }
    pub fn disarm(&self) { self.enabled.store(false, Ordering::Release); }
    pub fn push(&self, left: f32, right: f32) {
        if !self.enabled.load(Ordering::Relaxed) { return; }
        let w = self.write.load(Ordering::Relaxed);
        if w.wrapping_sub(self.read.load(Ordering::Acquire)) + 2 > TAP_RING { self.dropped.fetch_add(1, Ordering::Relaxed); return; }
        self.data[w % TAP_RING].store(left.to_bits(), Ordering::Relaxed);
        self.data[(w + 1) % TAP_RING].store(right.to_bits(), Ordering::Relaxed);
        self.write.store(w.wrapping_add(2), Ordering::Release);
        self.pushed.fetch_add(1, Ordering::Relaxed);
    }
    pub fn pop(&self) -> Option<(f32, f32)> {
        let r = self.read.load(Ordering::Relaxed);
        if self.write.load(Ordering::Acquire).wrapping_sub(r) < 2 { return None; }
        let pair = (f32::from_bits(self.data[r % TAP_RING].load(Ordering::Relaxed)), f32::from_bits(self.data[(r + 1) % TAP_RING].load(Ordering::Relaxed)));
        self.read.store(r.wrapping_add(2), Ordering::Release); Some(pair)
    }
}
/// Linear resampler used only when the device rate differs from the rate the
/// tap was armed with (an output device change during a recording).
#[derive(Default)]
pub struct TapResampler { phase: f64, prev: Option<(f32, f32)> }
impl TapResampler {
    pub fn push(&mut self, tap: &Tap, device_rate: u32, left: f32, right: f32) {
        let tap_rate = tap.rate();
        if device_rate == tap_rate || tap_rate == 0 { self.prev = None; self.phase = 0.0; tap.push(left, right); return; }
        let Some(prev) = self.prev else { self.prev = Some((left, right)); return; };
        let step = device_rate as f64 / tap_rate as f64;
        while self.phase < 1.0 {
            let t = self.phase as f32;
            tap.push(prev.0 + (left - prev.0) * t, prev.1 + (right - prev.1) * t);
            self.phase += step;
        }
        self.phase -= 1.0; self.prev = Some((left, right));
    }
}
/// One device callback: the ring feeds the device buffer and the tap mirrors
/// exactly the clamped stereo frames the device receives. Returns block peaks.
pub fn render_output<S: cpal::Sample + cpal::FromSample<f32>>(output: &mut [S], channels: usize, ring: &Ring, tap: &Tap,
    resampler: &mut TapResampler, device_rate: u32, underflows: &AtomicU64) -> [f32; 2] {
    let mut peaks = [0.0_f32; 2];
    for frame in output.chunks_mut(channels) {
        let (left, right) = ring.pop().unwrap_or_else(|| { underflows.fetch_add(1, Ordering::Relaxed); (0.0, 0.0) });
        peaks[0] = peaks[0].max(left.abs()); peaks[1] = peaks[1].max(right.abs());
        let (left, right) = (left.clamp(-1.0, 1.0), right.clamp(-1.0, 1.0));
        let (left, right) = if channels == 1 { ((left + right) * 0.5, (left + right) * 0.5) } else { (left, right) };
        for (channel, value) in frame.iter_mut().enumerate() {
            let sample = if channel == 0 { left } else if channel == 1 { right } else { 0.0 };
            *value = S::from_sample_(sample);
        }
        resampler.push(tap, device_rate, left, right);
    }
    peaks
}
fn write_tap_chunk(stream: &mut std::net::TcpStream, rate: u32, frame_index: u64, dropped: u64, samples: &[f32]) -> std::io::Result<()> {
    let mut bytes = Vec::with_capacity(32 + samples.len() * 4);
    bytes.extend_from_slice(TAP_MAGIC);
    bytes.extend_from_slice(&rate.to_le_bytes());
    bytes.extend_from_slice(&((samples.len() / 2) as u32).to_le_bytes());
    bytes.extend_from_slice(&0_u32.to_le_bytes());
    bytes.extend_from_slice(&frame_index.to_le_bytes());
    bytes.extend_from_slice(&dropped.to_le_bytes());
    for sample in samples { bytes.extend_from_slice(&sample.to_le_bytes()); }
    stream.write_all(&bytes)
}
struct TapSession { stop: Arc<AtomicBool>, worker: Option<thread::JoinHandle<(u64, String)>>, started_unix_ms: u64, rate: u32 }

/// Equal-power fade of one clip voice across a picture transition. The angle
/// is the state, so an interrupted fade continues from its current level.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum FadeRole { In, Out }
pub fn fade_target(role: FadeRole) -> f64 { match role { FadeRole::In => std::f64::consts::FRAC_PI_2, FadeRole::Out => 0.0 } }
/// Angle for a voice first seen while its transition is already at picture progress `progress` (0..1).
pub fn fade_start(role: FadeRole, progress: Option<f64>) -> f64 {
    let p = progress.unwrap_or(0.0).clamp(0.0, 1.0);
    (match role { FadeRole::In => p, FadeRole::Out => 1.0 - p }) * std::f64::consts::FRAC_PI_2
}
pub fn advance_fade(theta: f64, role: FadeRole, duration: f64, running: bool, dt: f64) -> f64 {
    let target = fade_target(role);
    if !duration.is_finite() || duration <= 0.0 { return target; }
    if !running || !dt.is_finite() || dt <= 0.0 { return theta.clamp(0.0, std::f64::consts::FRAC_PI_2); }
    let step = dt * std::f64::consts::FRAC_PI_2 / duration;
    if theta < target { (theta + step).min(target) } else { (theta - step).max(target) }
}
pub fn fade_level(theta: f64) -> f32 { theta.clamp(0.0, std::f64::consts::FRAC_PI_2).sin() as f32 }

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
fn voice_reader_key(voice: &MixVoice) -> (String, PathBuf) { (voice.voice.id.clone(), voice.asset.path.clone()) }
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
    tap: Arc<Tap>, stream_active: Arc<AtomicBool>, tap_session: Option<TapSession>, null_output: Option<thread::JoinHandle<()>>,
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
            underflows: Arc::new(AtomicU64::new(0)), callbacks: Arc::new(AtomicU64::new(0)), latency: Arc::new(AtomicU64::new(0)), peak_left: Arc::new(AtomicU32::new(0)), peak_right: Arc::new(AtomicU32::new(0)), callback_frames: Arc::new(AtomicUsize::new(256)), last_attempt: None, decoders, worker: None,
            tap: Arc::new(Tap::new()), stream_active: Arc::new(AtomicBool::new(false)), tap_session: None, null_output: None }
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
        if self.stream.is_some() || self.null_output.is_some() { return Ok(()); }
        // Test hook: a paced software device with the exact callback path, so
        // tests can verify the mix and the recording tap without speakers.
        if std::env::var_os("GA_CLIP_AUDIO_NULL_OUTPUT").is_some_and(|v| v == "1") { return self.start_null_output(); }
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
        let tap = self.tap.clone(); let device_rate = self.output_rate;
        macro_rules! stream { ($sample:ty) => {{
            let mut resampler = TapResampler::default();
            device.build_output_stream(&stream_config, move |output: &mut [$sample], info: &cpal::OutputCallbackInfo| {
                callbacks.fetch_add(1, Ordering::Relaxed);
                callback_frames.store(output.len() / channels, Ordering::Relaxed);
                if let Some(delay) = info.timestamp().playback.duration_since(&info.timestamp().callback) { latency.store(delay.as_nanos().min(u64::MAX as u128) as u64, Ordering::Release); }
                let peaks = render_output(output, channels, &ring, &tap, &mut resampler, device_rate, &underflows);
                peak_left.store(peaks[0].to_bits(), Ordering::Relaxed); peak_right.store(peaks[1].to_bits(), Ordering::Relaxed);
            }, move |err| { if let Ok(mut value) = error.try_lock() { *value = err.to_string(); } }, None)
        }}; }
        let output = match config.sample_format() {
            cpal::SampleFormat::F32 => stream!(f32), cpal::SampleFormat::I16 => stream!(i16), cpal::SampleFormat::U16 => stream!(u16),
            format => return Err(format!("Unsupported audio output format: {format:?}")),
        }.map_err(|e| e.to_string())?;
        self.spawn_mixer();
        if let Err(error) = output.play() { self.stop_output(); return Err(error.to_string()); } self.stream = Some(output); *self.error.lock().unwrap() = String::new();
        self.stream_active.store(true, Ordering::Release); Ok(())
    }
    fn start_null_output(&mut self) -> Result<(), String> {
        self.last_attempt = Some(Instant::now());
        self.output_rate = 48000;
        self.spawn_mixer();
        let (stop, ring, tap, underflows, callbacks) = (self.stop.clone(), self.ring.clone(), self.tap.clone(), self.underflows.clone(), self.callbacks.clone());
        let (callback_frames, peak_left, peak_right) = (self.callback_frames.clone(), self.peak_left.clone(), self.peak_right.clone());
        self.null_output = Some(thread::spawn(move || {
            let mut resampler = TapResampler::default(); let mut buffer = vec![0.0_f32; 512];
            let started = Instant::now(); let mut frames: u64 = 0;
            while !stop.load(Ordering::Acquire) {
                let due = started + Duration::from_secs_f64(frames as f64 / 48000.0);
                let now = Instant::now();
                if now < due { thread::sleep(due - now); continue; }
                callbacks.fetch_add(1, Ordering::Relaxed); callback_frames.store(256, Ordering::Relaxed);
                let peaks = render_output(&mut buffer, 2, &ring, &tap, &mut resampler, 48000, &underflows);
                peak_left.store(peaks[0].to_bits(), Ordering::Relaxed); peak_right.store(peaks[1].to_bits(), Ordering::Relaxed);
                frames += 256;
            }
        }));
        *self.error.lock().unwrap() = String::new();
        self.stream_active.store(true, Ordering::Release); Ok(())
    }
    fn spawn_mixer(&mut self) {
        self.stop.store(false, Ordering::Release);
        let stop = self.stop.clone(); let ring = self.ring.clone(); let mix = self.mix.clone(); let latency = self.latency.clone(); let rate = self.output_rate as f64; let callback_frames = self.callback_frames.clone();
        self.worker = Some(thread::spawn(move || {
            let mut readers: HashMap<(String, PathBuf), Reader> = HashMap::new();
            let mut gains: HashMap<String, (f32, f32)> = HashMap::new();
            while !stop.load(Ordering::Acquire) {
                if ring.len() >= (callback_frames.load(Ordering::Relaxed).saturating_mul(4).max(1024)).min(RING - 256) { thread::sleep(Duration::from_millis(1)); continue; }
                let snapshot = mix.lock().ok().map(|s| (s.voices.clone(), s.at));
                let Some((voices, at)) = snapshot else { continue; };
                readers.retain(|(id, path), _| voices.iter().any(|v| v.voice.id == *id && v.asset.path == *path));
                gains.retain(|id, _| voices.iter().any(|v| v.voice.id == *id));
                for entry in &voices { gains.entry(entry.voice.id.clone()).or_insert((0.0, 0.0)); }
                let age = at.elapsed().as_secs_f64();
                let ahead = ring.len() as f64 / 2.0 / rate + latency.load(Ordering::Acquire) as f64 / 1e9;
                let smoothing = (1.0 / (rate * 0.003)) as f32;
                let mut block = [[0.0_f32; 2]; 128];
                // Mix each voice as a block: resolve its independent cursor and
                // gain once, not 128 times. Assets remain shared and bounded.
                for entry in &voices {
                    let voice = &entry.voice;
                    let (left, right) = balance(voice.pan);
                    let target = if voice.playing && age <= 0.5 { voice.gain } else { 0.0 };
                    let gain = gains.get_mut(&voice.id).unwrap();
                    if target == 0.0 && gain.0.abs() + gain.1.abs() < 0.00001 { continue; }
                    let key = voice_reader_key(entry);
                    if !readers.contains_key(&key) {
                        let Ok(file) = File::open(&key.1) else { continue; };
                        readers.insert(key.clone(), Reader { file, start: 0, samples: Vec::new(), bytes: Vec::new() });
                    }
                    let reader = readers.get_mut(&key).unwrap();
                    for (frame, sum) in block.iter_mut().enumerate() {
                        gain.0 += (target * left - gain.0) * smoothing;
                        gain.1 += (target * right - gain.1) * smoothing;
                        if gain.0.abs() + gain.1.abs() < 0.00001 { continue; }
                        let Some(time) = transport_time(voice.time + (age + ahead + frame as f64 / rate) * voice.rate, voice.lo, voice.hi, voice.looping, voice.bounce) else { continue; };
                        let position = time.max(0.0) * RATE;
                        let a = reader.sample(&entry.asset, position.floor() as u64);
                        let next_time = transport_time(time + 1.0 / RATE, voice.lo, voice.hi, voice.looping, voice.bounce).unwrap_or(time);
                        let b = reader.sample(&entry.asset, (next_time.max(0.0) * RATE).floor() as u64);
                        let fraction = position.fract() as f32;
                        sum[0] += (a[0] + (b[0] - a[0]) * fraction) * gain.0;
                        sum[1] += (a[1] + (b[1] - a[1]) * fraction) * gain.1;
                    }
                }
                for sum in block {
                    // Linked stereo peak protection preserves balance when layers sum above unity.
                    let peak = sum[0].abs().max(sum[1].abs()).max(1.0);
                    ring.push(sum[0] / peak, sum[1] / peak);
                }
            }
        }));
    }
    fn stop_output(&mut self) {
        self.stream_active.store(false, Ordering::Release);
        self.stream = None; self.stop.store(true, Ordering::Release);
        if let Some(worker) = self.worker.take() { let _ = worker.join(); }
        if let Some(null_output) = self.null_output.take() { let _ = null_output.join(); }
        self.ring = Arc::new(Ring::new());
    }
    /// Stream the device mix to a loopback sink while a recording runs. The
    /// timeline starts now and stays continuous whether or not an output
    /// stream exists: silence stands in for a closed device and for frames
    /// the ring had to drop, so the sink never has to reason about gaps.
    pub fn start_tap(&mut self, port: u16, token: &str) -> Result<Value, String> {
        self.stop_tap();
        let address = std::net::SocketAddr::from(([127, 0, 0, 1], port));
        let mut stream = std::net::TcpStream::connect_timeout(&address, Duration::from_secs(2)).map_err(|e| e.to_string())?;
        stream.set_write_timeout(Some(Duration::from_secs(10))).map_err(|e| e.to_string())?;
        stream.set_nodelay(true).map_err(|e| e.to_string())?;
        stream.write_all(token.as_bytes()).map_err(|e| e.to_string())?;
        let rate = self.output_rate;
        let started_unix_ms = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0);
        let started = Instant::now();
        self.tap.arm(rate);
        let stop = Arc::new(AtomicBool::new(false));
        let (tap, stream_active, stop_flag) = (self.tap.clone(), self.stream_active.clone(), stop.clone());
        let worker = thread::spawn(move || {
            let mut sent: u64 = 0; let mut padded_drops: u64 = 0; let mut samples: Vec<f32> = Vec::new(); let mut error = String::new();
            loop {
                let stopping = stop_flag.load(Ordering::Acquire);
                samples.clear();
                while let Some((left, right)) = tap.pop() { samples.push(left); samples.push(right); }
                let dropped = tap.dropped();
                if dropped > padded_drops { samples.resize(samples.len() + ((dropped - padded_drops) * 2) as usize, 0.0); padded_drops = dropped; }
                if !stream_active.load(Ordering::Acquire) && !stopping {
                    let expected = (started.elapsed().as_secs_f64() * rate as f64) as u64;
                    let have = sent + (samples.len() / 2) as u64;
                    if expected > have { samples.resize(samples.len() + ((expected - have) * 2) as usize, 0.0); }
                }
                if !samples.is_empty() {
                    if let Err(e) = write_tap_chunk(&mut stream, rate, sent, dropped, &samples) { error = e.to_string(); break; }
                    sent += (samples.len() / 2) as u64;
                }
                if stopping { break; }
                thread::sleep(Duration::from_millis(5));
            }
            let _ = stream.flush(); let _ = stream.shutdown(std::net::Shutdown::Both);
            (sent, error)
        });
        self.tap_session = Some(TapSession { stop, worker: Some(worker), started_unix_ms, rate });
        Ok(json!({ "sample_rate": rate, "started_unix_ms": started_unix_ms, "channels": 2, "format": "f32le", "latency_ms": self.latency_ms() }))
    }
    pub fn stop_tap(&mut self) -> Value {
        let Some(mut session) = self.tap_session.take() else { return json!({ "active": false, "frames": 0, "dropped": 0 }); };
        self.tap.disarm();
        session.stop.store(true, Ordering::Release);
        let (frames, error) = session.worker.take().and_then(|worker| worker.join().ok()).unwrap_or((0, "audio tap thread panicked".into()));
        // Frame n of the tap was handed to the device at started_unix_ms + n / rate
        // and heard `latency_ms` later, which is when the mixer aligned it to the picture.
        json!({ "active": false, "frames": frames, "dropped": self.tap.dropped(), "sample_rate": session.rate, "started_unix_ms": session.started_unix_ms,
            "latency_ms": self.latency_ms(), "error": error })
    }
    fn latency_ms(&self) -> f64 { if self.stream.is_some() { self.latency.load(Ordering::Acquire) as f64 / 1e6 } else { 0.0 } }
    pub fn tap_status(&self) -> Value {
        json!({ "active": self.tap_session.is_some(), "frames": self.tap.pushed(), "dropped": self.tap.dropped(), "sample_rate": self.tap.rate(),
            "started_unix_ms": self.tap_session.as_ref().map(|s| s.started_unix_ms).unwrap_or(0) })
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
        if self.stream.is_none() && self.null_output.is_none() && self.last_attempt.is_none_or(|at| at.elapsed() >= Duration::from_secs(2)) && voices.iter().any(|v| v.voice.playing && v.voice.gain > 0.0 && v.asset.frames.load(Ordering::Acquire) > 0) {
            self.last_attempt = Some(Instant::now());
            if let Err(error) = self.start_output() { *self.error.lock().unwrap() = error; }
        }
        if let Ok(mut mix) = self.mix.try_lock() { mix.voices = voices; mix.at = Instant::now(); }
    }
    pub fn status(&self) -> Value {
        json!({ "running": self.stream.is_some() || self.null_output.is_some(), "device": self.device, "sample_rate": self.output_rate,
            "peak_left": f32::from_bits(self.peak_left.load(Ordering::Relaxed)), "peak_right": f32::from_bits(self.peak_right.load(Ordering::Relaxed)),
            "voices": self.mix.lock().map(|s| s.voices.iter().map(|v| json!({"id": v.voice.id, "time": v.voice.time, "rate": v.voice.rate, "playing": v.voice.playing, "gain": v.voice.gain, "pan": v.voice.pan})).collect::<Vec<_>>()).unwrap_or_default(),
            "callbacks": self.callbacks.load(Ordering::Relaxed), "underflow_frames": self.underflows.load(Ordering::Relaxed),
            "latency_ms": self.latency.load(Ordering::Acquire) as f64 / 1e6, "tap": self.tap_status(),
            "cache_bytes": self.budget.load(Ordering::Acquire), "error": self.error.lock().map(|s| s.clone()).unwrap_or_default(),
            "assets": self.assets.iter().map(|(uri, a)| json!({ "uri": uri, "seconds_ready": a.frames.load(Ordering::Acquire) as f64 / RATE,
                "complete": a.done.load(Ordering::Acquire), "error": a.error.lock().map(|s| s.clone()).unwrap_or_default() })).collect::<Vec<_>>() })
    }
}
impl Drop for ClipAudio {
    fn drop(&mut self) { self.stop_tap(); self.stop_output(); for asset in self.assets.values() { asset.cancel(); } self.jobs.take(); for worker in self.decoders.drain(..) { let _ = worker.join(); } self.assets.clear(); if let Ok(mut mix) = self.mix.lock() { mix.voices.clear(); } let _ = std::fs::remove_dir(&self.directory); }
}
#[cfg(test)] mod tests {
    use super::*;
    #[test] fn same_asset_voices_keep_independent_read_windows() {
        let path = std::env::temp_dir().join(format!("ghost-voice-reader-{}.pcm", std::process::id()));
        let samples: Vec<u8> = (0..96000).flat_map(|i| {
            let x = if i < 48000 { 0.25f32 } else { -0.5f32 };
            [x.to_le_bytes(), x.to_le_bytes()].concat()
        }).collect();
        std::fs::write(&path, samples).unwrap();
        let asset = Arc::new(Asset { path: path.clone(), frames: AtomicU64::new(96000), bytes: AtomicU64::new(0),
            done: AtomicBool::new(true), cancelled: AtomicBool::new(false), error: Mutex::new(String::new()), child: Mutex::new(None), budget: Arc::new(AtomicU64::new(0)) });
        let voices: Vec<_> = ["deck-a", "deck-b"].iter().map(|id| MixVoice { asset: asset.clone(), voice: Voice {
            id: id.to_string(), uri: "same-file".to_string(), time: 0.0, rate: 1.0, lo: 0.0, hi: 2.0, looping: true, bounce: false, gain: 1.0, pan: 0.0, playing: true,
        }}).collect();
        let mut readers: HashMap<_, _> = voices.iter().map(|v| (voice_reader_key(v), Reader { file: File::open(&path).unwrap(), start: 0, samples: Vec::new(), bytes: Vec::new() })).collect();
        assert_eq!(readers.len(), 2);
        for i in 0..128 {
            assert_eq!(readers.get_mut(&voice_reader_key(&voices[0])).unwrap().sample(&asset, i), [0.25; 2]);
            assert_eq!(readers.get_mut(&voice_reader_key(&voices[1])).unwrap().sample(&asset, 48000+i), [-0.5; 2]);
        }
        assert_eq!(readers[&voice_reader_key(&voices[0])].start, 0);
        assert_eq!(readers[&voice_reader_key(&voices[1])].start, 45056);
        drop(readers); drop(voices); drop(asset);
    }
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
    #[test] fn recording_tap_mirrors_the_device_mix_including_clamp_and_underflow() {
        let ring = Ring::new(); let tap = Tap::new(); let underflows = AtomicU64::new(0);
        let mut resampler = TapResampler::default();
        tap.arm(48000);
        // 300 mixed frames, then the device asks for 320: the last 20 underflow to silence.
        for index in 0..300 { let x = (index as f32 / 300.0) * 2.5 - 1.25; ring.push(x, -x * 0.5); }
        let mut device = vec![0.0_f32; 320 * 2];
        let peaks = render_output(&mut device, 2, &ring, &tap, &mut resampler, 48000, &underflows);
        assert_eq!(underflows.load(Ordering::Relaxed), 20);
        assert!(peaks[0] > 1.0);
        assert_eq!(tap.pushed(), 320);
        for frame in device.chunks(2) { let (l, r) = tap.pop().unwrap(); assert_eq!((l, r), (frame[0], frame[1])); assert!(l.abs() <= 1.0); }
        assert_eq!(tap.pop(), None);
        // A mono device carries the folded signal; the tap carries the same fold on both channels.
        ring.push(0.5, -0.1);
        let mut mono = vec![0.0_f32; 1];
        render_output(&mut mono, 1, &ring, &tap, &mut resampler, 48000, &underflows);
        assert_eq!(tap.pop(), Some((mono[0], mono[0])));
        // Integer devices receive the converted sample; the tap keeps float.
        ring.push(0.25, 0.25);
        let mut i16s = vec![0_i16; 2];
        render_output(&mut i16s, 2, &ring, &tap, &mut resampler, 48000, &underflows);
        assert_eq!(i16s[0], <i16 as cpal::FromSample<f32>>::from_sample_(0.25));
        assert_eq!(tap.pop(), Some((0.25, 0.25)));
        // Disarmed: the device still plays but the tap records nothing.
        tap.disarm(); ring.push(0.5, 0.5);
        render_output(&mut device[..2], 2, &ring, &tap, &mut resampler, 48000, &underflows);
        assert_eq!(tap.pop(), None);
    }
    #[test] fn recording_tap_counts_overflow_drops_without_blocking() {
        let tap = Tap::new(); tap.arm(48000);
        let capacity = TAP_RING / 2;
        for index in 0..capacity + 25 { tap.push(index as f32, 0.0); }
        assert_eq!(tap.dropped(), 25);
        assert_eq!(tap.pushed() as usize, capacity);
        assert_eq!(tap.pop(), Some((0.0, 0.0)));
        assert_eq!(tap.pop(), Some((1.0, 0.0)));
        // Draining one frame frees one slot for the next push.
        tap.push(-1.0, 0.0);
        assert_eq!(tap.dropped(), 25);
        let mut drained = 2;
        while tap.pop().is_some() { drained += 1; }
        assert_eq!(drained, capacity + 1);
    }
    #[test] fn recording_tap_resamples_when_the_device_rate_differs() {
        let tap = Tap::new(); tap.arm(48000);
        let mut resampler = TapResampler::default();
        for index in 0..961 { resampler.push(&tap, 96000, index as f32, 0.0); }
        let mut count = 0; let mut last = -1.0_f32;
        while let Some((left, _)) = tap.pop() { assert!(left > last); last = left; count += 1; }
        assert!((count as i64 - 480).abs() <= 1, "{count}");
    }
    #[test] fn transition_fade_is_equal_power_and_continuous_when_interrupted() {
        use std::f64::consts::FRAC_PI_2;
        let (mut incoming, mut outgoing) = (fade_start(FadeRole::In, None), fade_start(FadeRole::Out, None));
        assert_eq!((fade_level(incoming), fade_level(outgoing)), (0.0, 1.0));
        // A transition that has not started yet holds both levels.
        incoming = advance_fade(incoming, FadeRole::In, 2.0, false, 0.5);
        assert_eq!(fade_level(incoming), 0.0);
        // 2 s transition sampled every 10 ms: sin^2 + cos^2 stays 1 and both reach their ends at 2 s.
        for step in 1..=200 {
            incoming = advance_fade(incoming, FadeRole::In, 2.0, true, 0.01);
            outgoing = advance_fade(outgoing, FadeRole::Out, 2.0, true, 0.01);
            let (a, b) = (fade_level(incoming) as f64, fade_level(outgoing) as f64);
            assert!((a * a + b * b - 1.0).abs() < 1e-4, "step {step}: {a} {b}");
            if step == 100 { assert!((a - std::f64::consts::FRAC_1_SQRT_2).abs() < 1e-3); }
        }
        assert!((fade_level(incoming) - 1.0).abs() < 1e-6 && fade_level(outgoing).abs() < 1e-6);
        assert_eq!(fade_level(advance_fade(incoming, FadeRole::In, 2.0, true, 5.0)), 1.0);
        // Interrupted at 1 s of a 2 s fade: the incoming voice becomes the outgoing voice of a 1 s fade
        // and continues from its current level instead of jumping to full.
        let mut theta = fade_start(FadeRole::In, None);
        for _ in 0..100 { theta = advance_fade(theta, FadeRole::In, 2.0, true, 0.01); }
        let before = fade_level(theta);
        theta = advance_fade(theta, FadeRole::Out, 1.0, true, 0.0);
        assert_eq!(fade_level(theta), before);
        for _ in 0..50 { theta = advance_fade(theta, FadeRole::Out, 1.0, true, 0.01); }
        assert!(fade_level(theta) < 1e-6);
        // A voice first seen mid-transition starts at the picture's progress.
        assert!((fade_start(FadeRole::In, Some(0.5)) - FRAC_PI_2 * 0.5).abs() < 1e-12);
        assert!((fade_level(fade_start(FadeRole::Out, Some(0.5))) as f64 - std::f64::consts::FRAC_1_SQRT_2).abs() < 1e-6);
        // 0 s stays a cut.
        assert_eq!(fade_level(advance_fade(0.0, FadeRole::In, 0.0, false, 0.0)), 1.0);
        assert_eq!(fade_level(advance_fade(FRAC_PI_2, FadeRole::Out, 0.0, true, 0.0)), 0.0);
    }
}
