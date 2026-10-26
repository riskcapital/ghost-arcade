//! The core's completed-frame counter, shared with the Windows presenters.
//!
//! The presenters in Electron copy the core's shared textures to their own
//! swapchains at every vblank of their display. They had no way to know
//! whether the core had drawn anything since the last copy, so a 144Hz panel
//! copied and blitted a 4K texture 144 times a second for a 60fps core --
//! bandwidth an integrated GPU then lacked for the core itself.
//!
//! The core publishes how many frames the GPU has completed in a small named
//! shared-memory block; a presenter skips a vblank when the number has not
//! moved. It is written once a frame's GPU work has finished, so a presenter
//! that sees a new number copies a finished frame.
//!
//! Layout (16 bytes, little-endian): magic `GAFC`, version 1, then the
//! completed-frame count as a 64-bit integer at offset 8.
// Only Windows has the presenters that read it.
#![cfg_attr(not(target_os = "windows"), allow(dead_code))]

pub const FRAME_COUNTER_MAGIC: u32 = u32::from_le_bytes(*b"GAFC");
pub const FRAME_COUNTER_VERSION: u32 = 1;
pub const FRAME_COUNTER_BYTES: usize = 16;

/// Session-local, like the shared texture names: one core per process id.
pub fn frame_counter_name(pid: u32) -> String {
    format!("Local\\GhostArcadeFrameCounter-{pid}")
}

/// The block's contents for a given count, as a presenter reads them.
#[cfg(test)]
fn encode(frames: u64) -> [u8; FRAME_COUNTER_BYTES] {
    let mut out = [0u8; FRAME_COUNTER_BYTES];
    out[0..4].copy_from_slice(&FRAME_COUNTER_MAGIC.to_le_bytes());
    out[4..8].copy_from_slice(&FRAME_COUNTER_VERSION.to_le_bytes());
    out[8..16].copy_from_slice(&frames.to_le_bytes());
    out
}

#[cfg(target_os = "windows")]
pub use windows_impl::FrameCounterPublisher;

#[cfg(target_os = "windows")]
mod windows_impl {
    use super::{FRAME_COUNTER_BYTES, FRAME_COUNTER_MAGIC, FRAME_COUNTER_VERSION};
    use std::sync::atomic::{AtomicU64, Ordering};
    use windows::{
        Win32::{
            Foundation::{CloseHandle, HANDLE, INVALID_HANDLE_VALUE},
            System::Memory::{
                CreateFileMappingW, FILE_MAP_WRITE, MEMORY_MAPPED_VIEW_ADDRESS, MapViewOfFile,
                PAGE_READWRITE, UnmapViewOfFile,
            },
        },
        core::PCWSTR,
    };

    pub struct FrameCounterPublisher {
        name: String,
        mapping: HANDLE,
        view: MEMORY_MAPPED_VIEW_ADDRESS,
    }

    // The view is a fixed block of shared memory written with atomics only.
    unsafe impl Send for FrameCounterPublisher {}
    unsafe impl Sync for FrameCounterPublisher {}

    impl FrameCounterPublisher {
        pub fn create(name: &str) -> Option<Self> {
            let wide: Vec<u16> = name.encode_utf16().chain(std::iter::once(0)).collect();
            unsafe {
                let mapping = CreateFileMappingW(
                    INVALID_HANDLE_VALUE,
                    None,
                    PAGE_READWRITE,
                    0,
                    FRAME_COUNTER_BYTES as u32,
                    PCWSTR(wide.as_ptr()),
                )
                .ok()?;
                let view = MapViewOfFile(mapping, FILE_MAP_WRITE, 0, 0, FRAME_COUNTER_BYTES);
                if view.Value.is_null() {
                    let _ = CloseHandle(mapping);
                    return None;
                }
                let base = view.Value as *mut u8;
                // Count first, then the header: a reader that sees the magic
                // sees a valid count.
                AtomicU64::from_ptr(base.add(8) as *mut u64).store(0, Ordering::Release);
                (base.add(4) as *mut u32).write_volatile(FRAME_COUNTER_VERSION);
                (base as *mut u32).write_volatile(FRAME_COUNTER_MAGIC);
                Some(Self { name: name.to_string(), mapping, view })
            }
        }

        pub fn name(&self) -> &str {
            &self.name
        }

        pub fn publish(&self, frames: u64) {
            // SAFETY: the view is 16 bytes, page aligned, and lives as long as self.
            unsafe {
                AtomicU64::from_ptr((self.view.Value as *mut u8).add(8) as *mut u64)
                    .store(frames, Ordering::Release);
            }
        }
    }

    impl Drop for FrameCounterPublisher {
        fn drop(&mut self) {
            unsafe {
                let _ = UnmapViewOfFile(self.view);
                let _ = CloseHandle(self.mapping);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_block_reads_back_as_the_presenters_expect() {
        let block = encode(0x0102_0304_0506_0708);
        // The addon checks the magic as a little-endian u32 (0x43464147).
        assert_eq!(u32::from_le_bytes(block[0..4].try_into().unwrap()), 0x4346_4147);
        assert_eq!(u32::from_le_bytes(block[4..8].try_into().unwrap()), 1);
        assert_eq!(u64::from_le_bytes(block[8..16].try_into().unwrap()), 0x0102_0304_0506_0708);
        assert_eq!(frame_counter_name(4242), "Local\\GhostArcadeFrameCounter-4242");
    }
}
