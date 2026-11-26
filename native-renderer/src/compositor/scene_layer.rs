//! Scene layers: the compositor's layer state, its mesh warp and edge
//! effects, and packing a layer for the GPU.

use crate::*;

#[derive(Clone, Debug)]
pub(crate) struct SceneLayer {
    pub(crate) id: String,
    pub(crate) z_index: i32,
    pub(crate) vj_layer_index: Option<i32>,
    pub(crate) visible: bool,
    pub(crate) opacity: f32,
    pub(crate) source_kind: f32,
    pub(crate) source_id: Option<String>,
    /// Raw media retained while the layer displays its processed effect output.
    pub(crate) effect_input_source_id: Option<String>,
    pub(crate) shader_id: Option<String>,
    pub(crate) shader_rendered: bool,
    /// Per-layer override for the global quality tier's render scale. None
    /// means inherit. A layer carrying one heavy raymarcher can be dropped on
    /// its own without softening everything else on the wall.
    pub(crate) render_quality: Option<f32>,
    pub(crate) preview_slot: Option<usize>,
    pub(crate) frame_slot: Option<usize>,
    /// Slot holding this layer's core-rendered FS/ISF shader frame — kept
    /// separate from frame_slot so an effect chain can DISPLAY its output on
    /// the layer while still SAMPLING the raw shader render as input.
    pub(crate) shader_frame_slot: Option<usize>,
    /// Source id that owns shader_frame_slot. A shader's output is not the
    /// layer's source_id (that is the shader's INPUT), so without this the
    /// slot looks unreferenced and the pool hands it to another layer.
    pub(crate) shader_source_id: Option<String>,
    pub(crate) color: [f32; 4],
    /// The colour was set by the editor (a colour layer), so it IS the
    /// content and draws at full strength. Otherwise `color` is the hashed
    /// placeholder an empty layer shows, which the shader deliberately dims.
    pub(crate) explicit_color: bool,
    pub(crate) corners: [[f32; 2]; 4],
    /// The corner pin is a true perspective (homography) instead of the
    /// bilinear map: a flat face seen at a slant, measured by the phone.
    /// Off by default so existing corner warps draw exactly as before.
    pub(crate) corner_perspective: bool,
    pub(crate) native_params: [f32; 8],
    pub(crate) blend_code: f32,
    pub(crate) uv0: [f32; 4],
    pub(crate) uv1: [f32; 4],
    pub(crate) shape: [f32; 4],
    pub(crate) shape2: [f32; 4],
    pub(crate) shape_meta: [f32; 4],
    pub(crate) shape_pts: Vec<[f32; 4]>,
    pub(crate) effects: [[f32; 4]; 4],
    pub(crate) effect_count: f32,
    pub(crate) edge: Box<LayerEdgeEffects>,
    pub(crate) mask_info: [f32; 4],
    pub(crate) mask_points: Vec<[f32; 4]>,
    pub(crate) mesh_rows: u32,
    pub(crate) mesh_cols: u32,
    pub(crate) mesh_points: Vec<[f32; 2]>,
    /// Rest position of each mesh point on the layer (y up, like
    /// `mesh_points`). Empty for the even lattice over the whole layer.
    pub(crate) mesh_rest: Vec<[f32; 2]>,
    /// Resolved Bezier tangents per mesh point (right, down, left, up), in
    /// the same y-up layer coordinates as `mesh_points`. Empty for a
    /// straight-edged mesh, which keeps the original bilinear cell path.
    pub(crate) mesh_tangents: Vec<[[f32; 2]; 4]>,
    pub(crate) source_rect: [f32; 4],
    /// VJ deck-monitor tag: Some(0)=bank A, Some(1)=bank B. Tagged layers
    /// re-render into the deck confidence monitor targets at
    /// `deck_monitor_opacity` (their true pre-crossfader level).
    pub(crate) deck_monitor_bank: Option<u8>,
    pub(crate) deck_monitor_opacity: f32,
    /// Colour multiplier from `set_layer_tint`; white leaves the layer as is.
    pub(crate) tint: [f32; 4],
    /// Where the layer sits on the dome, from `set_layer_dome`, packed as
    /// `LayerGpu::dome`. None composites it on the canvas like any layer.
    pub(crate) dome: Option<[f32; 4]>,
    /// The outgoing picture, shown until the new source has one.
    pub(crate) held: Option<HeldPicture>,
}

impl SceneLayer {
    pub(crate) fn new(id: String, z_index: i32) -> Self {
        Self {
            color: stable_layer_color(&id, 1.0),
            explicit_color: false,
            id,
            z_index,
            vj_layer_index: None,
            visible: true,
            opacity: 1.0,
            source_kind: 0.0,
            source_id: None,
            effect_input_source_id: None,
            shader_id: None,
            shader_rendered: false,
            render_quality: None,
            preview_slot: None,
            frame_slot: None,
            shader_frame_slot: None,
            shader_source_id: None,
            corners: [[0.0, 1.0], [1.0, 1.0], [1.0, 0.0], [0.0, 0.0]],
            corner_perspective: false,
            native_params: default_native_params(),
            blend_code: 0.0,
            uv0: [0.0, 0.0, 1.0, 1.0],
            uv1: [0.0, 1.0, 0.0, 0.0],
            shape: [0.0, 0.0, 0.0, 1.0],
            shape2: [1.0, 0.7, 6.0, 0.4],
            shape_meta: [0.0, 0.0, 0.0, 0.0],
            shape_pts: Vec::new(),
            effects: [[0.0; 4]; 4],
            effect_count: 0.0,
            edge: Box::default(),
            mask_info: [0.0; 4],
            mask_points: Vec::new(),
            mesh_rows: 0,
            mesh_cols: 0,
            mesh_points: Vec::new(),
            mesh_rest: Vec::new(),
            mesh_tangents: Vec::new(),
            source_rect: [0.0, 0.0, 1.0, 1.0],
            deck_monitor_bank: None,
            deck_monitor_opacity: 1.0,
            tint: [1.0; 4],
            dome: None,
            held: None,
        }
    }

    pub(crate) fn gpu(&self) -> LayerGpu {
        let [tl, tr, br, bl] = self.corners;
        let held = self.held.as_ref();
        // Missing media pixels are not a solid-colour source. This also
        // covers a video whose texture was evicted under pool pressure.
        let waiting_for_video = held.is_none()
            && self.source_kind == source_kind("video")
            && self.frame_slot.is_none();
        // Likewise a shader whose pipeline is still building on the worker
        // thread: it shows nothing until its first frame, not a colour block.
        let waiting_for_shader = held.is_none()
            && self.shader_id.is_some()
            && !self.shader_rendered
            && !self.explicit_color
            && !self.source_id.as_deref().is_some_and(|id| id.starts_with("effect-pass:"));
        // An empty layer (nothing bound, no colour of its own) draws the
        // alignment card instead of a flat fill, so it takes the full path.
        let empty_card = held.is_none() && self.shows_empty_card();
        let plain_fill = held.is_none() && !empty_card && !self.shader_rendered && self.source_kind < 9.0
            && self.frame_slot.is_none() && self.preview_slot.is_none()
            && self.effect_count < 0.5 && self.mesh_rows < 2 && self.mesh_cols < 2
            && self.shape == [0.0, 0.0, 0.0, 1.0] && self.shape2 == [1.0, 0.7, 6.0, 0.4]
            && self.shape_meta == [0.0; 4] && self.mask_info[0] < 0.5
            && !(25.5..26.5).contains(&self.blend_code)
            && !self.has_edge_effects()
            && tl[1] == tr[1] && bl[1] == br[1] && tl[0] == bl[0] && tr[0] == br[0]
            && (br[0] - tl[0]).abs() > 0.000001 && (br[1] - tl[1]).abs() > 0.000001;
        LayerGpu {
            cull: [0.0; 4],
            p0: [
                self.corners[0][0],
                self.corners[0][1],
                self.corners[1][0],
                self.corners[1][1],
            ],
            p1: [
                self.corners[2][0],
                self.corners[2][1],
                self.corners[3][0],
                self.corners[3][1],
            ],
            color: [
                self.color[0],
                self.color[1],
                self.color[2],
                if waiting_for_video || waiting_for_shader { 0.0 } else {
                    self.opacity.clamp(0.0, 1.0) * self.color[3].clamp(0.0, 1.0)
                },
            ],
            meta: [
                if self.visible { 1.0 } else { 0.0 },
                self.z_index as f32,
                if let Some(held) = held {
                    held.kind
                } else if self.shader_rendered {
                    NATIVE_SHADER_SOURCE_KIND
                } else {
                    self.source_kind
                },
                if let Some(held) = held {
                    SOURCE_FRAME_SLOT_OFFSET + held.slot as f32 + 1.0
                } else {
                    self.frame_slot
                        .map(|slot| SOURCE_FRAME_SLOT_OFFSET + slot as f32 + 1.0)
                        .or_else(|| self.preview_slot.map(|slot| slot as f32 + 1.0))
                        .unwrap_or(0.0)
                },
            ],
            params0: [
                self.native_params[0],
                self.native_params[1],
                self.native_params[2],
                self.native_params[3],
            ],
            params1: [
                self.native_params[4],
                self.native_params[5],
                self.native_params[6],
                self.native_params[7],
            ],
            style: [
                self.blend_code,
                self.effect_count,
                self.mesh_rows as f32,
                self.mesh_cols as f32,
            ],
            uv0: self.uv0,
            uv1: self.uv1,
            shape: self.shape,
            shape2: self.shape2,
            shape_meta: self.shape_meta,
            shape_pts: self.shape_pts_gpu(),
            effect0: self.effects[0],
            effect1: self.effects[1],
            effect2: self.effects[2],
            effect3: self.effects[3],
            edge_effects: self.edge.effects_gpu(),
            edge_info: self.edge.info_gpu(),
            edge_geom: self.edge.geometry,
            edge_extra: [self.edge.seed, self.sourceless_content_alpha(), if empty_card { 1.0 } else { 0.0 }, 0.0],
            edge_extra2: self.edge.bbox_gpu(),
            edge_bounds: self.edge.bounds,
            edge_chunks: self.edge.chunks_gpu(),
            edge_corners: self.edge.corners_gpu(),
            edge_diags: self.edge.diagonals_gpu(),
            edge_pts: self.edge.points_gpu(),
            mask_info: self.mask_info,
            mask: self.mask_gpu(),
            mesh: self.mesh_gpu(),
            mesh_rest: self.mesh_rest_gpu(),
            mesh_tangents: self.mesh_tangents_gpu(),
            mesh_bounds: self.mesh_bounds_gpu(),
            source_rect: held.map_or(self.source_rect, |held| held.rect),
            // w bit 1: perspective corner pin (bit 0 is the painted mask's inversion).
            fast_flags: [u32::from(plain_fill), u32::from(self.mesh_is_bezier()), u32::from(self.dome.is_some()), u32::from(self.corner_perspective) << 1],
            tint: [self.tint[0], self.tint[1], self.tint[2], self.color[3].clamp(0.0, 1.0)],
            dome: self.dome.unwrap_or([0.0; 4]),
        }
    }

    /// How strongly a layer with no source draws its own colour.
    ///
    /// An empty layer shows a dimmed placeholder so it reads as "nothing
    /// loaded yet" rather than as content. A colour layer has no source
    /// either -- its colour is its content -- and the shader applied the same
    /// 0.56 to both, so every solid colour went to output at 56%: pure white
    /// arrived as 143/255, on the editor, the output window, Spout and in
    /// recordings alike. Media is unaffected; it takes the sourced path.
    /// True for a layer with nothing bound and no colour of its own: it
    /// shows the alignment card. A layer whose media is still loading keeps
    /// its source kind and does not, so the card never flashes during a load.
    pub(crate) fn shows_empty_card(&self) -> bool {
        !self.explicit_color && !self.shader_rendered && self.source_kind < 0.5
            && self.frame_slot.is_none() && self.preview_slot.is_none()
    }

    pub(crate) fn sourceless_content_alpha(&self) -> f32 {
        if self.explicit_color { 1.0 } else { SOURCELESS_PLACEHOLDER_ALPHA }
    }

    /// A mesh renders as Bezier patches only when it carries a tangent for
    /// every point. Anything else takes the bilinear cell path unchanged.
    pub(crate) fn mesh_is_bezier(&self) -> bool {
        self.mesh_rows >= 2
            && self.mesh_cols >= 2
            && self.mesh_tangents.len() == (self.mesh_rows * self.mesh_cols) as usize
    }

    pub(crate) fn mesh_tangents_gpu(&self) -> [[f32; 4]; MAX_LAYER_MESH_TANGENT_VEC4S] {
        let mut packed = [[0.0; 4]; MAX_LAYER_MESH_TANGENT_VEC4S];
        if !self.mesh_is_bezier() {
            return packed;
        }
        for (index, tangents) in self
            .mesh_tangents
            .iter()
            .take(MAX_LAYER_MESH_POINTS)
            .enumerate()
        {
            let [right, down, left, up] = *tangents;
            // Offsets flip with the points: y-up layer space to the
            // compositor's y-down quad-local space.
            packed[index * 2] = [right[0], -right[1], down[0], -down[1]];
            packed[index * 2 + 1] = [left[0], -left[1], up[0], -up[1]];
        }
        packed
    }

    /// The quad-local rectangle a Bezier mesh's surface can reach. Each cell
    /// is a bicubic patch inside the hull of its 16 control points: the
    /// corners, the eight edge handles and the four inner points of its
    /// Bezier form (the same ones mesh_patch_inner in heartbeat.wgsl builds).
    /// The shader bounds a Bezier layer's pixels by this instead of the
    /// corner quad, so a bulge past the quad keeps its content.
    pub(crate) fn mesh_bounds_gpu(&self) -> [f32; 4] {
        if !self.mesh_is_bezier() {
            return [0.0; 4];
        }
        let rows = self.mesh_rows as usize;
        let cols = self.mesh_cols as usize;
        // Same flip as mesh_gpu / mesh_tangents_gpu: y-up layer space to
        // the compositor's y-down quad-local space.
        let point = |row: usize, col: usize| {
            let p = self.mesh_points[row * cols + col];
            [p[0], 1.0 - p[1]]
        };
        let handle = |row: usize, col: usize, side: usize| {
            let p = point(row, col);
            let t = self.mesh_tangents[row * cols + col][side];
            [p[0] + t[0], p[1] - t[1]]
        };
        let mut lo = [f32::INFINITY; 2];
        let mut hi = [f32::NEG_INFINITY; 2];
        let mut grow = |q: [f32; 2]| {
            lo = [lo[0].min(q[0]), lo[1].min(q[1])];
            hi = [hi[0].max(q[0]), hi[1].max(q[1])];
        };
        let mix = |a: [f32; 2], b: [f32; 2], t: f32| [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
        const RIGHT: usize = 0;
        const DOWN: usize = 1;
        const LEFT: usize = 2;
        const UP: usize = 3;
        for row in 0..rows - 1 {
            for col in 0..cols - 1 {
                let (a, b) = (point(row, col), point(row, col + 1));
                let (c, d) = (point(row + 1, col + 1), point(row + 1, col));
                let top = [handle(row, col, RIGHT), handle(row, col + 1, LEFT)];
                let bottom = [handle(row + 1, col, RIGHT), handle(row + 1, col + 1, LEFT)];
                // Layer-space "down" is the next row, which is further down
                // in quad-local space too once y is flipped.
                let left = [handle(row, col, DOWN), handle(row + 1, col, UP)];
                let right = [handle(row, col + 1, DOWN), handle(row + 1, col + 1, UP)];
                for q in [a, b, c, d, top[0], top[1], bottom[0], bottom[1], left[0], left[1], right[0], right[1]] {
                    grow(q);
                }
                for j in 1..=2usize {
                    for i in 1..=2usize {
                        let (fu, fv) = (i as f32 / 3.0, j as f32 / 3.0);
                        let tb = mix(top[i - 1], bottom[i - 1], fv);
                        let lr = mix(left[j - 1], right[j - 1], fu);
                        let sheet = mix(mix(a, b, fu), mix(d, c, fu), fv);
                        grow([tb[0] + lr[0] - sheet[0], tb[1] + lr[1] - sheet[1]]);
                    }
                }
            }
        }
        [lo[0], lo[1], hi[0], hi[1]]
    }

    pub(crate) fn has_edge_effects(&self) -> bool {
        self.edge.active()
    }

    pub(crate) fn shape_pts_gpu(&self) -> [[f32; 4]; 32] {
        let mut packed = [[0.0; 4]; 32];
        for (index, point) in self.shape_pts.iter().take(32).enumerate() {
            packed[index] = *point;
        }
        packed
    }

    pub(crate) fn mask_gpu(&self) -> [[f32; 4]; MAX_LAYER_MASK_POINTS] {
        let mut packed = [[0.0; 4]; MAX_LAYER_MASK_POINTS];
        for (index, point) in self
            .mask_points
            .iter()
            .take(MAX_LAYER_MASK_POINTS)
            .enumerate()
        {
            packed[index] = *point;
        }
        packed
    }

    pub(crate) fn mesh_gpu(&self) -> [[f32; 4]; MAX_LAYER_MESH_VEC4S] {
        let mut packed = [[0.0; 4]; MAX_LAYER_MESH_VEC4S];
        for (index, point) in self
            .mesh_points
            .iter()
            .take(MAX_LAYER_MESH_POINTS)
            .enumerate()
        {
            let target = &mut packed[index / 2];
            let offset = (index % 2) * 2;
            target[offset] = point[0];
            // Layer mesh points use OpenGL-style y=1 at the top. The native
            // compositor's quad-local coordinate uses y=0 at the top.
            target[offset + 1] = 1.0 - point[1];
        }
        packed
    }

    /// The rest lattice in the compositor's y-down layer space: the grid's
    /// own when it was fitted to a shape, the even lattice otherwise.
    pub(crate) fn mesh_rest_gpu(&self) -> [[f32; 4]; MAX_LAYER_MESH_VEC4S] {
        let mut packed = [[0.0; 4]; MAX_LAYER_MESH_VEC4S];
        let rows = self.mesh_rows as usize;
        let cols = self.mesh_cols as usize;
        if rows < 2 || cols < 2 {
            return packed;
        }
        let fitted = self.mesh_rest.len() == rows * cols;
        for index in 0..(rows * cols).min(MAX_LAYER_MESH_POINTS) {
            let (x, y) = if fitted {
                let p = self.mesh_rest[index];
                (p[0], 1.0 - p[1])
            } else {
                ((index % cols) as f32 / (cols - 1) as f32, (index / cols) as f32 / (rows - 1) as f32)
            };
            let target = &mut packed[index / 2];
            let offset = (index % 2) * 2;
            target[offset] = x;
            target[offset + 1] = y;
        }
        packed
    }
}

/// Parse a `mesh_grid` command value onto a layer: the control points and,
/// for a Bezier mesh, the resolved tangent of every point. A grid the
/// compositor cannot take clears the mesh rather than drawing a partial one.
pub(crate) fn apply_layer_mesh_grid(entry: &mut SceneLayer, mesh: Option<&Value>) {
    entry.mesh_rows = 0;
    entry.mesh_cols = 0;
    entry.mesh_points.clear();
    entry.mesh_rest.clear();
    entry.mesh_tangents.clear();
    let Some(mesh) = mesh.and_then(Value::as_object) else { return };
    let rows = mesh
        .get("rows")
        .and_then(Value::as_u64)
        .unwrap_or(0)
        .clamp(0, MAX_LAYER_MESH_SIDE as u64) as u32;
    let cols = mesh
        .get("cols")
        .and_then(Value::as_u64)
        .unwrap_or(0)
        .clamp(0, MAX_LAYER_MESH_SIDE as u64) as u32;
    let expected = rows.saturating_mul(cols) as usize;
    if rows < 2 || cols < 2 || expected > MAX_LAYER_MESH_POINTS {
        return;
    }
    let mut points = Vec::with_capacity(expected);
    if let Some(point_rows) = mesh.get("points").and_then(Value::as_array) {
        for row in point_rows.iter().take(rows as usize) {
            let Some(row_points) = row.as_array() else {
                break;
            };
            for point in row_points.iter().take(cols as usize) {
                let x = number_at(point, &["x"]);
                let y = number_at(point, &["y"]);
                let (Some(x), Some(y)) = (x, y) else { break };
                points.push([x.clamp(-8.0, 8.0) as f32, y.clamp(-8.0, 8.0) as f32]);
            }
        }
    }
    if points.len() != expected {
        return;
    }
    entry.mesh_rows = rows;
    entry.mesh_cols = cols;
    entry.mesh_tangents = parse_layer_mesh_tangents(mesh.get("tangents"), rows as usize, cols as usize, &points);
    entry.mesh_points = points;
    entry.mesh_rest = parse_layer_mesh_rest(mesh.get("rest"), rows as usize, cols as usize);
}

/// A mesh fitted to a Custom Shape carries `rest`: where each point sits on
/// the layer while unwarped (`[row][col]` of `{x, y}`, y up). Anything short
/// of a full grid is the even lattice, returned as an empty vec.
pub(crate) fn parse_layer_mesh_rest(rest: Option<&Value>, rows: usize, cols: usize) -> Vec<[f32; 2]> {
    let Some(rest_rows) = rest.and_then(Value::as_array) else { return Vec::new() };
    if rest_rows.len() != rows {
        return Vec::new();
    }
    let mut points = Vec::with_capacity(rows * cols);
    for row in rest_rows {
        let Some(row_points) = row.as_array() else { return Vec::new() };
        if row_points.len() != cols {
            return Vec::new();
        }
        for point in row_points {
            let (Some(x), Some(y)) = (number_at(point, &["x"]), number_at(point, &["y"])) else {
                return Vec::new();
            };
            if !x.is_finite() || !y.is_finite() {
                return Vec::new();
            }
            points.push([x.clamp(-8.0, 8.0) as f32, y.clamp(-8.0, 8.0) as f32]);
        }
    }
    points
}

/// Resolve the editor's sparse `tangents` grid (`[row][col]` of
/// `{right, down, left, up}` offsets or null) into an explicit tangent for
/// every point, with the same rules as resolveMeshTangents in
/// src/lib/utils/meshWarp.ts: a stored side wins, a missing side mirrors a
/// stored opposite (linked handles), and an axis with nothing stored keeps a
/// straight edge, i.e. a control point one third along the chord to the
/// neighbour. Returns an empty vec, meaning "not a Bezier mesh", when no
/// point carries a tangent, so a tangent-free grid renders exactly as before.
pub(crate) fn parse_layer_mesh_tangents(
    tangents: Option<&Value>,
    rows: usize,
    cols: usize,
    points: &[[f32; 2]],
) -> Vec<[[f32; 2]; 4]> {
    let Some(tangent_rows) = tangents.and_then(Value::as_array) else { return Vec::new() };
    let stored_at = |row: usize, col: usize, side: &str| -> Option<[f32; 2]> {
        let entry = tangent_rows.get(row)?.as_array()?.get(col)?;
        let side = entry.get(side)?;
        let x = number_at(side, &["x"])?;
        let y = number_at(side, &["y"])?;
        if !x.is_finite() || !y.is_finite() {
            return None;
        }
        Some([x.clamp(-8.0, 8.0) as f32, y.clamp(-8.0, 8.0) as f32])
    };
    let mut any = false;
    let mut resolved = Vec::with_capacity(rows * cols);
    for row in 0..rows {
        for col in 0..cols {
            let point = points[row * cols + col];
            let chord = |r: isize, c: isize| -> [f32; 2] {
                if r < 0 || c < 0 || r as usize >= rows || c as usize >= cols {
                    return [0.0, 0.0];
                }
                let next = points[r as usize * cols + c as usize];
                [(next[0] - point[0]) / 3.0, (next[1] - point[1]) / 3.0]
            };
            let neg = |t: [f32; 2]| [-t[0], -t[1]];
            let right = stored_at(row, col, "right");
            let left = stored_at(row, col, "left");
            let down = stored_at(row, col, "down");
            let up = stored_at(row, col, "up");
            any |= right.is_some() || left.is_some() || down.is_some() || up.is_some();
            let (r, c) = (row as isize, col as isize);
            resolved.push([
                right.or_else(|| left.map(neg)).unwrap_or_else(|| chord(r, c + 1)),
                down.or_else(|| up.map(neg)).unwrap_or_else(|| chord(r + 1, c)),
                left.or_else(|| right.map(neg)).unwrap_or_else(|| chord(r, c - 1)),
                up.or_else(|| down.map(neg)).unwrap_or_else(|| chord(r - 1, c)),
            ]);
        }
    }
    if any { resolved } else { Vec::new() }
}

pub(crate) fn set_scene_layer_color(layer: &mut SceneLayer, rgba: [f32; 4]) {
    layer.color = rgba;
    // The editor only sends this for colour layers, and for media layers
    // that carry a fill colour until they get content (layerRgba returns
    // null for every other type): either way the colour is meant to be seen,
    // not a placeholder card. Bound content replaces it.
    layer.explicit_color = true;
}

/// Strength of an empty layer's placeholder colour. Colour layers draw at 1.0.
pub(crate) const SOURCELESS_PLACEHOLDER_ALPHA: f32 = 0.56;

/// A layer's Edge Effects as the compositor reads them: resolved effect
/// values, the stroke centerline in output px and the per-shape data the
/// structural types use.
#[derive(Clone, Debug, Default)]
pub(crate) struct LayerEdgeEffects {
    pub(crate) effects: Vec<[[f32; 4]; LAYER_EDGE_EFFECT_VEC4S]>,
    /// (x px, y px, arc length px, surface scale)
    pub(crate) points: Vec<[f32; 4]>,
    /// (x px, y px, arc length px, point index)
    pub(crate) corners: Vec<[f32; 4]>,
    pub(crate) diagonals: Vec<[f32; 2]>,
    /// (centroid x, centroid y, perimeter, inradius), px
    pub(crate) geometry: [f32; 4],
    pub(crate) seed: f32,
    /// Output UV rectangle the stack can touch.
    pub(crate) bounds: [f32; 4],
}

impl LayerEdgeEffects {
    pub(crate) fn active(&self) -> bool {
        !self.effects.is_empty() && self.points.len() >= 3
    }

    pub(crate) fn effects_gpu(&self) -> [[[f32; 4]; LAYER_EDGE_EFFECT_VEC4S]; MAX_LAYER_EDGE_EFFECTS] {
        let mut packed = [[[0.0; 4]; LAYER_EDGE_EFFECT_VEC4S]; MAX_LAYER_EDGE_EFFECTS];
        if self.active() {
            for (slot, effect) in packed.iter_mut().zip(self.effects.iter()) {
                *slot = *effect;
            }
        }
        packed
    }

    pub(crate) fn info_gpu(&self) -> [f32; 4] {
        if !self.active() {
            return [0.0; 4];
        }
        [
            self.points.len() as f32,
            self.effects.len() as f32,
            self.corners.len() as f32,
            self.diagonals.len() as f32,
        ]
    }

    pub(crate) fn bbox_gpu(&self) -> [f32; 4] {
        let mut bbox = [f32::MAX, f32::MAX, f32::MIN, f32::MIN];
        for point in &self.points {
            bbox[0] = bbox[0].min(point[0]);
            bbox[1] = bbox[1].min(point[1]);
            bbox[2] = bbox[2].max(point[0]);
            bbox[3] = bbox[3].max(point[1]);
        }
        if self.points.is_empty() { [0.0; 4] } else { bbox }
    }

    /// Bounds of each run of 16 segments (segment i joins point i to i + 1,
    /// the last one closes the outline).
    pub(crate) fn chunks_gpu(&self) -> [[f32; 4]; MAX_LAYER_EDGE_CHUNKS] {
        let mut chunks = [[0.0; 4]; MAX_LAYER_EDGE_CHUNKS];
        let count = self.points.len();
        if count < 3 {
            return chunks;
        }
        for (chunk_index, chunk) in chunks.iter_mut().enumerate() {
            let start = chunk_index * LAYER_EDGE_CHUNK;
            if start >= count {
                break;
            }
            let mut bbox = [f32::MAX, f32::MAX, f32::MIN, f32::MIN];
            for index in start..(start + LAYER_EDGE_CHUNK).min(count) {
                for point in [self.points[index], self.points[(index + 1) % count]] {
                    bbox[0] = bbox[0].min(point[0]);
                    bbox[1] = bbox[1].min(point[1]);
                    bbox[2] = bbox[2].max(point[0]);
                    bbox[3] = bbox[3].max(point[1]);
                }
            }
            *chunk = bbox;
        }
        chunks
    }

    pub(crate) fn corners_gpu(&self) -> [[f32; 4]; MAX_LAYER_EDGE_CORNERS] {
        let mut packed = [[0.0; 4]; MAX_LAYER_EDGE_CORNERS];
        for (slot, corner) in packed.iter_mut().zip(self.corners.iter()) {
            *slot = *corner;
        }
        packed
    }

    pub(crate) fn diagonals_gpu(&self) -> [[f32; 4]; MAX_LAYER_EDGE_DIAGONALS / 2] {
        let mut packed = [[0.0; 4]; MAX_LAYER_EDGE_DIAGONALS / 2];
        for (index, pair) in self.diagonals.iter().enumerate() {
            packed[index / 2][(index % 2) * 2] = pair[0];
            packed[index / 2][(index % 2) * 2 + 1] = pair[1];
        }
        packed
    }

    pub(crate) fn points_gpu(&self) -> [[f32; 4]; MAX_LAYER_EDGE_POINTS] {
        let mut packed = [[0.0; 4]; MAX_LAYER_EDGE_POINTS];
        for (slot, point) in packed.iter_mut().zip(self.points.iter()) {
            *slot = *point;
        }
        packed
    }
}

/// `set_layer_edge_effects`: up to 16 effects of 22 resolved vec4s each and
/// the stroke centerline they are drawn on (output px, y up, up to 512
/// points with arc length and surface scale), its corners and inner
/// diagonals, (centroid, perimeter, inradius), a seed, and the output UV
/// rectangle the stack can touch. Without a centerline nothing renders:
/// there is no edge to draw on.
pub(crate) fn parse_layer_edge_effects(command: &Value) -> LayerEdgeEffects {
    let mut parsed = LayerEdgeEffects::default();
    let finite = |value: Option<&Value>, limit: f64| {
        value
            .and_then(Value::as_f64)
            .filter(|value| value.is_finite())
            .unwrap_or(0.0)
            .clamp(-limit, limit) as f32
    };
    let vec4_at = |value: &Value, limit: f64| -> [f32; 4] {
        let mut out = [0.0f32; 4];
        if let Some(values) = value.as_array() {
            for (component, slot) in out.iter_mut().enumerate() {
                *slot = finite(values.get(component), limit);
            }
        }
        out
    };
    if let Some(effects) = command.get("edge_effects").and_then(Value::as_array) {
        for effect in effects.iter() {
            if parsed.effects.len() >= MAX_LAYER_EDGE_EFFECTS {
                break;
            }
            let Some(vectors) = effect.as_array() else {
                continue;
            };
            let mut packed = [[0.0f32; 4]; LAYER_EDGE_EFFECT_VEC4S];
            for (vector_index, vector) in vectors.iter().take(LAYER_EDGE_EFFECT_VEC4S).enumerate() {
                packed[vector_index] = vec4_at(vector, 1.0e6);
            }
            if packed[0][0] < 0.5 {
                continue;
            }
            parsed.effects.push(packed);
        }
    }
    if let Some(points) = command.get("edge_outline").and_then(Value::as_array) {
        for point in points.iter().take(MAX_LAYER_EDGE_POINTS) {
            let mut value = vec4_at(point, 1.0e6);
            if point.as_array().map(|values| values.len() < 4).unwrap_or(true) {
                value[3] = 1.0;
            }
            parsed.points.push(value);
        }
    }
    let count = parsed.points.len();
    if let Some(corners) = command.get("edge_corners").and_then(Value::as_array) {
        for corner in corners.iter().take(MAX_LAYER_EDGE_CORNERS) {
            parsed.corners.push(vec4_at(corner, 1.0e6));
        }
    }
    if let Some(diagonals) = command.get("edge_diagonals").and_then(Value::as_array) {
        let corners = parsed.corners.len() as f32;
        for pair in diagonals.iter().take(MAX_LAYER_EDGE_DIAGONALS) {
            let value = vec4_at(pair, 1.0e6);
            let (a, b) = (value[0].round(), value[1].round());
            if a >= 0.0 && b >= 0.0 && a < corners && b < corners {
                parsed.diagonals.push([a, b]);
            }
        }
    }
    if let Some(geometry) = command.get("edge_geometry") {
        parsed.geometry = vec4_at(geometry, 1.0e6);
    }
    parsed.seed = finite(command.get("edge_seed"), 1.0e6);
    if let Some(bounds) = command.get("edge_bounds") {
        let bounds = vec4_at(bounds, 5.0);
        parsed.bounds = [bounds[0].max(-4.0), bounds[1].max(-4.0), bounds[2], bounds[3]];
    }
    if count < 3 {
        parsed.effects.clear();
        parsed.points.clear();
        parsed.corners.clear();
        parsed.diagonals.clear();
    }
    parsed
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn layer_tint_carries_the_content_alpha_for_edge_effects() {
        let mut layer = SceneLayer::new("tinted".to_string(), 0);
        set_scene_layer_color(&mut layer, [0.3, 0.34, 0.42, 0.35]);
        layer.tint = [0.0, 1.0, 0.5, 1.0];
        let gpu = layer.gpu();
        assert_eq!(gpu.tint, [0.0, 1.0, 0.5, 0.35]);
        assert!((gpu.color[3] - 0.35).abs() < 1e-6);
    }

    #[test]
    fn edge_effect_payload_keeps_sixteen_active_effects_and_their_outline() {
        let effect = |active: f32, tag: f32| {
            let mut vectors = vec![vec![active, 1.0, 0.0, 2.0]];
            for index in 1..LAYER_EDGE_EFFECT_VEC4S {
                vectors.push(vec![tag, index as f32, 0.0, 0.0]);
            }
            vectors
        };
        let mut effects = Vec::new();
        for index in 0..20 {
            // Every fifth one is inactive and must not take a slot.
            effects.push(effect(if index % 5 == 4 { 0.0 } else { 1.0 }, index as f32));
        }
        // A 40-point outline: three chunks of up to 16 segments.
        let outline: Vec<Vec<f64>> = (0..40)
            .map(|i| {
                let a = i as f64 / 40.0 * std::f64::consts::TAU;
                vec![100.0 + 50.0 * a.cos(), 80.0 + 50.0 * a.sin(), i as f64 * 7.8, 1.0]
            })
            .collect();
        let command = json!({
            "layer_id": "edge",
            "edge_effects": effects,
            "edge_outline": outline,
            "edge_corners": [[150.0, 80.0, 0.0, 0.0], [100.0, 130.0, 78.0, 10.0], [50.0, 80.0, 156.0, 20.0]],
            "edge_diagonals": [[0, 2], [1, 9]],
            "edge_geometry": [100.0, 80.0, 312.0, 45.0],
            "edge_seed": 7.0,
            "edge_bounds": [0.0, 0.0, 1.0, 1.0],
        });
        let parsed = parse_layer_edge_effects(&command);
        assert_eq!(parsed.effects.len(), 16);
        // Effects 4, 9 and 14 are skipped, so slot 15 holds effect 18.
        assert_eq!(parsed.effects[15][1][0], 18.0);
        assert_eq!(parsed.effects[4][1][0], 5.0);
        assert_eq!(parsed.effects[3][21][1], 21.0);
        assert_eq!(parsed.points.len(), 40);
        assert_eq!(parsed.diagonals, vec![[0.0, 2.0]], "a pair naming a missing corner is dropped");

        let mut layer = SceneLayer::new("edge".to_string(), 0);
        layer.edge = Box::new(parsed);
        let gpu = layer.gpu();
        assert_eq!(gpu.edge_info, [40.0, 16.0, 3.0, 1.0]);
        assert_eq!(gpu.edge_geom, [100.0, 80.0, 312.0, 45.0]);
        assert_eq!(gpu.edge_extra[0], 7.0);
        // The third chunk holds segments 32..39, the last closing back to point 0.
        let chunk = gpu.edge_chunks[2];
        assert!(chunk[2] >= 150.0 - 1e-3, "closing segment reaches point 0 at x = 150");
        assert_eq!(gpu.edge_chunks[3], [0.0; 4]);
        assert_eq!(gpu.fast_flags[0], 0, "a layer with edge effects never takes the plain-fill path");

        let no_outline = parse_layer_edge_effects(&json!({ "layer_id": "edge", "edge_effects": [effect(1.0, 0.0)] }));
        assert!(!no_outline.active(), "effects without an outline have nothing to draw on");
    }

    #[test]
    fn layer_color_updates_do_not_reclassify_source_kind() {
        let mut layer = SceneLayer::new("gpu-layer".to_string(), 0);
        layer.source_kind = source_kind("gpu:ink-cloud");

        set_scene_layer_color(&mut layer, [0.25, 0.5, 0.75, 0.8]);

        assert_eq!(layer.color, [0.25, 0.5, 0.75, 0.8]);
        assert_eq!(layer.source_kind, source_kind("gpu:ink-cloud"));
    }

    #[test]
    fn scene_layer_gpu_packs_mesh_points_in_compositor_coordinates() {
        let mut layer = SceneLayer::new("mesh-layer".to_string(), 0);
        layer.mesh_rows = 2;
        layer.mesh_cols = 2;
        layer.mesh_points = vec![[0.0, 1.0], [1.0, 1.0], [0.1, 0.0], [0.9, 0.0]];

        let gpu = layer.gpu();
        assert_eq!(gpu.style[2], 2.0);
        assert_eq!(gpu.style[3], 2.0);
        assert_eq!(gpu.mesh[0], [0.0, 0.0, 1.0, 0.0]);
        assert_eq!(gpu.mesh[1], [0.1, 1.0, 0.9, 1.0]);
        // No tangents: not a Bezier mesh, so the shader keeps the bilinear path.
        assert_eq!(gpu.fast_flags[1], 0);
        assert!(gpu.mesh_tangents.iter().all(|v| *v == [0.0; 4]));
        // No rest of its own: cells show an even share of the whole layer.
        assert_eq!(gpu.mesh_rest[0], [0.0, 0.0, 1.0, 0.0]);
        assert_eq!(gpu.mesh_rest[1], [0.0, 1.0, 1.0, 1.0]);
    }

    /// A mesh fitted to a Custom Shape carries `rest`, where each point sits
    /// on the layer: the compositor's cells show that part of the layer
    /// (y flipped like the points). A partial or malformed rest is the even
    /// lattice, so an odd grid never shows a scrambled picture.
    #[test]
    fn scene_layer_mesh_rest_packs_the_fitted_lattice() {
        let mut layer = SceneLayer::new("fitted-layer".to_string(), 0);
        let grid = serde_json::json!({
            "rows": 2, "cols": 3,
            "points": [
                [{"x": 0.2, "y": 0.8}, {"x": 0.4, "y": 0.8}, {"x": 0.6, "y": 0.8}],
                [{"x": 0.2, "y": 0.3}, {"x": 0.4, "y": 0.3}, {"x": 0.6, "y": 0.3}],
            ],
            "rest": [
                [{"x": 0.2, "y": 0.8}, {"x": 0.4, "y": 0.8}, {"x": 0.6, "y": 0.8}],
                [{"x": 0.2, "y": 0.3}, {"x": 0.4, "y": 0.3}, {"x": 0.6, "y": 0.3}],
            ],
        });
        apply_layer_mesh_grid(&mut layer, Some(&grid));
        assert_eq!(layer.mesh_rest.len(), 6);
        let gpu = layer.gpu();
        let close = |a: [f32; 4], b: [f32; 4]| a.iter().zip(b).all(|(x, y)| (x - y).abs() < 1e-6);
        assert!(close(gpu.mesh_rest[0], [0.2, 0.2, 0.4, 0.2]), "{:?}", gpu.mesh_rest[0]);
        assert!(close(gpu.mesh_rest[1], [0.6, 0.2, 0.2, 0.7]), "{:?}", gpu.mesh_rest[1]);
        assert!(close(gpu.mesh_rest[2], [0.4, 0.7, 0.6, 0.7]), "{:?}", gpu.mesh_rest[2]);

        let partial = serde_json::json!({
            "rows": 2, "cols": 2,
            "points": [[{"x": 0.0, "y": 1.0}, {"x": 1.0, "y": 1.0}], [{"x": 0.0, "y": 0.0}, {"x": 1.0, "y": 0.0}]],
            "rest": [[{"x": 0.2, "y": 0.8}, {"x": 0.6, "y": 0.8}]],
        });
        apply_layer_mesh_grid(&mut layer, Some(&partial));
        assert!(layer.mesh_rest.is_empty());
        assert_eq!(layer.gpu().mesh_rest[1], [0.0, 1.0, 1.0, 1.0]);
    }

    /// Sparse editor tangents resolve like resolveMeshTangents in
    /// meshWarp.ts: stored sides win, a missing opposite mirrors (linked
    /// handles), and untouched axes fall back to a straight edge. The
    /// packed offsets flip y with the points. A grid whose `tangents` carry
    /// nothing must stay a plain mesh so old projects render unchanged.
    #[test]
    fn scene_layer_mesh_tangents_resolve_and_pack_for_the_bezier_path() {
        let mut layer = SceneLayer::new("bezier-layer".to_string(), 0);
        let grid = serde_json::json!({
            "rows": 2, "cols": 3,
            "points": [
                [{"x": 0.0, "y": 1.0}, {"x": 0.5, "y": 1.0}, {"x": 1.0, "y": 1.0}],
                [{"x": 0.0, "y": 0.0}, {"x": 0.5, "y": 0.0}, {"x": 1.0, "y": 0.0}],
            ],
            "tangents": [
                [null, {"right": {"x": 0.1, "y": 0.2}}, null],
                [null, {"right": {"x": 0.1, "y": 0.0}, "left": {"x": -0.05, "y": 0.3}, "up": {"x": 0.0, "y": 0.25}}, null],
            ],
        });
        apply_layer_mesh_grid(&mut layer, Some(&grid));
        assert_eq!((layer.mesh_rows, layer.mesh_cols), (2, 3));
        assert_eq!(layer.mesh_tangents.len(), 6);
        // Top-middle: right stored, left mirrors it, down/up are chord thirds.
        assert_eq!(layer.mesh_tangents[1], [[0.1, 0.2], [0.0, -1.0 / 3.0], [-0.1, -0.2], [0.0, 0.0]]);
        // Bottom-middle: unlinked left, stored up mirrored into down.
        assert_eq!(layer.mesh_tangents[4], [[0.1, 0.0], [0.0, -0.25], [-0.05, 0.3], [0.0, 0.25]]);
        // Top-left corner: nothing stored, straight edges toward its neighbours.
        assert_eq!(layer.mesh_tangents[0], [[0.5 / 3.0, 0.0], [0.0, -1.0 / 3.0], [0.0, 0.0], [0.0, 0.0]]);

        let gpu = layer.gpu();
        assert_eq!(gpu.fast_flags[1], 1);
        assert_eq!(gpu.mesh_tangents[2], [0.1, -0.2, 0.0, 1.0 / 3.0]);
        assert_eq!(gpu.mesh_tangents[3], [-0.1, 0.2, 0.0, 0.0]);

        let empty = serde_json::json!({
            "rows": 2, "cols": 2,
            "points": [[{"x": 0.0, "y": 1.0}, {"x": 1.0, "y": 1.0}], [{"x": 0.0, "y": 0.0}, {"x": 1.0, "y": 0.0}]],
            "tangents": [[null, null], [null, {}]],
        });
        apply_layer_mesh_grid(&mut layer, Some(&empty));
        assert_eq!((layer.mesh_rows, layer.mesh_cols), (2, 2));
        assert!(layer.mesh_tangents.is_empty());
        assert_eq!(layer.gpu().fast_flags[1], 0);
    }

    /// A Bezier mesh whose top edge bulges above the corner quad has to hand
    /// the shader a reach that holds the bulge, or the compositor clips the
    /// content at the quad while the Edge Effect outline follows the curve.
    #[test]
    fn scene_layer_bezier_mesh_bounds_hold_a_bulge_past_the_corner_quad() {
        let mut layer = SceneLayer::new("bulge-layer".to_string(), 0);
        let grid = serde_json::json!({
            "rows": 2, "cols": 2,
            "points": [[{"x": 0.0, "y": 1.0}, {"x": 1.0, "y": 1.0}], [{"x": 0.0, "y": 0.0}, {"x": 1.0, "y": 0.0}]],
            "tangents": [
                [{"right": {"x": 0.3, "y": 0.3}}, {"left": {"x": -0.3, "y": 0.3}}],
                [null, null],
            ],
        });
        apply_layer_mesh_grid(&mut layer, Some(&grid));
        let gpu = layer.gpu();
        assert_eq!(gpu.fast_flags[1], 1);
        let [min_u, min_v, max_u, max_v] = gpu.mesh_bounds;
        // Layer y-up +0.3 is quad-local y-down -0.3: the handles lift the top
        // edge above v = 0, and nothing reaches past the other three sides.
        assert!((min_v + 0.3).abs() < 1e-6, "min v {min_v}");
        assert!(min_u.abs() < 1e-6 && (max_u - 1.0).abs() < 1e-6 && (max_v - 1.0).abs() < 1e-6, "{:?}", gpu.mesh_bounds);

        // A straight mesh keeps the corner quad and never reads the bounds.
        let straight = serde_json::json!({
            "rows": 2, "cols": 2,
            "points": [[{"x": 0.0, "y": 1.0}, {"x": 1.0, "y": 1.0}], [{"x": 0.0, "y": 0.0}, {"x": 1.0, "y": 0.0}]],
        });
        apply_layer_mesh_grid(&mut layer, Some(&straight));
        assert_eq!(layer.gpu().mesh_bounds, [0.0; 4]);
    }
}
