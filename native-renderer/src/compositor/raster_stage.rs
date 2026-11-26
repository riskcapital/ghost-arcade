//! Where a layer can land on a view drawn through an output stage (a Screen
//! drawn straight from the compositor, with its crop, rotation, projector
//! calibration, screen warp and the Master Warp), so the raster compositor
//! can cut its draw to those output pixels.
//!
//! fs_main maps each output pixel to a canvas point (output_source_uv in
//! heartbeat.wgsl): calibration, rotation, screen warp, then the inverse of
//! the Master Warp. The bounds here are conservative: every output pixel
//! whose canvas point a layer covers lies inside its rectangle. Each step is
//! bounded exactly or from above:
//!   calibration   a homography: a box maps to the quad of its corners while
//!                 no corner crosses the horizon; a pixel it maps outside the
//!                 screen is black whatever the layers (its mask is 0)
//!   rotation      quarter turns map boxes to boxes
//!   screen warp   the crop is affine; corners and straight mesh cells are
//!                 bilinear, which takes its extremes over a box at the
//!                 box's corners; a Bezier cell lies inside the sum of its
//!                 curves' control boxes less its corner box (the Coons
//!                 patch is their sum)
//!   Master Warp   points are destinations, so it is bounded the other way:
//!                 a layer's canvas box goes forward through the warp's
//!                 bilinear corners (and its mesh) to where the screen warp
//!                 lands
//! The output is cut into a grid of cells, each with the box the screen warp
//! takes it to; a layer draws over the cells whose box meets its own.

use crate::*;

/// Grid cells across each side of the output.
const STAGE_GRID: u32 = 32;

/// Rounding slack added to boxes in UV (the Master Warp's inverse solves
/// approximately: more slack after it).
const STAGE_SLACK: f32 = 1.0e-4;
const MASTER_WARP_SLACK: f32 = 2.0e-3;

#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) struct UvBox {
    pub(crate) x0: f32,
    pub(crate) y0: f32,
    pub(crate) x1: f32,
    pub(crate) y1: f32,
}

impl UvBox {
    pub(crate) const EMPTY: Self = Self { x0: f32::INFINITY, y0: f32::INFINITY, x1: f32::NEG_INFINITY, y1: f32::NEG_INFINITY };
    const UNIT: Self = Self { x0: 0.0, y0: 0.0, x1: 1.0, y1: 1.0 };

    pub(crate) fn new(x0: f32, y0: f32, x1: f32, y1: f32) -> Self {
        Self { x0, y0, x1, y1 }
    }

    fn of_points(points: &[[f32; 2]]) -> Self {
        points.iter().fold(Self::EMPTY, |b, p| b.add(*p))
    }

    fn add(self, p: [f32; 2]) -> Self {
        Self { x0: self.x0.min(p[0]), y0: self.y0.min(p[1]), x1: self.x1.max(p[0]), y1: self.y1.max(p[1]) }
    }

    fn union(self, o: Self) -> Self {
        Self { x0: self.x0.min(o.x0), y0: self.y0.min(o.y0), x1: self.x1.max(o.x1), y1: self.y1.max(o.y1) }
    }

    fn intersect(self, o: Self) -> Self {
        Self { x0: self.x0.max(o.x0), y0: self.y0.max(o.y0), x1: self.x1.min(o.x1), y1: self.y1.min(o.y1) }
    }

    fn is_empty(&self) -> bool {
        !(self.x0 <= self.x1 && self.y0 <= self.y1)
    }

    fn grow(self, by: f32) -> Self {
        if self.is_empty() { self } else { Self { x0: self.x0 - by, y0: self.y0 - by, x1: self.x1 + by, y1: self.y1 + by } }
    }

    fn meets(&self, o: &Self) -> bool {
        !self.is_empty() && !o.is_empty() && self.x0 <= o.x1 && o.x0 <= self.x1 && self.y0 <= o.y1 && o.y0 <= self.y1
    }

    fn corners(&self) -> [[f32; 2]; 4] {
        [[self.x0, self.y0], [self.x1, self.y0], [self.x1, self.y1], [self.x0, self.y1]]
    }
}

fn mix2(a: [f32; 2], b: [f32; 2], t: f32) -> [f32; 2] {
    [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]
}

/// mix(mix(a, b, x), mix(d, c, x), y): a at (0, 0), b (1, 0), c (1, 1), d (0, 1).
fn bilinear(a: [f32; 2], b: [f32; 2], c: [f32; 2], d: [f32; 2], p: [f32; 2]) -> [f32; 2] {
    mix2(mix2(a, b, p[0]), mix2(d, c, p[0]), p[1])
}

/// The bilinear map over `over` (a box in its parameters).
fn bilinear_box(a: [f32; 2], b: [f32; 2], c: [f32; 2], d: [f32; 2], over: UvBox) -> UvBox {
    UvBox::of_points(&over.corners().map(|p| bilinear(a, b, c, d, p)))
}

/// Point `index` of a packed output-warp mesh (two a vec4, as the shader's
/// swarp_mesh_point).
fn mesh_point(points: &[[f32; 4]; 128], index: usize) -> [f32; 2] {
    let packed = points[(index / 2).min(127)];
    if index % 2 == 0 { [packed[0], packed[1]] } else { [packed[2], packed[3]] }
}

/// A box holding the Coons patch of mesh cell (row, col): the sum of the
/// boxes of its edge curves (each inside its control points, every tangent
/// of the corners taken) less the box of its corners.
fn coons_cell_box(points: &[[f32; 4]; 128], tangents: &[[f32; 4]], cols: usize, row: usize, col: usize) -> UvBox {
    let ia = row * cols + col;
    let corners = [ia, ia + 1, ia + cols + 1, ia + cols];
    let mut sheet = UvBox::EMPTY;
    let mut all = UvBox::EMPTY;
    for index in corners {
        let p = mesh_point(points, index);
        sheet = sheet.add(p);
        all = all.add(p);
        for half in 0..2 {
            let packed = tangents[(index * 2 + half).min(tangents.len() - 1)];
            all = all.add([p[0] + packed[0], p[1] + packed[1]]).add([p[0] + packed[2], p[1] + packed[3]]);
        }
    }
    UvBox::new(2.0 * all.x0 - sheet.x1, 2.0 * all.y0 - sheet.y1, 2.0 * all.x1 - sheet.x0, 2.0 * all.y1 - sheet.y0)
}

/// A mesh over the unit square, as the shader indexes it: `at` gives cell
/// (row, col) and the parameter box inside it the map is evaluated over.
/// Bounds the map over `over`, clamping like the shader does.
fn mesh_box(over: UvBox, rows: usize, cols: usize, mut cell: impl FnMut(usize, usize, UvBox) -> UvBox) -> UvBox {
    if over.is_empty() {
        return UvBox::EMPTY;
    }
    let span = |lo: f32, hi: f32, n: usize| -> (usize, usize) {
        let last = (n - 2) as f32;
        let at = |v: f32| (v * (n - 1) as f32).floor().clamp(0.0, last) as usize;
        (at(lo), at(hi))
    };
    let (c0, c1) = span(over.x0, over.x1, cols);
    let (r0, r1) = span(over.y0, over.y1, rows);
    let mut out = UvBox::EMPTY;
    for row in r0..=r1 {
        for col in c0..=c1 {
            let fx = |v: f32| (v * (cols - 1) as f32 - col as f32).clamp(0.0, 1.0);
            let fy = |v: f32| (v * (rows - 1) as f32 - row as f32).clamp(0.0, 1.0);
            out = out.union(cell(row, col, UvBox::new(fx(over.x0), fy(over.y0), fx(over.x1), fy(over.y1))));
        }
    }
    out
}

/// What the raster compositor needs of a view's output stage.
pub(crate) enum StageBounds {
    /// The canvas, one to one (the program, deck monitors, the record target).
    Identity,
    /// Crop and rotation only: canvas = out0.xy + rotate(uv) * out0.zw.
    Affine { out0: [f32; 4], rotation: i32, width: u32, height: u32 },
    /// Anything else: grid cells (output pixel rectangles) with the box the
    /// output stage takes each to before the Master Warp.
    Grid { cells: Vec<([u32; 4], UvBox)>, master: Option<MasterWarp> },
}

/// The Master Warp, to take a canvas box forward to where the screen warp lands.
pub(crate) struct MasterWarp {
    corners: [[f32; 2]; 4],
    rows: usize,
    cols: usize,
    bezier: bool,
    points: [[f32; 4]; 128],
    tangents: Vec<[f32; 4]>,
}

impl MasterWarp {
    fn forward(&self, canvas: UvBox) -> UvBox {
        let [a, b, c, d] = self.corners;
        let canvas = canvas.intersect(UvBox::UNIT);
        if canvas.is_empty() {
            return UvBox::EMPTY;
        }
        let q = if self.rows < 2 || self.cols < 2 {
            vec![canvas]
        } else {
            let mut boxes = Vec::new();
            mesh_box(canvas, self.rows, self.cols, |row, col, at| {
                let cell = if self.bezier {
                    coons_cell_box(&self.points, &self.tangents, self.cols, row, col)
                } else {
                    let ia = row * self.cols + col;
                    bilinear_box(mesh_point(&self.points, ia), mesh_point(&self.points, ia + 1),
                        mesh_point(&self.points, ia + self.cols + 1), mesh_point(&self.points, ia + self.cols), at)
                };
                boxes.push(cell);
                UvBox::EMPTY
            });
            boxes
        };
        q.into_iter().fold(UvBox::EMPTY, |out, q| out.union(bilinear_box(a, b, c, d, q))).grow(MASTER_WARP_SLACK)
    }
}

fn rotate_box(b: UvBox, rotation: i32) -> UvBox {
    match rotation {
        1 => UvBox::new(b.y0, 1.0 - b.x1, b.y1, 1.0 - b.x0),
        2 => UvBox::new(1.0 - b.x1, 1.0 - b.y1, 1.0 - b.x0, 1.0 - b.y0),
        3 => UvBox::new(1.0 - b.y1, b.x0, 1.0 - b.y0, b.x1),
        _ => b,
    }
}

/// The inverse of rotate_box.
fn unrotate_box(b: UvBox, rotation: i32) -> UvBox {
    match rotation {
        1 => rotate_box(b, 3),
        3 => rotate_box(b, 1),
        other => rotate_box(b, other),
    }
}

/// Output pixels (y down, x1/y1 exclusive) whose centres fall in `b`
/// (output UV, y up), a pixel wider all round.
fn uv_box_pixels(b: UvBox, width: u32, height: u32) -> Option<[u32; 4]> {
    if b.is_empty() {
        return None;
    }
    let (w, h) = (width as f32, height as f32);
    let x0 = (b.x0 * w - 0.5).floor() - 1.0;
    let x1 = (b.x1 * w - 0.5).ceil() + 2.0;
    let y0 = ((1.0 - b.y1) * h - 0.5).floor() - 1.0;
    let y1 = ((1.0 - b.y0) * h - 0.5).ceil() + 2.0;
    let clamp = |v: f32, size: f32| if v.is_nan() { 0.0 } else { v.clamp(0.0, size) };
    let rect = [clamp(x0, w) as u32, clamp(y0, h) as u32, clamp(x1, w) as u32, clamp(y1, h) as u32];
    (rect[0] < rect[2] && rect[1] < rect[3]).then_some(rect)
}

impl StageBounds {
    /// The bounds of `u`'s output stage on a `width` x `height` view. Err
    /// names a stage the raster compositor does not draw.
    pub(crate) fn new(u: &Uniforms, width: u32, height: u32) -> Result<Self, &'static str> {
        if stage_is_identity(u) {
            return Ok(Self::Identity);
        }
        if u.dome0[0] > 0.5 {
            return Err("dome Screen");
        }
        // Each layer draw would search the Master Warp's mesh again for its
        // pixels (fs_main does it once per pixel): measured at 4x the
        // legacy compositor's time.
        if u.mwarp[0] >= 0.5 && u.mwarp[1] >= 2.0 && u.mwarp[2] >= 2.0 {
            return Err("Master Warp mesh Screen");
        }
        let rotation = ((u.out1[0] + 0.5).floor() as i32).clamp(0, 3);
        let calibration = u.projector_calibration[2][3];
        let warp = (u.swarp[0] + 0.5).floor() as i32;
        let master = u.mwarp[0] >= 0.5;
        if (-0.5..0.5).contains(&calibration) && warp != 1 && warp != 2 && !master {
            return Ok(Self::Affine { out0: u.out0, rotation, width, height });
        }
        let slice_rows = u.swarp[1].clamp(2.0, WARP_MESH_MAX_DIM as f32) as usize;
        let slice_cols = u.swarp[2].clamp(2.0, WARP_MESH_MAX_DIM as f32) as usize;
        let slice_bezier = u.swarp[3] > 0.5;
        let warp_box = |b: UvBox| -> UvBox {
            match warp {
                1 => bilinear_box([u.swarp_c0[0], u.swarp_c0[1]], [u.swarp_c0[2], u.swarp_c0[3]],
                    [u.swarp_c1[0], u.swarp_c1[1]], [u.swarp_c1[2], u.swarp_c1[3]], b),
                2 => mesh_box(b, slice_rows, slice_cols, |row, col, at| {
                    if slice_bezier {
                        coons_cell_box(&u.swarp_mesh, &u.swarp_tangents, slice_cols, row, col)
                    } else {
                        let ia = row * slice_cols + col;
                        bilinear_box(mesh_point(&u.swarp_mesh, ia), mesh_point(&u.swarp_mesh, ia + 1),
                            mesh_point(&u.swarp_mesh, ia + slice_cols + 1), mesh_point(&u.swarp_mesh, ia + slice_cols), at)
                    }
                }),
                _ => {
                    let a = [u.out0[0] + b.x0 * u.out0[2], u.out0[1] + b.y0 * u.out0[3]];
                    let c = [u.out0[0] + b.x1 * u.out0[2], u.out0[1] + b.y1 * u.out0[3]];
                    UvBox::of_points(&[a, c])
                }
            }
        };
        let cal = u.projector_calibration;
        let calibrate = |b: UvBox| -> UvBox {
            if calibration < -0.5 {
                return UvBox::EMPTY; // every pixel's mask is 0
            }
            if calibration < 0.5 {
                return b;
            }
            let mut sign = 0.0f32;
            let mut points = [[0.0f32; 2]; 4];
            for (point, corner) in points.iter_mut().zip(b.corners()) {
                let p = [corner[0], 1.0 - corner[1], 1.0];
                let z = cal[2][0] * p[0] + cal[2][1] * p[1] + cal[2][2] * p[2];
                if z.abs() < 1.0e-5 || (sign != 0.0 && z.signum() != sign) {
                    return UvBox::UNIT;
                }
                sign = z.signum();
                let qx = (cal[0][0] * p[0] + cal[0][1] * p[1] + cal[0][2] * p[2]) / z;
                let qy = (cal[1][0] * p[0] + cal[1][1] * p[1] + cal[1][2] * p[2]) / z;
                *point = [qx, 1.0 - qy];
            }
            // A pixel landing off the screen has mask 0: black.
            UvBox::of_points(&points).grow(STAGE_SLACK).intersect(UvBox::UNIT)
        };
        let (w, h) = (width.max(1), height.max(1));
        let mut cells = Vec::with_capacity((STAGE_GRID * STAGE_GRID) as usize);
        for row in 0..STAGE_GRID {
            let (y0, y1) = (row * h / STAGE_GRID, (row + 1) * h / STAGE_GRID);
            if y0 >= y1 { continue; }
            for col in 0..STAGE_GRID {
                let (x0, x1) = (col * w / STAGE_GRID, (col + 1) * w / STAGE_GRID);
                if x0 >= x1 { continue; }
                let output = UvBox::new(x0 as f32 / w as f32, 1.0 - y1 as f32 / h as f32, x1 as f32 / w as f32, 1.0 - y0 as f32 / h as f32);
                let local = calibrate(output.grow(STAGE_SLACK));
                if local.is_empty() { continue; }
                let warped = warp_box(rotate_box(local, rotation)).grow(STAGE_SLACK);
                if warped.is_empty() { continue; }
                cells.push(([x0, y0, x1, y1], warped));
            }
        }
        let master = master.then(|| MasterWarp {
            corners: [[u.mwarp_c0[0], u.mwarp_c0[1]], [u.mwarp_c0[2], u.mwarp_c0[3]],
                [u.mwarp_c1[0], u.mwarp_c1[1]], [u.mwarp_c1[2], u.mwarp_c1[3]]],
            rows: u.mwarp[1].clamp(0.0, WARP_MESH_MAX_DIM as f32) as usize,
            cols: u.mwarp[2].clamp(0.0, WARP_MESH_MAX_DIM as f32) as usize,
            bezier: u.mwarp[3] > 0.5,
            points: u.mwarp_mesh,
            tangents: u.mwarp_tangents.to_vec(),
        });
        Ok(Self::Grid { cells, master })
    }

    pub(crate) fn identity(&self) -> bool {
        matches!(self, Self::Identity)
    }

    /// Output pixels (x0, y0, x1, y1, y down) a layer covering canvas box
    /// `canvas` (y up; unbounded where it reaches the canvas border) can
    /// touch. None: none.
    pub(crate) fn pixels(&self, canvas: UvBox) -> Option<[u32; 4]> {
        match self {
            Self::Identity => None,
            Self::Affine { out0, rotation, width, height } => {
                let (sx, sy) = (out0[2], out0[3]);
                if !(sx.abs() > 1.0e-6 && sy.abs() > 1.0e-6) {
                    return uv_box_pixels(UvBox::UNIT, *width, *height);
                }
                let a = [(canvas.x0 - out0[0]) / sx, (canvas.y0 - out0[1]) / sy];
                let c = [(canvas.x1 - out0[0]) / sx, (canvas.y1 - out0[1]) / sy];
                let rotated = UvBox::of_points(&[a, c]).grow(STAGE_SLACK);
                uv_box_pixels(unrotate_box(rotated, *rotation), *width, *height)
            }
            Self::Grid { cells, master } => {
                let target = match master {
                    Some(master) => master.forward(canvas),
                    None => canvas,
                };
                let mut out: Option<[u32; 4]> = None;
                for (rect, warped) in cells {
                    if warped.meets(&target) {
                        out = Some(match out {
                            Some(o) => [o[0].min(rect[0]), o[1].min(rect[1]), o[2].max(rect[2]), o[3].max(rect[3])],
                            None => *rect,
                        });
                    }
                }
                out
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn uniforms() -> Uniforms {
        let mut u = Uniforms::zeroed();
        let stage = OutputStage::default();
        u.out0 = stage.out0;
        u.out1 = stage.out1;
        u.swarp = stage.swarp;
        u.swarp_c0 = stage.swarp_c0;
        u.swarp_c1 = stage.swarp_c1;
        u.mwarp = stage.mwarp;
        u.mwarp_c0 = stage.mwarp_c0;
        u.mwarp_c1 = stage.mwarp_c1;
        u.dome0 = stage.dome0;
        u.projector_calibration = stage.projector_calibration;
        u
    }

    /// The shader's output_source_uv (without the mesh warps), on the CPU.
    fn source_uv(u: &Uniforms, uv: [f32; 2]) -> Option<[f32; 2]> {
        let cal = u.projector_calibration;
        let mut local = uv;
        if cal[2][3] >= 0.5 {
            let p = [uv[0], 1.0 - uv[1], 1.0];
            let z = cal[2][0] * p[0] + cal[2][1] * p[1] + cal[2][2];
            let q = [(cal[0][0] * p[0] + cal[0][1] * p[1] + cal[0][2]) / z, (cal[1][0] * p[0] + cal[1][1] * p[1] + cal[1][2]) / z];
            if !(0.0..=1.0).contains(&q[0]) || !(0.0..=1.0).contains(&q[1]) {
                return None;
            }
            local = [q[0], 1.0 - q[1]];
        }
        let rotated = match (u.out1[0] + 0.5).floor() as i32 {
            1 => [local[1], 1.0 - local[0]],
            2 => [1.0 - local[0], 1.0 - local[1]],
            3 => [1.0 - local[1], local[0]],
            _ => local,
        };
        let warped = match (u.swarp[0] + 0.5).floor() as i32 {
            1 => bilinear([u.swarp_c0[0], u.swarp_c0[1]], [u.swarp_c0[2], u.swarp_c0[3]],
                [u.swarp_c1[0], u.swarp_c1[1]], [u.swarp_c1[2], u.swarp_c1[3]], rotated),
            _ => [u.out0[0] + rotated[0] * u.out0[2], u.out0[1] + rotated[1] * u.out0[3]],
        };
        Some(warped)
    }

    /// Every pixel whose canvas point lies in `canvas` is inside the
    /// rectangle the bounds give.
    fn check(u: &Uniforms, canvas: UvBox, forward: impl Fn([f32; 2]) -> Option<[f32; 2]>) {
        let (w, h) = (160u32, 90u32);
        let bounds = StageBounds::new(u, w, h).unwrap();
        let rect = bounds.pixels(canvas);
        let mut hits = 0;
        for py in 0..h {
            for px in 0..w {
                let uv = [(px as f32 + 0.5) / w as f32, 1.0 - (py as f32 + 0.5) / h as f32];
                let Some(c) = forward(uv) else { continue };
                if c[0] >= canvas.x0 && c[0] <= canvas.x1 && c[1] >= canvas.y0 && c[1] <= canvas.y1 {
                    hits += 1;
                    let r = rect.unwrap_or_else(|| panic!("pixel {px},{py} lands on the layer, bounds give none"));
                    assert!(px >= r[0] && px < r[2] && py >= r[1] && py < r[3], "pixel {px},{py} outside {r:?}");
                }
            }
        }
        assert!(hits > 0, "the layer lands somewhere");
    }

    #[test]
    fn crop_and_rotation_bound_exactly() {
        let mut u = uniforms();
        u.out0 = [0.25, 0.1, 0.5, 0.6];
        for rotation in 0..4 {
            u.out1[0] = rotation as f32;
            let bounds = StageBounds::new(&u, 160, 90).unwrap();
            assert!(matches!(bounds, StageBounds::Affine { .. }));
            check(&u, UvBox::new(0.3, 0.2, 0.45, 0.5), |uv| source_uv(&u, uv));
            // Tight: a layer over a tenth of the crop is far from the whole view.
            let r = bounds.pixels(UvBox::new(0.3, 0.2, 0.35, 0.26)).unwrap();
            assert!((r[2] - r[0]) * (r[3] - r[1]) < 160 * 90 / 8, "{r:?}");
        }
        // Off the crop: nothing.
        u.out1[0] = 0.0;
        assert_eq!(StageBounds::new(&u, 160, 90).unwrap().pixels(UvBox::new(0.0, 0.0, 0.1, 0.05)), None);
    }

    #[test]
    fn corner_warp_and_calibration_bound_every_pixel() {
        let mut u = uniforms();
        u.swarp = [1.0, 0.0, 0.0, 0.0];
        u.swarp_c0 = [0.1, 0.05, 0.85, 0.2];
        u.swarp_c1 = [0.95, 0.9, 0.05, 0.7];
        u.out1[0] = 1.0;
        for canvas in [UvBox::new(0.2, 0.2, 0.3, 0.3), UvBox::new(0.6, 0.1, 0.9, 0.4), UvBox::new(0.45, 0.45, 0.47, 0.47)] {
            check(&u, canvas, |uv| source_uv(&u, uv));
        }
        // A keystoned projector in front of it.
        u.projector_calibration[0] = [1.1, 0.1, -0.05, 0.0];
        u.projector_calibration[1] = [-0.05, 0.95, 0.04, 0.0];
        u.projector_calibration[2] = [0.08, -0.06, 1.0, 1.0];
        for canvas in [UvBox::new(0.2, 0.2, 0.3, 0.3), UvBox::new(0.6, 0.1, 0.9, 0.4)] {
            check(&u, canvas, |uv| source_uv(&u, uv));
        }
    }

    #[test]
    fn mesh_warps_bound_every_pixel() {
        let mut u = uniforms();
        // A 4 x 4 screen mesh, bent, with Bezier tangents.
        let (rows, cols) = (4usize, 4usize);
        u.swarp = [2.0, rows as f32, cols as f32, 0.0];
        let point = |r: usize, c: usize| -> [f32; 2] {
            let (x, y) = (c as f32 / 3.0, r as f32 / 3.0);
            [0.1 + 0.8 * x + 0.05 * (y * 4.0).sin(), 0.1 + 0.8 * y + 0.04 * (x * 5.0).cos()]
        };
        for r in 0..rows {
            for c in 0..cols {
                let i = r * cols + c;
                let p = point(r, c);
                if i % 2 == 0 { u.swarp_mesh[i / 2][0] = p[0]; u.swarp_mesh[i / 2][1] = p[1]; }
                else { u.swarp_mesh[i / 2][2] = p[0]; u.swarp_mesh[i / 2][3] = p[1]; }
                u.swarp_tangents[i * 2] = [0.08, 0.03, -0.02, -0.09];
                u.swarp_tangents[i * 2 + 1] = [-0.09, 0.02, 0.01, 0.08];
            }
        }
        let straight = |uv: [f32; 2]| -> Option<[f32; 2]> {
            let fx = uv[0] * 3.0;
            let fy = uv[1] * 3.0;
            let ci = fx.floor().clamp(0.0, 2.0) as usize;
            let ri = fy.floor().clamp(0.0, 2.0) as usize;
            let su = (fx - ci as f32).clamp(0.0, 1.0);
            let sv = (fy - ri as f32).clamp(0.0, 1.0);
            Some(bilinear(point(ri, ci), point(ri, ci + 1), point(ri + 1, ci + 1), point(ri + 1, ci), [su, sv]))
        };
        let canvases = [UvBox::new(0.2, 0.2, 0.3, 0.3), UvBox::new(0.5, 0.6, 0.8, 0.85), UvBox::new(0.4, 0.4, 0.41, 0.41)];
        for canvas in canvases {
            check(&u, canvas, straight);
        }
        // Bezier: the Coons patch of each cell, as mesh_patch_eval.
        u.swarp[3] = 1.0;
        let bezier3 = |p0: [f32; 2], p1: [f32; 2], p2: [f32; 2], p3: [f32; 2], t: f32| {
            let s = 1.0 - t;
            std::array::from_fn::<f32, 2, _>(|k| s * s * s * p0[k] + 3.0 * s * s * t * p1[k] + 3.0 * s * t * t * p2[k] + t * t * t * p3[k])
        };
        let add = |p: [f32; 2], t: [f32; 2]| [p[0] + t[0], p[1] + t[1]];
        let tangent = |i: usize, side: usize| {
            let packed = u.swarp_tangents[i * 2 + (side >> 1)];
            if side & 1 == 0 { [packed[0], packed[1]] } else { [packed[2], packed[3]] }
        };
        let curved = |uv: [f32; 2]| -> Option<[f32; 2]> {
            let fx = uv[0] * 3.0;
            let fy = uv[1] * 3.0;
            let ci = fx.floor().clamp(0.0, 2.0) as usize;
            let ri = fy.floor().clamp(0.0, 2.0) as usize;
            let su = (fx - ci as f32).clamp(0.0, 1.0);
            let sv = (fy - ri as f32).clamp(0.0, 1.0);
            let ia = ri * cols + ci;
            let (ib, id) = (ia + 1, ia + cols);
            let ic = id + 1;
            let (a, b, c, d) = (point(ri, ci), point(ri, ci + 1), point(ri + 1, ci + 1), point(ri + 1, ci));
            let top = bezier3(a, add(a, tangent(ia, 0)), add(b, tangent(ib, 2)), b, su);
            let bottom = bezier3(d, add(d, tangent(id, 0)), add(c, tangent(ic, 2)), c, su);
            let left = bezier3(a, add(a, tangent(ia, 1)), add(d, tangent(id, 3)), d, sv);
            let right = bezier3(b, add(b, tangent(ib, 1)), add(c, tangent(ic, 3)), c, sv);
            let sheet = bilinear(a, b, c, d, [su, sv]);
            let x = mix2(top, bottom, sv);
            let y = mix2(left, right, su);
            Some([x[0] + y[0] - sheet[0], x[1] + y[1] - sheet[1]])
        };
        for canvas in canvases {
            check(&u, canvas, curved);
        }
    }

    #[test]
    fn master_warp_meshes_are_not_drawn_here() {
        let mut u = uniforms();
        u.mwarp = [1.0, 4.0, 4.0, 0.0];
        assert_eq!(StageBounds::new(&u, 64, 64).err(), Some("Master Warp mesh Screen"));
    }

    #[test]
    fn master_warp_bounds_every_pixel() {
        let mut u = uniforms();
        u.out0 = [0.1, 0.0, 0.8, 1.0];
        u.mwarp = [1.0, 0.0, 0.0, 0.0];
        // Destinations: where the canvas corners land.
        let (a, b, c, d) = ([0.05, 0.1], [0.9, 0.0], [1.0, 0.95], [0.0, 0.8]);
        u.mwarp_c0 = [a[0], a[1], b[0], b[1]];
        u.mwarp_c1 = [c[0], c[1], d[0], d[1]];
        let inverse = |p: [f32; 2]| -> Option<[f32; 2]> {
            // Newton on the forward bilinear.
            let mut t = [0.5f32, 0.5];
            for _ in 0..40 {
                let f = bilinear(a, b, c, d, t);
                let e = 1.0e-3;
                let fx = bilinear(a, b, c, d, [t[0] + e, t[1]]);
                let fy = bilinear(a, b, c, d, [t[0], t[1] + e]);
                let j = [[(fx[0] - f[0]) / e, (fy[0] - f[0]) / e], [(fx[1] - f[1]) / e, (fy[1] - f[1]) / e]];
                let det = j[0][0] * j[1][1] - j[0][1] * j[1][0];
                let r = [p[0] - f[0], p[1] - f[1]];
                t = [t[0] + (j[1][1] * r[0] - j[0][1] * r[1]) / det, t[1] + (-j[1][0] * r[0] + j[0][0] * r[1]) / det];
            }
            ((0.0..=1.0).contains(&t[0]) && (0.0..=1.0).contains(&t[1])).then_some(t)
        };
        for canvas in [UvBox::new(0.2, 0.2, 0.3, 0.3), UvBox::new(0.0, 0.7, 0.2, 1.0), UvBox::new(0.6, 0.1, 0.9, 0.4)] {
            check(&u, canvas, |uv| source_uv(&u, uv).and_then(inverse));
        }
    }

    #[test]
    fn dome_screens_are_not_drawn_here() {
        let mut u = uniforms();
        u.dome0[0] = 1.0;
        assert_eq!(StageBounds::new(&u, 64, 64).err(), Some("dome Screen"));
    }
}
