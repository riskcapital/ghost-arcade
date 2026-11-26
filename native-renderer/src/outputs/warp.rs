//! Output warp meshes and Screen masks, packed for the output stage.

use crate::*;

/// Largest output-warp control grid the compositor stores, matching the
/// per-layer mesh cap. Larger grids from the editor are rejected rather than
/// silently truncated into a scrambled warp.
pub(crate) const WARP_MESH_MAX_DIM: usize = 16;

/// Read a `{x, y}` point, defaulting to the identity position given.
pub(crate) fn warp_point_at(value: Option<&Value>, fallback: [f32; 2]) -> [f32; 2] {
    let Some(point) = value else { return fallback };
    [
        number_at(point, &["x"]).unwrap_or(fallback[0] as f64) as f32,
        number_at(point, &["y"]).unwrap_or(fallback[1] as f64) as f32,
    ]
}

/// Corner quad packed for the shader as (TL.xy, TR.xy) and (BR.xy, BL.xy).
pub(crate) fn warp_corners_at(params: Option<&Value>) -> ([f32; 4], [f32; 4]) {
    let tl = warp_point_at(params.and_then(|v| v.get("topLeft")), [0.0, 0.0]);
    let tr = warp_point_at(params.and_then(|v| v.get("topRight")), [1.0, 0.0]);
    let br = warp_point_at(params.and_then(|v| v.get("bottomRight")), [1.0, 1.0]);
    let bl = warp_point_at(params.and_then(|v| v.get("bottomLeft")), [0.0, 1.0]);
    ([tl[0], tl[1], tr[0], tr[1]], [br[0], br[1], bl[0], bl[1]])
}

/// Bezier tangents of an output-stage mesh: two vec4 per point, (right.xy,
/// down.xy) then (left.xy, up.xy), packed exactly like a layer mesh's.
pub(crate) const WARP_MESH_TANGENT_VEC4S: usize = WARP_MESH_MAX_DIM * WARP_MESH_MAX_DIM * 2;

/// An output-stage warp mesh (a screen's or the Master Warp's) packed for
/// the uniforms. `rows`/`cols` are zero when the grid is absent or unusable,
/// which the shader reads as "no mesh". `bezier` is set only when the grid
/// carries tangents; everything else stays on the straight bilinear path.
#[derive(Clone, Copy)]
pub(crate) struct WarpMesh {
    pub(crate) rows: f32,
    pub(crate) cols: f32,
    pub(crate) points: [[f32; 4]; 128],
    pub(crate) bezier: bool,
    pub(crate) tangents: [[f32; 4]; WARP_MESH_TANGENT_VEC4S],
}

impl WarpMesh {
    pub(crate) fn none() -> Self {
        Self {
            rows: 0.0,
            cols: 0.0,
            points: [[0.0; 4]; 128],
            bezier: false,
            tangents: [[0.0; 4]; WARP_MESH_TANGENT_VEC4S],
        }
    }
}

/// Flatten a `{rows, cols, points: [[{x,y}]], bezier?, tangents?}` grid into
/// the packed control point array (two points per vec4, row-major) and, for
/// a Bezier grid, the resolved tangent of every point. Tangents resolve with
/// the layer mesh rules (parse_layer_mesh_tangents); the editor has already
/// moved them into the core's y-up frame along with the points.
pub(crate) fn warp_mesh_at(params: Option<&Value>) -> WarpMesh {
    let mut out = WarpMesh::none();
    let Some(grid) = params else { return out };
    let rows = number_at(grid, &["rows"]).unwrap_or(0.0) as usize;
    let cols = number_at(grid, &["cols"]).unwrap_or(0.0) as usize;
    if !(2..=WARP_MESH_MAX_DIM).contains(&rows) || !(2..=WARP_MESH_MAX_DIM).contains(&cols) {
        return out;
    }
    let Some(points) = grid.get("points").and_then(Value::as_array) else {
        return out;
    };
    let mut resolved_points = Vec::with_capacity(rows * cols);
    for row in 0..rows {
        let Some(row_points) = points.get(row).and_then(Value::as_array) else {
            return WarpMesh::none();
        };
        for col in 0..cols {
            // Identity fallback keeps a short row from folding the warp onto
            // itself; a malformed grid degrades to a flat pass-through cell.
            let fallback = [
                col as f32 / (cols - 1) as f32,
                row as f32 / (rows - 1) as f32,
            ];
            let point = warp_point_at(row_points.get(col), fallback);
            resolved_points.push(point);
            let index = row * cols + col;
            let slot = index / 2;
            if slot >= out.points.len() {
                break;
            }
            if index % 2 == 0 {
                out.points[slot][0] = point[0];
                out.points[slot][1] = point[1];
            } else {
                out.points[slot][2] = point[0];
                out.points[slot][3] = point[1];
            }
        }
    }
    out.rows = rows as f32;
    out.cols = cols as f32;
    if bool_at(grid, &["bezier"]) != Some(false) && resolved_points.len() == rows * cols {
        let tangents = parse_layer_mesh_tangents(grid.get("tangents"), rows, cols, &resolved_points);
        if tangents.len() == rows * cols {
            for (index, [right, down, left, up]) in tangents.into_iter().enumerate() {
                out.tangents[index * 2] = [right[0], right[1], down[0], down[1]];
                out.tangents[index * 2 + 1] = [left[0], left[1], up[0], up[1]];
            }
            out.bezier = true;
        }
    }
    out
}

/// Per-screen polygon masks, packed like the layer mask: up to 8 masks per
/// screen, 32 anchor points each, two points per vec4. Masks past the cap
/// are dropped whole rather than truncated into a different shape. A curved
/// edge is cut as a polyline (flatten_screen_mask), so one mask can use up
/// to SCREEN_MASK_FLAT_POINTS vertices in the uniforms.
pub(crate) const MAX_SCREEN_MASKS: usize = 8;

pub(crate) const SCREEN_MASK_POINTS_PER_MASK: usize = 32;

pub(crate) const SCREEN_MASK_FLAT_POINTS: usize = 128;

pub(crate) const MAX_SCREEN_MASK_POINTS: usize = MAX_SCREEN_MASKS * SCREEN_MASK_FLAT_POINTS;

pub(crate) const MAX_SCREEN_MASK_VEC4S: usize = MAX_SCREEN_MASK_POINTS / 2;

/// A flattened curve stays within this distance of the true cubic, in
/// screen UV: under half a pixel on a 4K projector. The editor preview
/// (flattenScreenMask in screenMaskGeometry.ts) uses the identical rule.
pub(crate) const SCREEN_MASK_CURVE_TOLERANCE: f64 = 1.0 / 8192.0;

pub(crate) const SCREEN_MASK_CURVE_MAX_SEGMENTS: f64 = 64.0;

/// Slack around a mask's bounds before a pixel skips the polygon test: far
/// above rounding, far below a pixel, so the reject never changes a pixel.
pub(crate) const SCREEN_MASK_BOUNDS_PAD: f32 = 1e-3;

/// One mask vertex with its optional curve handles (absolute positions).
#[derive(Clone, Copy)]
pub(crate) struct ScreenMaskAnchor {
    pub(crate) point: [f64; 2],
    pub(crate) cp_in: Option<[f64; 2]>,
    pub(crate) cp_out: Option<[f64; 2]>,
}

pub(crate) fn screen_mask_curve_segments(a: [f64; 2], c1: [f64; 2], c2: [f64; 2], b: [f64; 2], tolerance: f64) -> usize {
    // A cubic strays from its chord polyline by at most 3/4 of its largest
    // second difference over n^2.
    let d1 = [a[0] - 2.0 * c1[0] + c2[0], a[1] - 2.0 * c1[1] + c2[1]];
    let d2 = [c1[0] - 2.0 * c2[0] + b[0], c1[1] - 2.0 * c2[1] + b[1]];
    let dd = (d1[0] * d1[0] + d1[1] * d1[1]).sqrt().max((d2[0] * d2[0] + d2[1] * d2[1]).sqrt());
    let n = ((0.75 * dd) / tolerance).sqrt().ceil();
    if n.is_finite() { n.clamp(1.0, SCREEN_MASK_CURVE_MAX_SEGMENTS) as usize } else { 1 }
}

/// A mask outline as the polygon the shader cuts: the anchors, with each
/// curved edge (the anchor it leaves has cp_out, or the one it reaches has
/// cp_in) replaced by points along its cubic spaced to stay within
/// SCREEN_MASK_CURVE_TOLERANCE. When that needs more than
/// SCREEN_MASK_FLAT_POINTS vertices the tolerance doubles until it fits. A
/// mask without handles comes back as exactly its vertex list.
pub(crate) fn flatten_screen_mask(anchors: &[ScreenMaskAnchor]) -> Vec<[f32; 2]> {
    let count = anchors.len();
    let plain = |a: &ScreenMaskAnchor| [a.point[0] as f32, a.point[1] as f32];
    if count < 3 {
        return anchors.iter().map(plain).collect();
    }
    let edges: Vec<Option<[[f64; 2]; 4]>> = (0..count)
        .map(|i| {
            let a = anchors[i];
            let b = anchors[(i + 1) % count];
            if a.cp_out.is_none() && b.cp_in.is_none() {
                return None;
            }
            Some([a.point, a.cp_out.unwrap_or(a.point), b.cp_in.unwrap_or(b.point), b.point])
        })
        .collect();
    let segments_for = |tolerance: f64| -> Vec<usize> {
        edges
            .iter()
            .map(|edge| edge.map_or(1, |[a, c1, c2, b]| screen_mask_curve_segments(a, c1, c2, b, tolerance)))
            .collect()
    };
    let mut tolerance = SCREEN_MASK_CURVE_TOLERANCE;
    let mut segments = segments_for(tolerance);
    for _ in 0..40 {
        if segments.iter().sum::<usize>() <= SCREEN_MASK_FLAT_POINTS {
            break;
        }
        tolerance *= 2.0;
        segments = segments_for(tolerance);
    }
    let mut out = Vec::with_capacity(segments.iter().sum());
    for (i, anchor) in anchors.iter().enumerate() {
        out.push(plain(anchor));
        let Some([a, c1, c2, b]) = edges[i] else { continue };
        let n = segments[i];
        for k in 1..n {
            let t = k as f64 / n as f64;
            let mt = 1.0 - t;
            let (w0, w1, w2, w3) = (mt * mt * mt, 3.0 * mt * mt * t, 3.0 * mt * t * t, t * t * t);
            out.push([
                (w0 * a[0] + w1 * c1[0] + w2 * c2[0] + w3 * b[0]) as f32,
                (w0 * a[1] + w1 * c1[1] + w2 * c2[1] + w3 * b[1]) as f32,
            ]);
        }
    }
    out
}

/// Screen mask block for the uniforms: header (mask count, keep count), one
/// info vec4 per mask (point start, point count, feather, invert), padded
/// bounds per mask (x0, y0, x1, y1) and the packed vertex list. Points
/// arrive already in the core's y-up screen UV; the editor flips them (and
/// their curve handles) once at the sync boundary, as it does the warp
/// corners. A disabled mask or one with fewer than 3 usable points is
/// skipped so it can never black out the screen.
pub(crate) fn screen_masks_at(
    params: Option<&Value>,
) -> (
    [f32; 4],
    [[f32; 4]; MAX_SCREEN_MASKS],
    [[f32; 4]; MAX_SCREEN_MASKS],
    [[f32; 4]; MAX_SCREEN_MASK_VEC4S],
) {
    let mut info = [[0.0f32; 4]; MAX_SCREEN_MASKS];
    let mut bounds = [[0.0f32; 4]; MAX_SCREEN_MASKS];
    let mut points = [[0.0f32; 4]; MAX_SCREEN_MASK_VEC4S];
    let mut mask_count = 0usize;
    let mut keep_count = 0usize;
    let mut cursor = 0usize;
    let Some(entries) = params.and_then(Value::as_array) else {
        return ([0.0; 4], info, bounds, points);
    };
    // A vertex may sit outside the screen so a mask can run off its edge;
    // only nonsense values are rejected.
    let position = |value: Option<&Value>| -> Option<[f64; 2]> {
        let value = value?;
        let x = number_at(value, &["x"])?;
        let y = number_at(value, &["y"])?;
        if !x.is_finite() || !y.is_finite() {
            return None;
        }
        Some([x.clamp(-4.0, 5.0), y.clamp(-4.0, 5.0)])
    };
    for entry in entries {
        if mask_count >= MAX_SCREEN_MASKS {
            break;
        }
        if !bool_at(entry, &["enabled"]).unwrap_or(true) {
            continue;
        }
        let Some(vertices) = entry.get("points").and_then(Value::as_array) else {
            continue;
        };
        let anchors: Vec<ScreenMaskAnchor> = vertices
            .iter()
            .filter_map(|point| {
                Some(ScreenMaskAnchor {
                    point: position(Some(point))?,
                    cp_in: position(point.get("cpIn")),
                    cp_out: position(point.get("cpOut")),
                })
            })
            .take(SCREEN_MASK_POINTS_PER_MASK)
            .collect();
        if anchors.len() < 3 {
            continue;
        }
        let vertices = flatten_screen_mask(&anchors);
        if cursor + vertices.len() > MAX_SCREEN_MASK_POINTS {
            continue;
        }
        let invert = bool_at(entry, &["invert"]).unwrap_or(false);
        let feather = number_at(entry, &["feather"]).unwrap_or(0.0).clamp(0.0, 1.0) as f32;
        info[mask_count] = [
            cursor as f32,
            vertices.len() as f32,
            feather,
            if invert { 1.0 } else { 0.0 },
        ];
        let mut lo = [f32::INFINITY; 2];
        let mut hi = [f32::NEG_INFINITY; 2];
        for vertex in &vertices {
            lo = [lo[0].min(vertex[0]), lo[1].min(vertex[1])];
            hi = [hi[0].max(vertex[0]), hi[1].max(vertex[1])];
            let slot = cursor / 2;
            if cursor % 2 == 0 {
                points[slot][0] = vertex[0];
                points[slot][1] = vertex[1];
            } else {
                points[slot][2] = vertex[0];
                points[slot][3] = vertex[1];
            }
            cursor += 1;
        }
        bounds[mask_count] = [
            lo[0] - SCREEN_MASK_BOUNDS_PAD,
            lo[1] - SCREEN_MASK_BOUNDS_PAD,
            hi[0] + SCREEN_MASK_BOUNDS_PAD,
            hi[1] + SCREEN_MASK_BOUNDS_PAD,
        ];
        if !invert {
            keep_count += 1;
        }
        mask_count += 1;
    }
    ([mask_count as f32, keep_count as f32, 0.0, 0.0], info, bounds, points)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Screen and Master Warp meshes take the layer mesh's tangent rules
    /// and packing. A grid without tangents, or with Bezier switched off,
    /// must stay off the Bezier path so it renders exactly as before.
    #[test]
    fn output_warp_meshes_pack_bezier_tangents_only_when_curved() {
        use serde_json::json;
        let points = json!([
            [{ "x": 0.0, "y": 0.0 }, { "x": 0.5, "y": 0.0 }, { "x": 1.0, "y": 0.0 }],
            [{ "x": 0.0, "y": 1.0 }, { "x": 0.5, "y": 1.0 }, { "x": 1.0, "y": 1.0 }],
        ]);
        let straight = super::warp_mesh_at(Some(&json!({ "rows": 2, "cols": 3, "points": points })));
        assert_eq!((straight.rows, straight.cols, straight.bezier), (2.0, 3.0, false));
        assert_eq!(straight.points[0], [0.0, 0.0, 0.5, 0.0]);
        assert!(straight.tangents.iter().all(|v| *v == [0.0; 4]));

        let curved_json = json!({ "rows": 2, "cols": 3, "points": points, "bezier": true,
            "tangents": [[null, { "right": { "x": 0.1, "y": -0.2 } }, null], [null, null, null]] });
        let curved = super::warp_mesh_at(Some(&curved_json));
        assert!(curved.bezier);
        // Top-middle: right stored, left mirrors it, down is a chord third.
        assert_eq!(curved.tangents[2], [0.1, -0.2, 0.0, 1.0 / 3.0]);
        assert_eq!(curved.tangents[3], [-0.1, 0.2, 0.0, 0.0]);
        assert_eq!(curved.points, straight.points);

        let mut off = curved_json.clone();
        off["bezier"] = json!(false);
        assert!(!super::warp_mesh_at(Some(&off)).bezier);
        let mut empty = curved_json;
        empty["tangents"] = json!([[null, null, null], [null, {}, null]]);
        assert!(!super::warp_mesh_at(Some(&empty)).bezier);
        assert_eq!(super::warp_mesh_at(Some(&json!({ "rows": 1, "cols": 3, "points": [] }))).rows, 0.0);
    }

    #[test]
    fn screen_masks_pack_enabled_polygons_and_skip_unusable_ones() {
        use serde_json::json;
        let masks = json!([
            { "enabled": true, "invert": false, "feather": 0.3,
              "points": [{ "x": 0.1, "y": 0.1 }, { "x": 0.9, "y": 0.1 }, { "x": 0.5, "y": 0.9 }] },
            // Disabled, and too few points: neither may reach the shader.
            { "enabled": false, "points": [{ "x": 0.0, "y": 0.0 }, { "x": 1.0, "y": 0.0 }, { "x": 1.0, "y": 1.0 }] },
            { "points": [{ "x": 0.0, "y": 0.0 }, { "x": 1.0, "y": 0.0 }] },
            { "invert": true, "feather": 4.0,
              "points": [{ "x": 0.4, "y": 0.4 }, { "x": 0.6, "y": 0.4 }, { "x": 0.6, "y": 0.6 }, { "x": 0.4, "y": "nope" }] },
        ]);
        let (header, info, bounds, points) = super::screen_masks_at(Some(&masks));
        assert_eq!(header, [2.0, 1.0, 0.0, 0.0]);
        let pad = super::SCREEN_MASK_BOUNDS_PAD;
        assert_eq!(bounds[0], [0.1 - pad, 0.1 - pad, 0.9 + pad, 0.9 + pad]);
        assert_eq!(info[0], [0.0, 3.0, 0.3, 0.0]);
        // The inverted mask starts after the first mask's 3 vertices, drops
        // its unusable vertex and clamps feather into range.
        assert_eq!(info[1], [3.0, 3.0, 1.0, 1.0]);
        assert_eq!(points[0], [0.1, 0.1, 0.9, 0.1]);
        assert_eq!(points[1], [0.5, 0.9, 0.4, 0.4]);
        assert_eq!(points[2], [0.6, 0.4, 0.6, 0.6]);
        assert_eq!(super::screen_masks_at(None).0, [0.0; 4]);
        assert_eq!(super::screen_masks_at(Some(&json!("x"))).0, [0.0; 4]);
        // Past the per-screen cap, extra masks are dropped whole.
        let many = json!((0..12).map(|_| json!({ "points": [{ "x": 0.0, "y": 0.0 }, { "x": 1.0, "y": 0.0 }, { "x": 1.0, "y": 1.0 }] })).collect::<Vec<_>>());
        assert_eq!(super::screen_masks_at(Some(&many)).0[0], super::MAX_SCREEN_MASKS as f32);
    }

    /// Curved mask edges are cut as polylines that stay within the
    /// flattening tolerance of their cubic; straight edges and masks
    /// without handles pack exactly as before; a mask whose curves would
    /// overflow its vertex budget coarsens rather than being dropped.
    #[test]
    fn screen_masks_flatten_curved_edges_within_tolerance() {
        use serde_json::json;
        let a = [0.2, 0.2];
        let c1 = [0.5, -0.1];
        let c2 = [0.7, 0.0];
        let b = [0.8, 0.2];
        let masks = json!([{ "points": [
            { "x": a[0], "y": a[1], "cpOut": { "x": c1[0], "y": c1[1] } },
            { "x": b[0], "y": b[1], "cpIn": { "x": c2[0], "y": c2[1] } },
            { "x": 0.5, "y": 0.8 },
        ] }]);
        let (header, info, bounds, points) = super::screen_masks_at(Some(&masks));
        assert_eq!(header[0], 1.0);
        let count = info[0][1] as usize;
        assert!(count > 12, "a strong curve needs many segments, got {count}");
        let flat: Vec<[f32; 2]> = (0..count)
            .map(|i| { let v = points[i / 2]; if i % 2 == 0 { [v[0], v[1]] } else { [v[2], v[3]] } })
            .collect();
        assert_eq!(flat[0], [0.2, 0.2]);
        assert_eq!(flat[count - 2], [0.8, 0.2]);
        assert_eq!(flat[count - 1], [0.5, 0.8]);
        // Every chord of the flattened curve stays within tolerance of the
        // cubic (checked densely against its midpoints).
        let cubic = |t: f64| {
            let mt = 1.0 - t;
            [
                mt * mt * mt * a[0] + 3.0 * mt * mt * t * c1[0] + 3.0 * mt * t * t * c2[0] + t * t * t * b[0],
                mt * mt * mt * a[1] + 3.0 * mt * mt * t * c1[1] + 3.0 * mt * t * t * c2[1] + t * t * t * b[1],
            ]
        };
        let n = count - 2;
        for k in 0..n {
            let (p, q) = (flat[k], flat[k + 1]);
            let mid = cubic((k as f64 + 0.5) / n as f64);
            let (dx, dy) = ((q[0] - p[0]) as f64, (q[1] - p[1]) as f64);
            let len = (dx * dx + dy * dy).sqrt();
            let dist = ((mid[0] - p[0] as f64) * dy - (mid[1] - p[1] as f64) * dx).abs() / len;
            assert!(dist <= super::SCREEN_MASK_CURVE_TOLERANCE * 1.01, "segment {k} strays {dist}");
        }
        // The bounds cover the bulge (down to y ~ 0.01, below both anchors).
        assert!(bounds[0][1] < 0.02);

        // 32 wildly curved anchors cannot all get full detail: the mask
        // still packs, within its budget, with every anchor kept.
        let wild = json!([{ "points": (0..32).map(|i| {
            let t = i as f64 / 32.0 * std::f64::consts::TAU;
            json!({ "x": 0.5 + 0.4 * t.cos(), "y": 0.5 + 0.4 * t.sin(),
                "cpIn": { "x": 0.5, "y": 2.0 }, "cpOut": { "x": 0.5, "y": -1.0 } })
        }).collect::<Vec<_>>() }]);
        let (header, info, _, _) = super::screen_masks_at(Some(&wild));
        assert_eq!(header[0], 1.0);
        assert!(info[0][1] as usize <= super::SCREEN_MASK_FLAT_POINTS && info[0][1] as usize >= 32);
    }
}
