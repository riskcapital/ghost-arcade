use std::time::Instant;

/// A started fade owns its clock until the transition token changes.
pub struct TransitionClock { token: u64, start: Instant, progress: f64, duration: f64 }
impl TransitionClock {
    pub fn sample(slot: &mut Option<Self>, token: u64, progress: f64, duration: f64, now: Instant) -> f32 {
        if slot.as_ref().is_none_or(|clock| clock.token != token) {
            *slot = Some(Self { token, start: now, progress: progress.clamp(0.0, 1.0), duration });
        }
        let clock = slot.as_ref().unwrap();
        (clock.progress + now.saturating_duration_since(clock.start).as_secs_f64() / clock.duration).clamp(0.0, 1.0) as f32
    }
}
#[cfg(test)] mod tests {
    use super::*;
    use std::time::Duration;
    #[test] fn advances_without_updates_and_ignores_stale_progress() {
        let now=Instant::now(); let mut clock=None;
        assert_eq!(TransitionClock::sample(&mut clock,1,0.2,1.0,now),0.2);
        assert_eq!(TransitionClock::sample(&mut clock,1,0.0,1.0,now+Duration::from_millis(500)),0.7);
        assert_eq!(TransitionClock::sample(&mut clock,1,0.0,1.0,now+Duration::from_secs(2)),1.0);
        assert_eq!(TransitionClock::sample(&mut clock,2,0.0,1.0,now+Duration::from_secs(2)),0.0);
    }
}
