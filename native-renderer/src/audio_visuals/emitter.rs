//! Emitter shapes shared by the audio-reactive instruments: a point, tangent
//! and outward normal at a parameter `u` in 0..1 along a line, ring, regular
//! polygon or stack of horizontal strata.
//!
//! `emitter.wgsl` is the GPU copy and must match this file line for line; the
//! tests here pin the behaviour both follow. New shapes (an SVG path, text, a
//! point cloud, a mesh surface) slot in as new kinds that return the same
//! `EmitterPoint`, so every instrument that samples a shape gets them free.

use std::f32::consts::{PI, TAU};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum EmitterKind {
    /// Vertical line through the centre, `size.y` half length.
    Line = 0,
    /// Ellipse with radii `size`.
    Ring = 1,
    /// Regular polygon with `sides` corners on radius `size.x`, flat on top.
    Polygon = 2,
    /// `count` horizontal lines stacked over `size.y`, each `size.x` half wide.
    Strata = 3,
}

impl EmitterKind {
    pub fn from_index(index: u32) -> Self {
        match index {
            1 => Self::Ring,
            2 => Self::Polygon,
            3 => Self::Strata,
            _ => Self::Line,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct EmitterShape {
    pub kind: EmitterKind,
    pub sides: u32,
    pub count: u32,
    pub center: [f32; 2],
    pub size: [f32; 2],
    pub rotation: f32,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct EmitterPoint {
    pub pos: [f32; 2],
    pub tangent: [f32; 2],
    /// Points away from the shape's centre (closed shapes), +x for a line,
    /// +y for strata.
    pub normal: [f32; 2],
    /// Where along the shape the spectrum is read, 0..1. Closed shapes mirror
    /// it so the seam at u = 0/1 reads the same bin on both sides; strata read
    /// the whole spectrum along each line, low in the middle, high at the ends.
    pub spectral: f32,
}

fn rotate(v: [f32; 2], angle: f32) -> [f32; 2] {
    let (s, c) = angle.sin_cos();
    [v[0] * c - v[1] * s, v[0] * s + v[1] * c]
}

fn normalize(v: [f32; 2]) -> [f32; 2] {
    let len = (v[0] * v[0] + v[1] * v[1]).sqrt().max(1e-8);
    [v[0] / len, v[1] / len]
}

fn mirror(u: f32) -> f32 {
    1.0 - (2.0 * u - 1.0).abs()
}

pub fn emitter_sample(shape: &EmitterShape, u: f32) -> EmitterPoint {
    let u = u.rem_euclid(1.0);
    let (local, tangent, normal, spectral) = match shape.kind {
        EmitterKind::Line => {
            let y = (u * 2.0 - 1.0) * shape.size[1];
            ([0.0, y], [0.0, 1.0], [1.0, 0.0], u)
        }
        EmitterKind::Ring => {
            let a = u * TAU + PI * 0.5;
            let (s, c) = a.sin_cos();
            let pos = [c * shape.size[0], s * shape.size[1]];
            let tangent = normalize([-s * shape.size[0], c * shape.size[1]]);
            // Outward normal of a CCW curve: the tangent turned clockwise.
            (pos, tangent, [tangent[1], -tangent[0]], mirror(u))
        }
        EmitterKind::Polygon => {
            let sides = shape.sides.clamp(3, 64) as f32;
            let t = u * sides;
            let edge = t.floor().min(sides - 1.0);
            let f = t - edge;
            let offset = PI * 0.5 - PI / sides;
            let a0 = offset + edge / sides * TAU;
            let a1 = offset + (edge + 1.0) / sides * TAU;
            let p0 = [a0.cos() * shape.size[0], a0.sin() * shape.size[0]];
            let p1 = [a1.cos() * shape.size[0], a1.sin() * shape.size[0]];
            let pos = [p0[0] + (p1[0] - p0[0]) * f, p0[1] + (p1[1] - p0[1]) * f];
            let tangent = normalize([p1[0] - p0[0], p1[1] - p0[1]]);
            (pos, tangent, [tangent[1], -tangent[0]], mirror(u))
        }
        EmitterKind::Strata => {
            let count = shape.count.clamp(1, 64) as f32;
            let t = u * count;
            let line = t.floor().min(count - 1.0);
            let f = t - line;
            let y = if count > 1.0 { (line / (count - 1.0) * 2.0 - 1.0) * shape.size[1] } else { 0.0 };
            ([(f * 2.0 - 1.0) * shape.size[0], y], [1.0, 0.0], [0.0, 1.0], 1.0 - mirror(f))
        }
    };
    let pos = rotate(local, shape.rotation);
    EmitterPoint {
        pos: [pos[0] + shape.center[0], pos[1] + shape.center[1]],
        tangent: rotate(tangent, shape.rotation),
        normal: rotate(normal, shape.rotation),
        spectral,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn shape(kind: EmitterKind) -> EmitterShape {
        EmitterShape { kind, sides: 4, count: 5, center: [0.2, -0.1], size: [0.5, 0.4], rotation: 0.3 }
    }

    fn len(v: [f32; 2]) -> f32 {
        (v[0] * v[0] + v[1] * v[1]).sqrt()
    }

    fn dot(a: [f32; 2], b: [f32; 2]) -> f32 {
        a[0] * b[0] + a[1] * b[1]
    }

    #[test]
    fn tangent_and_normal_are_unit_and_perpendicular_for_every_kind() {
        for kind in [EmitterKind::Line, EmitterKind::Ring, EmitterKind::Polygon, EmitterKind::Strata] {
            for step in 0..200 {
                let point = emitter_sample(&shape(kind), step as f32 / 200.0);
                assert!((len(point.tangent) - 1.0).abs() < 1e-4, "{kind:?} tangent");
                assert!((len(point.normal) - 1.0).abs() < 1e-4, "{kind:?} normal");
                assert!(dot(point.tangent, point.normal).abs() < 1e-4, "{kind:?} perpendicular");
                assert!((0.0..=1.0).contains(&point.spectral), "{kind:?} spectral");
            }
        }
    }

    #[test]
    fn closed_shapes_meet_at_the_seam_and_normals_point_outward() {
        for kind in [EmitterKind::Ring, EmitterKind::Polygon] {
            let s = shape(kind);
            let a = emitter_sample(&s, 0.0);
            let b = emitter_sample(&s, 0.999_999);
            assert!(len([a.pos[0] - b.pos[0], a.pos[1] - b.pos[1]]) < 1e-3, "{kind:?} seam");
            assert!((a.spectral - b.spectral).abs() < 1e-3, "{kind:?} spectral seam");
            for step in 0..64 {
                let point = emitter_sample(&s, (step as f32 + 0.5) / 64.0);
                let out = [point.pos[0] - s.center[0], point.pos[1] - s.center[1]];
                assert!(dot(out, point.normal) > 0.0, "{kind:?} normal must point outward");
            }
        }
    }

    #[test]
    fn polygon_corners_sit_on_the_radius_and_a_square_is_flat_on_top() {
        let square = EmitterShape { rotation: 0.0, center: [0.0, 0.0], ..shape(EmitterKind::Polygon) };
        for corner in 0..4 {
            let point = emitter_sample(&square, corner as f32 / 4.0);
            assert!((len(point.pos) - 0.5).abs() < 1e-4);
        }
        // The first edge runs along the top, right to left.
        let mid_top = emitter_sample(&square, 0.125);
        assert!(mid_top.pos[0].abs() < 1e-4 && mid_top.pos[1] > 0.0);
        assert!((mid_top.normal[1] - 1.0).abs() < 1e-4);
    }

    #[test]
    fn strata_spread_evenly_over_the_height() {
        let strata = EmitterShape { rotation: 0.0, center: [0.0, 0.0], ..shape(EmitterKind::Strata) };
        let ys: Vec<f32> = (0..5).map(|line| emitter_sample(&strata, (line as f32 + 0.5) / 5.0).pos[1]).collect();
        let expected = [-0.4, -0.2, 0.0, 0.2, 0.4];
        for (y, want) in ys.iter().zip(expected) {
            assert!((y - want).abs() < 1e-4, "{ys:?}");
        }
        let left = emitter_sample(&strata, 0.0);
        assert!((left.pos[0] + 0.5).abs() < 1e-4);
        assert!((left.spectral - 1.0).abs() < 1e-4, "a line's ends read the top of the spectrum");
        let middle = emitter_sample(&strata, 0.5 / 5.0);
        assert!(middle.spectral.abs() < 1e-4, "and its middle the lowest bin");
    }

    #[test]
    fn a_line_runs_bottom_to_top_through_the_centre() {
        let line = EmitterShape { rotation: 0.0, ..shape(EmitterKind::Line) };
        let bottom = emitter_sample(&line, 0.0);
        let middle = emitter_sample(&line, 0.5);
        assert!((bottom.pos[1] - (-0.1 - 0.4)).abs() < 1e-4);
        assert!((middle.pos[0] - 0.2).abs() < 1e-4 && (middle.pos[1] + 0.1).abs() < 1e-4);
        assert_eq!(EmitterKind::from_index(9), EmitterKind::Line);
    }
}
