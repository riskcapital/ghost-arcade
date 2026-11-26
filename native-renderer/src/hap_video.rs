//! Indexed HAP MOV reader. Only Snappy is expanded on the CPU; BC blocks stay
//! compressed until sampled by the GPU. No FFmpeg process is used for playback.
//! Format: https://github.com/Vidvox/hap/blob/master/documentation/HapVideoDRAFT.md
use std::{
    fs::File,
    io::{Read, Seek, SeekFrom},
    path::Path,
    sync::Arc,
};
const MAX_INDEX_BYTES: u64 = 32 * 1024 * 1024;
const MAX_SAMPLES: usize = 1_000_000;
const MAX_PACKET_BYTES: usize = 128 * 1024 * 1024;
type Result<T> = std::result::Result<T, String>;
fn bad() -> String {
    "Invalid or unsupported HAP MOV layout".into()
}
fn be32(b: &[u8], at: usize) -> Result<u32> {
    Ok(u32::from_be_bytes(
        b.get(at..at + 4).ok_or_else(bad)?.try_into().unwrap(),
    ))
}
fn be64(b: &[u8], at: usize) -> Result<u64> {
    Ok(u64::from_be_bytes(
        b.get(at..at + 8).ok_or_else(bad)?.try_into().unwrap(),
    ))
}
fn le32(b: &[u8], at: usize) -> Result<u32> {
    Ok(u32::from_le_bytes(
        b.get(at..at + 4).ok_or_else(bad)?.try_into().unwrap(),
    ))
}
fn atoms(mut b: &[u8]) -> Result<Vec<([u8; 4], &[u8])>> {
    let mut out = Vec::new();
    while !b.is_empty() {
        let small = be32(b, 0)? as usize;
        let kind = b.get(4..8).ok_or_else(bad)?.try_into().unwrap();
        let (size, head) = if small == 1 {
            (usize::try_from(be64(b, 8)?).map_err(|_| bad())?, 16)
        } else if small == 0 {
            (b.len(), 8)
        } else {
            (small, 8)
        };
        if size < head || size > b.len() {
            return Err(bad());
        }
        if out.len() >= 65536 {
            return Err(bad());
        }
        out.push((kind, &b[head..size]));
        b = &b[size..];
    }
    Ok(out)
}
fn atom<'a>(b: &'a [u8], kind: &[u8; 4]) -> Result<&'a [u8]> {
    atoms(b)?
        .into_iter()
        .find(|(k, _)| k == kind)
        .map(|(_, b)| b)
        .ok_or_else(bad)
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum HapFormat {
    Rgb,
    Alpha,
    YCoCg,
}
impl HapFormat {
    pub fn block_bytes(self) -> usize {
        if self == Self::Rgb { 8 } else { 16 }
    }
    pub fn fourcc(self) -> u32 {
        u32::from_be_bytes(match self {
            Self::Rgb => *b"Hap1",
            Self::Alpha => *b"Hap5",
            Self::YCoCg => *b"HapY",
        })
    }
}
#[derive(Clone, Debug)]
pub struct HapFrame {
    pub width: u32,
    pub height: u32,
    pub pts_seconds: f64,
    pub duration_seconds: f64,
    pub format: HapFormat,
    pub blocks: Arc<Vec<u8>>,
}
#[derive(Clone, Copy, Debug)]
pub struct HapMetadata {
    pub width: u32,
    pub height: u32,
    pub fps: f64,
    pub duration_seconds: f64,
}
struct Sample {
    offset: u64,
    size: usize,
    time: u64,
    duration: u32,
}
pub struct HapVideoDecoder {
    file: File,
    packet: Vec<u8>,
    metadata: HapMetadata,
    format: HapFormat,
    samples: Vec<Sample>,
    timescale: f64,
    cursor: usize,
    end: f64,
    /// Block buffers handed out in frames, reused once every frame holding
    /// one has been dropped (a 4K HAP Q frame is about 8 MB).
    slabs: Vec<Arc<Vec<u8>>>,
}
/// Buffers a decoder keeps for reuse: the queued frame, the one being shown
/// and the one being decoded. `frame_budget_bytes` already counts three.
const RECYCLED_SLABS: usize = 3;
impl HapVideoDecoder {
    /// Like `open`, but says whether a refusal is about a HAP movie (its
    /// reason is then the one to show) or about a file that is not HAP at
    /// all (another decoder should try it).
    #[cfg_attr(not(any(target_os = "macos", target_os = "windows")), allow(dead_code))]
    pub fn open_checked(path: &Path) -> std::result::Result<Self, HapOpenError> {
        match Self::open(path) {
            Ok(decoder) => Ok(decoder),
            Err(reason) if sniff_hap_codec(path).is_some() => Err(HapOpenError::Unplayable(reason)),
            Err(_) => Err(HapOpenError::NotHap),
        }
    }
    pub fn open(path: &Path) -> Result<Self> {
        let (file, len, moov) = read_moov(path)?;
        let mut unsupported: Option<&'static str> = None;
        for (kind, track) in atoms(&moov)? {
            if kind != *b"trak" {
                continue;
            }
            let Ok(mdia) = atom(track, b"mdia") else {
                continue;
            };
            let Ok(minf) = atom(mdia, b"minf") else {
                continue;
            };
            let Ok(stbl) = atom(minf, b"stbl") else {
                continue;
            };
            let Ok(stsd) = atom(stbl, b"stsd") else {
                continue;
            };
            if be32(stsd, 4)? != 1 {
                continue;
            }
            let descriptions = atoms(stsd.get(8..).ok_or_else(bad)?)?;
            let Some((codec, description)) = descriptions.first() else {
                continue;
            };
            let format = match codec {
                b"Hap1" => HapFormat::Rgb,
                b"Hap5" => HapFormat::Alpha,
                b"HapY" => HapFormat::YCoCg,
                other => {
                    if let Some(name) = unsupported_variant_name(other) {
                        unsupported.get_or_insert(name);
                    }
                    continue;
                }
            };
            let width = u16::from_be_bytes(
                description.get(24..26).ok_or_else(bad)?.try_into().unwrap(),
            ) as u32;
            let height = u16::from_be_bytes(
                description.get(26..28).ok_or_else(bad)?.try_into().unwrap(),
            ) as u32;
            if width == 0 || height == 0 || width > 8192 || height > 8192 {
                return Err("HAP dimensions exceed the supported limit".into());
            }
            // The texture path currently uses the coded geometry. Do
            // not silently ignore a container crop, aspect or rotation.
            if let Ok(tkhd) = atom(track, b"tkhd") {
                let matrix_at = match tkhd.first() { Some(0) => 40, Some(1) => 52, _ => return Err(bad()) };
                for i in 0..9 {
                    let expected = match i { 0 | 4 => 0x10000, 8 => 0x40000000, _ => 0 };
                    if be32(tkhd, matrix_at + i * 4)? != expected { return Err("Transformed HAP tracks require compatibility playback".into()); }
                }
            }
            for (kind, data) in atoms(description.get(78..).ok_or_else(bad)?)? {
                if kind == *b"clap" || (kind == *b"pasp" && be32(data, 0)? != be32(data, 4)?) {
                    return Err("Cropped or non-square-pixel HAP requires compatibility playback".into());
                }
            }
            if let Ok(edts) = atom(track, b"edts") {
                if !plays_from_first_frame(atom(edts, b"elst")?)? {
                    return Err("HAP edit lists require compatibility playback".into());
                }
            }
            let mdhd = atom(mdia, b"mdhd")?;
            let scale_at = match mdhd.first() {
                Some(0) => 12,
                Some(1) => 20,
                _ => return Err(bad()),
            };
            let timescale = be32(mdhd, scale_at)? as f64;
            if timescale == 0.0 {
                return Err(bad());
            }
            let samples = sample_index(stbl, len)?;
            let duration_seconds = samples
                .last()
                .map(|s| (s.time + s.duration as u64) as f64 / timescale)
                .ok_or_else(bad)?;
            let fps = samples.len() as f64 / duration_seconds;
            return Ok(Self {
                file,
                packet: Vec::new(),
                metadata: HapMetadata {
                    width,
                    height,
                    fps,
                    duration_seconds,
                },
                format,
                samples,
                timescale,
                cursor: 0,
                end: duration_seconds,
                slabs: Vec::new(),
            });
        }
        match unsupported {
            Some(name) => Err(format!("{name} is not supported by GPU HAP playback yet")),
            None => Err("Movie has no supported HAP video track".into()),
        }
    }
    pub fn metadata(&self) -> HapMetadata {
        self.metadata
    }
    pub fn index_bytes(&self) -> usize {
        self.samples.len() * std::mem::size_of::<Sample>()
    }
    pub fn frame_budget_bytes(&self) -> u64 {
        (self.metadata.width.div_ceil(4) as u64)
            * (self.metadata.height.div_ceil(4) as u64)
            * self.format.block_bytes() as u64
            * 3
            + 65536
            + self.index_bytes() as u64
    }
    pub fn seek(&mut self, time: f64, end: Option<f64>) -> Result<()> {
        if !time.is_finite() || time < 0.0 {
            return Err(bad());
        }
        self.cursor = self.samples.partition_point(|s| {
            (s.time + s.duration as u64) as f64 / self.timescale <= time + 1e-9
        });
        self.end = end.unwrap_or(self.metadata.duration_seconds);
        Ok(())
    }
    pub fn next_frame(&mut self) -> Result<Option<HapFrame>> {
        let Some(sample) = self.samples.get(self.cursor) else {
            return Ok(None);
        };
        let pts_seconds = sample.time as f64 / self.timescale;
        if pts_seconds >= self.end {
            return Ok(None);
        }
        self.file
            .seek(SeekFrom::Start(sample.offset))
            .map_err(|e| e.to_string())?;
        let expected = self.metadata.width.div_ceil(4) as usize
            * self.metadata.height.div_ceil(4) as usize
            * self.format.block_bytes();
        if sample.size > expected.saturating_mul(2).saturating_add(65536) {
            return Err("HAP packet exceeds its bounded frame budget".into());
        }
        self.packet.resize(sample.size, 0);
        self.file
            .read_exact(&mut self.packet)
            .map_err(|e| e.to_string())?;
        let duration = sample.duration;
        let blocks = self.decode_into_slab(expected)?;
        self.cursor += 1;
        Ok(Some(HapFrame {
            width: self.metadata.width,
            height: self.metadata.height,
            pts_seconds,
            duration_seconds: duration as f64 / self.timescale,
            format: self.format,
            blocks,
        }))
    }
    /// Decodes the packet just read into a buffer no frame still holds,
    /// keeping up to `RECYCLED_SLABS` of them; past that a frame gets a
    /// buffer of its own, freed with it as before.
    fn decode_into_slab(&mut self, expected: usize) -> Result<Arc<Vec<u8>>> {
        let free = self.slabs.iter_mut().position(|slab| Arc::get_mut(slab).is_some());
        let index = match free {
            Some(index) => index,
            None if self.slabs.len() < RECYCLED_SLABS => {
                self.slabs.push(Arc::new(Vec::new()));
                self.slabs.len() - 1
            }
            None => {
                let mut blocks = Vec::new();
                decode_packet_into(&self.packet, self.format, expected, &mut blocks)?;
                return Ok(Arc::new(blocks));
            }
        };
        let slab = Arc::get_mut(&mut self.slabs[index]).expect("free slab is unshared");
        decode_packet_into(&self.packet, self.format, expected, slab)?;
        Ok(self.slabs[index].clone())
    }
    pub fn step_frame(
        &mut self,
        reference: f64,
        direction: i32,
        start: f64,
        end: f64,
    ) -> Result<Option<HapFrame>> {
        let first = self.samples.partition_point(|s| {
            (s.time + s.duration as u64) as f64 / self.timescale <= start + 1e-9
        });
        let last = self
            .samples
            .partition_point(|s| (s.time as f64 / self.timescale) < end)
            .saturating_sub(1);
        if first > last || first >= self.samples.len() {
            return Ok(None);
        }
        let current = self
            .samples
            .partition_point(|s| s.time as f64 / self.timescale <= reference + 1e-9)
            .saturating_sub(1);
        self.cursor = if direction < 0 {
            current.saturating_sub(1)
        } else {
            current.saturating_add(1)
        }
        .clamp(first, last);
        self.end = end;
        self.next_frame()
    }
}
/// Why the native HAP path did not take a file.
#[derive(Debug)]
#[cfg_attr(not(any(target_os = "macos", target_os = "windows")), allow(dead_code))]
pub enum HapOpenError {
    /// Not a HAP movie: another decoder should try it.
    NotHap,
    /// A HAP movie this path cannot play; the reason is worth showing.
    Unplayable(String),
}

/// HAP variants other tools write that this path does not decode yet.
fn unsupported_variant_name(codec: &[u8; 4]) -> Option<&'static str> {
    match codec {
        b"HapM" => Some("HAP Q Alpha"),
        b"HapA" => Some("HAP Alpha-Only"),
        b"Hap7" => Some("HAP R"),
        b"HapH" => Some("HAP HDR"),
        other if other.starts_with(b"Hap") => Some("This HAP variant"),
        _ => None,
    }
}

/// The movie's `moov` box, read within the index memory limit.
fn read_moov(path: &Path) -> Result<(File, u64, Vec<u8>)> {
    let mut file = File::open(path).map_err(|e| e.to_string())?;
    let len = file.metadata().map_err(|e| e.to_string())?.len();
    let mut offset = 0u64;
    while offset.checked_add(8).is_some_and(|v| v <= len) {
        file.seek(SeekFrom::Start(offset))
            .map_err(|e| e.to_string())?;
        let mut header = [0u8; 16];
        file.read_exact(&mut header[..8])
            .map_err(|e| e.to_string())?;
        let short = be32(&header, 0)? as u64;
        let (size, head) = if short == 1 {
            file.read_exact(&mut header[8..])
                .map_err(|e| e.to_string())?;
            (be64(&header, 8)?, 16)
        } else if short == 0 {
            (len - offset, 8)
        } else {
            (short, 8)
        };
        if size < head || offset.checked_add(size).is_none_or(|v| v > len) {
            return Err(bad());
        }
        if &header[4..8] == b"moov" {
            if size - head > MAX_INDEX_BYTES {
                return Err("HAP movie index exceeds its memory limit".into());
            }
            let mut moov = vec![0u8; (size - head) as usize];
            file.read_exact(&mut moov).map_err(|e| e.to_string())?;
            return Ok((file, len, moov));
        }
        offset += size;
    }
    Err("Movie has no HAP sample index".into())
}

/// The first video sample description's codec when it is a HAP codec
/// (`Hap1`, `Hap5`, `HapY`, `HapM`, ...). Tolerant: any parse problem is
/// "not HAP".
#[cfg_attr(not(any(target_os = "macos", target_os = "windows")), allow(dead_code))]
pub fn sniff_hap_codec(path: &Path) -> Option<[u8; 4]> {
    let (_, _, moov) = read_moov(path).ok()?;
    for (kind, track) in atoms(&moov).ok()? {
        if kind != *b"trak" {
            continue;
        }
        let stsd = atom(track, b"mdia")
            .and_then(|m| atom(m, b"minf"))
            .and_then(|m| atom(m, b"stbl"))
            .and_then(|m| atom(m, b"stsd"));
        let Ok(stsd) = stsd else { continue };
        let Some(entries) = stsd.get(8..).and_then(|b| atoms(b).ok()) else { continue };
        if let Some((codec, _)) = entries.first()
            && codec.starts_with(b"Hap")
        {
            return Some(*codec);
        }
    }
    None
}

/// True when an edit list plays the media from its first sample at normal
/// speed: one edit at media time 0, optionally after one empty edit (a delay
/// before the track starts, which encoders write for a stream whose first
/// timestamp is not zero). The delay is dropped: a clip starts on its first
/// frame. Anything else (trims, speed changes, several pieces) is refused.
fn plays_from_first_frame(elst: &[u8]) -> Result<bool> {
    let version = *elst.first().ok_or_else(bad)?;
    let count = be32(elst, 4)? as usize;
    let entry = match version {
        0 => 12,
        1 => 20,
        _ => return Err(bad()),
    };
    let read = |i: usize| -> Result<(i64, u32)> {
        let at = 8 + i * entry;
        Ok(if version == 0 {
            (be32(elst, at + 4)? as i32 as i64, be32(elst, at + 8)?)
        } else {
            (be64(elst, at + 8)? as i64, be32(elst, at + 16)?)
        })
    };
    let normal = |(media_time, rate): (i64, u32)| media_time == 0 && rate == 0x10000;
    Ok(match count {
        1 => normal(read(0)?),
        2 => read(0)?.0 == -1 && normal(read(1)?),
        _ => false,
    })
}

fn sample_index(stbl: &[u8], file_len: u64) -> Result<Vec<Sample>> {
    let sizes = atom(stbl, b"stsz")?;
    let fixed = be32(sizes, 4)? as usize;
    let count = be32(sizes, 8)? as usize;
    if count == 0 || count > MAX_SAMPLES {
        return Err(bad());
    }
    let (offsets, wide) = match atom(stbl, b"co64") {
        Ok(b) => (b, true),
        Err(_) => (atom(stbl, b"stco")?, false),
    };
    let chunks = be32(offsets, 4)? as usize;
    let sc = atom(stbl, b"stsc")?;
    let sc_count = be32(sc, 4)? as usize;
    if sc_count == 0 || sc_count > chunks || chunks > MAX_SAMPLES || be32(sc, 8)? != 1 {
        return Err(bad());
    }
    let mut mappings = Vec::with_capacity(sc_count);
    for i in 0..sc_count {
        let first = be32(sc, 8 + i * 12)? as usize;
        let per = be32(sc, 12 + i * 12)? as usize;
        if first == 0
            || first > chunks
            || per == 0
            || be32(sc, 16 + i * 12)? != 1
            || mappings.last().is_some_and(|&(prev, _)| first <= prev)
        {
            return Err(bad());
        }
        mappings.push((first, per));
    }
    let mut samples = Vec::with_capacity(count);
    let mut map = 0;
    for chunk in 0..chunks {
        if map + 1 < mappings.len() && chunk + 1 >= mappings[map + 1].0 {
            map += 1;
        }
        let mut offset = if wide {
            be64(offsets, 8 + chunk * 8)?
        } else {
            be32(offsets, 8 + chunk * 4)? as u64
        };
        for _ in 0..mappings[map].1 {
            if samples.len() >= count {
                return Err(bad());
            }
            let size = if fixed > 0 {
                fixed
            } else {
                be32(sizes, 12 + samples.len() * 4)? as usize
            };
            if size == 0
                || size > MAX_PACKET_BYTES
                || offset.checked_add(size as u64).is_none_or(|v| v > file_len)
            {
                return Err(bad());
            }
            samples.push(Sample {
                offset,
                size,
                time: 0,
                duration: 0,
            });
            offset += size as u64;
        }
    }
    if samples.len() != count {
        return Err(bad());
    }
    let stts = atom(stbl, b"stts")?;
    let runs = be32(stts, 4)? as usize;
    if runs > count {
        return Err(bad());
    }
    let mut cursor = 0;
    let mut time = 0u64;
    for i in 0..runs {
        let n = be32(stts, 8 + i * 8)? as usize;
        let delta = be32(stts, 12 + i * 8)?;
        if delta == 0 || n > count - cursor {
            return Err(bad());
        }
        for sample in &mut samples[cursor..cursor + n] {
            sample.time = time;
            sample.duration = delta;
            time = time.checked_add(delta as u64).ok_or_else(bad)?;
        }
        cursor += n;
    }
    if cursor != count {
        return Err(bad());
    }
    if let Ok(ctts) = atom(stbl, b"ctts") {
        let n = be32(ctts, 4)? as usize;
        if n > count {
            return Err(bad());
        }
        for i in 0..n {
            if be32(ctts, 12 + i * 8)? != 0 {
                return Err("HAP reordered samples require compatibility playback".into());
            }
        }
    }
    Ok(samples)
}
fn section(b: &[u8]) -> Result<(u8, &[u8], usize)> {
    let h = b.get(..4).ok_or_else(bad)?;
    let short = h[0] as usize | ((h[1] as usize) << 8) | ((h[2] as usize) << 16);
    let (n, head): (usize, usize) = if short == 0 {
        (le32(b, 4)? as usize, 8)
    } else {
        (short, 4)
    };
    let end = head.checked_add(n).ok_or_else(bad)?;
    Ok((h[3], b.get(head..end).ok_or_else(bad)?, end))
}
/// One second-stage chunk of a frame: compressed bytes, compressor and the
/// exact number of texture bytes it expands to.
struct Chunk<'a> {
    input: &'a [u8],
    compressor: u8,
    len: usize,
}
fn chunk_len(input: &[u8], compressor: u8) -> Result<usize> {
    match compressor {
        0x0a => Ok(input.len()),
        0x0b => snap::raw::decompress_len(input).map_err(|e| e.to_string()),
        _ => Err(bad()),
    }
}
fn expand_chunk(chunk: &Chunk, output: &mut [u8], snappy: &mut snap::raw::Decoder) -> Result<()> {
    if chunk.compressor == 0x0a {
        output.copy_from_slice(chunk.input);
    } else if snappy.decompress(chunk.input, output).map_err(|e| e.to_string())? != output.len() {
        return Err(bad());
    }
    Ok(())
}
/// Below this a frame expands faster on one thread than it takes to wake
/// others (a 1080p HAP frame is about 1-2 MB).
const PARALLEL_MIN_BYTES: usize = 512 * 1024;
/// Worker threads one frame may use, besides the decoding thread itself.
fn frame_workers() -> usize {
    static WORKERS: std::sync::OnceLock<usize> = std::sync::OnceLock::new();
    *WORKERS.get_or_init(|| {
        std::thread::available_parallelism()
            .map(|n| n.get())
            .unwrap_or(1)
            .saturating_sub(1)
            .clamp(0, 7)
    })
}
/// Expands every chunk into `output` (exactly `expected` bytes). Chunks are
/// independent, so a large frame's chunks expand on several threads, each
/// writing its own disjoint part of the one output buffer.
fn expand_chunks(chunks: &[Chunk], output: &mut Vec<u8>, expected: usize) -> Result<()> {
    let mut total = 0usize;
    for chunk in chunks {
        total = total.checked_add(chunk.len).ok_or_else(bad)?;
        if total > expected {
            return Err("HAP block data exceeds frame dimensions".into());
        }
    }
    if total != expected {
        return Err("HAP block data does not match frame dimensions".into());
    }
    // A recycled buffer already has this length: no clearing, no allocation.
    output.resize(expected, 0);
    // Stored (uncompressed) chunks are plain copies, bound by memory
    // bandwidth: only Snappy expansion is worth spreading over threads.
    let snappy_bytes: usize = chunks.iter().filter(|c| c.compressor == 0x0b).map(|c| c.len).sum();
    let workers = frame_workers().min(chunks.len().saturating_sub(1));
    if workers == 0 || snappy_bytes < PARALLEL_MIN_BYTES {
        let mut snappy = snap::raw::Decoder::new();
        let mut rest = output.as_mut_slice();
        for chunk in chunks {
            let (out, tail) = rest.split_at_mut(chunk.len);
            expand_chunk(chunk, out, &mut snappy)?;
            rest = tail;
        }
        return Ok(());
    }
    // Split the chunks into `workers + 1` runs of about equal output size.
    let mut runs: Vec<(&[Chunk], &mut [u8])> = Vec::with_capacity(workers + 1);
    let share = expected.div_ceil(workers + 1);
    let mut rest = output.as_mut_slice();
    let (mut first, mut bytes) = (0usize, 0usize);
    for (i, chunk) in chunks.iter().enumerate() {
        bytes += chunk.len;
        if bytes >= share || i + 1 == chunks.len() {
            let (out, tail) = rest.split_at_mut(bytes);
            runs.push((&chunks[first..=i], out));
            rest = tail;
            first = i + 1;
            bytes = 0;
        }
    }
    let expand_run = |(run, mut out): (&[Chunk], &mut [u8])| -> Result<()> {
        let mut snappy = snap::raw::Decoder::new();
        for chunk in run {
            let (part, tail) = out.split_at_mut(chunk.len);
            expand_chunk(chunk, part, &mut snappy)?;
            out = tail;
        }
        Ok(())
    };
    let mut runs = runs.into_iter();
    let own = runs.next();
    std::thread::scope(|scope| {
        let handles: Vec<_> = runs.map(|run| scope.spawn(move || expand_run(run))).collect();
        let mut result = own.map_or(Ok(()), expand_run);
        for handle in handles {
            let joined = handle.join().unwrap_or_else(|_| Err("HAP chunk decode panicked".into()));
            if result.is_ok() {
                result = joined;
            }
        }
        result
    })
}
/// The chunks of one texture section: a single simple or Snappy chunk, or a
/// chunked frame's table (section type 0x0c).
fn texture_chunks(kind: u8, body: &[u8]) -> Result<Vec<Chunk<'_>>> {
    match kind >> 4 {
        c @ (0x0a | 0x0b) => Ok(vec![Chunk { input: body, compressor: c, len: chunk_len(body, c)? }]),
        0x0c => {
            let (ty, instructions, head) = section(body)?;
            if ty != 1 {
                return Err(bad());
            }
            let mut compressors = None;
            let mut sizes = None;
            let mut offsets = None;
            let mut left = instructions;
            while !left.is_empty() {
                let (ty, data, n) = section(left)?;
                left = &left[n..];
                match ty {
                    2 => {
                        if compressors.replace(data).is_some() {
                            return Err(bad());
                        }
                    }
                    3 => {
                        if sizes.replace(data).is_some() {
                            return Err(bad());
                        }
                    }
                    4 => {
                        if offsets.replace(data).is_some() {
                            return Err(bad());
                        }
                    }
                    _ => {}
                }
            }
            let compressors = compressors.ok_or_else(bad)?;
            let sizes = sizes.ok_or_else(bad)?;
            if compressors.is_empty()
                || compressors.len() > 65536
                || sizes.len() != compressors.len() * 4
                || offsets.is_some_and(|o| o.len() != sizes.len())
            {
                return Err(bad());
            }
            let payload = &body[head..];
            let mut offset = 0usize;
            let mut chunks = Vec::with_capacity(compressors.len());
            for (i, compressor) in compressors.iter().enumerate() {
                if let Some(offsets) = offsets {
                    offset = le32(offsets, i * 4)? as usize;
                }
                let end = offset
                    .checked_add(le32(sizes, i * 4)? as usize)
                    .ok_or_else(bad)?;
                let input = payload.get(offset..end).ok_or_else(bad)?;
                chunks.push(Chunk { input, compressor: *compressor, len: chunk_len(input, *compressor)? });
                offset = end;
            }
            Ok(chunks)
        }
        _ => Err(bad()),
    }
}
#[cfg(test)]
pub fn decode_packet(packet: &[u8], format: HapFormat, expected: usize) -> Result<Vec<u8>> {
    let mut output = Vec::new();
    decode_packet_into(packet, format, expected, &mut output)?;
    Ok(output)
}
/// Expands a frame's texture blocks into `output`, reusing its memory.
pub fn decode_packet_into(packet: &[u8], format: HapFormat, expected: usize, output: &mut Vec<u8>) -> Result<()> {
    let (kind, body, end) = section(packet)?;
    let tag = match format {
        HapFormat::Rgb => 0x0b,
        HapFormat::Alpha => 0x0e,
        HapFormat::YCoCg => 0x0f,
    };
    if end != packet.len() || kind & 15 != tag || expected > MAX_PACKET_BYTES {
        return Err(bad());
    }
    expand_chunks(&texture_chunks(kind, body)?, output, expected)
}

#[cfg(test)]
mod tests {
    use super::*;
    fn packet(kind: u8, body: &[u8]) -> Vec<u8> {
        let n = body.len();
        let mut p = vec![n as u8, (n >> 8) as u8, (n >> 16) as u8, kind];
        p.extend(body);
        p
    }
    #[test]
    fn simple_and_snappy_keep_exact_texture_blocks() {
        let bytes = vec![37u8; 128];
        assert_eq!(
            decode_packet(&packet(0xae, &bytes), HapFormat::Alpha, 128).unwrap(),
            bytes
        );
        let compressed = snap::raw::Encoder::new().compress_vec(&bytes).unwrap();
        assert_eq!(
            decode_packet(&packet(0xbe, &compressed), HapFormat::Alpha, 128).unwrap(),
            bytes
        );
        assert!(decode_packet(&packet(0xbe, &compressed), HapFormat::Alpha, 64).is_err());
        assert!(decode_packet(&packet(0xbe, &compressed), HapFormat::Rgb, 128).is_err());
    }
    #[test]
    fn chunk_tables_and_malformed_lengths_are_checked() {
        let mut instructions = packet(2, &[0x0a, 0x0a]);
        instructions.extend(packet(3, &[4, 0, 0, 0, 4, 0, 0, 0]));
        let mut body = packet(1, &instructions);
        body.extend([1, 2, 3, 4, 5, 6, 7, 8]);
        assert_eq!(
            decode_packet(&packet(0xcb, &body), HapFormat::Rgb, 8).unwrap(),
            vec![1, 2, 3, 4, 5, 6, 7, 8]
        );
        for n in 0..body.len() {
            assert!(decode_packet(&packet(0xcb, &body[..n]), HapFormat::Rgb, 8).is_err());
        }
        assert!(decode_packet(&[0, 0, 0, 0xbb, 255, 255, 255, 255], HapFormat::Rgb, 8).is_err());
    }
    /// A chunked frame large enough to expand on several threads, with
    /// uneven Snappy and stored chunks, comes out byte for byte in order.
    #[test]
    fn large_chunked_frames_expand_in_parallel_in_order() {
        let expected: Vec<u8> = (0..3_000_000u32).map(|i| ((i / 7) ^ (i >> 13)) as u8).collect();
        let cuts = [0usize, 1, 400_000, 400_016, 1_200_000, 2_000_000, 2_999_999, 3_000_000];
        let (mut compressors, mut sizes, mut payload) = (Vec::new(), Vec::new(), Vec::new());
        for (n, pair) in cuts.windows(2).enumerate() {
            let part = &expected[pair[0]..pair[1]];
            let bytes = if n % 3 == 1 { part.to_vec() } else { snap::raw::Encoder::new().compress_vec(part).unwrap() };
            compressors.push(if n % 3 == 1 { 0x0a } else { 0x0b });
            sizes.extend((bytes.len() as u32).to_le_bytes());
            payload.extend(bytes);
        }
        let long = |kind: u8, body: &[u8]| {
            let mut p = vec![0, 0, 0, kind];
            p.extend((body.len() as u32).to_le_bytes());
            p.extend(body);
            p
        };
        let mut instructions = packet(2, &compressors);
        instructions.extend(packet(3, &sizes));
        let mut body = packet(1, &instructions);
        body.extend(&payload);
        let frame = long(0xcf, &body);
        let mut slab = vec![9u8; expected.len()];
        decode_packet_into(&frame, HapFormat::YCoCg, expected.len(), &mut slab).unwrap();
        assert!(slab == expected);
        assert!(decode_packet(&frame, HapFormat::YCoCg, expected.len() - 1).is_err());
        assert!(decode_packet(&frame, HapFormat::YCoCg, expected.len() + 1).is_err());
        // A corrupt chunk on a worker thread fails the whole frame.
        let mut broken = frame.clone();
        let at = broken.len() - 10;
        broken[at..].fill(0xff);
        assert!(decode_packet(&broken, HapFormat::YCoCg, expected.len()).is_err());
    }
    #[test]
    fn hap_shader_validates() {
        let module = naga::front::wgsl::parse_str(include_str!("hap_texture.wgsl")).unwrap();
        naga::valid::Validator::new(
            naga::valid::ValidationFlags::all(),
            naga::valid::Capabilities::empty(),
        )
        .validate(&module)
        .unwrap();
    }
    #[test]
    #[ignore = "Requires GA_TEST_FFMPEG pointing at the bundled FFmpeg"]
    fn real_mov_frames_seek_step_and_chunked_decode() {
        let ffmpeg = std::env::var("GA_TEST_FFMPEG").expect("Set GA_TEST_FFMPEG");
        let dir = std::env::temp_dir().join(format!("ghost-hap-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        for format in ["hap", "hap_alpha", "hap_q"] {
            for compressor in ["none", "snappy"] {
                let path = dir.join(format!("{format}-{compressor}.mov"));
                let status = std::process::Command::new(&ffmpeg)
                    .args([
                        "-v",
                        "error",
                        "-y",
                        "-f",
                        "lavfi",
                        "-i",
                        "testsrc2=s=64x64:r=25:d=0.2",
                        "-c:v",
                        "hap",
                        "-format",
                        format,
                        "-compressor",
                        compressor,
                        "-chunks",
                        "4",
                    ])
                    .arg(&path)
                    .status()
                    .unwrap();
                assert!(status.success());
                let mut decoder = HapVideoDecoder::open(&path).unwrap();
                assert_eq!(decoder.metadata().width, 64);
                assert!((decoder.metadata().duration_seconds - 0.2).abs() < 1e-6);
                let mut frames = 0;
                while let Some(frame) = decoder.next_frame().unwrap() {
                    assert_eq!(
                        frame.blocks.len(),
                        if format == "hap" { 2048 } else { 4096 }
                    );
                    frames += 1;
                }
                assert_eq!(frames, 5);
                decoder.seek(0.09, None).unwrap();
                let f = decoder.next_frame().unwrap().unwrap();
                assert!((f.pts_seconds - 0.08).abs() < 1e-6);
                let f = decoder.step_frame(0.08, -1, 0.0, 0.2).unwrap().unwrap();
                assert!((f.pts_seconds - 0.04).abs() < 1e-6);
                let f = decoder.step_frame(0.16, 1, 0.0, 0.2).unwrap().unwrap();
                assert!((f.pts_seconds - 0.16).abs() < 1e-6);
            }
        }
        std::fs::remove_dir_all(dir).unwrap();
    }
    fn elst(version: u8, entries: &[(i64, u32)]) -> Vec<u8> {
        let mut b = vec![version, 0, 0, 0];
        b.extend_from_slice(&(entries.len() as u32).to_be_bytes());
        for &(media_time, rate) in entries {
            if version == 0 {
                b.extend_from_slice(&1000u32.to_be_bytes());
                b.extend_from_slice(&(media_time as i32).to_be_bytes());
            } else {
                b.extend_from_slice(&1000u64.to_be_bytes());
                b.extend_from_slice(&media_time.to_be_bytes());
            }
            b.extend_from_slice(&rate.to_be_bytes());
        }
        b
    }
    #[test]
    fn edit_lists_that_play_from_the_first_frame_are_accepted() {
        for v in [0u8, 1] {
            assert!(plays_from_first_frame(&elst(v, &[(0, 0x10000)])).unwrap());
            // A start delay (empty edit) before the media: dropped.
            assert!(plays_from_first_frame(&elst(v, &[(-1, 0x10000), (0, 0x10000)])).unwrap());
            // Trims, speed changes and several pieces still need compatibility playback.
            assert!(!plays_from_first_frame(&elst(v, &[(1500, 0x10000)])).unwrap());
            assert!(!plays_from_first_frame(&elst(v, &[(0, 0x20000)])).unwrap());
            assert!(!plays_from_first_frame(&elst(v, &[(0, 0x10000), (0, 0x10000)])).unwrap());
            assert!(!plays_from_first_frame(&elst(v, &[(-1, 0x10000), (500, 0x10000)])).unwrap());
            assert!(!plays_from_first_frame(&elst(v, &[])).unwrap());
        }
        assert!(plays_from_first_frame(&elst(2, &[(0, 0x10000)])).is_err());
        assert!(plays_from_first_frame(&[0, 0, 0, 0, 0, 0, 0, 1]).is_err());
    }
    #[test]
    fn unsupported_variants_are_named() {
        assert_eq!(unsupported_variant_name(b"HapM"), Some("HAP Q Alpha"));
        assert_eq!(unsupported_variant_name(b"HapA"), Some("HAP Alpha-Only"));
        assert_eq!(unsupported_variant_name(b"Hap7"), Some("HAP R"));
        assert_eq!(unsupported_variant_name(b"HapH"), Some("HAP HDR"));
        assert_eq!(unsupported_variant_name(b"Hapz"), Some("This HAP variant"));
        assert_eq!(unsupported_variant_name(b"avc1"), None);
    }
    #[test]
    #[ignore = "Requires GA_TEST_FFMPEG pointing at the bundled FFmpeg"]
    fn start_delays_unsupported_variants_and_other_codecs() {
        let ffmpeg = std::env::var("GA_TEST_FFMPEG").expect("Set GA_TEST_FFMPEG");
        let dir = std::env::temp_dir().join(format!("ghost-hap-variants-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let make = |name: &str, args: &[&str]| {
            let path = dir.join(name);
            let status = std::process::Command::new(&ffmpeg)
                .args(["-v", "error", "-y", "-f", "lavfi", "-i", "testsrc2=s=64x64:r=25:d=0.2"])
                .args(args)
                .arg(&path)
                .status()
                .unwrap();
            assert!(status.success());
            path
        };
        // An encoder start offset writes an empty edit first: it plays from its first frame.
        let delayed = make("delayed.mov", &["-c:v", "hap", "-format", "hap_q", "-output_ts_offset", "0.5"]);
        let mut decoder = HapVideoDecoder::open(&delayed).unwrap();
        assert!((decoder.metadata().duration_seconds - 0.2).abs() < 1e-6);
        assert!((decoder.next_frame().unwrap().unwrap().pts_seconds).abs() < 1e-9);
        // A HAP Q Alpha sample description: refused by name, as a HAP movie.
        let mut bytes = std::fs::read(&delayed).unwrap();
        let stsd = bytes.windows(4).position(|w| w == b"stsd").unwrap();
        let tag = stsd + bytes[stsd..].windows(4).position(|w| w == b"HapY").unwrap();
        bytes[tag..tag + 4].copy_from_slice(b"HapM");
        let q_alpha = dir.join("q-alpha.mov");
        std::fs::write(&q_alpha, &bytes).unwrap();
        assert_eq!(sniff_hap_codec(&q_alpha), Some(*b"HapM"));
        match HapVideoDecoder::open_checked(&q_alpha) {
            Err(HapOpenError::Unplayable(reason)) => assert!(reason.starts_with("HAP Q Alpha is not supported"), "{reason}"),
            other => panic!("expected a named refusal, got {:?}", other.err()),
        }
        // Not HAP at all: left to the platform decoder.
        let mjpeg = make("mjpeg.mov", &["-c:v", "mjpeg"]);
        assert!(sniff_hap_codec(&mjpeg).is_none());
        assert!(matches!(HapVideoDecoder::open_checked(&mjpeg), Err(HapOpenError::NotHap)));
        std::fs::remove_dir_all(dir).unwrap();
    }
    /// Times frame decode (read + chunk expansion) over GA_HAP_BENCH_FILE.
    #[test]
    #[ignore = "Requires GA_HAP_BENCH_FILE pointing at a HAP movie"]
    fn decode_timing_report() {
        let path = std::env::var("GA_HAP_BENCH_FILE").expect("Set GA_HAP_BENCH_FILE");
        let mut decoder = HapVideoDecoder::open(std::path::Path::new(&path)).unwrap();
        let mut times = Vec::new();
        let mut held = std::collections::VecDeque::new();
        for _ in 0..5 {
            decoder.seek(0.0, None).unwrap();
            loop {
                let started = std::time::Instant::now();
                let Some(frame) = decoder.next_frame().unwrap() else { break };
                times.push(started.elapsed().as_secs_f64() * 1000.0);
                // Like playback: one frame queued, one being shown.
                held.push_back(frame);
                if held.len() > 2 {
                    held.pop_front();
                }
            }
        }
        times.sort_by(|a, b| a.partial_cmp(b).unwrap());
        let mean = times.iter().sum::<f64>() / times.len() as f64;
        println!(
            "HAP decode {path}: {} frames, mean {mean:.2} ms, median {:.2} ms, p95 {:.2} ms",
            times.len(),
            times[times.len() / 2],
            times[times.len() * 95 / 100]
        );
    }
    /// Opens and decodes every .mov under GA_HAP_SAMPLE_DIR and prints one
    /// line per file: how the native HAP path takes it, or why not.
    #[test]
    #[ignore = "Requires GA_HAP_SAMPLE_DIR pointing at a folder of MOV files"]
    fn sample_folder_report() {
        let dir = std::env::var("GA_HAP_SAMPLE_DIR").expect("Set GA_HAP_SAMPLE_DIR");
        let mut paths = Vec::new();
        let mut stack = vec![std::path::PathBuf::from(dir)];
        while let Some(at) = stack.pop() {
            for entry in std::fs::read_dir(&at).unwrap().flatten() {
                let path = entry.path();
                if path.is_dir() {
                    stack.push(path);
                } else if path.extension().is_some_and(|e| e.eq_ignore_ascii_case("mov")) {
                    paths.push(path);
                }
            }
        }
        paths.sort();
        let limit = std::env::var("GA_HAP_SAMPLE_FRAMES").ok().and_then(|v| v.parse::<usize>().ok()).unwrap_or(usize::MAX);
        for path in paths {
            let name = path.file_name().unwrap().to_string_lossy().to_string();
            match HapVideoDecoder::open(&path) {
                Err(err) => println!("REJECT {name}: {err}"),
                Ok(mut decoder) => {
                    let m = decoder.metadata();
                    let mut frames = 0;
                    let mut error = None;
                    while frames < limit {
                        match decoder.next_frame() {
                            Ok(Some(_)) => frames += 1,
                            Ok(None) => break,
                            Err(err) => {
                                error = Some(err);
                                break;
                            }
                        }
                    }
                    let seek = decoder
                        .seek(m.duration_seconds / 2.0, None)
                        .and_then(|_| decoder.next_frame())
                        .map(|f| f.is_some());
                    println!(
                        "{} {name}: {:?} {}x{} {:.3} fps {:.3} s, {frames} frames, seek {:?}{}",
                        if error.is_none() && seek == Ok(true) { "OK" } else { "FAIL" },
                        decoder.format,
                        m.width,
                        m.height,
                        m.fps,
                        m.duration_seconds,
                        seek,
                        error.map(|e| format!(", decode error: {e}")).unwrap_or_default()
                    );
                }
            }
        }
    }
}
