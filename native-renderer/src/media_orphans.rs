//! Media sources that nothing uses any more.
//!
//! A layer's media source is released when the layer lets go of it
//! (`release_media_source_if_orphaned`). A source can still be left behind
//! with no layer: a pre-roll request that lands after its layer was removed,
//! or a release skipped because something else held the source at that moment
//! and nobody asked again. Those records were never released, and the decode
//! pump looked at every one of them every frame, so a long session kept
//! growing the list.
//!
//! The sweep releases a plain (editor) source once nothing has referenced it
//! for `ORPHAN_GRACE`. Sources whose id names an owner (`library:`, `show:`,
//! `warmup:`, …), splat textures, clip snapshots and the empty frame are
//! released by their owners and never swept.

use std::collections::HashMap;
use std::time::{Duration, Instant};

/// How long a source may sit unreferenced before it is released. Longer than
/// any gap between a pre-roll and the layer that binds it.
pub(crate) const ORPHAN_GRACE: Duration = Duration::from_secs(10);
/// How often the sweep looks.
pub(crate) const SWEEP_INTERVAL: Duration = Duration::from_secs(1);

/// Whether the sweep may release this source at all.
pub(crate) fn sweepable(id: &str, empty_frame_id: &str) -> bool {
    !id.is_empty()
        && id != empty_frame_id
        && !id.contains(':')
        && !id.starts_with("native-splat-video-")
        && !id.starts_with("vj-clip-snapshot-")
}

/// Each sweepable source is either referenced (not tracked) or unreferenced
/// since a time; past the grace it is released. Only sources present in the
/// latest pass are tracked, so the map never outgrows the source list.
#[derive(Default)]
pub(crate) struct OrphanSweep {
    unreferenced_since: HashMap<String, Instant>,
    last_pass: Option<Instant>,
}

impl OrphanSweep {
    /// True at most once per `SWEEP_INTERVAL`.
    pub(crate) fn due(&mut self, now: Instant) -> bool {
        if self.last_pass.is_some_and(|at| now.duration_since(at) < SWEEP_INTERVAL) {
            return false;
        }
        self.last_pass = Some(now);
        true
    }

    /// One pass over the current sources as (id, referenced). Returns the ids
    /// to release now.
    pub(crate) fn pass<'a>(
        &mut self,
        sources: impl IntoIterator<Item = (&'a str, bool)>,
        empty_frame_id: &str,
        now: Instant,
    ) -> Vec<String> {
        let mut next = HashMap::new();
        let mut release = Vec::new();
        for (id, referenced) in sources {
            if referenced || !sweepable(id, empty_frame_id) {
                continue;
            }
            let since = self.unreferenced_since.get(id).copied().unwrap_or(now);
            if now.duration_since(since) >= ORPHAN_GRACE {
                release.push(id.to_string());
            } else {
                next.insert(id.to_string(), since);
            }
        }
        self.unreferenced_since = next;
        release
    }

    pub(crate) fn tracked(&self) -> usize {
        self.unreferenced_since.len()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const EMPTY: &str = "__empty__";

    #[test]
    fn owned_ids_are_never_swept() {
        for id in ["library:a:g1", "show:run-1", "warmup:vj:src", "native-splat-video-3",
            "vj-clip-snapshot-A-2", EMPTY, ""] {
            assert!(!sweepable(id, EMPTY), "{id}");
        }
        assert!(sweepable("4b3249fe-d6ac-44d4-a4ca-005397d2fce2", EMPTY));
    }

    #[test]
    fn an_unreferenced_source_is_released_after_the_grace_only() {
        let mut sweep = OrphanSweep::default();
        let t0 = Instant::now();
        assert!(sweep.pass([("a", false)], EMPTY, t0).is_empty());
        assert_eq!(sweep.tracked(), 1);
        assert!(sweep.pass([("a", false)], EMPTY, t0 + ORPHAN_GRACE / 2).is_empty());
        assert_eq!(sweep.pass([("a", false)], EMPTY, t0 + ORPHAN_GRACE), vec!["a".to_string()]);
        assert_eq!(sweep.tracked(), 0);
    }

    #[test]
    fn a_reference_in_between_restarts_the_grace() {
        let mut sweep = OrphanSweep::default();
        let t0 = Instant::now();
        sweep.pass([("a", false)], EMPTY, t0);
        assert!(sweep.pass([("a", true)], EMPTY, t0 + ORPHAN_GRACE / 2).is_empty());
        assert_eq!(sweep.tracked(), 0);
        // Unreferenced again: the grace counts from now, not from t0.
        assert!(sweep.pass([("a", false)], EMPTY, t0 + ORPHAN_GRACE).is_empty());
        assert!(sweep.pass([("a", false)], EMPTY, t0 + ORPHAN_GRACE + ORPHAN_GRACE / 2).is_empty());
        assert_eq!(sweep.pass([("a", false)], EMPTY, t0 + ORPHAN_GRACE * 2), vec!["a".to_string()]);
    }

    #[test]
    fn referenced_and_owned_sources_stay_and_gone_ones_are_forgotten() {
        let mut sweep = OrphanSweep::default();
        let t0 = Instant::now();
        sweep.pass([("a", false), ("b", true), ("library:x:g1", false)], EMPTY, t0);
        assert_eq!(sweep.tracked(), 1);
        // `a` was released elsewhere: the sweep forgets it.
        assert!(sweep.pass([("b", true)], EMPTY, t0 + ORPHAN_GRACE).is_empty());
        assert_eq!(sweep.tracked(), 0);
    }

    #[test]
    fn passes_are_at_most_once_per_interval() {
        let mut sweep = OrphanSweep::default();
        let t0 = Instant::now();
        assert!(sweep.due(t0));
        assert!(!sweep.due(t0 + SWEEP_INTERVAL / 2));
        assert!(sweep.due(t0 + SWEEP_INTERVAL));
    }
}
