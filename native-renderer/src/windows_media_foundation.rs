//! Media Foundation, resolved when it is first used.
//!
//! Windows N and KN editions ship without Media Foundation. The `windows`
//! crate imports mfplat.dll and mfreadwrite.dll at load time (raw-dylib), so
//! on those systems Windows refused to start the render core at all
//! (STATUS_DLL_NOT_FOUND, 0xC0000135): no picture, not just no hardware
//! video. These entry points are looked up at runtime instead. Without Media
//! Foundation the core starts, hardware decoding and native recording report
//! why they are unavailable, and video falls back to the ffmpeg decoder.
//!
//! The functions keep the `windows` crate's names and signatures, so the
//! decoder and encoder call sites read the same. Importing them explicitly
//! shadows the crate's glob-imported originals.
#![cfg(target_os = "windows")]
#![allow(non_snake_case)]

use std::{ffi::c_void, sync::OnceLock};

use windows::{
    Win32::{
        Foundation::HMODULE,
        Media::MediaFoundation::{
            IMFAttributes, IMFByteStream, IMFDXGIDeviceManager, IMFMediaBuffer, IMFMediaType,
            IMFSample, IMFSinkWriter, IMFSourceReader,
        },
        System::LibraryLoader::{GetProcAddress, LOAD_LIBRARY_SEARCH_SYSTEM32, LoadLibraryExW},
    },
    core::{BOOL, Error, GUID, HRESULT, IUnknown, Interface, PCSTR, PCWSTR, Param, Result, s, w},
};

type StartupFn = unsafe extern "system" fn(u32, u32) -> HRESULT;
type ShutdownFn = unsafe extern "system" fn() -> HRESULT;
type CreateAttributesFn = unsafe extern "system" fn(*mut *mut c_void, u32) -> HRESULT;
type CreateDxgiDeviceManagerFn = unsafe extern "system" fn(*mut u32, *mut *mut c_void) -> HRESULT;
type CreateObjectFn = unsafe extern "system" fn(*mut *mut c_void) -> HRESULT;
type CreateDxgiSurfaceBufferFn =
    unsafe extern "system" fn(*const GUID, *mut c_void, u32, BOOL, *mut *mut c_void) -> HRESULT;
type CreateSourceReaderFromUrlFn =
    unsafe extern "system" fn(PCWSTR, *mut c_void, *mut *mut c_void) -> HRESULT;
type CreateSinkWriterFromUrlFn =
    unsafe extern "system" fn(PCWSTR, *mut c_void, *mut c_void, *mut *mut c_void) -> HRESULT;

struct Platform {
    startup: StartupFn,
    shutdown: ShutdownFn,
    create_attributes: CreateAttributesFn,
    create_dxgi_device_manager: CreateDxgiDeviceManagerFn,
    create_media_type: CreateObjectFn,
    create_sample: CreateObjectFn,
    create_dxgi_surface_buffer: CreateDxgiSurfaceBufferFn,
}

struct ReadWrite {
    create_source_reader_from_url: CreateSourceReaderFromUrlFn,
    create_sink_writer_from_url: CreateSinkWriterFromUrlFn,
}

/// The message every Media Foundation call returns on a system without it.
pub const MEDIA_FOUNDATION_MISSING: &str = "Media Foundation is not installed on this PC, so videos play \
through the slower software decoder. On Windows N or KN editions, install Microsoft's Media Feature Pack \
(Settings > Apps > Optional features), then restart Ghost Arcade";

/// ERROR_MOD_NOT_FOUND as an HRESULT.
const MODULE_NOT_FOUND: HRESULT = HRESULT::from_win32(126);

fn missing(detail: &str) -> Error {
    Error::new(MODULE_NOT_FOUND, format!("{MEDIA_FOUNDATION_MISSING} ({detail})"))
}

/// System32 only: a stray mfplat.dll beside the executable or on PATH must
/// never be picked up in place of the system's own.
fn load_system_library(name: PCWSTR) -> std::result::Result<HMODULE, String> {
    unsafe { LoadLibraryExW(name, None, LOAD_LIBRARY_SEARCH_SYSTEM32) }
        .map_err(|error| format!("{} could not be loaded: {error}", unsafe { name.display() }))
}

/// # Safety
/// `T` must be the `extern "system"` function pointer type of `name`.
unsafe fn symbol<T: Copy>(module: HMODULE, name: PCSTR) -> std::result::Result<T, String> {
    let address = unsafe { GetProcAddress(module, name) }
        .ok_or_else(|| format!("{} is missing", unsafe { name.display() }))?;
    debug_assert_eq!(std::mem::size_of::<T>(), std::mem::size_of_val(&address));
    // A function pointer of the documented signature, as GetProcAddress
    // returns it for every export.
    Ok(unsafe { std::mem::transmute_copy::<_, T>(&address) })
}

fn platform() -> std::result::Result<&'static Platform, Error> {
    static PLATFORM: OnceLock<std::result::Result<Platform, String>> = OnceLock::new();
    PLATFORM
        .get_or_init(|| {
            // Loaded once and kept for the life of the process, like the
            // load-time import it replaces.
            let module = load_system_library(w!("mfplat.dll"))?;
            unsafe {
                Ok(Platform {
                    startup: symbol(module, s!("MFStartup"))?,
                    shutdown: symbol(module, s!("MFShutdown"))?,
                    create_attributes: symbol(module, s!("MFCreateAttributes"))?,
                    create_dxgi_device_manager: symbol(module, s!("MFCreateDXGIDeviceManager"))?,
                    create_media_type: symbol(module, s!("MFCreateMediaType"))?,
                    create_sample: symbol(module, s!("MFCreateSample"))?,
                    create_dxgi_surface_buffer: symbol(module, s!("MFCreateDXGISurfaceBuffer"))?,
                })
            }
        })
        .as_ref()
        .map_err(|detail| missing(detail))
}

fn read_write() -> std::result::Result<&'static ReadWrite, Error> {
    static READ_WRITE: OnceLock<std::result::Result<ReadWrite, String>> = OnceLock::new();
    READ_WRITE
        .get_or_init(|| {
            let module = load_system_library(w!("mfreadwrite.dll"))?;
            unsafe {
                Ok(ReadWrite {
                    create_source_reader_from_url: symbol(module, s!("MFCreateSourceReaderFromURL"))?,
                    create_sink_writer_from_url: symbol(module, s!("MFCreateSinkWriterFromURL"))?,
                })
            }
        })
        .as_ref()
        .map_err(|detail| missing(detail))
}

/// Whether this PC has Media Foundation, and if not, why (for status).
pub fn availability() -> std::result::Result<(), String> {
    platform().map(|_| ()).map_err(|e| e.message())?;
    read_write().map(|_| ()).map_err(|e| e.message())
}

unsafe fn created<T: Interface>(hr: HRESULT, raw: *mut c_void) -> Result<T> {
    hr.ok()?;
    if raw.is_null() {
        return Err(Error::from_hresult(windows::Win32::Foundation::E_POINTER));
    }
    Ok(unsafe { T::from_raw(raw) })
}

pub unsafe fn MFStartup(version: u32, flags: u32) -> Result<()> {
    unsafe { (platform()?.startup)(version, flags) }.ok()
}

pub unsafe fn MFShutdown() -> Result<()> {
    unsafe { (platform()?.shutdown)() }.ok()
}

pub unsafe fn MFCreateAttributes(attributes: *mut Option<IMFAttributes>, initial_size: u32) -> Result<()> {
    let create = platform()?.create_attributes;
    // Option<interface> has the layout of the raw COM pointer (null = None).
    unsafe { create(attributes.cast(), initial_size) }.ok()
}

pub unsafe fn MFCreateDXGIDeviceManager(
    reset_token: *mut u32,
    manager: *mut Option<IMFDXGIDeviceManager>,
) -> Result<()> {
    let create = platform()?.create_dxgi_device_manager;
    unsafe { create(reset_token, manager.cast()) }.ok()
}

pub unsafe fn MFCreateMediaType() -> Result<IMFMediaType> {
    let create = platform()?.create_media_type;
    let mut raw = std::ptr::null_mut();
    unsafe { created(create(&mut raw), raw) }
}

pub unsafe fn MFCreateSample() -> Result<IMFSample> {
    let create = platform()?.create_sample;
    let mut raw = std::ptr::null_mut();
    unsafe { created(create(&mut raw), raw) }
}

pub unsafe fn MFCreateDXGISurfaceBuffer<P1>(
    riid: *const GUID,
    surface: P1,
    subresource: u32,
    bottom_up_when_linear: bool,
) -> Result<IMFMediaBuffer>
where
    P1: Param<IUnknown>,
{
    let create = platform()?.create_dxgi_surface_buffer;
    let mut raw = std::ptr::null_mut();
    unsafe {
        let hr = create(riid, surface.param().abi(), subresource, bottom_up_when_linear.into(), &mut raw);
        created(hr, raw)
    }
}

pub unsafe fn MFCreateSourceReaderFromURL<P1>(url: PCWSTR, attributes: P1) -> Result<IMFSourceReader>
where
    P1: Param<IMFAttributes>,
{
    let create = read_write()?.create_source_reader_from_url;
    let mut raw = std::ptr::null_mut();
    unsafe {
        let hr = create(url, attributes.param().abi(), &mut raw);
        created(hr, raw)
    }
}

pub unsafe fn MFCreateSinkWriterFromURL<P1, P2>(url: PCWSTR, byte_stream: P1, attributes: P2) -> Result<IMFSinkWriter>
where
    P1: Param<IMFByteStream>,
    P2: Param<IMFAttributes>,
{
    let create = read_write()?.create_sink_writer_from_url;
    let mut raw = std::ptr::null_mut();
    unsafe {
        let hr = create(url, byte_stream.param().abi(), attributes.param().abi(), &mut raw);
        created(hr, raw)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn media_foundation_is_found_when_installed_and_explained_when_not() {
        let system = std::env::var_os("SystemRoot").map(std::path::PathBuf::from)
            .unwrap_or_else(|| std::path::PathBuf::from(r"C:\Windows"));
        let installed = system.join("System32").join("mfplat.dll").exists()
            && system.join("System32").join("mfreadwrite.dll").exists();
        match availability() {
            Ok(()) => assert!(installed, "Media Foundation loaded although its DLLs are absent"),
            Err(reason) => {
                assert!(!installed, "Media Foundation is installed but did not load: {reason}");
                assert!(reason.contains("Media Feature Pack"), "{reason}");
            }
        }
    }

    #[test]
    fn calls_without_media_foundation_fail_instead_of_stopping_the_core() {
        use windows::Win32::Media::MediaFoundation::{MF_VERSION, MFSTARTUP_FULL};
        // Either way the call returns: Media Foundation starts, or the plain reason.
        match unsafe { MFStartup(MF_VERSION, MFSTARTUP_FULL) } {
            Ok(()) => {
                assert!(availability().is_ok());
                assert!(unsafe { MFCreateMediaType() }.is_ok());
                let _ = unsafe { MFShutdown() };
            }
            Err(error) => assert!(error.message().contains("Media Feature Pack"), "{error}"),
        }
    }
}
