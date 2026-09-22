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
}
impl HapVideoDecoder {
    pub fn open(path: &Path) -> Result<Self> {
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
                        _ => continue,
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
                        let elst = atom(edts, b"elst")?;
                        let version = *elst.first().ok_or_else(bad)?;
                        let media_time = if version == 0 {
                            be32(elst, 12)? as u64
                        } else if version == 1 {
                            be64(elst, 16)?
                        } else {
                            return Err(bad());
                        };
                        let rate_at = if version == 0 { 16 } else { 24 };
                        if be32(elst, 4)? != 1 || media_time != 0 || be32(elst, rate_at)? != 0x10000
                        {
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
                    });
                }
                return Err("Movie has no supported HAP video track".into());
            }
            offset += size;
        }
        Err("Movie has no HAP sample index".into())
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
        let blocks = decode_packet(&self.packet, self.format, expected)?;
        self.cursor += 1;
        Ok(Some(HapFrame {
            width: self.metadata.width,
            height: self.metadata.height,
            pts_seconds,
            duration_seconds: sample.duration as f64 / self.timescale,
            format: self.format,
            blocks: Arc::new(blocks),
        }))
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
fn decode_chunk(input: &[u8], compressor: u8, output: &mut Vec<u8>, limit: usize) -> Result<()> {
    let n = match compressor {
        0x0a => input.len(),
        0x0b => snap::raw::decompress_len(input).map_err(|e| e.to_string())?,
        _ => return Err(bad()),
    };
    if n > limit.saturating_sub(output.len()) {
        return Err("HAP block data exceeds frame dimensions".into());
    }
    let at = output.len();
    output.resize(at + n, 0);
    if compressor == 0x0a {
        output[at..].copy_from_slice(input);
    } else {
        snap::raw::Decoder::new()
            .decompress(input, &mut output[at..])
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}
pub fn decode_packet(packet: &[u8], format: HapFormat, expected: usize) -> Result<Vec<u8>> {
    let (kind, body, end) = section(packet)?;
    let tag = match format {
        HapFormat::Rgb => 0x0b,
        HapFormat::Alpha => 0x0e,
        HapFormat::YCoCg => 0x0f,
    };
    if end != packet.len() || kind & 15 != tag || expected > MAX_PACKET_BYTES {
        return Err(bad());
    }
    let mut output = Vec::with_capacity(expected);
    match kind >> 4 {
        0x0a | 0x0b => decode_chunk(body, kind >> 4, &mut output, expected)?,
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
            for (i, compressor) in compressors.iter().enumerate() {
                if let Some(offsets) = offsets {
                    offset = le32(offsets, i * 4)? as usize;
                }
                let end = offset
                    .checked_add(le32(sizes, i * 4)? as usize)
                    .ok_or_else(bad)?;
                decode_chunk(
                    payload.get(offset..end).ok_or_else(bad)?,
                    *compressor,
                    &mut output,
                    expected,
                )?;
                offset = end;
            }
        }
        _ => return Err(bad()),
    }
    if output.len() != expected {
        return Err("HAP block data does not match frame dimensions".into());
    }
    Ok(output)
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
}
