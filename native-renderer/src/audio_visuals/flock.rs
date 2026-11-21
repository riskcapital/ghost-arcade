//! Cloud Flock: on kicks the scan's points burst into a curl-noise swarm;
//! bass drives the swarm's speed and cohesion; then a spring pulls every point
//! back to its place in the scan. CPU side: params, the flock phase machine
//! and the per-frame block (`wgsl/flock_sim.wgsl`).

use serde_json::Value;

use super::audio_data::{AudioVisualData, H_BASS, OnsetBand};
use super::params::num;

pub const FLOCK_POINT_BYTES: u64 = 32;

#[derive(Clone, Debug, PartialEq)]
pub struct FlockParams {
    /// Burst speed per unit of kick strength.
    pub scatter: f32,
    /// Spring back to the scan once re-formed (per second squared).
    pub spring: f32,
    /// Seconds the swarm runs free after a kick before it starts re-forming.
    pub hold: f32,
    /// Seconds from starting to re-form to fully formed.
    pub reform: f32,
    pub curl: f32,
    pub flow_scale: f32,
    pub flow_speed: f32,
    pub drag: f32,
    pub cohesion: f32,
    /// Speed at which a point reads fully hot.
    pub heat: f32,
    /// Kicks sooner than this after a scatter are ignored, so the flock
    /// gets to re-form between bursts.
    pub cooldown: f32,
    /// How strongly the swarm gathers into bands (0 = even dust).
    pub banding: f32,
    /// How fast points turn to fly with the flow (per second): neighbours
    /// share a heading, so the swarm moves in sheets, not dust.
    pub align: f32,
    /// Speed the aligned swarm cruises at.
    pub cruise: f32,
    /// Push out of crowded grid cells (keeps sheets thin, gaps dark).
    pub separation: f32,
    /// How bright the swarm's edges burn against its dark body.
    pub edge_light: f32,
}

pub fn normalize_flock_params(params: &Value) -> FlockParams {
    FlockParams {
        scatter: num(params, "scatter", 0.35).clamp(0.0, 10.0),
        spring: num(params, "spring", 40.0).clamp(0.0, 200.0),
        hold: num(params, "hold", 0.35).clamp(0.0, 10.0),
        reform: num(params, "reform", 0.9).clamp(0.05, 20.0),
        curl: num(params, "swarm", 3.0).clamp(0.0, 20.0),
        flow_scale: num(params, "flowScale", 0.6).clamp(0.1, 40.0),
        flow_speed: num(params, "flowSpeed", 0.6).clamp(0.0, 10.0),
        drag: num(params, "drag", 3.0).clamp(0.0, 20.0),
        cohesion: num(params, "cohesion", 1.6).clamp(0.0, 20.0),
        heat: 1.0 / num(params, "hotSpeed", 1.2).clamp(0.01, 10.0),
        cooldown: num(params, "cooldown", 1.6).clamp(0.0, 30.0),
        banding: num(params, "banding", 0.5).clamp(0.0, 10.0),
        align: num(params, "align", 3.0).clamp(0.0, 30.0),
        cruise: num(params, "cruise", 0.45).clamp(0.0, 5.0),
        separation: num(params, "separation", 0.2).clamp(0.0, 10.0),
        edge_light: num(params, "edgeLight", 1.0).clamp(0.0, 4.0),
    }
}

/// Where the flock is. Explicit, so the spring can only ramp one way:
/// Formed -> Scattered (kick) -> Reforming (after `hold`) -> Formed.
/// A kick in any phase scatters again.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum FlockPhase {
    Formed,
    Scattered { since: f32 },
    Reforming { since: f32 },
}

#[derive(Clone, Debug, PartialEq)]
pub struct FlockState {
    pub phase: FlockPhase,
    pub last_seq: u32,
    /// Burst waiting for the next real (stepping) frame.
    pub pending_impulse: f32,
    pub last_scatter: f32,
}

impl Default for FlockState {
    fn default() -> Self {
        Self { phase: FlockPhase::Formed, last_seq: 0, pending_impulse: 0.0, last_scatter: f32::NEG_INFINITY }
    }
}

impl FlockState {
    pub fn ingest(&mut self, data: &AudioVisualData, now: f32, params: &FlockParams) {
        // The clock went back (a new render, a new song position): start
        // formed again rather than waiting out a cooldown from the future.
        if now + 0.1 < self.last_scatter {
            *self = Self { last_seq: self.last_seq, ..Self::default() };
        }
        if !data.active() {
            return;
        }
        let fresh = data.events_after(self.last_seq, 4);
        if let Some(last) = data.event(0) {
            self.last_seq = self.last_seq.max(last.seq);
        }
        for event in fresh.iter().filter(|e| e.band == OnsetBand::Bass) {
            if now - self.last_scatter < params.cooldown {
                continue;
            }
            self.last_scatter = now;
            self.pending_impulse = (self.pending_impulse + event.strength * params.scatter).min(params.scatter * 2.5);
            self.phase = FlockPhase::Scattered { since: now };
        }
    }

    pub fn step(&mut self, now: f32, params: &FlockParams) {
        self.phase = match self.phase {
            FlockPhase::Scattered { since } if now - since >= params.hold => FlockPhase::Reforming { since: now },
            FlockPhase::Reforming { since } if now - since >= params.reform => FlockPhase::Formed,
            phase => phase,
        };
    }

    /// Spring strength now: almost none while scattered, easing back in.
    pub fn spring(&self, now: f32, params: &FlockParams) -> f32 {
        match self.phase {
            FlockPhase::Formed => params.spring,
            FlockPhase::Scattered { .. } => params.spring * 0.02,
            FlockPhase::Reforming { since } => {
                let t = ((now - since) / params.reform).clamp(0.0, 1.0);
                params.spring * (0.02 + 0.98 * t * t * (3.0 - 2.0 * t))
            }
        }
    }

    /// The `C.data` block for this frame. Takes the pending burst only on a
    /// real step, so a repeat render of the frame does not burst twice.
    pub fn block(&mut self, data: &AudioVisualData, now: f32, dt: f32, params: &FlockParams) -> Vec<f32> {
        let bass = data.header(H_BASS).clamp(0.0, 1.5);
        let impulse = if dt > 0.0 { std::mem::take(&mut self.pending_impulse) } else { 0.0 };
        let free = !matches!(self.phase, FlockPhase::Formed);
        // The swarm's own flow: full while scattered, fading out as the scan
        // re-forms, none once formed.
        let flow_share = match self.phase {
            FlockPhase::Scattered { .. } => 1.0,
            FlockPhase::Reforming { since } => (1.0 - (now - since) / params.reform).clamp(0.15, 1.0),
            // Formed: held by the spring alone, and the flow is not computed.
            FlockPhase::Formed => 0.0,
        };
        let curl = params.curl * (0.25 + bass * 1.2) * flow_share;
        // Near-critical damping on the way back, so points settle into the
        // scan instead of overshooting and ringing around it.
        let spring = self.spring(now, params);
        let drag = params.drag.max(1.8 * spring.sqrt());
        vec![
            dt, spring, curl, drag,
            impulse, params.cohesion * (0.5 + bass) * if free { 1.0 } else { 0.0 }, params.flow_speed * (0.5 + bass), now,
            0.0, 0.0, 0.0, params.flow_scale,
            // Bands only form in the swarm; the formed scan stays put.
            if free { params.banding * flow_share } else { 0.0 },
            if free { params.align * flow_share } else { 0.0 },
            params.cruise * (0.6 + bass * 0.6),
            params.separation,
            params.edge_light, 0.0, 0.0, 0.0,
        ]
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn kick(seq: u32) -> AudioVisualData {
        let mut floats = vec![0.0_f32; super::super::audio_data::AV_TOTAL_FLOATS];
        floats[0] = 1.0;
        floats[1] = 1.0;
        floats[2] = 1.0;
        floats[3] = 1.0;
        floats[16..20].copy_from_slice(&[1.0, 0.0, 1.0, seq as f32]);
        let mut data = AudioVisualData::default();
        data.set_from_bytes(bytemuck::cast_slice(&floats)).unwrap();
        data
    }

    #[test]
    fn a_kick_scatters_then_the_flock_reforms_on_its_own_clock() {
        let params = normalize_flock_params(&serde_json::json!({ "hold": 0.3, "reform": 1.0 }));
        let mut flock = FlockState::default();
        assert_eq!(flock.spring(0.0, &params), params.spring);
        flock.ingest(&kick(1), 1.0, &params);
        assert_eq!(flock.phase, FlockPhase::Scattered { since: 1.0 });
        assert!(flock.spring(1.0, &params) < params.spring * 0.05);
        flock.step(1.2, &params);
        assert!(matches!(flock.phase, FlockPhase::Scattered { .. }));
        flock.step(1.31, &params);
        assert_eq!(flock.phase, FlockPhase::Reforming { since: 1.31 });
        let half = flock.spring(1.81, &params);
        assert!(half > params.spring * 0.3 && half < params.spring * 0.7);
        flock.step(2.32, &params);
        assert_eq!(flock.phase, FlockPhase::Formed);
    }

    #[test]
    fn a_clock_that_jumps_back_does_not_freeze_the_flock() {
        let params = normalize_flock_params(&serde_json::json!({}));
        let mut flock = FlockState::default();
        flock.ingest(&kick(1), 8.0, &params);
        assert_eq!(flock.last_scatter, 8.0);
        flock.ingest(&kick(2), 1.0, &params);
        assert_eq!(flock.last_scatter, 1.0, "the kick at 1 s scatters again");
    }

    #[test]
    fn the_burst_lands_once_on_a_real_step_and_never_on_a_repeat() {
        let params = normalize_flock_params(&serde_json::json!({}));
        let mut flock = FlockState::default();
        flock.ingest(&kick(1), 1.0, &params);
        flock.ingest(&kick(1), 1.0, &params);
        flock.ingest(&kick(2), 1.1, &params);
        assert_eq!(flock.last_scatter, 1.0, "a kick inside the cooldown does not scatter again");
        let repeat = flock.block(&kick(1), 1.0, 0.0, &params);
        assert_eq!(repeat[4], 0.0);
        let step = flock.block(&kick(1), 1.0, 1.0 / 60.0, &params);
        assert!(step[4] > 0.0 && step[4] <= params.scatter * 2.5);
        let next = flock.block(&kick(1), 1.02, 1.0 / 60.0, &params);
        assert_eq!(next[4], 0.0, "one burst per kick");
    }
}

/// Cells per side of the neighbour grid (`FLOCK_GRID_N` in flock_common.wgsl).
pub const FLOCK_GRID_N: u32 = 32;
/// Bytes of the grid: vx, vy, vz, count as i32 per cell.
pub const FLOCK_GRID_BYTES: u64 = (FLOCK_GRID_N as u64).pow(3) * 16;

/// The neighbour grid's buffer and its two passes (clear, then splat), to
/// run before the flock update, which reads the grid at binding 4.
pub fn flock_grid_plan(
    prefix: &str,
    uniform_id: &str,
    flock_id: &str,
    point_count: u32,
) -> (crate::compute_graph::NativeComputeGraphBufferSpec, Vec<crate::compute_graph::NativeComputeGraphPassPlan>, String) {
    use crate::compute_graph::{NativeComputeBufferBindingKind as Kind, NativeComputeGraphBufferSpec, NativeComputeGraphPassPlan};
    use super::hdr_post::buffer_binding;
    use super::shaders::{FLOCK_GRID, core_shader};
    let grid_id = format!("{prefix}:flock-grid");
    let buffer = NativeComputeGraphBufferSpec {
        id: grid_id.clone(),
        byte_length: FLOCK_GRID_BYTES,
        kind: Kind::StorageReadWrite,
        initial_bytes: Vec::new(),
        persistent: true,
        clear: false,
        indirect: false,
    };
    let shader = core_shader(FLOCK_GRID);
    let pass = |entry: &str, groups: u32, with_flock: bool| {
        let mut bindings = vec![buffer_binding(1, uniform_id, Kind::Uniform)];
        if with_flock {
            bindings.push(buffer_binding(2, flock_id, Kind::StorageRead));
        }
        bindings.push(buffer_binding(4, &grid_id, Kind::StorageReadWrite));
        let layout = crate::native_graph_binding_layout_signature(&bindings);
        NativeComputeGraphPassPlan {
            name: format!("{prefix}:{entry}"),
            cache_key: format!("graph:{}:{}:{entry}:{layout}", shader.id, shader.hash),
            source: shader.source.clone(),
            entry: entry.to_string(),
            dispatch: [groups.max(1), 1, 1],
            bindings,
        }
    };
    let cells = FLOCK_GRID_N.pow(3) * 4;
    let passes = vec![
        pass("cs_grid_clear", cells.div_ceil(64), false),
        pass("cs_grid_splat", point_count.div_ceil(64), true),
    ];
    (buffer, passes, grid_id)
}
