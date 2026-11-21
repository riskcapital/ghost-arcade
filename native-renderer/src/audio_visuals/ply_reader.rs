//! A bounded PLY reader for Cloud Pulse: reads a point cloud or a Gaussian
//! splat file straight into a compact GPU layout (16 bytes a point: xyz and
//! a packed RGBA8 colour), on a worker thread, never more than `max_points`.
//!
//! The app's point upload path carries 168 bytes a point through the 64 MiB
//! RPC, which caps it well below the density Cloud Pulse needs; reading the
//! file here costs one pass and 16 MB for a million points.

use std::fs::File;
use std::io::{BufRead, BufReader, Read};
use std::path::Path;
use std::sync::{Arc, Mutex};

pub const CLOUD_POINT_BYTES: u64 = 16;
pub const CLOUD_MAX_POINTS: u32 = 2_000_000;
const MAX_HEADER_BYTES: usize = 64 * 1024;
const SH_C0: f32 = 0.282_094_8;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Scalar {
    I8,
    U8,
    I16,
    U16,
    I32,
    U32,
    F32,
    F64,
}

impl Scalar {
    fn parse(name: &str) -> Option<Self> {
        Some(match name {
            "char" | "int8" => Self::I8,
            "uchar" | "uint8" => Self::U8,
            "short" | "int16" => Self::I16,
            "ushort" | "uint16" => Self::U16,
            "int" | "int32" => Self::I32,
            "uint" | "uint32" => Self::U32,
            "float" | "float32" => Self::F32,
            "double" | "float64" => Self::F64,
            _ => return None,
        })
    }

    fn size(self) -> usize {
        match self {
            Self::I8 | Self::U8 => 1,
            Self::I16 | Self::U16 => 2,
            Self::I32 | Self::U32 | Self::F32 => 4,
            Self::F64 => 8,
        }
    }

    fn read(self, b: &[u8], big: bool) -> f32 {
        macro_rules! num {
            ($t:ty, $n:expr) => {{
                let mut a = [0_u8; $n];
                a.copy_from_slice(&b[..$n]);
                if big { <$t>::from_be_bytes(a) } else { <$t>::from_le_bytes(a) }
            }};
        }
        match self {
            Self::I8 => b[0] as i8 as f32,
            Self::U8 => b[0] as f32,
            Self::I16 => num!(i16, 2) as f32,
            Self::U16 => num!(u16, 2) as f32,
            Self::I32 => num!(i32, 4) as f32,
            Self::U32 => num!(u32, 4) as f32,
            Self::F32 => num!(f32, 4),
            Self::F64 => num!(f64, 8) as f32,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Format {
    Ascii,
    BinaryLittle,
    BinaryBig,
}

/// One property: its byte offset (binary, fixed rows), its column (ASCII
/// rows) and its type.
#[derive(Clone, Copy, Debug)]
struct Prop {
    offset: usize,
    column: usize,
    scalar: Scalar,
}

/// An element in the header: scalars, and list properties as (count type, item type).
#[derive(Debug)]
struct Element {
    name: String,
    count: usize,
    props: Vec<(String, Prop)>,
    lists: Vec<(Scalar, Scalar)>,
    /// Byte size of a row when it has no lists.
    stride: usize,
    /// A list property comes before a scalar one (columns and offsets unknown).
    list_first: bool,
}

struct Layout {
    format: Format,
    /// Elements before the vertices, to skip.
    before: Vec<Element>,
    count: usize,
    stride: usize,
    vertex_lists: bool,
    x: Prop,
    y: Prop,
    z: Prop,
    rgb: Option<[Prop; 3]>,
    dc: Option<[Prop; 3]>,
    opacity: Option<Prop>,
    alpha: Option<Prop>,
}

fn parse_header(header: &str) -> Result<Layout, String> {
    let mut lines = header.lines();
    if lines.next().map(str::trim) != Some("ply") {
        return Err("not a PLY file".to_string());
    }
    let mut format = None;
    let mut elements: Vec<Element> = Vec::new();
    for line in lines {
        let parts: Vec<&str> = line.split_whitespace().collect();
        match parts.as_slice() {
            ["format", "ascii", _] => format = Some(Format::Ascii),
            ["format", "binary_little_endian", _] => format = Some(Format::BinaryLittle),
            ["format", "binary_big_endian", _] => format = Some(Format::BinaryBig),
            ["format", other, ..] => return Err(format!("PLY format `{other}` is not supported")),
            ["element", name, count] => {
                let count = count.parse::<usize>().map_err(|_| "bad element count".to_string())?;
                elements.push(Element { name: name.to_string(), count, props: Vec::new(), lists: Vec::new(), stride: 0, list_first: false });
            }
            ["property", "list", count_ty, item_ty, _name] => {
                let count = Scalar::parse(count_ty).ok_or_else(|| format!("unknown PLY type `{count_ty}`"))?;
                let item = Scalar::parse(item_ty).ok_or_else(|| format!("unknown PLY type `{item_ty}`"))?;
                if let Some(element) = elements.last_mut() {
                    element.lists.push((count, item));
                }
            }
            ["property", ty, name] => {
                let scalar = Scalar::parse(ty).ok_or_else(|| format!("unknown PLY type `{ty}`"))?;
                if let Some(element) = elements.last_mut() {
                    if !element.lists.is_empty() {
                        element.list_first = true;
                    }
                    let prop = Prop { offset: element.stride, column: element.props.len(), scalar };
                    element.props.push((name.to_string(), prop));
                    element.stride += scalar.size();
                }
            }
            _ => {}
        }
    }
    let format = format.ok_or("PLY has no format line")?;
    let mut before = Vec::new();
    for element in elements {
        if element.name != "vertex" {
            before.push(element);
            continue;
        }
        if element.list_first {
            return Err("PLY vertices have a list before their coordinates".to_string());
        }
        let find = |key: &str| element.props.iter().find(|p| p.0 == key).map(|p| p.1);
        let x = find("x").ok_or("PLY vertices have no x")?;
        let y = find("y").ok_or("PLY vertices have no y")?;
        let z = find("z").ok_or("PLY vertices have no z")?;
        let rgb = match (find("red").or(find("diffuse_red")), find("green").or(find("diffuse_green")), find("blue").or(find("diffuse_blue"))) {
            (Some(r), Some(g), Some(b)) => Some([r, g, b]),
            _ => None,
        };
        let dc = match (find("f_dc_0"), find("f_dc_1"), find("f_dc_2")) {
            (Some(r), Some(g), Some(b)) => Some([r, g, b]),
            _ => None,
        };
        return Ok(Layout {
            format,
            count: element.count,
            stride: element.stride,
            vertex_lists: !element.lists.is_empty(),
            before,
            x,
            y,
            z,
            rgb,
            dc,
            opacity: find("opacity"),
            alpha: find("alpha"),
        });
    }
    Err("PLY has no vertex element".to_string())
}

/// Points ready for the GPU, normalised to about a unit cube around the
/// cloud's median, and the count read.
#[derive(Debug)]
pub struct CloudPoints {
    pub bytes: Vec<u8>,
    pub count: u32,
    /// Points in the file (for diagnostics; `count` were read).
    #[allow(dead_code)]
    pub source_count: u64,
}

fn read_header(reader: &mut impl BufRead) -> Result<(String, usize), String> {
    let mut header = String::new();
    let mut consumed = 0;
    loop {
        let mut line = String::new();
        let n = reader.read_line(&mut line).map_err(|err| err.to_string())?;
        if n == 0 {
            return Err("PLY header ended early".to_string());
        }
        consumed += n;
        if consumed > MAX_HEADER_BYTES {
            return Err("PLY header is too long".to_string());
        }
        let done = line.trim() == "end_header";
        header.push_str(&line);
        if done {
            return Ok((header, consumed));
        }
    }
}

/// Reads one row of an element in a binary file into `row` (scalars, then
/// lists skipped). Rows with lists are read field by field.
fn read_binary_row(reader: &mut impl Read, element_stride: usize, lists: &[(Scalar, Scalar)], big: bool, row: &mut Vec<u8>) -> std::io::Result<()> {
    row.resize(element_stride, 0);
    reader.read_exact(row)?;
    let mut buf = [0_u8; 8];
    for (count_ty, item_ty) in lists {
        reader.read_exact(&mut buf[..count_ty.size()])?;
        let n = count_ty.read(&buf, big).max(0.0) as u64;
        std::io::copy(&mut reader.take(n * item_ty.size() as u64), &mut std::io::sink())?;
    }
    Ok(())
}

/// One ASCII row's numbers (only the scalar columns are kept).
fn read_ascii_row(reader: &mut impl BufRead, line: &mut String, values: &mut Vec<f32>) -> Result<bool, String> {
    loop {
        line.clear();
        let n = reader.read_line(line).map_err(|err| err.to_string())?;
        if n == 0 {
            return Ok(false);
        }
        if line.trim().is_empty() {
            continue;
        }
        values.clear();
        values.extend(line.split_whitespace().map(|t| t.parse::<f64>().map_or(f32::NAN, |v| v as f32)));
        return Ok(true);
    }
}

pub fn read_cloud(reader: impl Read, max_points: u32) -> Result<CloudPoints, String> {
    let mut reader = BufReader::with_capacity(1 << 20, reader);
    let (header, _) = read_header(&mut reader)?;
    let layout = parse_header(&header)?;
    if layout.count == 0 {
        return Err("PLY has no points".to_string());
    }
    let big = layout.format == Format::BinaryBig;
    let ascii = layout.format == Format::Ascii;
    let mut row: Vec<u8> = Vec::new();
    let mut line = String::new();
    let mut values: Vec<f32> = Vec::new();
    // Elements before the vertices (rare): skipped row by row.
    for element in &layout.before {
        for _ in 0..element.count {
            if ascii {
                if !read_ascii_row(&mut reader, &mut line, &mut values)? {
                    return Err("PLY ended before its vertices".to_string());
                }
            } else {
                read_binary_row(&mut reader, element.stride, &element.lists, big, &mut row).map_err(|err| err.to_string())?;
            }
        }
    }
    let wanted = (max_points.clamp(1, CLOUD_MAX_POINTS) as usize).min(layout.count);
    // Every n-th point, evenly over the file, so a capped read still covers
    // the whole scan. Memory stays at the cap whatever the file's size.
    let mut positions: Vec<[f32; 3]> = Vec::with_capacity(wanted);
    let mut colors: Vec<u32> = Vec::with_capacity(wanted);
    let mut next_pick = 0.0_f64;
    let step = layout.count as f64 / wanted as f64;
    let vertex_lists: Vec<(Scalar, Scalar)> = Vec::new();
    for index in 0..layout.count {
        let picked = (index as f64) >= next_pick;
        if ascii {
            // Rows not picked are read but not parsed.
            let more = if picked {
                read_ascii_row(&mut reader, &mut line, &mut values)?
            } else {
                line.clear();
                reader.read_line(&mut line).map_err(|err| err.to_string())? > 0
            };
            if !more {
                return Err(format!("PLY ended at point {index}"));
            }
        } else if layout.vertex_lists {
            return Err("PLY vertices with list properties are not supported in binary files".to_string());
        } else {
            read_binary_row(&mut reader, layout.stride, &vertex_lists, big, &mut row).map_err(|err| format!("PLY ended at point {index}: {err}"))?;
        }
        if !picked {
            continue;
        }
        next_pick += step;
        let get = |p: Prop| -> f32 {
            if ascii { values.get(p.column).copied().unwrap_or(f32::NAN) } else { p.scalar.read(&row[p.offset..], big) }
        };
        let p = [get(layout.x), get(layout.y), get(layout.z)];
        if !p.iter().all(|v| v.is_finite()) {
            continue;
        }
        let unit = |s: Scalar| match s {
            Scalar::U8 => 1.0 / 255.0,
            Scalar::U16 => 1.0 / 65535.0,
            _ => 1.0,
        };
        let (r, g, b) = if let Some([r, g, b]) = layout.rgb {
            let scale = unit(r.scalar);
            (get(r) * scale, get(g) * scale, get(b) * scale)
        } else if let Some([r, g, b]) = layout.dc {
            (0.5 + SH_C0 * get(r), 0.5 + SH_C0 * get(g), 0.5 + SH_C0 * get(b))
        } else {
            (0.8, 0.8, 0.8)
        };
        let a = match (layout.opacity, layout.alpha) {
            (Some(o), _) => 1.0 / (1.0 + (-get(o)).exp()),
            (None, Some(al)) => get(al) * unit(al.scalar),
            _ => 1.0,
        };
        let finite = |v: f32| if v.is_finite() { v } else { 0.8 };
        let pack = |v: f32| (finite(v).clamp(0.0, 1.0) * 255.0).round() as u32;
        positions.push(p);
        colors.push(pack(r) | (pack(g) << 8) | (pack(b) << 16) | (pack(a) << 24));
        if positions.len() >= wanted {
            break;
        }
    }
    if positions.is_empty() {
        return Err("PLY had no finite points".to_string());
    }
    let (center, scale) = normalisation(&positions);
    let mut bytes = Vec::with_capacity(positions.len() * CLOUD_POINT_BYTES as usize);
    for (p, color) in positions.iter().zip(colors.iter()) {
        for axis in 0..3 {
            bytes.extend_from_slice(&((p[axis] - center[axis]) * scale).to_le_bytes());
        }
        bytes.extend_from_slice(&color.to_le_bytes());
    }
    Ok(CloudPoints { bytes, count: positions.len() as u32, source_count: layout.count as u64 })
}

/// Median centre and a scale that puts 96% of points within 0.5 of it, so a
/// few stray points far away do not shrink the scan to a dot.
fn normalisation(points: &[[f32; 3]]) -> ([f32; 3], f32) {
    let mut center = [0.0; 3];
    let mut axis_values: Vec<f32> = Vec::with_capacity(points.len());
    for (axis, slot) in center.iter_mut().enumerate() {
        axis_values.clear();
        axis_values.extend(points.iter().map(|p| p[axis]));
        let mid = axis_values.len() / 2;
        *slot = *axis_values.select_nth_unstable_by(mid, f32::total_cmp).1;
    }
    let mut distances: Vec<f32> = points
        .iter()
        .map(|p| ((p[0] - center[0]).powi(2) + (p[1] - center[1]).powi(2) + (p[2] - center[2]).powi(2)).sqrt())
        .collect();
    let at = ((distances.len() as f32 * 0.96) as usize).min(distances.len() - 1);
    let reach = *distances.select_nth_unstable_by(at, f32::total_cmp).1;
    (center, if reach > 1e-9 { 0.5 / reach } else { 1.0 })
}

/// A cloud being read on a worker thread. Explicit states; the render thread
/// only ever looks, never waits.
#[derive(Debug)]
pub enum CloudLoadState {
    Loading,
    Ready(Arc<CloudPoints>),
    Failed(String),
}

#[derive(Debug)]
pub struct CloudLoad {
    pub path: String,
    pub max_points: u32,
    pub state: Mutex<CloudLoadState>,
}

impl CloudLoad {
    pub fn start(path: String, max_points: u32) -> Arc<Self> {
        let load = Arc::new(Self { path: path.clone(), max_points, state: Mutex::new(CloudLoadState::Loading) });
        let worker = Arc::clone(&load);
        let spawned = std::thread::Builder::new().name("cloud-pulse-ply".to_string()).spawn(move || {
            let result = File::open(Path::new(&path))
                .map_err(|err| format!("{path}: {err}"))
                .and_then(|file| read_cloud(file, max_points));
            let next = match result {
                Ok(points) => CloudLoadState::Ready(Arc::new(points)),
                Err(err) => CloudLoadState::Failed(err),
            };
            if let Ok(mut state) = worker.state.lock() {
                *state = next;
            }
        });
        if let Err(err) = spawned
            && let Ok(mut state) = load.state.lock()
        {
            *state = CloudLoadState::Failed(err.to_string());
        }
        load
    }

    pub fn ready(&self) -> Result<Option<Arc<CloudPoints>>, String> {
        match &*self.state.lock().map_err(|_| "cloud load lock poisoned".to_string())? {
            CloudLoadState::Loading => Ok(None),
            CloudLoadState::Ready(points) => Ok(Some(Arc::clone(points))),
            CloudLoadState::Failed(err) => Err(err.clone()),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ply(header_props: &str, rows: &[Vec<u8>], extra_before: &str, extra_bytes: &[u8]) -> Vec<u8> {
        let mut out = format!(
            "ply\nformat binary_little_endian 1.0\n{extra_before}element vertex {}\n{header_props}end_header\n",
            rows.len()
        )
        .into_bytes();
        out.extend_from_slice(extra_bytes);
        for row in rows {
            out.extend_from_slice(row);
        }
        out
    }

    fn row_rgb(x: f32, y: f32, z: f32, rgb: [u8; 3]) -> Vec<u8> {
        let mut r = Vec::new();
        for v in [x, y, z] {
            r.extend_from_slice(&v.to_le_bytes());
        }
        r.extend_from_slice(&rgb);
        r
    }

    #[test]
    fn reads_rgb_points_and_normalises_around_the_median() {
        let props = "property float x\nproperty float y\nproperty float z\nproperty uchar red\nproperty uchar green\nproperty uchar blue\n";
        let rows: Vec<Vec<u8>> = (0..101).map(|i| row_rgb(10.0 + i as f32, 5.0, -3.0, [255, 0, 128])).collect();
        let cloud = read_cloud(&ply(props, &rows, "", &[])[..], 1000).unwrap();
        assert_eq!(cloud.count, 101);
        assert_eq!(cloud.bytes.len(), 101 * 16);
        // The middle point sits at the origin.
        let mid = &cloud.bytes[50 * 16..50 * 16 + 16];
        assert_eq!(f32::from_le_bytes(mid[0..4].try_into().unwrap()), 0.0);
        let color = u32::from_le_bytes(mid[12..16].try_into().unwrap());
        assert_eq!(color & 0xff, 255);
        assert_eq!((color >> 8) & 0xff, 0);
        assert_eq!(color >> 24, 255, "no opacity: opaque");
        // 96% of points within 0.5.
        let x_last = f32::from_le_bytes(cloud.bytes[100 * 16..100 * 16 + 4].try_into().unwrap());
        assert!(x_last > 0.5 && x_last < 0.6, "{x_last}");
    }

    #[test]
    fn caps_points_evenly_and_reads_splat_colour_and_opacity() {
        let props = "property float x\nproperty float y\nproperty float z\nproperty float f_dc_0\nproperty float f_dc_1\nproperty float f_dc_2\nproperty float opacity\n";
        let rows: Vec<Vec<u8>> = (0..1000)
            .map(|i| {
                let mut r = Vec::new();
                for v in [i as f32, 0.0, 0.0, 1.0, 0.0, -1.0, 0.0] {
                    r.extend_from_slice(&v.to_le_bytes());
                }
                r
            })
            .collect();
        let cloud = read_cloud(&ply(props, &rows, "", &[])[..], 100).unwrap();
        assert_eq!(cloud.count, 100);
        assert_eq!(cloud.source_count, 1000);
        let color = u32::from_le_bytes(cloud.bytes[12..16].try_into().unwrap());
        assert_eq!(color & 0xff, ((0.5 + SH_C0) * 255.0_f32).round() as u32);
        assert_eq!((color >> 16) & 0xff, ((0.5 - SH_C0) * 255.0_f32).round() as u32);
        assert_eq!(color >> 24, 128, "opacity 0 is a sigmoid of one half");
        // Spread over the file, not the first hundred rows.
        let last_x = f32::from_le_bytes(cloud.bytes[99 * 16..99 * 16 + 4].try_into().unwrap());
        let first_x = f32::from_le_bytes(cloud.bytes[0..4].try_into().unwrap());
        assert!(last_x - first_x > 0.8, "{first_x}..{last_x}");
    }

    #[test]
    fn skips_fixed_elements_before_the_vertices_and_refuses_what_it_cannot_read() {
        let props = "property float x\nproperty float y\nproperty float z\nproperty uchar red\nproperty uchar green\nproperty uchar blue\n";
        let rows = vec![row_rgb(1.0, 2.0, 3.0, [1, 2, 3]), row_rgb(2.0, 2.0, 3.0, [1, 2, 3])];
        let before = "element camera 1\nproperty float fx\nproperty float fy\n";
        let cloud = read_cloud(&ply(props, &rows, before, &[0_u8; 8])[..], 10).unwrap();
        assert_eq!(cloud.count, 2);
        assert!(read_cloud(&b"ply\nformat ascii 1.0\nelement vertex 1\nproperty float x\nend_header\n1\n"[..], 10).is_err());
        assert!(read_cloud(&b"not a ply"[..], 10).is_err());
        let truncated = ply(props, &rows, "", &[]);
        assert!(read_cloud(&truncated[..truncated.len() - 4], 10).is_err());
    }

    #[test]
    fn a_missing_file_ends_in_failed_not_loading() {
        let load = CloudLoad::start("/nonexistent/cloud.ply".to_string(), 10);
        for _ in 0..200 {
            if !matches!(&*load.state.lock().unwrap(), CloudLoadState::Loading) {
                break;
            }
            std::thread::sleep(std::time::Duration::from_millis(5));
        }
        assert!(load.ready().is_err());
    }
}

/// The scan a cloud instrument reads: the picked file, or with none picked the
/// small default scan that ships beside the core (`assets/default-scan.ply`),
/// so a new cloud layer or voice draws at once. `GA_DEFAULT_SCAN` overrides it.
pub fn scan_path_or_default(picked: &str) -> String {
    if !picked.trim().is_empty() {
        return picked.to_string();
    }
    default_scan_path().unwrap_or_default()
}

/// Whether `path` is the bundled default scan.
pub fn is_default_scan(path: &str) -> bool {
    default_scan_path().is_some_and(|d| d == path)
}

fn default_scan_path() -> Option<String> {
    if let Ok(env) = std::env::var("GA_DEFAULT_SCAN")
        && !env.trim().is_empty()
    {
        return Some(env);
    }
    let exe = std::env::current_exe().ok()?;
    let dir = exe.parent()?;
    // Packaged: {resources}/native-renderer/assets. Dev: target/{profile}/ -> native-renderer/assets.
    [dir.join("assets"), dir.join("../../assets"), dir.join("../../../assets")]
        .into_iter()
        .map(|d| d.join("default-scan.ply"))
        .find(|p| p.is_file())
        .map(|p| p.to_string_lossy().into_owned())
}

#[cfg(test)]
mod default_scan_tests {
    use super::*;

    #[test]
    fn a_picked_file_wins_and_the_bundled_scan_is_found() {
        assert_eq!(scan_path_or_default("/x/a.ply"), "/x/a.ply");
        let p = scan_path_or_default("");
        assert!(p.ends_with("default-scan.ply"), "bundled default scan found from the test binary: {p:?}");
        assert!(std::path::Path::new(&p).is_file());
    }

    fn header(format: &str, props: &str, n: usize, after: &str) -> String {
        format!("ply\nformat {format} 1.0\ncomment test\nelement vertex {n}\n{props}{after}end_header\n")
    }

    #[test]
    fn reads_ascii_points_with_faces_after() {
        let props = "property float x\nproperty float y\nproperty float z\nproperty uchar red\nproperty uchar green\nproperty uchar blue\n";
        let mut text = header("ascii", props, 3, "element face 1\nproperty list uchar int vertex_indices\n");
        text.push_str("0 0 0 255 0 0\n1 2 3 0 255 0\n-1.5e0 2 0.25 0 0 255\n3 0 1 2\n");
        let cloud = read_cloud(text.as_bytes(), 1000).unwrap();
        assert_eq!(cloud.count, 3);
        let color = u32::from_le_bytes(cloud.bytes[12..16].try_into().unwrap());
        assert_eq!(color & 0xff, 255);
    }

    #[test]
    fn reads_big_endian_doubles_with_float_colour_and_a_face_element_before() {
        let props = "property double x\nproperty double y\nproperty double z\nproperty float red\nproperty float green\nproperty float blue\n";
        let mut out = format!("ply\nformat binary_big_endian 1.0\nelement face 1\nproperty list uchar int vertex_indices\nelement vertex 2\n{props}end_header\n").into_bytes();
        out.push(3);
        for v in [0_i32, 1, 2] {
            out.extend_from_slice(&v.to_be_bytes());
        }
        for i in 0..2 {
            for v in [i as f64 * 2.0, 1.0, -1.0] {
                out.extend_from_slice(&v.to_be_bytes());
            }
            for v in [0.0_f32, 1.0, 0.5] {
                out.extend_from_slice(&v.to_be_bytes());
            }
        }
        let cloud = read_cloud(&out[..], 1000).unwrap();
        assert_eq!(cloud.count, 2);
        let color = u32::from_le_bytes(cloud.bytes[12..16].try_into().unwrap());
        assert_eq!((color >> 8) & 0xff, 255);
        assert_eq!(color & 0xff, 0);
        let x0 = f32::from_le_bytes(cloud.bytes[0..4].try_into().unwrap());
        let x1 = f32::from_le_bytes(cloud.bytes[16..20].try_into().unwrap());
        assert!(x1 > x0);
    }

    #[test]
    fn caps_a_large_ascii_file_evenly() {
        let props = "property float x\nproperty float y\nproperty float z\n";
        let mut text = header("ascii", props, 10_000, "");
        for i in 0..10_000 {
            text.push_str(&format!("{i} 0 0\n"));
        }
        let cloud = read_cloud(text.as_bytes(), 100).unwrap();
        assert_eq!(cloud.count, 100);
        assert_eq!(cloud.source_count, 10_000);
    }

    /// `GA_PLY_PROBE=a.ply:b.ply cargo test --release probe_files -- --ignored --nocapture`
    #[test]
    #[ignore]
    fn probe_files() {
        for path in std::env::var("GA_PLY_PROBE").unwrap_or_default().split(':').filter(|p| !p.is_empty()) {
            let t = std::time::Instant::now();
            let cloud = read_cloud(File::open(path).unwrap(), 400_000).unwrap();
            let lit = cloud.bytes.chunks(16).filter(|c| (c[12] as u32 + c[13] as u32 + c[14] as u32) > 30).count();
            println!("{path}: {} of {} points, {lit} coloured, {:?}", cloud.count, cloud.source_count, t.elapsed());
        }
    }
}
