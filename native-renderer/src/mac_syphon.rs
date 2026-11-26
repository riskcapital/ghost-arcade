#![cfg(target_os = "macos")]
//! Rust side of the core's Syphon server (`mac_syphon_server.mm`).
//!
//! Syphon.framework is found and opened at run time: next to the packaged
//! app's other frameworks, or in the source tree for a development build.
//! A core that cannot find it keeps running and reports why it cannot
//! publish; the app then keeps its older Syphon path.

use std::ffi::{c_char, c_void, CString};
use std::path::{Path, PathBuf};
use std::sync::OnceLock;

use objc2_io_surface::IOSurfaceRef;

const ERROR_CAPACITY: usize = 512;

unsafe extern "C" {
    fn ghost_syphon_load(path: *const c_char, error: *mut c_char, capacity: usize) -> i32;
    fn ghost_syphon_set_app_name(name: *const c_char);
    fn ghost_syphon_server_create(
        name: *const c_char,
        error: *mut c_char,
        capacity: usize,
    ) -> *mut c_void;
    fn ghost_syphon_server_set_slot(
        server: *mut c_void,
        slot: u32,
        surface: *mut c_void,
        width: u32,
        height: u32,
        error: *mut c_char,
        capacity: usize,
    ) -> i32;
    fn ghost_syphon_server_slot_free(server: *mut c_void, slot: u32) -> i32;
    fn ghost_syphon_server_publish(server: *mut c_void, slot: u32, flipped: i32) -> i32;
    fn ghost_syphon_server_has_clients(server: *mut c_void) -> i32;
    fn ghost_syphon_server_free(server: *mut c_void);
}

fn take_error(buffer: &[c_char], fallback: &str) -> String {
    let bytes: Vec<u8> = buffer
        .iter()
        .take_while(|c| **c != 0)
        .map(|c| *c as u8)
        .collect();
    if bytes.is_empty() {
        fallback.to_string()
    } else {
        String::from_utf8_lossy(&bytes).into_owned()
    }
}

/// Where Syphon.framework may be, most specific first.
pub fn framework_candidates(override_path: Option<&str>, exe: Option<&Path>) -> Vec<PathBuf> {
    let mut candidates = Vec::new();
    if let Some(path) = override_path.map(str::trim).filter(|p| !p.is_empty()) {
        candidates.push(PathBuf::from(path));
    }
    if let Some(dir) = exe.and_then(Path::parent) {
        // Packaged: Contents/Resources/native-renderer/ghost-render-core,
        // with the framework in Contents/Frameworks.
        candidates.push(dir.join("../../Frameworks/Syphon.framework"));
        // Source tree: native-renderer/target/<profile>/ghost-render-core.
        let repo = dir.join("../../..");
        candidates.push(repo.join("electron/native/build/Release/Syphon.framework"));
        candidates.push(repo.join("electron/native/vendor/Syphon.framework"));
    }
    candidates
}

/// Open the framework once per process. The answer (its path, or why it
/// could not be opened) is kept: a framework that failed to load will not
/// load on a second try either.
pub fn load_framework() -> Result<PathBuf, String> {
    static LOADED: OnceLock<Result<PathBuf, String>> = OnceLock::new();
    LOADED
        .get_or_init(|| {
            let override_path = std::env::var("GA_SYPHON_FRAMEWORK").ok();
            let exe = std::env::current_exe().ok();
            let mut reasons = Vec::new();
            for candidate in framework_candidates(override_path.as_deref(), exe.as_deref()) {
                if !candidate.join("Syphon").exists() && !candidate.join("Versions/A/Syphon").exists() {
                    continue;
                }
                let path = candidate.canonicalize().unwrap_or(candidate);
                let Ok(path_c) = CString::new(path.to_string_lossy().as_ref()) else {
                    continue;
                };
                let mut error = [0 as c_char; ERROR_CAPACITY];
                if unsafe { ghost_syphon_load(path_c.as_ptr(), error.as_mut_ptr(), ERROR_CAPACITY) } == 1 {
                    return Ok(path);
                }
                reasons.push(take_error(&error, "could not load Syphon.framework"));
            }
            Err(if reasons.is_empty() {
                "Syphon.framework was not found next to the render core".to_string()
            } else {
                reasons.join("; ")
            })
        })
        .clone()
}

pub struct SyphonServer {
    handle: *mut c_void,
}

// Only ever used from the core's render thread.
unsafe impl Send for SyphonServer {}

impl SyphonServer {
    /// `app_name`: what clients list as the publishing application (the
    /// app's own name, not the core executable's).
    pub fn new(name: &str, app_name: Option<&str>) -> Result<Self, String> {
        load_framework()?;
        if let Some(app) = app_name.and_then(|app| CString::new(app.trim()).ok()) {
            unsafe { ghost_syphon_set_app_name(app.as_ptr()) };
        }
        let name_c = CString::new(name).map_err(|_| "Syphon server name contains a NUL".to_string())?;
        let mut error = [0 as c_char; ERROR_CAPACITY];
        let handle =
            unsafe { ghost_syphon_server_create(name_c.as_ptr(), error.as_mut_ptr(), ERROR_CAPACITY) };
        if handle.is_null() {
            return Err(take_error(&error, "could not create the Syphon server"));
        }
        Ok(Self { handle })
    }

    pub fn set_slot(&mut self, slot: u32, surface: &IOSurfaceRef, width: u32, height: u32) -> Result<(), String> {
        let mut error = [0 as c_char; ERROR_CAPACITY];
        let surface = surface as *const IOSurfaceRef as *mut c_void;
        let ok = unsafe {
            ghost_syphon_server_set_slot(self.handle, slot, surface, width, height, error.as_mut_ptr(), ERROR_CAPACITY)
        };
        if ok == 1 {
            Ok(())
        } else {
            Err(take_error(&error, "could not bind a Syphon slot"))
        }
    }

    /// OpenGL has finished reading the slot since its last publish.
    pub fn slot_free(&self, slot: u32) -> bool {
        unsafe { ghost_syphon_server_slot_free(self.handle, slot) == 1 }
    }

    pub fn publish(&mut self, slot: u32, flipped: bool) -> bool {
        unsafe { ghost_syphon_server_publish(self.handle, slot, i32::from(flipped)) == 1 }
    }

    pub fn has_clients(&self) -> bool {
        unsafe { ghost_syphon_server_has_clients(self.handle) == 1 }
    }
}

impl Drop for SyphonServer {
    fn drop(&mut self) {
        unsafe { ghost_syphon_server_free(self.handle) };
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn framework_is_looked_for_in_the_override_then_the_app_bundle_then_the_source_tree() {
        let exe = Path::new("/App.app/Contents/Resources/native-renderer/ghost-render-core");
        let found = framework_candidates(Some(" /opt/Syphon.framework "), Some(exe));
        assert_eq!(found[0], PathBuf::from("/opt/Syphon.framework"));
        assert_eq!(
            found[1],
            PathBuf::from("/App.app/Contents/Resources/native-renderer/../../Frameworks/Syphon.framework")
        );
        assert!(found[2].ends_with("electron/native/build/Release/Syphon.framework"));
        assert!(found[3].ends_with("electron/native/vendor/Syphon.framework"));
        assert_eq!(framework_candidates(Some(""), None), Vec::<PathBuf>::new());
    }
}
