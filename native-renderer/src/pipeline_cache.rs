//! Compiled pipelines kept on disk between runs.
//!
//! A cold start compiles the compositor and every effect shader from
//! scratch. Where the backend can hand its compiled pipelines back (wgpu's
//! `Features::PIPELINE_CACHE`, which in wgpu 30 is Vulkan only), they are
//! saved to a file and given to the driver at the next start. Metal and
//! D3D12 keep their own shader caches in the driver, and wgpu's cache is a
//! no-op there, so on those this does nothing.
//!
//! The file is named after the adapter (vendor, device), a hash of the
//! driver and the core's version, so another GPU, driver or core build never
//! reads it. Its contents carry their length and a checksum: a truncated or
//! damaged file is deleted and the run starts with an empty cache. wgpu and
//! the driver also check the data's own header and fall back to empty when
//! it is out of date. `GA_CORE_PIPELINE_CACHE=0` turns it off;
//! `GA_CORE_CACHE_DIR` picks the folder (default: the OS cache folder).

use std::{
    path::{Path, PathBuf},
    sync::Mutex,
    time::{Duration, Instant},
};

const MAGIC: &[u8; 8] = b"GAPCACH1";
const HEADER_BYTES: usize = 8 + 8 + 8;
/// Pipelines are usually built in bursts (start, a new effect, a new show):
/// save once a burst has settled for this long.
const SAVE_SETTLE: Duration = Duration::from_secs(3);
/// How often the driver's data is looked at: reading it copies all of it.
const CHECK_EVERY: Duration = Duration::from_secs(1);

/// The cache of the running device. One device per core process; the
/// device is kept with it so a cache can never be handed to another one.
static CURRENT: Mutex<Option<(wgpu::Device, wgpu::PipelineCache)>> = Mutex::new(None);

/// The pipeline cache to compile with on `device`, if it has one.
pub fn for_device(device: &wgpu::Device) -> Option<wgpu::PipelineCache> {
    let current = CURRENT.lock().ok()?;
    current.as_ref().filter(|(owner, _)| owner == device).map(|(_, cache)| cache.clone())
}

/// Whether to ask the adapter for the feature at all.
pub fn wanted() -> bool {
    !std::env::var("GA_CORE_PIPELINE_CACHE").is_ok_and(|value| value == "0")
}

pub struct DiskPipelineCache {
    path: PathBuf,
    cache: wgpu::PipelineCache,
    saved_len: usize,
    /// When the data was seen to change and has not been saved yet.
    changed_at: Option<Instant>,
    last_len: usize,
    last_check: Instant,
}

impl DiskPipelineCache {
    /// Open the cache file for this device, when the device has the feature.
    pub fn open(device: &wgpu::Device, adapter: &wgpu::AdapterInfo) -> Option<Self> {
        if !device.features().contains(wgpu::Features::PIPELINE_CACHE) {
            return None;
        }
        let path = cache_dir()?.join(file_name(adapter)?);
        let data = read_cache_file(&path);
        if data.is_none() && path.exists() {
            let _ = std::fs::remove_file(&path);
        }
        let mut cache = create(device, data.as_deref());
        if cache.is_none() && data.is_some() {
            // The device refused the data (another adapter's): start empty.
            let _ = std::fs::remove_file(&path);
            cache = create(device, None);
        }
        let cache = cache?;
        let saved_len = cache.get_data().map_or(0, |data| data.len());
        eprintln!(
            "[ghost-core] pipeline cache: {} ({} bytes loaded)",
            path.display(),
            data.as_ref().map_or(0, Vec::len)
        );
        if let Ok(mut current) = CURRENT.lock() {
            *current = Some((device.clone(), cache.clone()));
        }
        Some(Self { path, cache, saved_len, changed_at: None, last_len: saved_len, last_check: Instant::now() })
    }

    /// Save once new pipelines have stopped arriving for a moment. Called
    /// every frame; looks at the data once a second.
    pub fn maybe_save(&mut self, now: Instant) {
        if now.duration_since(self.last_check) < CHECK_EVERY {
            return;
        }
        self.last_check = now;
        let Some(data) = self.cache.get_data() else { return };
        if data.len() != self.last_len {
            self.last_len = data.len();
            self.changed_at = Some(now);
            return;
        }
        let settled = self.changed_at.is_some_and(|at| now.duration_since(at) >= SAVE_SETTLE);
        if settled && data.len() != self.saved_len {
            self.write(data);
        }
    }

    /// Save now, before returning, if anything is unsaved (shutdown).
    pub fn flush(&mut self) {
        if let Some(data) = self.cache.get_data() {
            if data.len() != self.saved_len {
                self.saved_len = data.len();
                save(&self.path, &data);
            }
        }
    }

    fn write(&mut self, data: Vec<u8>) {
        self.changed_at = None;
        self.saved_len = data.len();
        let path = self.path.clone();
        // Off the render thread: the file can be a few MB.
        std::thread::spawn(move || save(&path, &data));
    }
}

impl Drop for DiskPipelineCache {
    fn drop(&mut self) {
        if let Ok(mut current) = CURRENT.lock() {
            *current = None;
        }
    }
}

fn save(path: &Path, data: &[u8]) {
    if let Err(err) = write_cache_file(path, data) {
        eprintln!("[ghost-core] pipeline cache not saved to {}: {err}", path.display());
    }
}

fn create(device: &wgpu::Device, data: Option<&[u8]>) -> Option<wgpu::PipelineCache> {
    let scope = device.push_error_scope(wgpu::ErrorFilter::Validation);
    // SAFETY: `data` is only ever what `get_data` returned on an adapter with
    // the same key (the file name), checked against its stored checksum;
    // wgpu validates its header and `fallback` drops data it cannot use.
    let cache = unsafe {
        device.create_pipeline_cache(&wgpu::PipelineCacheDescriptor {
            label: Some("Ghost Render Core Pipeline Cache"),
            data,
            fallback: true,
        })
    };
    let error = pollster::block_on(scope.pop());
    error.is_none().then_some(cache)
}

fn cache_dir() -> Option<PathBuf> {
    if let Some(dir) = std::env::var_os("GA_CORE_CACHE_DIR").filter(|dir| !dir.is_empty()) {
        return Some(PathBuf::from(dir));
    }
    let base = if cfg!(target_os = "windows") {
        std::env::var_os("LOCALAPPDATA").map(PathBuf::from)
    } else if cfg!(target_os = "macos") {
        std::env::var_os("HOME").map(|home| PathBuf::from(home).join("Library/Caches"))
    } else {
        std::env::var_os("XDG_CACHE_HOME")
            .filter(|dir| !dir.is_empty())
            .map(PathBuf::from)
            .or_else(|| std::env::var_os("HOME").map(|home| PathBuf::from(home).join(".cache")))
    }?;
    Some(base.join("ghost-render-core"))
}

fn file_name(adapter: &wgpu::AdapterInfo) -> Option<String> {
    let key = wgpu::util::pipeline_cache_key(adapter)?;
    let driver = fnv1a(format!("{}|{}|{}", adapter.name, adapter.driver, adapter.driver_info).as_bytes());
    Some(format!("{key}_{driver:016x}_core{}.bin", env!("CARGO_PKG_VERSION")))
}

fn fnv1a(bytes: &[u8]) -> u64 {
    bytes.iter().fold(0xcbf2_9ce4_8422_2325u64, |hash, byte| {
        (hash ^ u64::from(*byte)).wrapping_mul(0x0000_0100_0000_01b3)
    })
}

/// The cache data in `path`, or None when it is missing, short or damaged.
fn read_cache_file(path: &Path) -> Option<Vec<u8>> {
    decode(&std::fs::read(path).ok()?)
}

fn decode(file: &[u8]) -> Option<Vec<u8>> {
    if file.len() < HEADER_BYTES || &file[..8] != MAGIC {
        return None;
    }
    let len = u64::from_le_bytes(file[8..16].try_into().ok()?) as usize;
    let sum = u64::from_le_bytes(file[16..24].try_into().ok()?);
    let data = &file[HEADER_BYTES..];
    (data.len() == len && fnv1a(data) == sum).then(|| data.to_vec())
}

fn encode(data: &[u8]) -> Vec<u8> {
    let mut file = Vec::with_capacity(HEADER_BYTES + data.len());
    file.extend_from_slice(MAGIC);
    file.extend_from_slice(&(data.len() as u64).to_le_bytes());
    file.extend_from_slice(&fnv1a(data).to_le_bytes());
    file.extend_from_slice(data);
    file
}

/// Write beside the target and rename over it, so a reader (or a crash
/// mid-write) never sees half a file.
fn write_cache_file(path: &Path, data: &[u8]) -> std::io::Result<()> {
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir)?;
    }
    let temp = path.with_extension(format!("tmp{}", std::process::id()));
    std::fs::write(&temp, encode(data))?;
    std::fs::rename(&temp, path).inspect_err(|_| {
        let _ = std::fs::remove_file(&temp);
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cache_files_round_trip_and_reject_damage() {
        let data = (0..1000u32).map(|i| (i * 7) as u8).collect::<Vec<_>>();
        let file = encode(&data);
        assert_eq!(decode(&file).as_deref(), Some(data.as_slice()));
        // Truncated, extended, flipped byte, wrong magic, empty.
        assert!(decode(&file[..file.len() - 1]).is_none());
        let mut longer = file.clone();
        longer.push(0);
        assert!(decode(&longer).is_none());
        let mut flipped = file.clone();
        flipped[HEADER_BYTES + 10] ^= 1;
        assert!(decode(&flipped).is_none());
        let mut magic = file.clone();
        magic[0] = b'X';
        assert!(decode(&magic).is_none());
        assert!(decode(&[]).is_none());
    }

    #[test]
    fn cache_file_writes_replace_the_old_file_whole() {
        let dir = std::env::temp_dir().join(format!("ga-pipeline-cache-test-{}", std::process::id()));
        let path = dir.join("cache.bin");
        write_cache_file(&path, b"first").unwrap();
        write_cache_file(&path, b"second, longer").unwrap();
        assert_eq!(read_cache_file(&path).as_deref(), Some(&b"second, longer"[..]));
        let leftovers = std::fs::read_dir(&dir).unwrap().count();
        assert_eq!(leftovers, 1, "no temp file is left behind");
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn only_vulkan_adapters_get_a_cache_file() {
        let mut adapter = wgpu::AdapterInfo {
            name: "Test GPU".into(),
            vendor: 0x10de,
            device: 0x2684,
            driver: "driver".into(),
            driver_info: "1.2.3".into(),
            ..wgpu::AdapterInfo::new(wgpu::DeviceType::DiscreteGpu, wgpu::Backend::Vulkan)
        };
        let vulkan = file_name(&adapter).expect("vulkan has a key");
        assert!(vulkan.contains(env!("CARGO_PKG_VERSION")));
        adapter.driver_info = "1.2.4".into();
        assert_ne!(file_name(&adapter).unwrap(), vulkan, "a driver update gets a new file");
        adapter.backend = wgpu::Backend::Metal;
        assert!(file_name(&adapter).is_none());
    }
}
