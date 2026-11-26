#![cfg(target_os = "windows")]
//! A Spout sender inside the render core (Windows).
//!
//! Spout is a shared-memory protocol around one D3D11 texture shared with a
//! legacy (KMT) handle:
//!
//! * `SpoutSenderNames` lists every sender: 256-byte, NUL-padded names,
//!   sorted, ended by an empty entry, guarded by `SpoutSenderNames_mutex`.
//! * A map named after the sender holds its `SharedTextureInfo` (280 bytes:
//!   share handle, width, height, DXGI format, usage, a 256-byte description
//!   that carries the host executable's path, partner id), guarded by
//!   `<name>_mutex`.
//! * `ActiveSenderName` names the sender a receiver picks by default.
//! * `<name>_SpoutAccessMutex` is held while the texture is written.
//! * When frame counting is switched on in Spout's settings
//!   (`HKCU\Software\Leading Edge\Spout\Framecount` = 1) the sender also
//!   counts frames on the `<name>_Count_Semaphore` semaphore.
//!
//! This is the protocol of the Spout2 SDK (BSD licence), written here against
//! the Win32 API so the core needs no C++ build step. The frame comes from the
//! core's own output texture, opened by name on a D3D11 device of the same
//! adapter; the copy into the Spout texture is ordered after the frame on the
//! GPU, and the core's later frames are ordered after the copy, so nothing
//! waits on the CPU and nothing tears.

use std::ffi::CString;

use wgpu::hal::api::Dx12;
use windows::core::{Interface, PCSTR, PCWSTR};
use windows::Win32::Foundation::{
    CloseHandle, GetLastError, ERROR_ALREADY_EXISTS, GENERIC_ALL, HANDLE, HMODULE, INVALID_HANDLE_VALUE,
    WAIT_OBJECT_0,
};
use windows::Win32::Graphics::Direct3D::{D3D_DRIVER_TYPE_UNKNOWN, D3D_FEATURE_LEVEL_11_0, D3D_FEATURE_LEVEL_11_1};
use windows::Win32::Graphics::Direct3D11::{
    D3D11CreateDevice, ID3D11Device, ID3D11Device1, ID3D11Device5, ID3D11DeviceContext, ID3D11DeviceContext4,
    ID3D11Fence, ID3D11Texture2D, D3D11_BIND_RENDER_TARGET, D3D11_BIND_SHADER_RESOURCE,
    D3D11_CREATE_DEVICE_BGRA_SUPPORT, D3D11_RESOURCE_MISC_SHARED, D3D11_SDK_VERSION, D3D11_TEXTURE2D_DESC,
    D3D11_USAGE_DEFAULT,
};
use windows::Win32::Graphics::Direct3D12::{ID3D12Device, ID3D12Fence, D3D12_FENCE_FLAG_SHARED};
use windows::Win32::Graphics::Dxgi::Common::{DXGI_FORMAT, DXGI_SAMPLE_DESC};
use windows::Win32::Graphics::Dxgi::{
    CreateDXGIFactory2, IDXGIAdapter, IDXGIFactory4, IDXGIResource, DXGI_CREATE_FACTORY_FLAGS,
};
use windows::Win32::System::Memory::{
    CreateFileMappingA, MapViewOfFile, UnmapViewOfFile, FILE_MAP_ALL_ACCESS, MEMORY_MAPPED_VIEW_ADDRESS,
    PAGE_READWRITE,
};
use windows::Win32::System::Registry::{RegGetValueA, HKEY_CURRENT_USER, RRF_RT_REG_DWORD};
use windows::Win32::System::Threading::{
    CreateMutexA, CreateSemaphoreA, ReleaseMutex, ReleaseSemaphore, WaitForSingleObject,
};

const NAME_LEN: usize = 256;
const DEFAULT_MAX_SENDERS: u32 = 64;
const INFO_SIZE: usize = 280;
/// How long a lock waits: Spout's own timeouts.
const MAP_LOCK_MS: u32 = 100;
const ACCESS_LOCK_MS: u32 = 67;

fn win_error(what: &str, error: windows::core::Error) -> String {
    format!("Spout: {what}: {error}")
}

fn cstring(text: &str) -> Result<CString, String> {
    CString::new(text).map_err(|_| "Spout: a name contains a NUL".to_string())
}

fn spout_dword(value: &str) -> Option<u32> {
    let mut data = 0u32;
    let mut size = std::mem::size_of::<u32>() as u32;
    let key = cstring("Software\\Leading Edge\\Spout").ok()?;
    let name = cstring(value).ok()?;
    let status = unsafe {
        RegGetValueA(
            HKEY_CURRENT_USER,
            PCSTR(key.as_ptr() as *const u8),
            PCSTR(name.as_ptr() as *const u8),
            RRF_RT_REG_DWORD,
            None,
            Some(&mut data as *mut u32 as *mut _),
            Some(&mut size),
        )
    };
    status.is_ok().then_some(data)
}

/// A named shared-memory block with the mutex Spout pairs with it.
struct SharedMap {
    map: HANDLE,
    view: MEMORY_MAPPED_VIEW_ADDRESS,
    mutex: HANDLE,
    size: usize,
}

impl SharedMap {
    fn create(name: &str, size: usize) -> Result<Self, String> {
        let name_c = cstring(name)?;
        let mutex_c = cstring(&format!("{name}_mutex"))?;
        unsafe {
            let map = CreateFileMappingA(
                INVALID_HANDLE_VALUE,
                None,
                PAGE_READWRITE,
                0,
                size as u32,
                PCSTR(name_c.as_ptr() as *const u8),
            )
            .map_err(|e| win_error(&format!("create shared memory {name}"), e))?;
            let view = MapViewOfFile(map, FILE_MAP_ALL_ACCESS, 0, 0, 0);
            if view.Value.is_null() {
                let _ = CloseHandle(map);
                return Err(format!("Spout: map shared memory {name}"));
            }
            let mutex = match CreateMutexA(None, false, PCSTR(mutex_c.as_ptr() as *const u8)) {
                Ok(mutex) => mutex,
                Err(e) => {
                    let _ = UnmapViewOfFile(view);
                    let _ = CloseHandle(map);
                    return Err(win_error(&format!("create mutex for {name}"), e));
                }
            };
            Ok(Self { map, view, mutex, size })
        }
    }

    /// Run `f` over the block under its mutex. False when the lock timed out.
    fn with<R>(&self, f: impl FnOnce(&mut [u8]) -> R) -> Option<R> {
        unsafe {
            let waited = WaitForSingleObject(self.mutex, MAP_LOCK_MS);
            // An abandoned mutex is ours now: the block is still usable.
            if waited != WAIT_OBJECT_0 && waited.0 != 0x80 {
                return None;
            }
            let bytes = std::slice::from_raw_parts_mut(self.view.Value as *mut u8, self.size);
            let result = f(bytes);
            let _ = ReleaseMutex(self.mutex);
            Some(result)
        }
    }
}

impl Drop for SharedMap {
    fn drop(&mut self) {
        unsafe {
            let _ = UnmapViewOfFile(self.view);
            let _ = CloseHandle(self.map);
            let _ = CloseHandle(self.mutex);
        }
    }
}

/// The names in a `SpoutSenderNames` block, in order.
pub(crate) fn read_names(block: &[u8], max: usize) -> Vec<String> {
    let mut names = Vec::new();
    for entry in block.chunks(NAME_LEN).take(max) {
        let end = entry.iter().position(|b| *b == 0).unwrap_or(entry.len());
        if end == 0 {
            break;
        }
        names.push(String::from_utf8_lossy(&entry[..end]).into_owned());
    }
    names
}

/// Write `names` (sorted, as Spout keeps them) and the empty entry after them.
pub(crate) fn write_names(block: &mut [u8], names: &[String], max: usize) {
    let mut sorted: Vec<&String> = names.iter().collect();
    sorted.sort();
    sorted.dedup();
    let mut written = 0;
    for (entry, name) in block.chunks_mut(NAME_LEN).zip(sorted.iter()).take(max) {
        entry.fill(0);
        let bytes = name.as_bytes();
        let len = bytes.len().min(NAME_LEN - 1);
        entry[..len].copy_from_slice(&bytes[..len]);
        written += 1;
    }
    if written < max {
        if let Some(entry) = block.chunks_mut(NAME_LEN).nth(written) {
            entry[0] = 0;
        }
    }
}

/// The 280-byte `SharedTextureInfo` record.
pub(crate) fn texture_info(share_handle: u32, width: u32, height: u32, format: u32, description: &str) -> [u8; INFO_SIZE] {
    let mut info = [0u8; INFO_SIZE];
    info[0..4].copy_from_slice(&share_handle.to_le_bytes());
    info[4..8].copy_from_slice(&width.to_le_bytes());
    info[8..12].copy_from_slice(&height.to_le_bytes());
    info[12..16].copy_from_slice(&format.to_le_bytes());
    // usage (16..20) stays 0. The description holds the host path as bytes.
    let text = description.as_bytes();
    let len = text.len().min(255);
    info[20..20 + len].copy_from_slice(&text[..len]);
    // partnerId (276..280) stays 0.
    info
}

/// A D3D12 fence shared with the sender's D3D11 device.
unsafe fn shared_fence(device12: &ID3D12Device, device5: &ID3D11Device5) -> Result<(ID3D12Fence, ID3D11Fence), String> {
    unsafe {
        let fence12: ID3D12Fence =
            device12.CreateFence(0, D3D12_FENCE_FLAG_SHARED).map_err(|e| win_error("create shared fence", e))?;
        let shared = device12
            .CreateSharedHandle(&fence12, None, GENERIC_ALL.0, PCWSTR::null())
            .map_err(|e| win_error("export fence", e))?;
        let mut fence11 = None;
        let opened = device5.OpenSharedFence(shared, &mut fence11);
        let _ = CloseHandle(shared);
        opened.map_err(|e| win_error("open fence on D3D11", e))?;
        let fence11 = fence11.ok_or_else(|| "Spout: D3D11 returned no shared fence".to_string())?;
        Ok((fence12, fence11))
    }
}

pub struct SpoutSender {
    name: String,
    max_senders: usize,
    description: String,
    device: ID3D11Device,
    context: ID3D11DeviceContext4,
    names: SharedMap,
    active: SharedMap,
    info: SharedMap,
    access: HANDLE,
    frame_count: Option<HANDLE>,
    texture: Option<(ID3D11Texture2D, u32, u32, u32, u32)>,
    source: Option<(String, ID3D11Texture2D)>,
    frame_done12: ID3D12Fence,
    frame_done11: ID3D11Fence,
    copied12: ID3D12Fence,
    copied11: ID3D11Fence,
    fence_value: u64,
    pub frames: u64,
}

// Only used from the core's render thread.
unsafe impl Send for SpoutSender {}

impl SpoutSender {
    /// `description`: the host path receivers may show (the app's own exe).
    pub fn new(wgpu_device: &wgpu::Device, name: &str, description: Option<&str>) -> Result<Self, String> {
        if name.is_empty() || name.len() >= NAME_LEN {
            return Err("Spout: the sender name must be 1 to 255 bytes".into());
        }
        unsafe {
            let raw = wgpu_device
                .as_hal::<Dx12>()
                .ok_or_else(|| "Spout from the core needs the renderer's D3D12 device".to_string())?;
            let device12 = raw.raw_device().clone();
            drop(raw);
            let factory: IDXGIFactory4 =
                CreateDXGIFactory2(DXGI_CREATE_FACTORY_FLAGS(0)).map_err(|e| win_error("create DXGI factory", e))?;
            let adapter: IDXGIAdapter = factory
                .EnumAdapterByLuid(device12.GetAdapterLuid())
                .map_err(|e| win_error("find the renderer's adapter", e))?;
            let mut device = None;
            let mut immediate = None;
            D3D11CreateDevice(
                &adapter,
                D3D_DRIVER_TYPE_UNKNOWN,
                HMODULE::default(),
                D3D11_CREATE_DEVICE_BGRA_SUPPORT,
                Some(&[D3D_FEATURE_LEVEL_11_1, D3D_FEATURE_LEVEL_11_0]),
                D3D11_SDK_VERSION,
                Some(&mut device),
                None,
                Some(&mut immediate),
            )
            .map_err(|e| win_error("create same-adapter D3D11 device", e))?;
            let device: ID3D11Device = device.ok_or("Spout: D3D11 returned no device")?;
            let immediate: ID3D11DeviceContext = immediate.ok_or("Spout: D3D11 returned no context")?;
            let context: ID3D11DeviceContext4 = immediate.cast().map_err(|e| win_error("require D3D11 GPU fences", e))?;
            let device5: ID3D11Device5 = device.cast().map_err(|e| win_error("query ID3D11Device5", e))?;
            let (frame_done12, frame_done11) = shared_fence(&device12, &device5)?;
            let (copied12, copied11) = shared_fence(&device12, &device5)?;

            let max_senders = spout_dword("MaxSenders").filter(|n| *n >= 1).unwrap_or(DEFAULT_MAX_SENDERS) as usize;
            let names = SharedMap::create("SpoutSenderNames", max_senders * NAME_LEN)?;
            let active = SharedMap::create("ActiveSenderName", NAME_LEN)?;
            let info = SharedMap::create(name, INFO_SIZE)?;
            let access_c = cstring(&format!("{name}_SpoutAccessMutex"))?;
            let access = CreateMutexA(None, false, PCSTR(access_c.as_ptr() as *const u8))
                .map_err(|e| win_error("create the access mutex", e))?;
            let frame_count = if spout_dword("Framecount") == Some(1) {
                let sem_c = cstring(&format!("{name}_Count_Semaphore"))?;
                CreateSemaphoreA(None, 1, i32::MAX, PCSTR(sem_c.as_ptr() as *const u8)).ok()
            } else {
                None
            };
            let _ = GetLastError() == ERROR_ALREADY_EXISTS;

            let sender = Self {
                name: name.to_string(),
                max_senders,
                description: description.unwrap_or_default().to_string(),
                device,
                context,
                names,
                active,
                info,
                access,
                frame_count,
                texture: None,
                source: None,
                frame_done12,
                frame_done11,
                copied12,
                copied11,
                fence_value: 0,
                frames: 0,
            };
            sender.register()?;
            Ok(sender)
        }
    }

    pub fn name(&self) -> &str {
        &self.name
    }

    fn register(&self) -> Result<(), String> {
        let max = self.max_senders;
        let name = self.name.clone();
        self.names
            .with(|block| {
                let mut list = read_names(block, max);
                if !list.contains(&name) && list.len() < max {
                    list.push(name.clone());
                    write_names(block, &list, max);
                }
            })
            .ok_or_else(|| "Spout: the sender list stayed locked".to_string())?;
        self.active.with(|block| {
            block.fill(0);
            let bytes = name.as_bytes();
            block[..bytes.len()].copy_from_slice(bytes);
        });
        Ok(())
    }

    fn unregister(&self) {
        let max = self.max_senders;
        let name = self.name.clone();
        self.names.with(|block| {
            let list: Vec<String> = read_names(block, max).into_iter().filter(|n| *n != name).collect();
            block.fill(0);
            write_names(block, &list, max);
        });
        self.active.with(|block| {
            let end = block.iter().position(|b| *b == 0).unwrap_or(block.len());
            if &block[..end] == name.as_bytes() {
                block.fill(0);
            }
        });
    }

    unsafe fn source_texture(&mut self, shared_name: &str) -> Result<ID3D11Texture2D, String> {
        if let Some((name, texture)) = &self.source {
            if name == shared_name {
                return Ok(texture.clone());
            }
        }
        unsafe {
            let device1: ID3D11Device1 = self.device.cast().map_err(|e| win_error("query ID3D11Device1", e))?;
            let wide: Vec<u16> = shared_name.encode_utf16().chain(std::iter::once(0)).collect();
            let texture: ID3D11Texture2D = device1
                .OpenSharedResourceByName(PCWSTR::from_raw(wide.as_ptr()), 0x8000_0000 /* DXGI_SHARED_RESOURCE_READ */)
                .map_err(|e| win_error(&format!("open the output texture \"{shared_name}\""), e))?;
            self.source = Some((shared_name.to_string(), texture.clone()));
            Ok(texture)
        }
    }

    /// The Spout texture for this size and format, made (and announced) when
    /// either changes.
    unsafe fn ensure_texture(&mut self, width: u32, height: u32, format: DXGI_FORMAT) -> Result<ID3D11Texture2D, String> {
        if let Some((texture, w, h, f, _)) = &self.texture {
            if *w == width && *h == height && *f == format.0 as u32 {
                return Ok(texture.clone());
            }
        }
        unsafe {
            let desc = D3D11_TEXTURE2D_DESC {
                Width: width,
                Height: height,
                MipLevels: 1,
                ArraySize: 1,
                Format: format,
                SampleDesc: DXGI_SAMPLE_DESC { Count: 1, Quality: 0 },
                Usage: D3D11_USAGE_DEFAULT,
                BindFlags: (D3D11_BIND_SHADER_RESOURCE.0 | D3D11_BIND_RENDER_TARGET.0) as u32,
                CPUAccessFlags: 0,
                MiscFlags: D3D11_RESOURCE_MISC_SHARED.0 as u32,
            };
            let mut texture = None;
            self.device
                .CreateTexture2D(&desc, None, Some(&mut texture))
                .map_err(|e| win_error("create the shared texture", e))?;
            let texture: ID3D11Texture2D = texture.ok_or("Spout: D3D11 returned no texture")?;
            let resource: IDXGIResource = texture.cast().map_err(|e| win_error("query IDXGIResource", e))?;
            let handle = resource.GetSharedHandle().map_err(|e| win_error("get the share handle", e))?;
            // Spout stores the (32-bit) KMT handle value.
            let share = handle.0 as usize as u32;
            let info = texture_info(share, width, height, format.0 as u32, &self.description);
            self.info
                .with(|block| block[..INFO_SIZE].copy_from_slice(&info))
                .ok_or_else(|| "Spout: the sender info stayed locked".to_string())?;
            self.texture = Some((texture.clone(), width, height, format.0 as u32, share));
            Ok(texture)
        }
    }

    /// Send the output texture `shared_name`. Call right after the frame
    /// that wrote it was submitted; this only queues GPU work.
    pub fn send(&mut self, wgpu_device: &wgpu::Device, shared_name: &str) -> Result<bool, String> {
        unsafe {
            let source = self.source_texture(shared_name)?;
            let mut desc = D3D11_TEXTURE2D_DESC::default();
            source.GetDesc(&mut desc);
            if desc.Width == 0 || desc.Height == 0 {
                return Ok(false);
            }
            let target = self.ensure_texture(desc.Width, desc.Height, desc.Format)?;

            self.fence_value += 1;
            let value = self.fence_value;
            {
                let raw = wgpu_device
                    .as_hal::<Dx12>()
                    .ok_or_else(|| "Spout lost the renderer's D3D12 device".to_string())?;
                raw.raw_queue().Signal(&self.frame_done12, value).map_err(|e| win_error("signal the frame fence", e))?;
            }
            // A receiver may hold the texture: skip this frame rather than wait.
            let waited = WaitForSingleObject(self.access, ACCESS_LOCK_MS);
            let locked = waited == WAIT_OBJECT_0 || waited.0 == 0x80;
            self.context.Wait(&self.frame_done11, value).map_err(|e| win_error("wait for the frame", e))?;
            if locked {
                self.context.CopyResource(&target, &source);
            }
            self.context.Signal(&self.copied11, value).map_err(|e| win_error("signal the copy", e))?;
            self.context.Flush();
            if locked {
                let _ = ReleaseMutex(self.access);
            }
            // The core's next writes to the output wait for the copy.
            let raw = wgpu_device
                .as_hal::<Dx12>()
                .ok_or_else(|| "Spout lost the renderer's D3D12 device".to_string())?;
            raw.raw_queue()
                .Wait(&self.copied12, value)
                .map_err(|e| win_error("order the next frame after the copy", e))?;
            if !locked {
                return Ok(false);
            }
            if let Some(semaphore) = self.frame_count {
                if WaitForSingleObject(semaphore, 0) == WAIT_OBJECT_0 {
                    let _ = ReleaseSemaphore(semaphore, 2, None);
                }
            }
            self.frames += 1;
            Ok(true)
        }
    }

    pub fn size(&self) -> (u32, u32) {
        self.texture.as_ref().map(|(_, w, h, _, _)| (*w, *h)).unwrap_or((0, 0))
    }
}

impl Drop for SpoutSender {
    fn drop(&mut self) {
        self.unregister();
        unsafe {
            let _ = CloseHandle(self.access);
            if let Some(semaphore) = self.frame_count.take() {
                let _ = CloseHandle(semaphore);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sender_names_are_kept_sorted_and_end_with_an_empty_entry() {
        let mut block = vec![0xffu8; NAME_LEN * 4];
        write_names(&mut block, &["zeta".into(), "Alpha".into(), "mid".into()], 4);
        assert_eq!(read_names(&block, 4), vec!["Alpha", "mid", "zeta"]);
        assert_eq!(block[NAME_LEN * 3], 0);
        write_names(&mut block, &["only".into()], 4);
        assert_eq!(read_names(&block, 4), vec!["only"]);
    }

    #[test]
    fn texture_info_matches_the_spout_record() {
        let info = texture_info(0x1234, 1920, 1080, 87, "C:\\Ghost Arcade.exe");
        assert_eq!(info.len(), 280);
        assert_eq!(u32::from_le_bytes(info[0..4].try_into().unwrap()), 0x1234);
        assert_eq!(u32::from_le_bytes(info[4..8].try_into().unwrap()), 1920);
        assert_eq!(u32::from_le_bytes(info[8..12].try_into().unwrap()), 1080);
        assert_eq!(u32::from_le_bytes(info[12..16].try_into().unwrap()), 87);
        assert_eq!(&info[20..39], b"C:\\Ghost Arcade.exe");
    }
}
