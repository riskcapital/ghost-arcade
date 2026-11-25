//! Opt-in count of GPU objects the core makes while it draws.
//!
//! `GA_CORE_CHURN_PROBE=1` in the core's environment turns it on; the status
//! then carries `gpu_object_churn` (running totals since start). Divide the
//! change in a total by the change in `gpu_frames_submitted` for a per-frame
//! figure. Off (the default) each note is one relaxed load of a flag set once.

use serde::Serialize;
use std::sync::{
    atomic::{AtomicBool, AtomicU64, Ordering},
    OnceLock,
};

static ENABLED: OnceLock<bool> = OnceLock::new();
static ON: AtomicBool = AtomicBool::new(false);
static BIND_GROUPS: AtomicU64 = AtomicU64::new(0);
static TEXTURE_VIEWS: AtomicU64 = AtomicU64::new(0);

/// Read the switch once, at start.
pub fn init() {
    let enabled = *ENABLED.get_or_init(|| std::env::var("GA_CORE_CHURN_PROBE").is_ok_and(|v| v == "1"));
    ON.store(enabled, Ordering::Relaxed);
}

#[inline]
pub fn bind_group() {
    if ON.load(Ordering::Relaxed) {
        BIND_GROUPS.fetch_add(1, Ordering::Relaxed);
    }
}

#[inline]
pub fn texture_view() {
    if ON.load(Ordering::Relaxed) {
        TEXTURE_VIEWS.fetch_add(1, Ordering::Relaxed);
    }
}

#[derive(Clone, Copy, Debug, Serialize)]
pub struct ChurnCounts {
    pub bind_groups: u64,
    pub texture_views: u64,
}

/// The running totals, or None while the probe is off.
pub fn counts() -> Option<ChurnCounts> {
    ON.load(Ordering::Relaxed).then(|| ChurnCounts {
        bind_groups: BIND_GROUPS.load(Ordering::Relaxed),
        texture_views: TEXTURE_VIEWS.load(Ordering::Relaxed),
    })
}
