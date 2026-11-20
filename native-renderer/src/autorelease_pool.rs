//! Objective-C autorelease pools for the core's own threads (macOS).
//!
//! Metal, AVFoundation and VideoToolbox hand back autoreleased objects. The
//! main thread's run loop drains its pool every turn, but a thread the core
//! starts itself has no pool at all: the runtime then parks every autoreleased
//! object in an implicit pool that is only drained when the thread exits. The
//! GPU completion thread and a video stream's decode thread live for the whole
//! session, so what they autoreleased (a retain on the Metal device every
//! frame, a released video reader's track output every seek) piled up for
//! hours. Measured with `OBJC_DEBUG_MISSING_POOLS=YES`: ~100 objects a second
//! on a playing set.
//!
//! [`IterationPool`] is one pool per loop turn: create it at the top of the
//! loop body; it drains when the turn ends, however it ends (`continue`, `?`,
//! `return`). Off macOS it is nothing.

use std::marker::PhantomData;

/// One autorelease pool, drained when dropped. Not `Send`: a pool must be
/// popped on the thread that pushed it, in the reverse order of pushing.
pub struct IterationPool {
    #[cfg(target_os = "macos")]
    token: *mut std::ffi::c_void,
    _not_send: PhantomData<*mut ()>,
}

impl IterationPool {
    #[inline]
    pub fn new() -> Self {
        Self {
            // SAFETY: push/pop are paired by this value's lifetime on one
            // thread (it is neither Send nor Clone).
            #[cfg(target_os = "macos")]
            token: unsafe { objc2::ffi::objc_autoreleasePoolPush() },
            _not_send: PhantomData,
        }
    }
}

impl Drop for IterationPool {
    #[inline]
    fn drop(&mut self) {
        // SAFETY: the token came from the matching push on this thread.
        #[cfg(target_os = "macos")]
        unsafe {
            objc2::ffi::objc_autoreleasePoolPop(self.token)
        };
    }
}

/// Runs `f` inside its own pool.
#[inline]
pub fn with_pool<R>(f: impl FnOnce() -> R) -> R {
    let _pool = IterationPool::new();
    f()
}

#[cfg(all(test, target_os = "macos"))]
mod tests {
    use super::*;
    use objc2::rc::Retained;
    use objc2::runtime::NSObject;
    use std::sync::Arc;
    use std::sync::atomic::{AtomicUsize, Ordering};

    /// An object autoreleased inside a turn's pool is released when the turn
    /// ends, on a thread that never had a pool of its own.
    #[test]
    fn a_turn_releases_what_it_autoreleased() {
        let observed = Arc::new(AtomicUsize::new(0));
        let seen = Arc::clone(&observed);
        std::thread::spawn(move || {
            let object: Retained<NSObject> = NSObject::new();
            let count = || -> usize { unsafe { objc2::msg_send![&*object, retainCount] } };
            for _ in 0..1000 {
                let _turn = IterationPool::new();
                // +1 retain, handed to the pool.
                let extra = object.clone();
                let _ = Retained::autorelease_return(extra);
            }
            // Every turn drained: only our own reference is left.
            seen.store(count(), Ordering::SeqCst);
        })
        .join()
        .unwrap();
        assert_eq!(observed.load(Ordering::SeqCst), 1);
    }

    /// Without the pool the same loop keeps every object (the leak this
    /// module fixes): the retain count climbs with the turns.
    #[test]
    fn without_a_pool_the_thread_keeps_them() {
        let observed = Arc::new(AtomicUsize::new(0));
        let seen = Arc::clone(&observed);
        std::thread::spawn(move || {
            let object: Retained<NSObject> = NSObject::new();
            let count = || -> usize { unsafe { objc2::msg_send![&*object, retainCount] } };
            // An outer pool stands in for the thread's implicit one, so the
            // test cleans up after itself.
            with_pool(|| {
                for _ in 0..1000 {
                    let extra = object.clone();
                    let _ = Retained::autorelease_return(extra);
                }
                seen.store(count(), Ordering::SeqCst);
            });
        })
        .join()
        .unwrap();
        assert_eq!(observed.load(Ordering::SeqCst), 1001);
    }

    /// A pool per frame costs nothing measurable: well under a microsecond
    /// to open and drain (a frame at 60 fps is 16,667 µs).
    #[test]
    fn a_pool_costs_well_under_a_microsecond() {
        let turns = 200_000;
        let started = std::time::Instant::now();
        for _ in 0..turns {
            let _turn = IterationPool::new();
        }
        let per_turn_ns = started.elapsed().as_nanos() as f64 / turns as f64;
        eprintln!("autorelease pool: {per_turn_ns:.0} ns per turn");
        assert!(per_turn_ns < 1_000.0, "{per_turn_ns} ns per pool");
    }
}
