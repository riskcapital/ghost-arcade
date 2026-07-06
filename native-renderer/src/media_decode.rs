use std::{
    fs,
    path::{Path, PathBuf},
    process::Command,
    time::UNIX_EPOCH,
};

pub const MAX_NATIVE_IMAGE_DECODE_BYTES: u64 = 256 * 1024 * 1024;
pub const MAX_NATIVE_IMAGE_DECODE_PIXELS: u64 = 8192 * 8192;
pub const MAX_NATIVE_VIDEO_FRAME_DECODE_DIMENSION: usize = 4096;
pub const NATIVE_VIDEO_PREFETCH_WINDOW_MAX_FRAMES: u32 = 4;
pub const NATIVE_VIDEO_PREFETCH_WINDOW_DEFAULT_FPS: f64 = 30.0;
pub const NATIVE_VIDEO_PREFETCH_WINDOW_MIN_FPS: f64 = 1.0;
pub const NATIVE_VIDEO_PREFETCH_WINDOW_MAX_FPS: f64 = 120.0;

#[derive(Debug)]
pub struct NativeVideoFrameDecodeOutput {
    pub width: usize,
    pub height: usize,
    pub frame_bucket: u64,
    pub signature: String,
    pub rgba: Vec<u8>,
}

pub fn decode_native_image_rgba(path: &Path) -> Result<(usize, usize, Vec<u8>), String> {
    let metadata = fs::metadata(path).map_err(|err| {
        format!(
            "native image decode failed to stat `{}`: {err}",
            path.display()
        )
    })?;
    if !metadata.is_file() {
        return Err(format!(
            "native image decode rejected non-file path `{}`",
            path.display()
        ));
    }
    if metadata.len() > MAX_NATIVE_IMAGE_DECODE_BYTES {
        return Err(format!(
            "native image decode rejected `{}`: file is {} MB, cap is {} MB",
            path.display(),
            metadata.len() / (1024 * 1024),
            MAX_NATIVE_IMAGE_DECODE_BYTES / (1024 * 1024)
        ));
    }
    let (width, height) = image::image_dimensions(path).map_err(|err| {
        format!(
            "native image decode could not read dimensions for `{}`: {err}",
            path.display()
        )
    })?;
    let pixels = u64::from(width).saturating_mul(u64::from(height));
    if width == 0 || height == 0 || pixels > MAX_NATIVE_IMAGE_DECODE_PIXELS {
        return Err(format!(
            "native image decode rejected `{}`: dimensions {}x{} exceed {} pixels",
            path.display(),
            width,
            height,
            MAX_NATIVE_IMAGE_DECODE_PIXELS
        ));
    }
    let image = image::ImageReader::open(path)
        .map_err(|err| {
            format!(
                "native image decode failed to open `{}`: {err}",
                path.display()
            )
        })?
        .with_guessed_format()
        .map_err(|err| {
            format!(
                "native image decode failed to sniff `{}`: {err}",
                path.display()
            )
        })?
        .decode()
        .map_err(|err| format!("native image decode failed for `{}`: {err}", path.display()))?
        .to_rgba8();
    Ok((
        image.width() as usize,
        image.height() as usize,
        image.into_raw(),
    ))
}

pub fn decode_native_video_frame_rgba(
    path: &Path,
    width: usize,
    height: usize,
    time_seconds: f64,
) -> Result<(usize, usize, Vec<u8>), String> {
    let metadata = fs::metadata(path).map_err(|err| {
        format!(
            "native video frame decode failed to stat `{}`: {err}",
            path.display()
        )
    })?;
    if !metadata.is_file() {
        return Err(format!(
            "native video frame decode rejected non-file path `{}`",
            path.display()
        ));
    }
    let target_width = width.clamp(16, MAX_NATIVE_VIDEO_FRAME_DECODE_DIMENSION);
    let target_height = height.clamp(16, MAX_NATIVE_VIDEO_FRAME_DECODE_DIMENSION);
    let expected_bytes = target_width.saturating_mul(target_height).saturating_mul(4);
    let ffmpeg = ffmpeg_binary();
    let scale =
        format!("scale={target_width}:{target_height}:force_original_aspect_ratio=decrease");
    let pad = format!("pad={target_width}:{target_height}:(ow-iw)/2:(oh-ih)/2:color=black");
    let output = Command::new(&ffmpeg)
        .arg("-hide_banner")
        .arg("-loglevel")
        .arg("error")
        .arg("-nostdin")
        .arg("-ss")
        .arg(format!("{:.3}", time_seconds.clamp(0.0, 3600.0)))
        .arg("-i")
        .arg(path)
        .arg("-frames:v")
        .arg("1")
        .arg("-vf")
        .arg(format!("{scale},{pad},format=rgba"))
        .arg("-f")
        .arg("rawvideo")
        .arg("-pix_fmt")
        .arg("rgba")
        .arg("pipe:1")
        .output()
        .map_err(|err| {
            format!(
                "native video frame decode failed to launch `{ffmpeg}` for `{}`: {err}",
                path.display()
            )
        })?;
    if !output.status.success() {
        let detail = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(format!(
            "native video frame decode ffmpeg failed for `{}`: {}",
            path.display(),
            if detail.is_empty() {
                output.status.to_string()
            } else {
                detail
            }
        ));
    }
    if output.stdout.len() < expected_bytes {
        let detail = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(format!(
            "native video frame decode produced {}/{} bytes for `{}`{}",
            output.stdout.len(),
            expected_bytes,
            path.display(),
            if detail.is_empty() {
                String::new()
            } else {
                format!(": {detail}")
            }
        ));
    }
    let mut rgba = output.stdout;
    rgba.truncate(expected_bytes);
    Ok((target_width, target_height, rgba))
}

pub fn decode_native_video_frame_window_rgba(
    path: &Path,
    width: usize,
    height: usize,
    time_seconds: f64,
    fps: f64,
    frame_count: u32,
) -> Result<Vec<NativeVideoFrameDecodeOutput>, String> {
    let metadata = fs::metadata(path).map_err(|err| {
        format!(
            "native video frame window decode failed to stat `{}`: {err}",
            path.display()
        )
    })?;
    if !metadata.is_file() {
        return Err(format!(
            "native video frame window decode rejected non-file path `{}`",
            path.display()
        ));
    }
    let target_width = width.clamp(16, MAX_NATIVE_VIDEO_FRAME_DECODE_DIMENSION);
    let target_height = height.clamp(16, MAX_NATIVE_VIDEO_FRAME_DECODE_DIMENSION);
    let expected_bytes = target_width.saturating_mul(target_height).saturating_mul(4);
    let count = frame_count
        .max(1)
        .min(NATIVE_VIDEO_PREFETCH_WINDOW_MAX_FRAMES.saturating_add(1));
    let sample_fps = fps.clamp(
        NATIVE_VIDEO_PREFETCH_WINDOW_MIN_FPS,
        NATIVE_VIDEO_PREFETCH_WINDOW_MAX_FPS,
    );
    let ffmpeg = ffmpeg_binary();
    let scale =
        format!("scale={target_width}:{target_height}:force_original_aspect_ratio=decrease");
    let pad = format!("pad={target_width}:{target_height}:(ow-iw)/2:(oh-ih)/2:color=black");
    let output = Command::new(&ffmpeg)
        .arg("-hide_banner")
        .arg("-loglevel")
        .arg("error")
        .arg("-nostdin")
        .arg("-ss")
        .arg(format!("{:.3}", time_seconds.clamp(0.0, 3600.0)))
        .arg("-i")
        .arg(path)
        .arg("-frames:v")
        .arg(count.to_string())
        .arg("-vf")
        .arg(format!("{scale},{pad},fps={sample_fps:.3},format=rgba"))
        .arg("-f")
        .arg("rawvideo")
        .arg("-pix_fmt")
        .arg("rgba")
        .arg("pipe:1")
        .output()
        .map_err(|err| {
            format!(
                "native video frame window decode failed to launch `{ffmpeg}` for `{}`: {err}",
                path.display()
            )
        })?;
    if !output.status.success() {
        let detail = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(format!(
            "native video frame window decode ffmpeg failed for `{}`: {}",
            path.display(),
            if detail.is_empty() {
                output.status.to_string()
            } else {
                detail
            }
        ));
    }
    let decoded_count = output.stdout.len() / expected_bytes;
    if decoded_count == 0 {
        let detail = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(format!(
            "native video frame window decode produced {}/{} bytes for `{}`{}",
            output.stdout.len(),
            expected_bytes,
            path.display(),
            if detail.is_empty() {
                String::new()
            } else {
                format!(": {detail}")
            }
        ));
    }
    let frame_step = 1.0 / sample_fps;
    let mut frames = Vec::with_capacity(decoded_count.min(count as usize));
    for frame_index in 0..decoded_count.min(count as usize) {
        let start = frame_index.saturating_mul(expected_bytes);
        let end = start.saturating_add(expected_bytes);
        let frame_time = (time_seconds + frame_step * frame_index as f64).clamp(0.0, 3600.0);
        let frame_bucket = native_video_frame_bucket(frame_time);
        let signature =
            native_video_frame_file_signature(path, target_width, target_height, frame_bucket)?;
        frames.push(NativeVideoFrameDecodeOutput {
            width: target_width,
            height: target_height,
            frame_bucket,
            signature,
            rgba: output.stdout[start..end].to_vec(),
        });
    }
    if frames.is_empty() {
        return Err(format!(
            "native video frame window decode produced no usable frames for `{}`",
            path.display()
        ));
    }
    Ok(frames)
}

pub fn native_video_frame_bucket(time_seconds: f64) -> u64 {
    (time_seconds * NATIVE_VIDEO_PREFETCH_WINDOW_DEFAULT_FPS)
        .round()
        .max(0.0) as u64
}

pub fn native_image_file_signature(path: &Path) -> Result<String, String> {
    let metadata = fs::metadata(path).map_err(|err| {
        format!(
            "native image decode failed to stat `{}`: {err}",
            path.display()
        )
    })?;
    if !metadata.is_file() {
        return Err(format!(
            "native image decode rejected non-file path `{}`",
            path.display()
        ));
    }
    Ok(file_signature(path, &metadata))
}

pub fn native_video_frame_file_signature(
    path: &Path,
    width: usize,
    height: usize,
    frame_bucket: u64,
) -> Result<String, String> {
    let metadata = fs::metadata(path).map_err(|err| {
        format!(
            "native video frame decode failed to stat `{}`: {err}",
            path.display()
        )
    })?;
    if !metadata.is_file() {
        return Err(format!(
            "native video frame decode rejected non-file path `{}`",
            path.display()
        ));
    }
    let base = file_signature(path, &metadata);
    Ok(format!("{base}:{width}:{height}:{frame_bucket}"))
}

pub fn local_media_path_from_uri(uri: &str) -> Option<PathBuf> {
    let trimmed = uri.trim();
    if trimmed.is_empty()
        || trimmed.starts_with("http://")
        || trimmed.starts_with("https://")
        || trimmed.starts_with("blob:")
        || trimmed.starts_with("data:")
    {
        return None;
    }
    if let Some(rest) = trimmed.strip_prefix("ghost-asset://") {
        return local_path_from_hierarchical_uri_rest(rest);
    }
    if let Some(rest) = trimmed.strip_prefix("file://") {
        return local_path_from_hierarchical_uri_rest(rest);
    }
    absolute_path_from_uri_path(trimmed)
}

fn ffmpeg_binary() -> String {
    std::env::var("GA_FFMPEG_PATH")
        .ok()
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| {
            if cfg!(target_os = "windows") {
                "ffmpeg.exe".to_string()
            } else {
                "ffmpeg".to_string()
            }
        })
}

fn file_signature(path: &Path, metadata: &fs::Metadata) -> String {
    let modified = metadata
        .modified()
        .ok()
        .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
        .map(|duration| format!("{}:{}", duration.as_secs(), duration.subsec_nanos()))
        .unwrap_or_else(|| "unknown".to_string());
    let canonical = path.canonicalize().unwrap_or_else(|_| path.to_path_buf());
    format!("{}:{}:{}", canonical.display(), metadata.len(), modified)
}

fn local_path_from_hierarchical_uri_rest(rest: &str) -> Option<PathBuf> {
    let path_part = if rest.starts_with('/') {
        rest
    } else {
        let slash = rest.find('/')?;
        &rest[slash..]
    };
    absolute_path_from_uri_path(path_part)
}

fn absolute_path_from_uri_path(path: &str) -> Option<PathBuf> {
    let decoded = percent_decode_uri_path(path)?;
    let normalized = if decoded.starts_with('/') && windows_drive_path(&decoded[1..]) {
        decoded[1..].to_string()
    } else {
        decoded
    };
    let path = PathBuf::from(&normalized);
    if path.is_absolute() || windows_drive_path(&normalized) {
        Some(path)
    } else {
        None
    }
}

fn percent_decode_uri_path(input: &str) -> Option<String> {
    let bytes = input.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut index = 0usize;
    while index < bytes.len() {
        if bytes[index] == b'%' {
            let hi = *bytes.get(index + 1)?;
            let lo = *bytes.get(index + 2)?;
            out.push(
                hex_value(hi)?
                    .saturating_mul(16)
                    .saturating_add(hex_value(lo)?),
            );
            index += 3;
        } else {
            out.push(bytes[index]);
            index += 1;
        }
    }
    String::from_utf8(out).ok()
}

fn hex_value(byte: u8) -> Option<u8> {
    match byte {
        b'0'..=b'9' => Some(byte - b'0'),
        b'a'..=b'f' => Some(byte - b'a' + 10),
        b'A'..=b'F' => Some(byte - b'A' + 10),
        _ => None,
    }
}

fn windows_drive_path(path: &str) -> bool {
    let bytes = path.as_bytes();
    bytes.len() >= 3
        && bytes[1] == b':'
        && (bytes[2] == b'/' || bytes[2] == b'\\')
        && bytes[0].is_ascii_alphabetic()
}
