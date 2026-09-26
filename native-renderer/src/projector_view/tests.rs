//! Projector-view render test: a textured cube seen by one projector while
//! a second lens lays the content onto it. The GPU image is compared with
//! a CPU ray cast that only uses the pinhole model (basis, focal length,
//! principal point) and analytic box intersections, never the 4x4 matrices
//! the renderer consumes, so a convention slip on either side shows up.
use super::*;
use serde_json::json;

const W: u32 = 384;
const H: u32 = 216;
const CONTENT: u32 = 256;

type V3 = [f64; 3];

fn sub(a: V3, b: V3) -> V3 { [a[0] - b[0], a[1] - b[1], a[2] - b[2]] }
fn add(a: V3, b: V3) -> V3 { [a[0] + b[0], a[1] + b[1], a[2] + b[2]] }
fn mul(a: V3, s: f64) -> V3 { [a[0] * s, a[1] * s, a[2] * s] }
fn dot(a: V3, b: V3) -> f64 { a[0] * b[0] + a[1] * b[1] + a[2] * b[2] }
fn cross(a: V3, b: V3) -> V3 { [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]] }
fn norm(a: V3) -> V3 { let l = dot(a, a).sqrt(); mul(a, 1.0 / l) }

/// A projector lens, as the editor describes it.
#[derive(Clone)]
struct Lens {
    id: &'static str,
    position: V3,
    target: V3,
    roll_deg: f64,
    fov_deg: f64,
    aspect: f64,
    shift: [f64; 2],
    near: f64,
    far: f64,
    crop: [f64; 4],
    blend: [f64; 4],
    content_from: Option<&'static str>,
}

impl Lens {
    /// GL camera basis: x right, y up, z backwards (Map Sim's projectorBasis).
    fn basis(&self) -> (V3, V3, V3) {
        let z = norm(sub(self.position, self.target));
        let x = norm(cross([0.0, 1.0, 0.0], z));
        let y = cross(z, x);
        let (s, c) = self.roll_deg.to_radians().sin_cos();
        (add(mul(x, c), mul(y, s)), add(mul(x, -s), mul(y, c)), z)
    }

    fn view_matrix(&self) -> [f64; 16] {
        let (x, y, z) = self.basis();
        let p = self.position;
        [
            x[0], y[0], z[0], 0.0,
            x[1], y[1], z[1], 0.0,
            x[2], y[2], z[2], 0.0,
            -dot(x, p), -dot(y, p), -dot(z, p), 1.0,
        ]
    }

    fn ndc_intrinsics(&self) -> (f64, f64, f64, f64) {
        let fyn = 1.0 / (self.fov_deg.to_radians() / 2.0).tan();
        (fyn / self.aspect, fyn, -2.0 * self.shift[0], -2.0 * self.shift[1])
    }

    fn projection_matrix(&self) -> [f64; 16] {
        let (fxn, fyn, ox, oy) = self.ndc_intrinsics();
        let (n, f) = (self.near, self.far);
        [
            fxn, 0.0, 0.0, 0.0,
            0.0, fyn, 0.0, 0.0,
            -ox, -oy, -(f + n) / (f - n), -1.0,
            0.0, 0.0, -2.0 * f * n / (f - n), 0.0,
        ]
    }

    fn json(&self) -> Value {
        json!({
            "id": self.id,
            "view": self.view_matrix().to_vec(),
            "projection": self.projection_matrix().to_vec(),
            "position": self.position.to_vec(),
            "near": self.near,
            "far": self.far,
            "crop": self.crop.to_vec(),
            "blend": self.blend.to_vec(),
            "content_from": self.content_from,
        })
    }

    /// Pixel pinhole model for an image of w x h: rays and projections in
    /// the computer-vision camera (x right, y down, z forward).
    fn ray(&self, px: f64, py: f64, w: f64, h: f64) -> V3 {
        let (x, y, z) = self.basis();
        let (_, fyn, ox, oy) = self.ndc_intrinsics();
        let f = h / 2.0 * fyn;
        let cx = w / 2.0 * (1.0 + ox);
        let cy = h / 2.0 * (1.0 - oy);
        let d = [(px - cx) / f, (py - cy) / f, 1.0];
        // Camera axes in world: x, down = -y, forward = -z.
        norm(add(add(mul(x, d[0]), mul(y, -d[1])), mul(z, -d[2])))
    }

    /// Normalised image position (u right, v down) of a world point, and
    /// its depth along the lens axis.
    fn project(&self, p: V3) -> Option<(f64, f64, f64)> {
        let (x, y, z) = self.basis();
        let d = sub(p, self.position);
        let (xc, yc, zc) = (dot(d, x), -dot(d, y), -dot(d, z));
        if zc <= 1e-9 {
            return None;
        }
        let (fxn, fyn, ox, oy) = self.ndc_intrinsics();
        let ndc_x = fxn * xc / zc + ox;
        let ndc_y = -fyn * yc / zc + oy;
        Some((ndc_x * 0.5 + 0.5, 0.5 - ndc_y * 0.5, zc))
    }
}

/// An oriented box: centre, yaw about +Y, half extents.
#[derive(Clone, Copy)]
struct Block {
    centre: V3,
    yaw_deg: f64,
    half: V3,
    receive: bool,
}

impl Block {
    fn axes(&self) -> [V3; 3] {
        let (s, c) = self.yaw_deg.to_radians().sin_cos();
        // Rotation about Y (right-handed): x -> (c, 0, -s), z -> (s, 0, c).
        [[c, 0.0, -s], [0.0, 1.0, 0.0], [s, 0.0, c]]
    }

    /// Column-major model matrix: translate * rotateY * scale(2 * half) on
    /// a unit cube centred at the origin.
    fn model(&self) -> [f64; 16] {
        let a = self.axes();
        let s = mul(self.half, 2.0);
        [
            a[0][0] * s[0], a[0][1] * s[0], a[0][2] * s[0], 0.0,
            a[1][0] * s[1], a[1][1] * s[1], a[1][2] * s[1], 0.0,
            a[2][0] * s[2], a[2][1] * s[2], a[2][2] * s[2], 0.0,
            self.centre[0], self.centre[1], self.centre[2], 1.0,
        ]
    }

    /// Nearest ray hit: distance, world normal and a face id.
    fn hit(&self, origin: V3, dir: V3) -> Option<(f64, V3, usize)> {
        let axes = self.axes();
        let o = sub(origin, self.centre);
        let (mut t_near, mut t_far) = (f64::NEG_INFINITY, f64::INFINITY);
        let mut near_face = 0;
        for i in 0..3 {
            let oi = dot(o, axes[i]);
            let di = dot(dir, axes[i]);
            if di.abs() < 1e-12 {
                if oi.abs() > self.half[i] { return None; }
                continue;
            }
            let (mut t0, mut t1) = ((-self.half[i] - oi) / di, (self.half[i] - oi) / di);
            let mut face = i * 2;
            if t0 > t1 { std::mem::swap(&mut t0, &mut t1); face += 1; }
            if t0 > t_near { t_near = t0; near_face = face; }
            t_far = t_far.min(t1);
            if t_near > t_far { return None; }
        }
        if t_near <= 1e-9 { return None; }
        let axis = near_face / 2;
        // face even: entered through the -axis side.
        let normal = if near_face % 2 == 0 { mul(axes[axis], -1.0) } else { axes[axis] };
        Some((t_near, normal, near_face))
    }
}

/// Unit cube, 24 vertices with face normals, counter-clockwise outside.
fn unit_cube() -> ProjectorViewMeshData {
    let mut positions = Vec::new();
    let mut normals = Vec::new();
    let mut indices = Vec::new();
    let faces: [(V3, V3, V3); 6] = [
        ([1.0, 0.0, 0.0], [0.0, 0.0, -1.0], [0.0, 1.0, 0.0]),
        ([-1.0, 0.0, 0.0], [0.0, 0.0, 1.0], [0.0, 1.0, 0.0]),
        ([0.0, 1.0, 0.0], [1.0, 0.0, 0.0], [0.0, 0.0, -1.0]),
        ([0.0, -1.0, 0.0], [1.0, 0.0, 0.0], [0.0, 0.0, 1.0]),
        ([0.0, 0.0, 1.0], [1.0, 0.0, 0.0], [0.0, 1.0, 0.0]),
        ([0.0, 0.0, -1.0], [-1.0, 0.0, 0.0], [0.0, 1.0, 0.0]),
    ];
    for (n, u, v) in faces {
        let base = (positions.len() / 3) as u32;
        for (a, b) in [(-1.0, -1.0), (1.0, -1.0), (1.0, 1.0), (-1.0, 1.0)] {
            let p = add(mul(n, 0.5), add(mul(u, 0.5 * a), mul(v, 0.5 * b)));
            positions.extend(p.iter().map(|&c| c as f32));
            normals.extend(n.iter().map(|&c| c as f32));
        }
        indices.extend([base, base + 1, base + 2, base, base + 2, base + 3]);
    }
    ProjectorViewMeshData { positions, normals, indices }
}

fn b64_f32(values: &[f32]) -> String {
    base64::engine::general_purpose::STANDARD.encode(bytemuck::cast_slice(values))
}

fn b64_u32(values: &[u32]) -> String {
    base64::engine::general_purpose::STANDARD.encode(bytemuck::cast_slice(values))
}

/// Content: a gradient with a checker on top, so a flipped or shifted
/// mapping cannot pass by accident.
fn content_texel(x: u32, y: u32) -> [u8; 4] {
    let checker = ((x / 32) + (y / 32)) % 2 == 0;
    [x as u8, y as u8, if checker { 60 } else { 200 }, 255]
}

/// Bilinear, clamp-to-edge sample of the content (what the GPU sampler does).
fn sample_content(u: f64, v: f64) -> [f64; 3] {
    let n = CONTENT as f64;
    let fx = u * n - 0.5;
    let fy = v * n - 0.5;
    let x0 = fx.floor();
    let y0 = fy.floor();
    let (tx, ty) = (fx - x0, fy - y0);
    let texel = |x: f64, y: f64| {
        let xi = x.clamp(0.0, n - 1.0) as u32;
        let yi = y.clamp(0.0, n - 1.0) as u32;
        let t = content_texel(xi, yi);
        [t[0] as f64, t[1] as f64, t[2] as f64]
    };
    let (a, b, c, d) = (texel(x0, y0), texel(x0 + 1.0, y0), texel(x0, y0 + 1.0), texel(x0 + 1.0, y0 + 1.0));
    let mut out = [0.0; 3];
    for i in 0..3 {
        let top = a[i] * (1.0 - tx) + b[i] * tx;
        let bottom = c[i] * (1.0 - tx) + d[i] * tx;
        out[i] = top * (1.0 - ty) + bottom * ty;
    }
    out
}

fn smoothstep(e0: f64, e1: f64, x: f64) -> f64 {
    let t = ((x - e0) / (e1 - e0)).clamp(0.0, 1.0);
    t * t * (3.0 - 2.0 * t)
}

fn edge_fade(u: f64, v: f64, blend: [f64; 4]) -> f64 {
    let ramp = |width: f64, x: f64| if width > 0.0001 { smoothstep(0.0, width, x) } else { 1.0 };
    ramp(blend[0], u).min(ramp(blend[1], 1.0 - u)).min(ramp(blend[2], v)).min(ramp(blend[3], 1.0 - v)).clamp(0.0, 1.0)
}

#[derive(Clone, Copy, PartialEq, Debug)]
enum Class {
    Background,
    /// Not reached by the mapping lens: outside its frame or facing away.
    Unmapped(usize, usize),
    /// Hidden from the mapping lens by another surface.
    Occluded(usize, usize),
    Lit(usize, usize),
    NotReceiving(usize, usize),
}

fn nearest_hit(blocks: &[Block], origin: V3, dir: V3) -> Option<(f64, V3, usize, usize)> {
    blocks
        .iter()
        .enumerate()
        .filter_map(|(i, block)| block.hit(origin, dir).map(|(t, n, face)| (t, n, i, face)))
        .min_by(|a, b| a.0.partial_cmp(&b.0).unwrap())
}

/// The CPU expectation for one output pixel centre.
fn reference(blocks: &[Block], out: &Lens, map: &Lens, px: f64, py: f64) -> (Class, [f64; 3]) {
    let Some((t, normal, block, face)) = nearest_hit(blocks, out.position, out.ray(px, py, W as f64, H as f64)) else {
        return (Class::Background, [0.0; 3]);
    };
    if !blocks[block].receive {
        return (Class::NotReceiving(block, face), [0.0; 3]);
    }
    let point = add(out.position, mul(out.ray(px, py, W as f64, H as f64), t));
    let Some((u, v, _)) = map.project(point).filter(|(u, v, _)| (0.0..=1.0).contains(u) && (0.0..=1.0).contains(v)) else {
        return (Class::Unmapped(block, face), [0.0; 3]);
    };
    let to_map = sub(map.position, point);
    let distance = dot(to_map, to_map).sqrt();
    let facing = smoothstep(0.01, 0.08, dot(normal, mul(to_map, 1.0 / distance)));
    if facing <= 0.0 {
        return (Class::Unmapped(block, face), [0.0; 3]);
    }
    if map.id != out.id {
        if let Some((t_map, _, other, other_face)) = nearest_hit(blocks, map.position, mul(to_map, -1.0 / distance)) {
            if t_map < distance - 0.02 && (other, other_face) != (block, face) {
                return (Class::Occluded(block, face), [0.0; 3]);
            }
        }
    }
    let edge = edge_fade((px) / W as f64, (py) / H as f64, out.blend);
    let tex = sample_content(map.crop[0] + u * map.crop[2], map.crop[1] + v * map.crop[3]);
    (Class::Lit(block, face), tex.map(|c| c * facing * edge))
}

fn device() -> Option<(wgpu::Device, wgpu::Queue)> {
    let instance = wgpu::Instance::new(wgpu::InstanceDescriptor::new_without_display_handle());
    let adapter = pollster::block_on(instance.request_adapter(&wgpu::RequestAdapterOptions {
        power_preference: wgpu::PowerPreference::HighPerformance,
        force_fallback_adapter: false,
        compatible_surface: None,
        apply_limit_buckets: false,
    }))
    .ok()?;
    pollster::block_on(adapter.request_device(&wgpu::DeviceDescriptor::default())).ok()
}

fn content_texture(device: &wgpu::Device, queue: &wgpu::Queue) -> wgpu::Texture {
    let mut data = Vec::with_capacity((CONTENT * CONTENT * 4) as usize);
    for y in 0..CONTENT {
        for x in 0..CONTENT {
            data.extend(content_texel(x, y));
        }
    }
    device.create_texture_with_data(
        queue,
        &wgpu::TextureDescriptor {
            label: Some("test content"),
            size: wgpu::Extent3d { width: CONTENT, height: CONTENT, depth_or_array_layers: 1 },
            mip_level_count: 1,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format: wgpu::TextureFormat::Rgba8Unorm,
            usage: wgpu::TextureUsages::TEXTURE_BINDING,
            view_formats: &[],
        },
        wgpu::util::TextureDataOrder::LayerMajor,
        &data,
    )
}

fn read_rgba(device: &wgpu::Device, queue: &wgpu::Queue, texture: &wgpu::Texture) -> Vec<u8> {
    let row = (W * 4).div_ceil(wgpu::COPY_BYTES_PER_ROW_ALIGNMENT) * wgpu::COPY_BYTES_PER_ROW_ALIGNMENT;
    let buffer = device.create_buffer(&wgpu::BufferDescriptor {
        label: Some("test readback"),
        size: (row * H) as u64,
        usage: wgpu::BufferUsages::COPY_DST | wgpu::BufferUsages::MAP_READ,
        mapped_at_creation: false,
    });
    let mut encoder = device.create_command_encoder(&wgpu::CommandEncoderDescriptor::default());
    encoder.copy_texture_to_buffer(
        wgpu::TexelCopyTextureInfo { texture, mip_level: 0, origin: wgpu::Origin3d::ZERO, aspect: wgpu::TextureAspect::All },
        wgpu::TexelCopyBufferInfo {
            buffer: &buffer,
            layout: wgpu::TexelCopyBufferLayout { offset: 0, bytes_per_row: Some(row), rows_per_image: Some(H) },
        },
        wgpu::Extent3d { width: W, height: H, depth_or_array_layers: 1 },
    );
    queue.submit(Some(encoder.finish()));
    let slice = buffer.slice(..);
    let (tx, rx) = std::sync::mpsc::channel();
    slice.map_async(wgpu::MapMode::Read, move |result| {
        let _ = tx.send(result);
    });
    device.poll(wgpu::PollType::wait_indefinitely()).unwrap();
    rx.recv().unwrap().unwrap();
    let mapped = slice.get_mapped_range().unwrap();
    let mut out = Vec::with_capacity((W * H * 4) as usize);
    for y in 0..H {
        let start = (y * row) as usize;
        out.extend_from_slice(&mapped[start..start + (W * 4) as usize]);
    }
    out
}

struct Fixture {
    blocks: Vec<Block>,
    out: Lens,
    map: Lens,
}

fn fixture() -> Fixture {
    let blocks = vec![
        // The textured cube: 1.6 m, turned 25 degrees.
        Block { centre: [0.0, 0.8, 0.0], yaw_deg: 25.0, half: [0.8, 0.8, 0.8], receive: true },
        // A post between the content lens and the cube: its shadow is an
        // occluded patch on a face the output projector sees.
        Block { centre: [-0.55, 0.9, 2.1], yaw_deg: 0.0, half: [0.12, 0.9, 0.12], receive: false },
        // A floor slab under everything, receiving content.
        Block { centre: [0.0, -0.05, 0.0], yaw_deg: 0.0, half: [6.0, 0.05, 6.0], receive: true },
    ];
    let out = Lens {
        id: "out",
        position: [3.6, 2.6, 3.9],
        target: [0.0, 0.7, 0.0],
        roll_deg: 2.0,
        fov_deg: 38.0,
        aspect: W as f64 / H as f64,
        shift: [0.02, 0.05],
        near: 0.1,
        far: 60.0,
        crop: [0.0, 0.0, 1.0, 1.0],
        blend: [0.08, 0.0, 0.0, 0.06],
        content_from: Some("map"),
    };
    let map = Lens {
        id: "map",
        position: [-1.4, 1.3, 4.6],
        target: [0.0, 0.8, 0.0],
        roll_deg: -3.0,
        fov_deg: 34.0,
        aspect: 1.25,
        shift: [0.0, -0.03],
        near: 0.1,
        far: 60.0,
        crop: [0.1, 0.05, 0.8, 0.9],
        blend: [0.0; 4],
        content_from: None,
    };
    Fixture { blocks, out, map }
}

fn scene_commands(fixture: &Fixture) -> (Value, Value) {
    let cube = unit_cube();
    let meshes = json!({
        "type": "set_projection_sim_meshes",
        "meshes": [{
            "key": "cube",
            "positions_b64": b64_f32(&cube.positions),
            "normals_b64": b64_f32(&cube.normals),
            "indices_b64": b64_u32(&cube.indices),
        }],
    });
    let objects: Vec<Value> = fixture
        .blocks
        .iter()
        .map(|block| json!({ "mesh": "cube", "matrix": block.model().to_vec(), "receive": block.receive }))
        .collect();
    let view = json!({
        "type": "set_projection_sim_view",
        "view": { "objects": objects, "projectors": [fixture.out.json(), fixture.map.json()] },
    });
    (meshes, view)
}

fn render(fixture: &Fixture, projector: &str, overlay: Option<&ProjectorViewOverlay>) -> Option<Vec<u8>> {
    let (device, queue) = device()?;
    let (meshes_command, view_command) = scene_commands(fixture);
    let batch = parse_projector_view_meshes(&meshes_command).unwrap();
    let meshes: HashMap<String, Arc<ProjectorViewMeshData>> = batch.upserts.into_iter().collect();
    let scene = parse_projector_view_scene(&view_command).unwrap().unwrap();
    let content = content_texture(&device, &queue);
    let content_view = content.create_view(&wgpu::TextureViewDescriptor::default());
    let target = device.create_texture(&wgpu::TextureDescriptor {
        label: Some("test target"),
        size: wgpu::Extent3d { width: W, height: H, depth_or_array_layers: 1 },
        mip_level_count: 1,
        sample_count: 1,
        dimension: wgpu::TextureDimension::D2,
        format: wgpu::TextureFormat::Rgba8Unorm,
        usage: wgpu::TextureUsages::RENDER_ATTACHMENT | wgpu::TextureUsages::COPY_SRC,
        view_formats: &[],
    });
    let target_view = target.create_view(&wgpu::TextureViewDescriptor::default());
    let mut renderer = ProjectorViewRenderer::new(&device, &queue, wgpu::TextureFormat::Rgba8Unorm);
    renderer.sync_meshes(&device, &meshes);
    let mut encoder = device.create_command_encoder(&wgpu::CommandEncoderDescriptor::default());
    let drawn = renderer.render(
        &device,
        &queue,
        &mut encoder,
        &target_view,
        &ProjectorViewRequest { scene: &scene, projector_id: projector, content: Some(&content_view), overlay, width: W, height: H },
    );
    assert!(drawn);
    queue.submit(Some(encoder.finish()));
    Some(read_rgba(&device, &queue, &target))
}

#[test]
fn projector_view_matches_a_cpu_ray_cast_including_occlusion() {
    let fixture = fixture();
    let Some(pixels) = render(&fixture, "out", None) else {
        eprintln!("no GPU adapter; skipping the projector view render test");
        return;
    };
    let mut compared = 0;
    let mut counts: HashMap<&'static str, usize> = HashMap::new();
    let mut worst = 0.0f64;
    for py in (1..H - 1).step_by(3) {
        for px in (1..W - 1).step_by(3) {
            let (cx, cy) = (px as f64 + 0.5, py as f64 + 0.5);
            let (class, expected) = reference(&fixture.blocks, &fixture.out, &fixture.map, cx, cy);
            // Skip pixels next to a silhouette, shadow edge or frame edge:
            // rasterisation and depth-map texels decide those, not maths.
            let stable = [(-1.5, 0.0), (1.5, 0.0), (0.0, -1.5), (0.0, 1.5), (-1.5, -1.5), (1.5, 1.5), (-1.5, 1.5), (1.5, -1.5)]
                .iter()
                .all(|(dx, dy)| reference(&fixture.blocks, &fixture.out, &fixture.map, cx + dx, cy + dy).0 == class);
            if !stable {
                continue;
            }
            let i = ((py * W + px) * 4) as usize;
            let actual = [pixels[i] as f64, pixels[i + 1] as f64, pixels[i + 2] as f64];
            let error = (0..3).map(|c| (actual[c] - expected[c]).abs()).fold(0.0, f64::max);
            assert!(
                error <= 4.0,
                "pixel ({px}, {py}) {class:?}: GPU {actual:?} vs CPU {expected:?}",
            );
            worst = worst.max(error);
            compared += 1;
            let key = match class {
                Class::Background => "background",
                Class::Unmapped(..) => "unmapped",
                Class::Occluded(..) => "occluded",
                Class::Lit(..) => "lit",
                Class::NotReceiving(..) => "not-receiving",
            };
            *counts.entry(key).or_default() += 1;
        }
    }
    eprintln!("projector view: {compared} samples, worst error {worst:.2}/255, {counts:?}");
    assert!(compared >= 3000, "too few stable samples: {compared}");
    for (key, minimum) in [("lit", 500), ("occluded", 40), ("unmapped", 100), ("background", 100), ("not-receiving", 20)] {
        let count = counts.get(key).copied().unwrap_or(0);
        assert!(count >= minimum, "expected at least {minimum} {key} samples, got {count}");
    }
}

#[test]
fn a_projector_mapping_its_own_content_emits_the_crop_on_the_surfaces() {
    let mut fixture = fixture();
    fixture.out.content_from = None;
    fixture.out.crop = [0.2, 0.1, 0.6, 0.7];
    let Some(pixels) = render(&fixture, "out", None) else {
        return;
    };
    let mut lit = 0;
    for py in (2..H - 2).step_by(4) {
        for px in (2..W - 2).step_by(4) {
            let (cx, cy) = (px as f64 + 0.5, py as f64 + 0.5);
            let (class, expected) = reference(&fixture.blocks, &fixture.out, &fixture.out, cx, cy);
            let stable = [(-1.5, 0.0), (1.5, 0.0), (0.0, -1.5), (0.0, 1.5)]
                .iter()
                .all(|(dx, dy)| reference(&fixture.blocks, &fixture.out, &fixture.out, cx + dx, cy + dy).0 == class);
            if !stable {
                continue;
            }
            let i = ((py * W + px) * 4) as usize;
            for c in 0..3 {
                assert!((pixels[i + c] as f64 - expected[c]).abs() <= 4.0, "pixel ({px}, {py}) {class:?}");
            }
            if matches!(class, Class::Lit(..)) {
                lit += 1;
                // Mapping from its own lens, a lit pixel shows the content
                // at its own image position (times the facing falloff).
                let u = fixture.out.crop[0] + cx / W as f64 * fixture.out.crop[2];
                let v = fixture.out.crop[1] + cy / H as f64 * fixture.out.crop[3];
                let direct = sample_content(u, v);
                assert!(expected[1] <= direct[1] + 1e-6);
            }
        }
    }
    assert!(lit > 300);
}

#[test]
fn calibration_overlay_draws_the_crosshair_over_black() {
    let fixture = fixture();
    let overlay = ProjectorViewOverlay {
        mode: ProjectorViewMode::Black,
        cursor: Some([0.25, 0.75]),
        markers: vec![([0.8, 0.2], false)],
    };
    let Some(pixels) = render(&fixture, "out", Some(&overlay)) else {
        return;
    };
    let at = |x: u32, y: u32| {
        let i = ((y * W + x) * 4) as usize;
        [pixels[i], pixels[i + 1], pixels[i + 2]]
    };
    let (cx, cy) = ((0.25 * W as f64) as u32, (0.75 * H as f64) as u32);
    // The vertical and horizontal hairs run the whole frame.
    assert!(at(cx, 5)[0] > 200 && at(cx, 5)[1] > 200, "vertical hair: {:?}", at(cx, 5));
    assert!(at(W - 6, cy)[0] > 200, "horizontal hair: {:?}", at(W - 6, cy));
    // The centre dot is red; the rest of the frame is black in this mode.
    assert!(at(cx, cy)[0] > 200 && at(cx, cy)[1] < 120, "centre: {:?}", at(cx, cy));
    assert_eq!(at(cx + 40, cy + 20), [0, 0, 0]);
    // The matched point's ring is yellow.
    let (mx, my) = ((0.8 * W as f64) as u32, (0.2 * H as f64) as u32);
    let ring = at(mx + 10, my);
    assert!(ring[0] > 150 && ring[1] > 100 && ring[2] < 120, "marker ring: {ring:?}");
}

#[test]
fn parses_meshes_and_rejects_bad_geometry() {
    let cube = unit_cube();
    let good = json!({
        "meshes": [{
            "key": "cube",
            "positions_b64": b64_f32(&cube.positions),
            "normals_b64": b64_f32(&cube.normals),
            "indices_b64": b64_u32(&cube.indices),
        }],
        "retain": ["cube"],
    });
    let batch = parse_projector_view_meshes(&good).unwrap();
    assert_eq!(batch.upserts.len(), 1);
    assert_eq!(batch.upserts[0].1.vertex_count(), 24);
    assert_eq!(batch.retain, Some(vec!["cube".to_string()]));

    let mut bad_index = cube.indices.clone();
    bad_index[4] = 24;
    let err = parse_projector_view_meshes(&json!({ "meshes": [{
        "key": "cube",
        "positions_b64": b64_f32(&cube.positions),
        "normals_b64": b64_f32(&cube.normals),
        "indices_b64": b64_u32(&bad_index),
    }] }))
    .unwrap_err();
    assert!(err.contains("past the vertex list"), "{err}");

    let err = parse_projector_view_meshes(&json!({ "meshes": [{
        "key": "cube",
        "positions_b64": b64_f32(&cube.positions),
        "normals_b64": b64_f32(&cube.normals[..6]),
        "indices_b64": b64_u32(&cube.indices),
    }] }))
    .unwrap_err();
    assert!(err.contains("matching"), "{err}");
}

#[test]
fn parses_the_view_and_resolves_the_mapping_lens() {
    let fixture = fixture();
    let (_, view) = scene_commands(&fixture);
    let scene = parse_projector_view_scene(&view).unwrap().unwrap();
    assert_eq!(scene.objects.len(), 3);
    assert!(!scene.objects[1].receive);
    let out = scene.camera("out").unwrap();
    assert_eq!(scene.mapping_camera(out).id, "map");
    let map = scene.camera("map").unwrap();
    assert_eq!(scene.mapping_camera(map).id, "map");
    // wgpu depth: a point on the lens axis at the near plane maps to 0.
    let (x, y, z) = fixture.out.basis();
    let _ = (x, y);
    let on_axis = sub(fixture.out.position, mul(z, fixture.out.near));
    let clip: Vec<f64> = (0..4)
        .map(|row| (0..3).map(|k| out.view_proj[k][row] * on_axis[k]).sum::<f64>() + out.view_proj[3][row])
        .collect();
    assert!((clip[2] / clip[3]).abs() < 1e-9);
    assert!(parse_projector_view_scene(&json!({ "view": null })).unwrap().is_none());
    let (id, overlay) = parse_projector_view_overlay(&json!({ "projector_id": "out", "overlay": {
        "mode": "model", "cursor": [0.5, 0.25], "markers": [[0.1, 0.2, 1], [0.3, 0.4]],
    } }))
    .unwrap();
    assert_eq!(id, "out");
    let overlay = overlay.unwrap();
    assert_eq!(overlay.mode, ProjectorViewMode::Model);
    assert_eq!(overlay.cursor, Some([0.5, 0.25]));
    assert_eq!(overlay.markers, vec![([0.1, 0.2], true), ([0.3, 0.4], false)]);
}
