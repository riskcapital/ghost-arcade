//! Painted masks: brush strokes painted on a layer, rasterised here into a
//! per-layer coverage mask that heartbeat.wgsl samples in the layer's
//! content space (after the corner and mesh inverse), so a painted hole
//! stays on the same piece of the picture however the layer is warped.
//!
//! Storage contract (mirrors src/lib/utils/paintMask.ts). The project keeps
//! STROKES, not pixels: each stroke is a centreline in content UV (y down)
//! plus a brush (radius per axis, softness, opacity, erase or restore). A
//! stroke costs a few hundred bytes in the project file and in every undo
//! snapshot, where a bitmap would cost megabytes per snapshot, and the core
//! can rasterise it at whatever resolution the output needs.
//!
//! The mask starts fully visible (65535). Erase moves it toward 0, restore
//! back toward 65535. Within one stroke dabs combine by MAX, then the whole
//! stroke is applied once at its opacity, so a 40% stroke is 40% everywhere
//! instead of building up where the path crosses itself.
//!
//! Every edge is anti-aliased over at least one mask texel, and the mask is
//! sampled bilinearly, so a hard brush magnified onto a 4K output reads as a
//! smooth ramp rather than a staircase.

use base64::Engine;
use serde_json::Value;
use std::collections::HashMap;

/// Painted layers that can be on the GPU at once (texture array layers).
pub const PAINT_MASK_MAX_SLOTS: usize = 16;
pub const PAINT_MASK_MAX_STROKES: usize = 4096;
pub const PAINT_MASK_MAX_POINTS: usize = 16384;
/// Encoded points: u16 0..=65535 maps linearly onto content UV
/// POINT_RANGE_MIN..POINT_RANGE_MIN + POINT_RANGE_SPAN, so a dab centred
/// just outside the layer can still reach its edge.
pub const POINT_RANGE_MIN: f32 = -0.25;
pub const POINT_RANGE_SPAN: f32 = 1.5;
const FULL: u32 = 65535;
const MIN_RADIUS_TEXELS: f32 = 0.75;

/// Mask resolution for an output size: one mask texel per output pixel or
/// better for a layer that fills a 1440p output, and at 4K a 4096 mask.
pub fn paint_mask_size_for_output(width: u32, height: u32) -> u32 {
    if width.max(height) > 2560 { 4096 } else { 2048 }
}

/// Half-open texel rectangle.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Rect {
    pub x0: u32,
    pub y0: u32,
    pub x1: u32,
    pub y1: u32,
}

impl Rect {
    pub fn full(size: u32) -> Self {
        Rect { x0: 0, y0: 0, x1: size, y1: size }
    }
    pub fn width(&self) -> u32 {
        self.x1.saturating_sub(self.x0)
    }
    pub fn height(&self) -> u32 {
        self.y1.saturating_sub(self.y0)
    }
    pub fn is_empty(&self) -> bool {
        self.width() == 0 || self.height() == 0
    }
    pub fn union(self, other: Rect) -> Rect {
        if self.is_empty() {
            return other;
        }
        if other.is_empty() {
            return self;
        }
        Rect {
            x0: self.x0.min(other.x0),
            y0: self.y0.min(other.y0),
            x1: self.x1.max(other.x1),
            y1: self.y1.max(other.y1),
        }
    }
}

fn union_opt(a: Option<Rect>, b: Option<Rect>) -> Option<Rect> {
    match (a, b) {
        (Some(a), Some(b)) => Some(a.union(b)),
        (a, None) => a,
        (None, b) => b,
    }
}

#[derive(Clone, Debug, PartialEq)]
pub struct PaintStroke {
    pub id: String,
    pub erase: bool,
    /// Brush radius in content UV: x as a fraction of the content width,
    /// y of its height (an on-screen circle is an ellipse in UV).
    pub radius: [f32; 2],
    /// 0 = hard edge (anti-aliased only), 1 = falls off from the centre.
    pub softness: f32,
    pub opacity: f32,
    /// Centreline in content UV, y down.
    pub points: Vec<[f32; 2]>,
}

impl PaintStroke {
    pub fn from_json(value: &Value) -> Option<Self> {
        let id = value.get("id")?.as_str()?.trim();
        if id.is_empty() || id.len() > 128 {
            return None;
        }
        let num = |key: &str| value.get(key).and_then(Value::as_f64).filter(|v| v.is_finite());
        let rx = num("rx")? as f32;
        let ry = num("ry")? as f32;
        if rx <= 0.0 || ry <= 0.0 {
            return None;
        }
        let points = match value.get("points")? {
            Value::String(encoded) => decode_points(encoded)?,
            Value::Array(items) => items
                .iter()
                .take(PAINT_MASK_MAX_POINTS)
                .filter_map(|item| {
                    let (x, y) = match item {
                        Value::Array(pair) => (pair.first()?.as_f64()?, pair.get(1)?.as_f64()?),
                        _ => (item.get("x")?.as_f64()?, item.get("y")?.as_f64()?),
                    };
                    (x.is_finite() && y.is_finite()).then_some([x as f32, y as f32])
                })
                .collect(),
            _ => return None,
        };
        if points.is_empty() {
            return None;
        }
        Some(PaintStroke {
            id: id.to_string(),
            erase: value.get("mode").and_then(Value::as_str) != Some("restore"),
            radius: [rx.clamp(0.0001, 2.0), ry.clamp(0.0001, 2.0)],
            softness: num("softness").unwrap_or(0.5).clamp(0.0, 1.0) as f32,
            opacity: num("opacity").unwrap_or(1.0).clamp(0.0, 1.0) as f32,
            points,
        })
    }

    /// Same brush, and `self`'s points are a prefix of `longer`'s: the
    /// live preview of one drag grew without its start changing.
    fn is_prefix_of(&self, longer: &PaintStroke) -> bool {
        self.id == longer.id
            && self.erase == longer.erase
            && self.radius == longer.radius
            && self.softness == longer.softness
            && self.opacity == longer.opacity
            && self.points.len() <= longer.points.len()
            && self.points[..] == longer.points[..self.points.len()]
    }
}

pub fn decode_points(encoded: &str) -> Option<Vec<[f32; 2]>> {
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(encoded.trim())
        .ok()?;
    if bytes.len() % 4 != 0 {
        return None;
    }
    Some(
        bytes
            .chunks_exact(4)
            .take(PAINT_MASK_MAX_POINTS)
            .map(|c| {
                let qx = u16::from_le_bytes([c[0], c[1]]) as f32 / FULL as f32;
                let qy = u16::from_le_bytes([c[2], c[3]]) as f32 / FULL as f32;
                [
                    POINT_RANGE_MIN + qx * POINT_RANGE_SPAN,
                    POINT_RANGE_MIN + qy * POINT_RANGE_SPAN,
                ]
            })
            .collect(),
    )
}

#[cfg_attr(not(test), allow(dead_code))]
pub fn encode_points(points: &[[f32; 2]]) -> String {
    let mut bytes = Vec::with_capacity(points.len() * 4);
    for p in points {
        for v in p {
            let q = (((v - POINT_RANGE_MIN) / POINT_RANGE_SPAN).clamp(0.0, 1.0) * FULL as f32).round() as u16;
            bytes.extend_from_slice(&q.to_le_bytes());
        }
    }
    base64::engine::general_purpose::STANDARD.encode(bytes)
}

fn blend(base: u16, cov: u16, erase: bool, opacity: u32) -> u16 {
    let a = (cov as u32 * opacity + FULL / 2) / FULL;
    let b = base as u32;
    if erase {
        (b - (b * a + FULL / 2) / FULL) as u16
    } else {
        (b + ((FULL - b) * a + FULL / 2) / FULL) as u16
    }
}

fn opacity_u32(opacity: f32) -> u32 {
    (opacity.clamp(0.0, 1.0) * FULL as f32).round() as u32
}

/// MAX-blend the coverage of `stroke` into `cov` (size x size), starting at
/// the segment that ends at `from_point` (0 = the whole stroke). Returns the
/// texels touched.
pub fn rasterize_stroke(cov: &mut [u16], size: u32, stroke: &PaintStroke, from_point: usize) -> Option<Rect> {
    rasterize_stroke_band(cov, size, 0, stroke, from_point)
}

/// As rasterize_stroke, into a band of whole rows: `cov` holds rows
/// `row0 .. row0 + cov.len() / size`. Rects are in full-mask texels.
pub fn rasterize_stroke_band(cov: &mut [u16], size: u32, row0: u32, stroke: &PaintStroke, from_point: usize) -> Option<Rect> {
    let rows = (cov.len() / size as usize) as u32;
    let band = (row0, (row0 + rows).min(size));
    let s = size as f32;
    let rxt = (stroke.radius[0] * s).max(MIN_RADIUS_TEXELS);
    let ryt = (stroke.radius[1] * s).max(MIN_RADIUS_TEXELS);
    // One texel in brush-normalised units along the finer axis: the
    // narrowest ramp that still anti-aliases in both directions.
    let aa = 1.0 / rxt.min(ryt);
    let soft = stroke.softness;
    let (lo, hi) = if soft > aa { (1.0 - soft, 1.0) } else { (1.0 - aa * 0.5, 1.0 + aa * 0.5) };
    // Work in brush space, where the brush is the unit circle.
    let to_brush = |p: [f32; 2]| [p[0] * s / rxt, p[1] * s / ryt];
    let brush = Brush { rxt, ryt, lo, hi };
    let pts = &stroke.points;
    let mut touched: Option<Rect> = None;
    let mut segment = |a: [f32; 2], b: [f32; 2], touched: &mut Option<Rect>| {
        let (a, b) = (to_brush(a), to_brush(b));
        if let Some(rect) = capsule(cov, size, band, a, b, &brush) {
            *touched = Some(touched.map_or(rect, |t| t.union(rect)));
        }
    };
    if pts.len() == 1 {
        if from_point == 0 {
            segment(pts[0], pts[0], &mut touched);
        }
    } else {
        for i in from_point.max(1)..pts.len() {
            segment(pts[i - 1], pts[i], &mut touched);
        }
    }
    touched
}

struct Brush {
    /// Brush radius in texels per axis.
    rxt: f32,
    ryt: f32,
    /// Coverage is 1 inside `lo` and 0 outside `hi` (brush-space distance).
    lo: f32,
    hi: f32,
}

/// Where `lo <= m * x + c <= hi` along a line, as an x interval.
fn linear_interval(m: f32, c: f32, lo: f32, hi: f32) -> Option<(f32, f32)> {
    if m.abs() < 1e-12 {
        return (c >= lo && c <= hi).then_some((f32::NEG_INFINITY, f32::INFINITY));
    }
    let (x0, x1) = ((lo - c) / m, (hi - c) / m);
    Some((x0.min(x1), x0.max(x1)))
}

/// The x span (brush space) where row `py` is within `r` of segment a-b:
/// a capsule is convex, so it is one interval, the hull of the two end
/// discs' chords and the side band's.
fn capsule_row_span(a: [f32; 2], b: [f32; 2], py: f32, r: f32) -> Option<(f32, f32)> {
    let mut span: Option<(f32, f32)> = None;
    let mut add = |lo: f32, hi: f32| {
        if lo <= hi {
            span = Some(span.map_or((lo, hi), |(l, h)| (l.min(lo), h.max(hi))));
        }
    };
    for c in [a, b] {
        let dy = py - c[1];
        if dy.abs() < r {
            let half = (r * r - dy * dy).sqrt();
            add(c[0] - half, c[0] + half);
        }
    }
    let d = [b[0] - a[0], b[1] - a[1]];
    let len = (d[0] * d[0] + d[1] * d[1]).sqrt();
    if len > 1e-6 {
        let n = [d[0] / len, d[1] / len];
        // Along the segment: 0 <= (p - a) . n <= len; across: |(p - a) x n| <= r.
        let along = linear_interval(n[0], (py - a[1]) * n[1] - a[0] * n[0], 0.0, len);
        let across = linear_interval(n[1], -(py - a[1]) * n[0] - a[0] * n[1], -r, r);
        if let (Some(p), Some(q)) = (along, across) {
            add(p.0.max(q.0), p.1.min(q.1));
        }
    }
    span
}

/// One capsule from `a` to `b` in brush space (unit radius), clipped to
/// the rows in `band`.
fn capsule(cov: &mut [u16], size: u32, band: (u32, u32), a: [f32; 2], b: [f32; 2], brush: &Brush) -> Option<Rect> {
    let Brush { rxt, ryt, lo, hi } = *brush;
    // Texel rows: brush space -> texel space is (x * rxt, y * ryt).
    let min_y = (a[1].min(b[1]) - hi) * ryt;
    let max_y = (a[1].max(b[1]) + hi) * ryt;
    let y0 = (min_y.floor().max(0.0) as u32).max(band.0);
    let y1 = ((max_y.ceil().max(0.0) as u32) + 1).min(band.1);
    if y0 >= y1 {
        return None;
    }
    let ab = [b[0] - a[0], b[1] - a[1]];
    let ab_len2 = ab[0] * ab[0] + ab[1] * ab[1];
    let inv_ramp = 1.0 / (hi - lo).max(1e-6);
    let hi2 = hi * hi;
    let lo2 = lo.max(0.0) * lo.max(0.0);
    let mut rect: Option<Rect> = None;
    for y in y0..y1 {
        let py = (y as f32 + 0.5) / ryt;
        let Some((sx0, sx1)) = capsule_row_span(a, b, py, hi) else { continue };
        // Texel x whose centre (x + 0.5) / rxt lies in the span.
        let x0 = (sx0 * rxt - 0.5).ceil().max(0.0) as u32;
        let x1 = (((sx1 * rxt - 0.5).floor() + 1.0).max(0.0) as u32).min(size);
        if x0 >= x1 {
            continue;
        }
        let row = ((y - band.0) * size) as usize;
        let mut wrote = false;
        for x in x0..x1 {
            let slot = &mut cov[row + x as usize];
            // Already fully covered by an earlier dab of this stroke.
            if *slot == FULL as u16 {
                continue;
            }
            let px = (x as f32 + 0.5) / rxt;
            let ap = [px - a[0], py - a[1]];
            let t = if ab_len2 > 0.0 {
                ((ap[0] * ab[0] + ap[1] * ab[1]) / ab_len2).clamp(0.0, 1.0)
            } else {
                0.0
            };
            let dx = ap[0] - ab[0] * t;
            let dy = ap[1] - ab[1] * t;
            let d2 = dx * dx + dy * dy;
            if d2 >= hi2 {
                continue;
            }
            let c = if d2 <= lo2 {
                FULL as u16
            } else {
                let u = ((d2.sqrt() - lo) * inv_ramp).clamp(0.0, 1.0);
                let f = 1.0 - u * u * (3.0 - 2.0 * u);
                (f * FULL as f32 + 0.5) as u16
            };
            if c > *slot {
                *slot = c;
                wrote = true;
            }
        }
        if wrote {
            let r = Rect { x0, y0: y, x1, y1: y + 1 };
            rect = Some(rect.map_or(r, |t| t.union(r)));
        }
    }
    rect
}

/// Apply a stroke's coverage to `base` over `rect` at the stroke's opacity,
/// and zero that part of `cov` so the buffer can be reused.
pub fn composite_and_clear(base: &mut [u16], cov: &mut [u16], size: u32, rect: Rect, erase: bool, opacity: f32) {
    composite_and_clear_band(base, cov, size, 0, rect, erase, opacity);
}

/// As composite_and_clear on row bands starting at `row0` (`rect` is in
/// full-mask texels and inside the band).
pub fn composite_and_clear_band(base: &mut [u16], cov: &mut [u16], size: u32, row0: u32, rect: Rect, erase: bool, opacity: f32) {
    let op = opacity_u32(opacity);
    for y in rect.y0..rect.y1 {
        let row = ((y - row0) * size) as usize;
        for x in rect.x0..rect.x1 {
            let i = row + x as usize;
            let c = cov[i];
            if c != 0 {
                base[i] = blend(base[i], c, erase, op);
                cov[i] = 0;
            }
        }
    }
}

/// Apply `strokes` in order onto `base` (size x size), split into row bands
/// across threads. Each band runs every stroke independently, so the
/// result is identical to the single-threaded order. Returns the union of
/// texels touched.
pub fn apply_strokes_parallel(base: &mut [u16], size: u32, strokes: &[PaintStroke]) -> Option<Rect> {
    if strokes.is_empty() {
        return None;
    }
    let threads = std::thread::available_parallelism().map(|n| n.get()).unwrap_or(4).clamp(1, 16);
    let rows_per = (size as usize).div_ceil(threads).max(16);
    let chunk = rows_per * size as usize;
    std::thread::scope(|scope| {
        let handles: Vec<_> = base
            .chunks_mut(chunk)
            .enumerate()
            .map(|(i, band)| {
                scope.spawn(move || {
                    let row0 = (i * rows_per) as u32;
                    let mut cov = vec![0u16; band.len()];
                    let mut touched: Option<Rect> = None;
                    for stroke in strokes {
                        if let Some(rect) = rasterize_stroke_band(&mut cov, size, row0, stroke, 0) {
                            composite_and_clear_band(band, &mut cov, size, row0, rect, stroke.erase, stroke.opacity);
                            touched = union_opt(touched, Some(rect));
                        }
                    }
                    touched
                })
            })
            .collect();
        handles.into_iter().filter_map(|h| h.join().ok().flatten()).reduce(Rect::union)
    })
}

struct Preview {
    stroke: PaintStroke,
    cov: Vec<u16>,
    bbox: Option<Rect>,
}

/// The pixels one committed stroke overwrote, so undoing it is a copy.
struct UndoRecord {
    id: String,
    rect: Rect,
    before: Vec<u16>,
}

/// Undo records kept per layer. Past this the oldest go, and undoing that
/// far back re-rasterises instead.
const UNDO_BUDGET_BYTES: usize = 64 * 1024 * 1024;

#[derive(Default)]
struct PaintLayer {
    visible: bool,
    invert: bool,
    strokes: Vec<PaintStroke>,
    /// size x size, 65535 = visible. Empty means "no strokes": all visible.
    base: Vec<u16>,
    preview: Option<Preview>,
    dirty: Option<Rect>,
    slot: Option<usize>,
    undo: std::collections::VecDeque<UndoRecord>,
    undo_bytes: usize,
    /// The strokes and raster a Clear replaced, so Clear then Undo is a
    /// swap rather than a re-rasterise.
    cleared: Option<(Vec<PaintStroke>, Vec<u16>)>,
}

impl PaintLayer {
    fn active(&self) -> bool {
        self.visible && (!self.strokes.is_empty() || self.preview.is_some())
    }

    fn mark(&mut self, rect: Option<Rect>) {
        self.dirty = union_opt(self.dirty, rect);
    }

    fn push_undo(&mut self, id: &str, rect: Rect, size: u32) {
        let mut before = Vec::with_capacity((rect.width() * rect.height()) as usize);
        for y in rect.y0..rect.y1 {
            let row = (y * size) as usize;
            before.extend_from_slice(&self.base[row + rect.x0 as usize..row + rect.x1 as usize]);
        }
        self.undo_bytes += before.len() * 2;
        self.undo.push_back(UndoRecord { id: id.to_string(), rect, before });
        while self.undo_bytes > UNDO_BUDGET_BYTES {
            let Some(old) = self.undo.pop_front() else { break };
            self.undo_bytes -= old.before.len() * 2;
        }
    }

    fn drop_undo(&mut self) {
        self.undo.clear();
        self.undo_bytes = 0;
    }

    /// Undo the last `count` committed strokes from their records. False
    /// (and nothing changed) when any of them has no record.
    fn restore_from_undo(&mut self, removed: &[PaintStroke], size: u32) -> bool {
        if removed.len() > self.undo.len() {
            return false;
        }
        let tail = self.undo.len() - removed.len();
        if !self.undo.iter().skip(tail).zip(removed).all(|(r, s)| r.id == s.id) {
            return false;
        }
        while self.undo.len() > tail {
            let record = self.undo.pop_back().unwrap();
            self.undo_bytes -= record.before.len() * 2;
            let w = record.rect.width() as usize;
            for (k, y) in (record.rect.y0..record.rect.y1).enumerate() {
                let row = (y * size) as usize + record.rect.x0 as usize;
                self.base[row..row + w].copy_from_slice(&record.before[k * w..(k + 1) * w]);
            }
            self.dirty = union_opt(self.dirty, Some(record.rect));
        }
        true
    }
}

pub struct PaintMaskUpload {
    pub slot: usize,
    pub rect: Rect,
    /// R8, rect.width() x rect.height(), tightly packed.
    pub bytes: Vec<u8>,
}

/// Counters for the status payload and the tests.
#[derive(Clone, Copy, Debug, Default)]
pub struct PaintMaskStats {
    pub rebuilds: u64,
    pub undo_restores: u64,
    pub incremental_strokes: u64,
    pub last_rebuild_ms: f64,
    pub uploaded_bytes: u64,
}

pub struct PaintMaskStore {
    size: u32,
    layers: HashMap<String, PaintLayer>,
    slots: Vec<Option<String>>,
    pub stats: PaintMaskStats,
}

impl PaintMaskStore {
    pub fn new(size: u32) -> Self {
        PaintMaskStore {
            size: size.max(16),
            layers: HashMap::new(),
            slots: vec![None; PAINT_MASK_MAX_SLOTS],
            stats: PaintMaskStats::default(),
        }
    }

    pub fn size(&self) -> u32 {
        self.size
    }

    /// Change the mask resolution (output resize). Every mask is
    /// re-rasterised from its strokes, which is exactly why strokes are
    /// what gets stored.
    pub fn set_size(&mut self, size: u32) -> bool {
        let size = size.max(16);
        if size == self.size {
            return false;
        }
        self.size = size;
        let ids: Vec<String> = self.layers.keys().cloned().collect();
        for id in ids {
            let Some(layer) = self.layers.get_mut(&id) else { continue };
            let preview = layer.preview.take().map(|p| p.stroke);
            layer.base = Vec::new();
            layer.cleared = None;
            layer.drop_undo();
            layer.dirty = Some(Rect::full(size));
            if !layer.strokes.is_empty() {
                self.rebuild(&id);
            }
            if let Some(stroke) = preview {
                self.set_preview(&id, Some(stroke));
            }
        }
        true
    }

    /// `set_layer_paint_mask`: the full committed state of one layer.
    pub fn apply_command(&mut self, layer_id: &str, command: &Value) {
        let visible = command.get("enabled").and_then(Value::as_bool).unwrap_or(true);
        let invert = command.get("inverted").and_then(Value::as_bool).unwrap_or(false);
        let strokes: Vec<PaintStroke> = command
            .get("strokes")
            .and_then(Value::as_array)
            .map(|items| items.iter().take(PAINT_MASK_MAX_STROKES).filter_map(PaintStroke::from_json).collect())
            .unwrap_or_default();
        self.set_strokes(layer_id, visible, invert, strokes);
    }

    pub fn set_strokes(&mut self, layer_id: &str, visible: bool, invert: bool, strokes: Vec<PaintStroke>) {
        let size = self.size;
        let full = (size * size) as usize;
        let layer = self.layers.entry(layer_id.to_string()).or_default();
        layer.visible = visible;
        layer.invert = invert;
        let old_len = layer.strokes.len();
        let appended = strokes.len() >= old_len && strokes[..old_len] == layer.strokes[..];
        let truncated = strokes.len() < old_len && layer.strokes[..strokes.len()] == strokes[..];
        if appended && strokes.len() == old_len {
            // Only the flags changed.
        } else if appended {
            if layer.base.is_empty() {
                layer.base = vec![FULL as u16; full];
            }
            layer.cleared = None;
            let added = &strokes[old_len..];
            if added.len() > 4 {
                // A project load or a big redo: band threads, no records.
                layer.drop_undo();
                let rect = apply_strokes_parallel(&mut layer.base, size, added);
                layer.mark(rect);
            } else {
                let mut scratch: Vec<u16> = Vec::new();
                for stroke in added {
                    // The drag that was being previewed is now committed:
                    // its coverage is already rasterised, so fold it in.
                    let (mut cov, rect) = match layer.preview.take() {
                        Some(p) if p.stroke == *stroke => (p.cov, p.bbox),
                        other => {
                            layer.preview = other;
                            if scratch.len() != full {
                                scratch = vec![0; full];
                            }
                            let rect = rasterize_stroke(&mut scratch, size, stroke, 0);
                            (std::mem::take(&mut scratch), rect)
                        }
                    };
                    if let Some(rect) = rect {
                        layer.push_undo(&stroke.id, rect, size);
                        composite_and_clear(&mut layer.base, &mut cov, size, rect, stroke.erase, stroke.opacity);
                    }
                    scratch = cov;
                    layer.mark(rect);
                }
            }
            self.stats.incremental_strokes += added.len() as u64;
            layer.strokes = strokes;
        } else if strokes.is_empty() {
            // Clear: park the old raster in case the next thing is Undo.
            let old = std::mem::take(&mut layer.strokes);
            let base = std::mem::take(&mut layer.base);
            layer.drop_undo();
            layer.cleared = Some((old, base));
            layer.dirty = Some(Rect::full(size));
        } else if layer.cleared.as_ref().is_some_and(|(s, _)| *s == strokes) {
            let (s, base) = layer.cleared.take().unwrap();
            layer.strokes = s;
            layer.base = base;
            layer.dirty = Some(Rect::full(size));
            self.stats.undo_restores += 1;
        } else if truncated && layer.restore_from_undo(&layer.strokes[strokes.len()..].to_vec(), size) {
            layer.strokes = strokes;
            self.stats.undo_restores += 1;
        } else {
            // Undo past the records, a reorder or another project: rebuild.
            layer.strokes = strokes;
            layer.cleared = None;
            self.rebuild(layer_id);
        }
        // A preview whose stroke is already committed (a late pointer-move
        // arriving after the commit) would apply the stroke twice.
        let layer = self.layers.get_mut(layer_id).unwrap();
        if let Some(preview) = &layer.preview {
            if layer.strokes.iter().any(|s| s.id == preview.stroke.id) {
                let bbox = preview.bbox;
                layer.preview = None;
                layer.mark(bbox);
            }
        }
        self.update_slot(layer_id);
    }

    fn rebuild(&mut self, layer_id: &str) {
        let started = std::time::Instant::now();
        let size = self.size;
        let Some(layer) = self.layers.get_mut(layer_id) else { return };
        layer.drop_undo();
        layer.base.clear();
        layer.base.resize((size * size) as usize, FULL as u16);
        apply_strokes_parallel(&mut layer.base, size, &layer.strokes);
        layer.dirty = Some(Rect::full(size));
        self.stats.rebuilds += 1;
        self.stats.last_rebuild_ms = started.elapsed().as_secs_f64() * 1000.0;
    }

    /// `set_layer_paint_preview`: the stroke being dragged right now, or
    /// None when the drag ended without committing.
    pub fn apply_preview_command(&mut self, layer_id: &str, command: &Value) {
        let stroke = command.get("stroke").and_then(PaintStroke::from_json);
        self.set_preview(layer_id, stroke);
    }

    pub fn set_preview(&mut self, layer_id: &str, stroke: Option<PaintStroke>) {
        let size = self.size;
        let layer = self.layers.entry(layer_id.to_string()).or_insert_with(|| PaintLayer {
            visible: true,
            ..Default::default()
        });
        let stroke = stroke.filter(|s| !layer.strokes.iter().any(|c| c.id == s.id));
        let extends = matches!((&layer.preview, &stroke), (Some(p), Some(s)) if p.stroke.is_prefix_of(s));
        match stroke {
            None => {
                if let Some(old) = layer.preview.take() {
                    layer.mark(old.bbox);
                }
            }
            Some(stroke) if extends => {
                let preview = layer.preview.as_mut().unwrap();
                let from = preview.stroke.points.len();
                let mut rect = None;
                if stroke.points.len() > from {
                    rect = rasterize_stroke(&mut preview.cov, size, &stroke, from);
                    preview.bbox = union_opt(preview.bbox, rect);
                }
                preview.stroke = stroke;
                layer.mark(rect);
            }
            Some(stroke) => {
                if let Some(old) = layer.preview.take() {
                    layer.mark(old.bbox);
                }
                let mut cov = vec![0u16; (size * size) as usize];
                let bbox = rasterize_stroke(&mut cov, size, &stroke, 0);
                layer.mark(bbox);
                layer.preview = Some(Preview { stroke, cov, bbox });
            }
        }
        self.update_slot(layer_id);
    }

    pub fn remove_layer(&mut self, layer_id: &str) {
        if let Some(layer) = self.layers.remove(layer_id) {
            if let Some(slot) = layer.slot {
                self.slots[slot] = None;
            }
        }
    }

    fn update_slot(&mut self, layer_id: &str) {
        let Some(layer) = self.layers.get_mut(layer_id) else { return };
        let active = layer.active();
        match (active, layer.slot) {
            (true, None) => {
                if let Some(free) = self.slots.iter().position(Option::is_none) {
                    self.slots[free] = Some(layer_id.to_string());
                    layer.slot = Some(free);
                    // The texture layer holds whatever the last owner left.
                    layer.dirty = Some(Rect::full(self.size));
                } else {
                    eprintln!("[ghost-core] painted mask slots full ({PAINT_MASK_MAX_SLOTS}); {layer_id} renders unmasked");
                }
            }
            (false, Some(slot)) => {
                self.slots[slot] = None;
                layer.slot = None;
            }
            _ => {}
        }
    }

    /// (slot + 1, flags) for LayerGpu.fast_flags.zw. Slot 0 = no paint mask;
    /// flag bit 0 = inverted.
    pub fn gpu_flags(&self, layer_id: &str) -> (u32, u32) {
        match self.layers.get(layer_id) {
            Some(layer) if layer.active() => match layer.slot {
                Some(slot) => (slot as u32 + 1, u32::from(layer.invert)),
                None => (0, 0),
            },
            _ => (0, 0),
        }
    }

    /// Texture array layers needed (highest used slot + 1).
    pub fn slots_needed(&self) -> usize {
        self.slots.iter().rposition(Option::is_some).map_or(0, |i| i + 1)
    }

    pub fn mark_all_dirty(&mut self) {
        let size = self.size;
        for layer in self.layers.values_mut() {
            layer.dirty = Some(Rect::full(size));
        }
    }

    /// The R8 pixels each active layer needs re-uploaded since last time.
    pub fn drain_uploads(&mut self) -> Vec<PaintMaskUpload> {
        let size = self.size;
        let mut uploads = Vec::new();
        for layer in self.layers.values_mut() {
            let Some(slot) = layer.slot else {
                continue;
            };
            let Some(rect) = layer.dirty.take() else { continue };
            let rect = Rect { x0: rect.x0.min(size), y0: rect.y0.min(size), x1: rect.x1.min(size), y1: rect.y1.min(size) };
            if rect.is_empty() {
                continue;
            }
            let mut bytes = Vec::with_capacity((rect.width() * rect.height()) as usize);
            let preview = layer.preview.as_ref().map(|p| (&p.cov, p.stroke.erase, opacity_u32(p.stroke.opacity)));
            for y in rect.y0..rect.y1 {
                let row = (y * size) as usize;
                for x in rect.x0..rect.x1 {
                    let i = row + x as usize;
                    let mut v = if layer.base.is_empty() { FULL as u16 } else { layer.base[i] };
                    if let Some((cov, erase, op)) = preview {
                        if cov[i] != 0 {
                            v = blend(v, cov[i], erase, op);
                        }
                    }
                    bytes.push(((v as u32 * 255 + FULL / 2) / FULL) as u8);
                }
            }
            self.stats.uploaded_bytes += bytes.len() as u64;
            uploads.push(PaintMaskUpload { slot, rect, bytes });
        }
        uploads
    }

    /// Mask value (0..=65535) at a texel, preview included, for tests.
    #[cfg_attr(not(test), allow(dead_code))]
    pub fn value_at(&self, layer_id: &str, x: u32, y: u32) -> Option<u16> {
        let layer = self.layers.get(layer_id)?;
        let i = (y.min(self.size - 1) * self.size + x.min(self.size - 1)) as usize;
        let mut v = if layer.base.is_empty() { FULL as u16 } else { layer.base[i] };
        if let Some(p) = &layer.preview {
            v = blend(v, p.cov[i], p.stroke.erase, opacity_u32(p.stroke.opacity));
        }
        Some(v)
    }

    pub fn layer_summary(&self, layer_id: &str) -> Option<Value> {
        let layer = self.layers.get(layer_id)?;
        Some(serde_json::json!({
            "strokes": layer.strokes.len(),
            "visible": layer.visible,
            "inverted": layer.invert,
            "slot": layer.slot,
            "preview_points": layer.preview.as_ref().map(|p| p.stroke.points.len()),
            "size": self.size,
            "undo_records": layer.undo.len(),
            "rebuilds": self.stats.rebuilds,
            "undo_restores": self.stats.undo_restores,
            "last_rebuild_ms": self.stats.last_rebuild_ms,
        }))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn stroke(id: &str, erase: bool, r: f32, soft: f32, op: f32, pts: &[[f32; 2]]) -> PaintStroke {
        PaintStroke { id: id.into(), erase, radius: [r, r], softness: soft, opacity: op, points: pts.to_vec() }
    }

    fn texel(size: u32, u: f32, v: f32) -> (u32, u32) {
        ((u * size as f32) as u32, (v * size as f32) as u32)
    }

    #[test]
    fn points_round_trip_through_the_editor_encoding() {
        let pts = vec![[0.0, 0.0], [1.0, 1.0], [0.3333, 0.75], [-0.2, 1.2]];
        let decoded = decode_points(&encode_points(&pts)).unwrap();
        for (a, b) in pts.iter().zip(decoded.iter()) {
            assert!((a[0] - b[0]).abs() < 3e-5 && (a[1] - b[1]).abs() < 3e-5, "{a:?} vs {b:?}");
        }
        // Little-endian u16 pairs, the layout paintMask.ts writes.
        let bytes = base64::engine::general_purpose::STANDARD.decode(encode_points(&[[-0.25, 1.25]])).unwrap();
        assert_eq!(bytes, vec![0, 0, 255, 255]);
        assert!(decode_points("not base64!").is_none());
        assert!(decode_points("AAA=").is_none(), "odd byte count is rejected");
    }

    #[test]
    fn json_parsing_validates_and_clamps() {
        let s = PaintStroke::from_json(&json!({
            "id": "a", "mode": "restore", "rx": 0.1, "ry": 0.2, "softness": 3, "opacity": -1,
            "points": [[0.5, 0.5], {"x": 0.25, "y": 0.75}]
        }))
        .unwrap();
        assert!(!s.erase);
        assert_eq!(s.softness, 1.0);
        assert_eq!(s.opacity, 0.0);
        assert_eq!(s.points, vec![[0.5, 0.5], [0.25, 0.75]]);
        assert!(PaintStroke::from_json(&json!({"id": "", "rx": 0.1, "ry": 0.1, "points": [[0, 0]]})).is_none());
        assert!(PaintStroke::from_json(&json!({"id": "x", "rx": 0.0, "ry": 0.1, "points": [[0, 0]]})).is_none());
        assert!(PaintStroke::from_json(&json!({"id": "x", "rx": 0.1, "ry": 0.1, "points": []})).is_none());
        assert!(PaintStroke::from_json(&json!({"id": "x", "rx": 0.1, "ry": 0.1})).is_none());
        // Default mode is erase.
        assert!(PaintStroke::from_json(&json!({"id": "x", "rx": 0.1, "ry": 0.1, "points": [[0, 0]]})).unwrap().erase);
    }

    #[test]
    fn a_hard_erase_dab_cuts_a_round_hole_with_an_anti_aliased_edge() {
        let size = 256;
        let mut store = PaintMaskStore::new(size);
        store.set_strokes("L", true, false, vec![stroke("s1", true, 0.1, 0.0, 1.0, &[[0.5, 0.5]])]);
        let (cx, cy) = texel(size, 0.5, 0.5);
        assert_eq!(store.value_at("L", cx, cy), Some(0), "centre erased");
        assert_eq!(store.value_at("L", 5, 5), Some(65535), "far away untouched");
        // Radius is 25.6 texels. Walk out from the centre along +x: values
        // rise monotonically, fully erased inside ~24.5 and fully visible
        // past ~26.7, with at least one fractional texel between (AA).
        let mut prev = 0u16;
        let mut fractional = 0;
        for dx in 0..40u32 {
            let v = store.value_at("L", cx + dx, cy).unwrap();
            assert!(v >= prev, "monotonic at dx={dx}");
            prev = v;
            let dist = (cx + dx) as f32 + 0.5 - 128.0;
            if dist < 24.5 {
                assert_eq!(v, 0, "inside at {dist}");
            }
            if dist > 26.7 {
                assert_eq!(v, 65535, "outside at {dist}");
            }
            if v > 0 && v < 65535 {
                fractional += 1;
            }
        }
        assert!(fractional >= 1, "the edge is anti-aliased");
    }

    #[test]
    fn the_hole_is_round_so_a_magnified_edge_has_no_staircase() {
        // Sample the 50% contour of a hard dab along many directions: it
        // must sit on the circle to within half a texel, which is what
        // keeps a bilinearly magnified edge smooth instead of stepped.
        let size = 512;
        let r = 0.2;
        let mut store = PaintMaskStore::new(size);
        store.set_strokes("L", true, false, vec![stroke("s", true, r, 0.0, 1.0, &[[0.5, 0.5]])]);
        let rt = r * size as f32;
        for k in 0..64 {
            let ang = k as f32 / 64.0 * std::f32::consts::TAU;
            let (dx, dy) = (ang.cos(), ang.sin());
            // Bilinear sample of the mask along the ray; find the 50% crossing.
            let sample = |d: f32| -> f32 {
                let x = 256.0 + dx * d - 0.5;
                let y = 256.0 + dy * d - 0.5;
                let (x0, y0) = (x.floor(), y.floor());
                let (fx, fy) = (x - x0, y - y0);
                let g = |xx: f32, yy: f32| store.value_at("L", xx as u32, yy as u32).unwrap() as f32 / 65535.0;
                let top = g(x0, y0) * (1.0 - fx) + g(x0 + 1.0, y0) * fx;
                let bot = g(x0, y0 + 1.0) * (1.0 - fx) + g(x0 + 1.0, y0 + 1.0) * fx;
                top * (1.0 - fy) + bot * fy
            };
            let mut d = rt - 4.0;
            while sample(d) < 0.5 && d < rt + 4.0 {
                d += 0.05;
            }
            assert!((d - rt).abs() < 0.5, "contour at {d} vs radius {rt} (angle {ang})");
        }
    }

    #[test]
    fn softness_widens_the_ramp_and_opacity_scales_the_stroke() {
        let size = 256;
        let mut store = PaintMaskStore::new(size);
        store.set_strokes("L", true, false, vec![stroke("s", true, 0.1, 1.0, 0.5, &[[0.5, 0.5]])]);
        let (cx, cy) = texel(size, 0.5, 0.5);
        let centre = store.value_at("L", cx, cy).unwrap();
        assert!((centre as i32 - 32768).abs() < 200, "50% opacity erases half: {centre}");
        let mid = store.value_at("L", cx + 13, cy).unwrap();
        assert!(mid > centre && mid < 65535, "soft brush has a long falloff: {mid}");
    }

    #[test]
    fn overlapping_dabs_in_one_stroke_do_not_build_up_opacity() {
        let size = 256;
        let mut store = PaintMaskStore::new(size);
        // Back and forth over the same spot, 50% opacity.
        let pts = [[0.3, 0.5], [0.7, 0.5], [0.3, 0.5], [0.7, 0.5]];
        store.set_strokes("L", true, false, vec![stroke("s", true, 0.05, 0.0, 0.5, &pts)]);
        let (cx, cy) = texel(size, 0.5, 0.5);
        let v = store.value_at("L", cx, cy).unwrap();
        assert!((v as i32 - 32768).abs() < 200, "{v}");
        // A second stroke does compound: 50% of the remaining 50%.
        store.set_strokes("L", true, false, vec![
            stroke("s", true, 0.05, 0.0, 0.5, &pts),
            stroke("t", true, 0.05, 0.0, 0.5, &[[0.5, 0.5]]),
        ]);
        let v = store.value_at("L", cx, cy).unwrap();
        assert!((v as i32 - 16384).abs() < 200, "{v}");
    }

    #[test]
    fn restore_brings_erased_pixels_back() {
        let size = 128;
        let mut store = PaintMaskStore::new(size);
        let erase = stroke("e", true, 0.2, 0.0, 1.0, &[[0.5, 0.5]]);
        let restore = stroke("r", false, 0.1, 0.0, 1.0, &[[0.5, 0.5]]);
        store.set_strokes("L", true, false, vec![erase.clone(), restore.clone()]);
        let (cx, cy) = texel(size, 0.5, 0.5);
        assert_eq!(store.value_at("L", cx, cy), Some(65535), "restored centre");
        let (rx, ry) = texel(size, 0.66, 0.5);
        assert_eq!(store.value_at("L", rx, ry), Some(0), "still erased outside the restore dab");
    }

    #[test]
    fn elliptical_radii_follow_the_content_aspect() {
        let size = 256;
        let mut store = PaintMaskStore::new(size);
        let mut s = stroke("s", true, 0.1, 0.0, 1.0, &[[0.5, 0.5]]);
        s.radius = [0.05, 0.2];
        store.set_strokes("L", true, false, vec![s]);
        let (cx, cy) = texel(size, 0.5, 0.5);
        assert_eq!(store.value_at("L", cx + 20, cy), Some(65535), "narrow along x");
        assert_eq!(store.value_at("L", cx, cy + 40), Some(0), "tall along y");
    }

    fn base_of(store: &PaintMaskStore, id: &str) -> Vec<u16> {
        let size = store.size();
        (0..size * size).map(|i| store.value_at(id, i % size, i / size).unwrap()).collect()
    }

    fn three_strokes() -> Vec<PaintStroke> {
        vec![
            stroke("a", true, 0.08, 0.3, 1.0, &[[0.2, 0.2], [0.8, 0.3], [0.5, 0.9]]),
            stroke("b", false, 0.05, 0.0, 0.7, &[[0.1, 0.9], [0.9, 0.1]]),
            stroke("c", true, 0.12, 1.0, 0.4, &[[0.5, 0.5]]),
        ]
    }

    #[test]
    fn appending_strokes_matches_a_full_rebuild() {
        let strokes = three_strokes();
        let mut incremental = PaintMaskStore::new(128);
        for n in 1..=strokes.len() {
            incremental.set_strokes("L", true, false, strokes[..n].to_vec());
        }
        let mut fresh = PaintMaskStore::new(128);
        fresh.set_strokes("L", true, false, strokes.clone());
        assert_eq!(base_of(&incremental, "L"), base_of(&fresh, "L"));
        assert_eq!(incremental.stats.rebuilds, 0, "appends never rebuild");
    }

    #[test]
    fn undo_to_a_prefix_matches_the_state_before_the_stroke() {
        let strokes = three_strokes();
        let mut store = PaintMaskStore::new(128);
        store.set_strokes("L", true, false, strokes[..2].to_vec());
        let before = base_of(&store, "L");
        store.set_strokes("L", true, false, strokes.clone());
        assert_ne!(base_of(&store, "L"), before);
        store.set_strokes("L", true, false, strokes[..2].to_vec());
        assert_eq!(base_of(&store, "L"), before);
        store.set_strokes("L", true, false, Vec::new());
        assert!(base_of(&store, "L").iter().all(|&v| v == 65535), "cleared");
    }

    fn many_strokes(n: usize) -> Vec<PaintStroke> {
        (0..n)
            .map(|i| {
                let f = i as f32 / n as f32;
                let pts: Vec<[f32; 2]> = (0..12)
                    .map(|k| {
                        let t = k as f32 / 11.0;
                        [0.05 + 0.9 * t, 0.5 + 0.4 * (t * 7.0 + f * 11.0).sin()]
                    })
                    .collect();
                stroke(&format!("m{i}"), i % 3 != 0, 0.02 + 0.03 * f, f, 0.5 + 0.5 * f, &pts)
            })
            .collect()
    }

    #[test]
    fn band_threads_rasterise_exactly_like_one_thread() {
        let strokes = many_strokes(12);
        let mut bulk = PaintMaskStore::new(256);
        bulk.set_strokes("L", true, false, strokes.clone());
        let mut one_by_one = PaintMaskStore::new(256);
        for n in 1..=strokes.len() {
            one_by_one.set_strokes("L", true, false, strokes[..n].to_vec());
        }
        assert_eq!(base_of(&bulk, "L"), base_of(&one_by_one, "L"));
    }

    #[test]
    fn undo_and_clear_then_undo_restore_pixels_without_re_rasterising() {
        let strokes = many_strokes(8);
        let mut store = PaintMaskStore::new(256);
        let mut states = vec![vec![65535u16; 256 * 256]];
        for n in 1..=strokes.len() {
            store.set_strokes("L", true, false, strokes[..n].to_vec());
            states.push(base_of(&store, "L"));
        }
        // Cmd+Z one stroke at a time.
        for n in (0..strokes.len()).rev() {
            store.set_strokes("L", true, false, strokes[..n].to_vec());
            assert_eq!(base_of(&store, "L"), states[n], "after undo to {n} strokes");
        }
        assert_eq!(store.stats.rebuilds, 0, "every undo came from a record");
        // Redo is an append; Clear then Undo swaps the raster back.
        store.set_strokes("L", true, false, strokes[..3].to_vec());
        assert_eq!(base_of(&store, "L"), states[3]);
        store.set_strokes("L", true, false, Vec::new());
        assert_eq!(store.gpu_flags("L"), (0, 0), "an empty mask is not sampled");
        store.set_strokes("L", true, false, strokes[..3].to_vec());
        assert_eq!(base_of(&store, "L"), states[3]);
        assert_eq!(store.stats.rebuilds, 0);
        // Jumping back further than the records reach still lands right.
        let mut other = PaintMaskStore::new(256);
        other.set_strokes("L", true, false, strokes.clone());
        other.set_strokes("L", true, false, strokes[..2].to_vec());
        assert_eq!(base_of(&other, "L"), states[2]);
        assert_eq!(other.stats.rebuilds, 1, "bulk load keeps no records, so this rebuilds");
    }

    #[test]
    fn a_growing_preview_then_commit_equals_committing_directly() {
        let full = stroke("p", true, 0.06, 0.2, 0.8, &[[0.1, 0.1], [0.4, 0.2], [0.6, 0.6], [0.9, 0.7]]);
        let mut store = PaintMaskStore::new(128);
        store.set_strokes("L", true, false, vec![three_strokes()[1].clone()]);
        for n in 1..=full.points.len() {
            let mut partial = full.clone();
            partial.points.truncate(n);
            store.set_preview("L", Some(partial));
        }
        let previewed = base_of(&store, "L");
        store.set_strokes("L", true, false, vec![three_strokes()[1].clone(), full.clone()]);
        assert_eq!(base_of(&store, "L"), previewed, "commit folds the preview without a visible change");
        let mut direct = PaintMaskStore::new(128);
        direct.set_strokes("L", true, false, vec![three_strokes()[1].clone(), full.clone()]);
        assert_eq!(base_of(&store, "L"), base_of(&direct, "L"));
        // A late preview for the committed stroke is ignored.
        store.set_preview("L", Some(full));
        assert_eq!(base_of(&store, "L"), base_of(&direct, "L"));
    }

    #[test]
    fn slots_follow_active_layers_and_uploads_cover_dirty_texels() {
        let mut store = PaintMaskStore::new(64);
        assert_eq!(store.gpu_flags("L"), (0, 0));
        store.set_strokes("L", true, true, vec![stroke("s", true, 0.1, 0.0, 1.0, &[[0.5, 0.5]])]);
        assert_eq!(store.gpu_flags("L"), (1, 1), "slot 0 + inverted flag");
        let uploads = store.drain_uploads();
        assert_eq!(uploads.len(), 1);
        assert_eq!(uploads[0].rect, Rect::full(64), "a new slot uploads everything");
        assert_eq!(uploads[0].bytes.len(), 64 * 64);
        assert_eq!(uploads[0].bytes[32 * 64 + 32], 0);
        assert_eq!(uploads[0].bytes[0], 255);
        assert!(store.drain_uploads().is_empty(), "nothing left dirty");
        store.set_strokes("M", true, false, vec![stroke("s", true, 0.1, 0.0, 1.0, &[[0.5, 0.5]])]);
        assert_eq!(store.gpu_flags("M"), (2, 0));
        assert_eq!(store.slots_needed(), 2);
        // Hidden releases the slot; the raster is kept for showing again.
        store.set_strokes("L", false, true, vec![stroke("s", true, 0.1, 0.0, 1.0, &[[0.5, 0.5]])]);
        assert_eq!(store.gpu_flags("L"), (0, 0));
        assert_eq!(store.value_at("L", 32, 32), Some(0));
        store.remove_layer("M");
        assert_eq!(store.slots_needed(), 0);
        // An appended stroke only uploads its own rectangle.
        store.set_strokes("L", true, false, vec![stroke("s", true, 0.1, 0.0, 1.0, &[[0.5, 0.5]])]);
        store.drain_uploads();
        store.set_strokes("L", true, false, vec![
            stroke("s", true, 0.1, 0.0, 1.0, &[[0.5, 0.5]]),
            stroke("t", true, 0.05, 0.0, 1.0, &[[0.1, 0.1]]),
        ]);
        let uploads = store.drain_uploads();
        assert!(uploads[0].rect.width() < 16 && uploads[0].rect.height() < 16, "{:?}", uploads[0].rect);
    }

    #[test]
    fn resizing_re_rasterises_from_strokes() {
        let mut store = PaintMaskStore::new(128);
        store.set_strokes("L", true, false, vec![stroke("s", true, 0.1, 0.0, 1.0, &[[0.25, 0.75]])]);
        assert!(store.set_size(256));
        assert_eq!(store.value_at("L", 64, 192), Some(0));
        assert_eq!(store.value_at("L", 192, 64), Some(65535));
    }

    #[test]
    #[ignore = "timing probe: cargo test --release paint_mask_rebuild_timing -- --ignored --nocapture"]
    fn paint_mask_rebuild_timing() {
        for size in [2048u32, 4096] {
            let mut strokes = Vec::new();
            for i in 0..200 {
                let f = i as f32 / 200.0;
                let pts: Vec<[f32; 2]> = (0..120)
                    .map(|k| {
                        let t = k as f32 / 119.0;
                        [0.1 + 0.8 * t, 0.5 + 0.35 * (t * 9.0 + f * 20.0).sin()]
                    })
                    .collect();
                strokes.push(stroke(&format!("s{i}"), i % 3 != 0, 0.03, 0.4, 0.8, &pts));
            }
            let mut store = PaintMaskStore::new(size);
            let t = std::time::Instant::now();
            store.set_strokes("L", true, false, strokes.clone());
            let full = t.elapsed();
            let t = std::time::Instant::now();
            store.set_strokes("L", true, false, strokes[..199].to_vec());
            let undo = t.elapsed();
            let t = std::time::Instant::now();
            let _ = store.drain_uploads();
            let upload = t.elapsed();
            eprintln!("size {size}: 200-stroke build {full:?}, undo-rebuild {undo:?}, full R8 pack {upload:?}");
        }
    }
}
