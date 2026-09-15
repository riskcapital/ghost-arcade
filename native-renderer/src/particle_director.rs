//! Presentation camera for the source-driven particle instruments.
//!
//! A cinematographer, not an orbit: it plans a loop of shots against the
//! picture — establishing, push in, detail, rack focus, another detail — and
//! eases between them. It exists because a particle cloud framed by one fixed
//! camera shows its structure only once; the look lives in the detail shots,
//! and nobody can hand-drive those during a set.
//!
//! The director is pure and deterministic. It is given a seed, the loop index,
//! its settings and the picture's points of interest, and returns shots; it is
//! given the shots and a time, and returns a camera. Nothing here touches the
//! GPU, which is what lets it be tested exactly, and lets both Flythrough and
//! Pixel Particles map the same camera onto their own very different rigs.
//!
//! Points of interest come from a contrast grid of the live source (see the
//! `particle-director/poi-grid` compute pass). Until one has been read back,
//! and for pictures with nothing to single out, it frames by the thirds.

/// Director settings, normalized from the layer's params.
#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) struct DirectorParams {
    pub enabled: bool,
    /// Duration divisor: 0.6 slow, 1.0 medium, 1.7 fast.
    pub pace: f32,
    /// 0 = stays wide, 1 = pushes all the way in on detail shots.
    pub closeness: f32,
    /// Shallow focus on the push-in and detail shots.
    pub depth_of_field: bool,
    /// Round travel and hold to whole beats when the audio clock has a tempo.
    pub beat_sync: bool,
    pub seed: u32,
}

impl Default for DirectorParams {
    fn default() -> Self {
        Self {
            enabled: false,
            pace: 1.0,
            closeness: 0.7,
            depth_of_field: true,
            beat_sync: false,
            seed: 1,
        }
    }
}

/// A camera in instrument-neutral terms. Each instrument maps it onto its own
/// rig; 45 mm is defined as "the framing the operator set up".
#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) struct DirectorCamera {
    pub focal_mm: f32,
    /// Multiplies the operator's camera distance. 1 = unchanged.
    pub distance: f32,
    /// The subject, in source space: -1..1 on both axes, +Y up.
    pub target: [f32; 2],
    /// Yaw and pitch in degrees, added to the operator's.
    pub orbit: [f32; 2],
    /// 0 = focus on the nearest part of the subject, 1 = the farthest.
    pub focus: f32,
    /// 0 = everything sharp.
    pub aperture: f32,
}

impl DirectorCamera {
    pub(crate) const REST: DirectorCamera = DirectorCamera {
        focal_mm: 45.0,
        distance: 1.0,
        target: [0.0, 0.0],
        orbit: [0.0, 0.0],
        focus: 0.5,
        aperture: 0.0,
    };

    fn lerp(a: DirectorCamera, b: DirectorCamera, t: f32) -> DirectorCamera {
        let m = |x: f32, y: f32| x + (y - x) * t;
        DirectorCamera {
            focal_mm: m(a.focal_mm, b.focal_mm),
            distance: m(a.distance, b.distance),
            target: [m(a.target[0], b.target[0]), m(a.target[1], b.target[1])],
            orbit: [m(a.orbit[0], b.orbit[0]), m(a.orbit[1], b.orbit[1])],
            focus: m(a.focus, b.focus),
            aperture: m(a.aperture, b.aperture),
        }
    }

    /// How much closer the picture reads than the operator's framing: focal
    /// length over 45 mm, and dollying in multiplies it further.
    pub(crate) fn zoom(&self) -> f32 {
        (self.focal_mm / 45.0) / self.distance.max(0.05)
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum ShotKind {
    Establishing,
    PushIn,
    Detail,
    RackFocus,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) struct DirectorShot {
    pub kind: ShotKind,
    pub camera: DirectorCamera,
    /// Seconds spent easing from the previous camera to this one.
    pub travel: f32,
    /// Seconds held on this camera once it arrives.
    pub hold: f32,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) struct PointOfInterest {
    /// Source UV, 0..1, +V down (texture space).
    pub uv: [f32; 2],
    pub weight: f32,
}

/// The thirds and the centre: what a camera operator frames by when there is
/// nothing better to look at.
pub(crate) fn default_points_of_interest() -> Vec<PointOfInterest> {
    vec![
        PointOfInterest { uv: [0.5, 0.5], weight: 1.0 },
        PointOfInterest { uv: [1.0 / 3.0, 1.0 / 3.0], weight: 0.8 },
        PointOfInterest { uv: [2.0 / 3.0, 1.0 / 3.0], weight: 0.8 },
        PointOfInterest { uv: [1.0 / 3.0, 2.0 / 3.0], weight: 0.7 },
        PointOfInterest { uv: [2.0 / 3.0, 2.0 / 3.0], weight: 0.7 },
    ]
}

/// Points of interest from an n×n grid of contrast scores (row 0 at the top).
///
/// Local maxima of a 3×3-smoothed grid, strongest first, at least
/// `MIN_SEPARATION` apart in UV so the loop does not spend three shots on one
/// feature, and kept off the outer margin where a push-in would frame mostly
/// empty edge. A picture with no real contrast falls back to the thirds.
pub(crate) fn points_of_interest_from_grid(grid: &[f32], n: usize) -> Vec<PointOfInterest> {
    const MIN_SEPARATION: f32 = 0.18;
    const MARGIN: f32 = 0.1;
    const MAX_POINTS: usize = 6;
    if n < 3 || grid.len() < n * n {
        return default_points_of_interest();
    }
    let at = |x: usize, y: usize| grid[y * n + x].max(0.0);
    let mut smooth = vec![0.0_f32; n * n];
    for y in 0..n {
        for x in 0..n {
            let mut sum = 0.0;
            let mut count = 0.0;
            for dy in -1_i32..=1 {
                for dx in -1_i32..=1 {
                    let sx = x as i32 + dx;
                    let sy = y as i32 + dy;
                    if sx >= 0 && sy >= 0 && (sx as usize) < n && (sy as usize) < n {
                        sum += at(sx as usize, sy as usize);
                        count += 1.0;
                    }
                }
            }
            smooth[y * n + x] = sum / count;
        }
    }
    let peak = smooth.iter().cloned().fold(0.0_f32, f32::max);
    let mean = smooth.iter().sum::<f32>() / smooth.len() as f32;
    // Flat or near-flat: every cell about the same, so no cell is a subject.
    if peak <= 1e-4 || peak < mean * 1.15 {
        return default_points_of_interest();
    }
    let mut candidates = Vec::new();
    for y in 0..n {
        for x in 0..n {
            let v = smooth[y * n + x];
            let mut is_max = true;
            for dy in -1_i32..=1 {
                for dx in -1_i32..=1 {
                    if dx == 0 && dy == 0 {
                        continue;
                    }
                    let sx = x as i32 + dx;
                    let sy = y as i32 + dy;
                    if sx >= 0
                        && sy >= 0
                        && (sx as usize) < n
                        && (sy as usize) < n
                        && smooth[sy as usize * n + sx as usize] > v
                    {
                        is_max = false;
                    }
                }
            }
            let uv = [(x as f32 + 0.5) / n as f32, (y as f32 + 0.5) / n as f32];
            let inside = uv[0] >= MARGIN
                && uv[0] <= 1.0 - MARGIN
                && uv[1] >= MARGIN
                && uv[1] <= 1.0 - MARGIN;
            if is_max && inside && v > mean {
                candidates.push(PointOfInterest { uv, weight: v / peak });
            }
        }
    }
    candidates.sort_by(|a, b| b.weight.total_cmp(&a.weight));
    let mut chosen: Vec<PointOfInterest> = Vec::new();
    for candidate in candidates {
        let clear = chosen.iter().all(|c| {
            let dx = c.uv[0] - candidate.uv[0];
            let dy = c.uv[1] - candidate.uv[1];
            (dx * dx + dy * dy).sqrt() >= MIN_SEPARATION
        });
        if clear {
            chosen.push(candidate);
            if chosen.len() == MAX_POINTS {
                break;
            }
        }
    }
    if chosen.len() < 2 {
        // One feature is not enough to build a loop around; add the thirds
        // behind it rather than orbiting a single point forever.
        let mut padded = chosen;
        for fallback in default_points_of_interest() {
            if padded.len() >= 3 {
                break;
            }
            let clear = padded.iter().all(|c| {
                let dx = c.uv[0] - fallback.uv[0];
                let dy = c.uv[1] - fallback.uv[1];
                (dx * dx + dy * dy).sqrt() >= MIN_SEPARATION
            });
            if clear {
                padded.push(PointOfInterest { weight: fallback.weight * 0.5, ..fallback });
            }
        }
        return padded;
    }
    chosen
}

/// splitmix32: small, seedable, and the same on every platform.
struct Rng(u32);

impl Rng {
    fn new(seed: u32, stream: u32) -> Self {
        Rng(seed ^ stream.wrapping_mul(0x9e37_79b9) ^ 0x85eb_ca6b)
    }
    fn next(&mut self) -> f32 {
        self.0 = self.0.wrapping_add(0x9e37_79b9);
        let mut z = self.0;
        z = (z ^ (z >> 16)).wrapping_mul(0x85eb_ca6b);
        z = (z ^ (z >> 13)).wrapping_mul(0xc2b2_ae35);
        z ^= z >> 16;
        z as f32 / u32::MAX as f32
    }
    fn range(&mut self, lo: f32, hi: f32) -> f32 {
        lo + (hi - lo) * self.next()
    }
    fn sign(&mut self) -> f32 {
        if self.next() < 0.5 { -1.0 } else { 1.0 }
    }
}

fn uv_to_target(uv: [f32; 2]) -> [f32; 2] {
    [uv[0] * 2.0 - 1.0, 1.0 - uv[1] * 2.0]
}

/// Weighted pick without replacement, refilling from the full set once used.
fn take_point(rng: &mut Rng, pool: &mut Vec<PointOfInterest>, all: &[PointOfInterest]) -> PointOfInterest {
    if pool.is_empty() {
        pool.extend_from_slice(all);
    }
    let total: f32 = pool.iter().map(|p| p.weight.max(0.05)).sum();
    let mut pick = rng.next() * total;
    for index in 0..pool.len() {
        pick -= pool[index].weight.max(0.05);
        if pick <= 0.0 {
            return pool.remove(index);
        }
    }
    pool.pop().unwrap_or(PointOfInterest { uv: [0.5, 0.5], weight: 1.0 })
}

/// One loop of shots. The same seed, loop and points give the same loop.
pub(crate) fn plan_loop(
    params: &DirectorParams,
    loop_index: u32,
    points: &[PointOfInterest],
) -> Vec<DirectorShot> {
    let points = if points.is_empty() {
        default_points_of_interest()
    } else {
        points.to_vec()
    };
    let mut rng = Rng::new(params.seed, loop_index);
    let pace = params.pace.clamp(0.25, 4.0);
    let close = params.closeness.clamp(0.0, 1.0);
    let dof = |amount: f32| if params.depth_of_field { amount } else { 0.0 };
    let side = rng.sign();
    let mut pool = points.clone();
    let first = take_point(&mut rng, &mut pool, &points);
    let second = take_point(&mut rng, &mut pool, &points);
    let third = take_point(&mut rng, &mut pool, &points);

    let establishing = DirectorCamera {
        focal_mm: rng.range(40.0, 48.0),
        distance: 1.0,
        target: [0.0, 0.0],
        orbit: [rng.range(-3.0, 3.0), rng.range(-2.0, 2.0)],
        focus: 0.5,
        aperture: 0.0,
    };
    let push_in = DirectorCamera {
        focal_mm: rng.range(62.0, 72.0),
        distance: 1.0 - 0.18 * close,
        // Part-way toward the subject: a push-in commits to a region, not yet
        // to the feature.
        target: {
            let t = uv_to_target(first.uv);
            [t[0] * 0.55, t[1] * 0.55]
        },
        orbit: [side * rng.range(2.0, 5.0), rng.range(-3.0, 3.0)],
        focus: 0.45,
        aperture: dof(0.35),
    };
    let detail_focal = 78.0 + 42.0 * close + rng.range(-6.0, 6.0);
    let detail_distance = 1.0 - 0.38 * close;
    let detail = DirectorCamera {
        focal_mm: detail_focal,
        distance: detail_distance,
        target: uv_to_target(first.uv),
        orbit: [side * rng.range(4.0, 8.0), rng.range(-4.0, 4.0)],
        // Foreground focus first...
        focus: 0.22,
        aperture: dof(rng.range(0.9, 1.3)),
    };
    // ...then pull it through the depth of the same framing.
    let rack = DirectorCamera {
        focus: 0.88,
        orbit: [detail.orbit[0] + side * 1.5, detail.orbit[1] * 0.5],
        ..detail
    };
    let second_detail = DirectorCamera {
        focal_mm: (detail_focal - rng.range(6.0, 14.0)).max(60.0),
        distance: detail_distance + 0.06,
        target: uv_to_target(second.uv),
        orbit: [-side * rng.range(3.0, 7.0), rng.range(-3.0, 3.0)],
        focus: 0.55,
        aperture: dof(rng.range(0.7, 1.0)),
    };
    let third_detail = DirectorCamera {
        focal_mm: detail_focal + rng.range(-4.0, 8.0),
        distance: detail_distance,
        target: uv_to_target(third.uv),
        orbit: [side * rng.range(2.0, 6.0), rng.range(-4.0, 4.0)],
        focus: 0.35,
        aperture: dof(rng.range(0.8, 1.2)),
    };
    let pull_back = DirectorCamera {
        focal_mm: rng.range(42.0, 52.0),
        distance: 1.0,
        target: [0.0, 0.0],
        orbit: [-side * rng.range(1.0, 4.0), rng.range(-2.0, 2.0)],
        focus: 0.5,
        aperture: 0.0,
    };

    let shot = |kind, camera, travel: f32, hold: f32| DirectorShot {
        kind,
        camera,
        travel: travel / pace,
        hold: hold / pace,
    };
    vec![
        shot(ShotKind::Establishing, establishing, 2.5, 3.5),
        shot(ShotKind::PushIn, push_in, 3.0, 3.0),
        shot(ShotKind::Detail, detail, 2.5, 4.0),
        shot(ShotKind::RackFocus, rack, 2.2, 3.0),
        shot(ShotKind::Detail, second_detail, 3.5, 4.0),
        shot(ShotKind::Detail, third_detail, 3.0, 3.5),
        shot(ShotKind::Establishing, pull_back, 4.0, 2.0),
    ]
}

/// Round every travel and hold to whole beats, never under two.
pub(crate) fn quantize_to_beats(shots: &mut [DirectorShot], bpm: f32) {
    if !(40.0..=240.0).contains(&bpm) {
        return;
    }
    let beat = 60.0 / bpm;
    let round = |seconds: f32| ((seconds / beat).round().max(2.0)) * beat;
    for shot in shots {
        shot.travel = round(shot.travel);
        shot.hold = round(shot.hold);
    }
}

#[cfg(test)]
pub(crate) fn loop_duration(shots: &[DirectorShot]) -> f32 {
    shots.iter().map(|s| s.travel + s.hold).sum()
}

/// Smootherstep: zero velocity and acceleration at both ends, so a move
/// neither lurches out of a hold nor lands with a bump.
fn ease(t: f32) -> f32 {
    let t = t.clamp(0.0, 1.0);
    t * t * t * (t * (t * 6.0 - 15.0) + 10.0)
}

/// Where the camera is `t` seconds into a loop that started at `from`.
/// Returns the camera, the shot it is in, and whether the loop is over.
pub(crate) fn evaluate(
    shots: &[DirectorShot],
    from: DirectorCamera,
    t: f32,
) -> (DirectorCamera, usize, bool) {
    let mut elapsed = 0.0;
    let mut previous = from;
    for (index, shot) in shots.iter().enumerate() {
        if t < elapsed + shot.travel {
            let k = if shot.travel > 0.0 {
                (t - elapsed) / shot.travel
            } else {
                1.0
            };
            return (DirectorCamera::lerp(previous, shot.camera, ease(k)), index, false);
        }
        elapsed += shot.travel;
        if t < elapsed + shot.hold {
            // A held shot still breathes: a slow drift in orbit, well under
            // a degree, so the frame never reads as frozen.
            let held = t - elapsed;
            let mut camera = shot.camera;
            camera.orbit[0] += (held * 0.21).sin() * 0.6;
            camera.orbit[1] += (held * 0.17 + 1.3).sin() * 0.35;
            return (camera, index, false);
        }
        elapsed += shot.hold;
        previous = shot.camera;
    }
    (shots.last().map(|s| s.camera).unwrap_or(from), shots.len().saturating_sub(1), true)
}

/// Director state carried per layer between frames.
#[derive(Clone, Debug, PartialEq)]
pub(crate) struct DirectorState {
    pub loop_index: u32,
    pub loop_start: f32,
    pub from: DirectorCamera,
    pub shots: Vec<DirectorShot>,
    pub points: Vec<PointOfInterest>,
    /// Seed + settings the current loop was planned with; a change replans.
    pub planned_for: Option<DirectorParams>,
    pub last_camera: DirectorCamera,
}

impl Default for DirectorState {
    fn default() -> Self {
        Self {
            loop_index: 0,
            loop_start: 0.0,
            from: DirectorCamera::REST,
            shots: Vec::new(),
            points: default_points_of_interest(),
            planned_for: None,
            last_camera: DirectorCamera::REST,
        }
    }
}

impl DirectorState {
    /// Advance to `time` and return this frame's camera. `bpm` is the audio
    /// clock's tempo, or 0 when there is none.
    pub(crate) fn camera_at(&mut self, params: &DirectorParams, time: f32, bpm: f32) -> DirectorCamera {
        if !params.enabled {
            self.planned_for = None;
            self.shots.clear();
            self.last_camera = DirectorCamera::REST;
            return DirectorCamera::REST;
        }
        let replan = self.planned_for != Some(*params) || self.shots.is_empty();
        if replan {
            // Start the new plan from wherever the camera is now, so changing
            // a setting mid-shot does not snap.
            self.from = self.last_camera;
            self.loop_start = time;
            self.shots = plan_loop(params, self.loop_index, &self.points);
            if params.beat_sync {
                quantize_to_beats(&mut self.shots, bpm);
            }
            self.planned_for = Some(*params);
        }
        let (mut camera, _, done) = evaluate(&self.shots, self.from, time - self.loop_start);
        if done {
            self.loop_index = self.loop_index.wrapping_add(1);
            self.from = self.shots.last().map(|s| s.camera).unwrap_or(self.from);
            self.loop_start = time;
            self.shots = plan_loop(params, self.loop_index, &self.points);
            if params.beat_sync {
                quantize_to_beats(&mut self.shots, bpm);
            }
            camera = evaluate(&self.shots, self.from, 0.0).0;
        }
        self.last_camera = camera;
        camera
    }

    /// New points take effect from the next loop, so a readback landing
    /// mid-shot never moves the subject under the camera.
    pub(crate) fn set_points(&mut self, points: Vec<PointOfInterest>) {
        self.points = if points.is_empty() {
            default_points_of_interest()
        } else {
            points
        };
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn on() -> DirectorParams {
        DirectorParams { enabled: true, ..DirectorParams::default() }
    }

    #[test]
    fn a_loop_goes_wide_then_close_then_back() {
        let shots = plan_loop(&on(), 0, &default_points_of_interest());
        let kinds: Vec<ShotKind> = shots.iter().map(|s| s.kind).collect();
        assert_eq!(kinds.first(), Some(&ShotKind::Establishing));
        assert_eq!(kinds.last(), Some(&ShotKind::Establishing));
        assert!(kinds.contains(&ShotKind::PushIn));
        assert!(kinds.contains(&ShotKind::RackFocus));
        let establishing = shots[0].camera.zoom();
        let tightest = shots.iter().map(|s| s.camera.zoom()).fold(0.0, f32::max);
        assert!(tightest > establishing * 2.0, "detail shots should read at least twice as close");
    }

    #[test]
    fn the_rack_focus_keeps_the_framing_and_moves_only_focus() {
        let shots = plan_loop(&on(), 3, &default_points_of_interest());
        let rack = shots.iter().position(|s| s.kind == ShotKind::RackFocus).unwrap();
        let (detail, pulled) = (shots[rack - 1].camera, shots[rack].camera);
        assert_eq!(detail.focal_mm, pulled.focal_mm);
        assert_eq!(detail.target, pulled.target);
        assert!(pulled.focus - detail.focus > 0.5);
    }

    #[test]
    fn plans_are_repeatable_and_loops_differ() {
        let a = plan_loop(&on(), 5, &default_points_of_interest());
        let b = plan_loop(&on(), 5, &default_points_of_interest());
        let c = plan_loop(&on(), 6, &default_points_of_interest());
        assert_eq!(a, b);
        assert_ne!(a, c);
    }

    #[test]
    fn depth_of_field_off_means_no_aperture_anywhere() {
        let params = DirectorParams { depth_of_field: false, ..on() };
        assert!(plan_loop(&params, 0, &default_points_of_interest())
            .iter()
            .all(|s| s.camera.aperture == 0.0));
    }

    #[test]
    fn pace_scales_every_duration() {
        let medium = loop_duration(&plan_loop(&on(), 0, &default_points_of_interest()));
        let fast = loop_duration(&plan_loop(
            &DirectorParams { pace: 2.0, ..on() },
            0,
            &default_points_of_interest(),
        ));
        assert!((medium / fast - 2.0).abs() < 1e-3);
    }

    #[test]
    fn beat_sync_lands_every_move_on_whole_beats() {
        let mut shots = plan_loop(&on(), 0, &default_points_of_interest());
        quantize_to_beats(&mut shots, 120.0);
        for shot in &shots {
            for seconds in [shot.travel, shot.hold] {
                let beats = seconds / 0.5;
                assert!((beats - beats.round()).abs() < 1e-3 && beats >= 2.0 - 1e-3);
            }
        }
        // No tempo, or a nonsense one: durations untouched.
        let mut untouched = plan_loop(&on(), 0, &default_points_of_interest());
        let before = untouched.clone();
        quantize_to_beats(&mut untouched, 0.0);
        assert_eq!(untouched, before);
    }

    #[test]
    fn evaluation_eases_without_jumps() {
        let shots = plan_loop(&on(), 0, &default_points_of_interest());
        let total = loop_duration(&shots);
        let mut previous = evaluate(&shots, DirectorCamera::REST, 0.0).0;
        let step = 1.0 / 60.0;
        let mut t = step;
        while t < total {
            let camera = evaluate(&shots, DirectorCamera::REST, t).0;
            // At 60 fps no frame should move focal length by more than ~2 mm.
            assert!((camera.focal_mm - previous.focal_mm).abs() < 2.0, "jump at {t}");
            assert!((camera.target[0] - previous.target[0]).abs() < 0.05, "jump at {t}");
            previous = camera;
            t += step;
        }
        assert!(evaluate(&shots, DirectorCamera::REST, total + 0.1).2);
    }

    #[test]
    fn state_loops_forever_and_changing_a_setting_does_not_snap() {
        let mut state = DirectorState::default();
        let params = on();
        let mut t = 0.0;
        let mut last = state.camera_at(&params, t, 0.0);
        let first_loop = loop_duration(&state.shots);
        while t < first_loop * 2.5 {
            t += 1.0 / 30.0;
            let camera = state.camera_at(&params, t, 0.0);
            assert!((camera.focal_mm - last.focal_mm).abs() < 4.0, "snap at {t}");
            last = camera;
        }
        assert!(state.loop_index >= 2);

        let before = state.camera_at(&params, t, 0.0);
        let changed = DirectorParams { closeness: 0.2, ..params };
        let after = state.camera_at(&changed, t + 1.0 / 30.0, 0.0);
        assert!((after.focal_mm - before.focal_mm).abs() < 4.0);
    }

    #[test]
    fn disabled_rests_at_the_operator_framing() {
        let mut state = DirectorState::default();
        assert_eq!(state.camera_at(&DirectorParams::default(), 3.0, 0.0), DirectorCamera::REST);
    }

    #[test]
    fn points_come_from_contrast_peaks_and_flat_pictures_use_the_thirds() {
        let n = 24;
        let mut grid = vec![0.05_f32; n * n];
        // Two bright features, well apart.
        for (cx, cy) in [(6_usize, 7_usize), (17, 15)] {
            for dy in 0..3 {
                for dx in 0..3 {
                    grid[(cy + dy) * n + cx + dx] = 1.0;
                }
            }
        }
        let points = points_of_interest_from_grid(&grid, n);
        assert!(points.len() >= 2);
        let near = |uv: [f32; 2], x: f32, y: f32| (uv[0] - x).abs() < 0.08 && (uv[1] - y).abs() < 0.08;
        assert!(points.iter().any(|p| near(p.uv, 7.5 / 24.0, 8.5 / 24.0)));
        assert!(points.iter().any(|p| near(p.uv, 18.5 / 24.0, 16.5 / 24.0)));

        let flat = vec![0.3_f32; n * n];
        assert_eq!(points_of_interest_from_grid(&flat, n), default_points_of_interest());
    }
}
