//! Files the HTTP server hands out: the built phone app (dist/), which in a
//! packaged app sits inside app.asar, and in a development checkout the
//! public/ folder beside it. Node reads asar archives transparently; this
//! reads the archive's header itself.
//!
//! Also the path rules of the JS server: a request path is resolved against
//! the folder the way `path.resolve` does it, and anything that lands outside
//! is refused.

use serde_json::Value;
use std::fs;
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::sync::OnceLock;

/// An asar archive: its header and where the file data starts.
struct Archive {
    path: PathBuf,
    header: Value,
    data_start: u64,
}

fn read_u32(buf: &[u8], at: usize) -> Option<u32> {
    Some(u32::from_le_bytes(buf.get(at..at + 4)?.try_into().ok()?))
}

impl Archive {
    fn open(path: &Path) -> Option<Archive> {
        let mut file = fs::File::open(path).ok()?;
        let mut size_buf = [0u8; 8];
        file.read_exact(&mut size_buf).ok()?;
        // A pickle holding one u32: [payload size = 4][header size].
        let header_size = read_u32(&size_buf, 4)? as usize;
        if header_size > 512 * 1024 * 1024 {
            return None;
        }
        let mut header_buf = vec![0u8; header_size];
        file.read_exact(&mut header_buf).ok()?;
        // A pickle holding one string: [payload size][string length][bytes].
        let len = read_u32(&header_buf, 4)? as usize;
        let json = header_buf.get(8..8 + len)?;
        let header = serde_json::from_slice(json).ok()?;
        Some(Archive { path: path.to_path_buf(), header, data_start: 8 + header_size as u64 })
    }

    fn entry(&self, inner: &[String]) -> Option<&Value> {
        let mut node = &self.header;
        for part in inner {
            node = node.get("files")?.get(part)?;
        }
        Some(node)
    }

    fn is_file(&self, inner: &[String]) -> bool {
        self.entry(inner).is_some_and(|e| e.get("files").is_none() && e.get("link").is_none() && e.get("size").is_some())
    }

    fn read(&self, inner: &[String]) -> Option<Vec<u8>> {
        let entry = self.entry(inner)?;
        if !self.is_file(inner) {
            return None;
        }
        if entry.get("unpacked").and_then(Value::as_bool) == Some(true) {
            let mut unpacked = self.path.as_os_str().to_owned();
            unpacked.push(".unpacked");
            let mut p = PathBuf::from(unpacked);
            for part in inner {
                p.push(part);
            }
            return fs::read(p).ok();
        }
        let size = entry.get("size")?.as_u64()?;
        let offset: u64 = match entry.get("offset")? {
            Value::String(s) => s.parse().ok()?,
            Value::Number(n) => n.as_u64()?,
            _ => return None,
        };
        let mut file = fs::File::open(&self.path).ok()?;
        file.seek(SeekFrom::Start(self.data_start + offset)).ok()?;
        let mut data = vec![0u8; usize::try_from(size).ok()?];
        file.read_exact(&mut data).ok()?;
        Some(data)
    }
}

/// A folder to serve from, on disk or inside an archive.
pub struct Root {
    pub dir: PathBuf,
    archive: OnceLock<Option<(Archive, Vec<String>)>>,
}

impl Root {
    pub fn new(dir: PathBuf) -> Root {
        Root { dir, archive: OnceLock::new() }
    }

    /// The archive this folder is inside, and the folder's path within it.
    fn archive(&self) -> Option<&(Archive, Vec<String>)> {
        self.archive
            .get_or_init(|| {
                let mut prefix = PathBuf::new();
                let mut comps = self.dir.components();
                for comp in comps.by_ref() {
                    prefix.push(comp);
                    let is_asar = prefix.extension().is_some_and(|e| e.eq_ignore_ascii_case("asar"));
                    if is_asar && prefix.is_file() {
                        let inner = comps.map(|c| c.as_os_str().to_string_lossy().into_owned()).collect();
                        return Archive::open(&prefix).map(|a| (a, inner));
                    }
                }
                None
            })
            .as_ref()
    }

    fn inner_path(base: &[String], rel: &[String]) -> Vec<String> {
        base.iter().chain(rel).cloned().collect()
    }

    /// A regular file at `rel` (segments already checked) below this folder.
    pub fn is_file(&self, rel: &[String]) -> bool {
        if let Some((archive, base)) = self.archive() {
            return archive.is_file(&Self::inner_path(base, rel));
        }
        match self.disk_path(rel) {
            Some(p) => fs::metadata(p).is_ok_and(|m| m.is_file()),
            None => false,
        }
    }

    pub fn read(&self, rel: &[String]) -> Option<Vec<u8>> {
        if let Some((archive, base)) = self.archive() {
            return archive.read(&Self::inner_path(base, rel));
        }
        fs::read(self.disk_path(rel)?).ok()
    }

    fn disk_path(&self, rel: &[String]) -> Option<PathBuf> {
        let mut p = self.dir.clone();
        for part in rel {
            if !openable_segment(part) {
                return None;
            }
            p.push(part);
        }
        Some(p)
    }
}

/// A segment this platform can open as one plain name. Anything else is
/// treated as missing, which is where Node's fs calls end up for it too.
fn openable_segment(part: &str) -> bool {
    if part.is_empty() || part.contains('\0') {
        return false;
    }
    if cfg!(windows) {
        // A drive or stream (`C:`, `a:b`) would make Path::push replace the
        // whole path, and device names open devices, not files.
        if part.contains([':', '\\', '/']) {
            return false;
        }
        let stem = part.split('.').next().unwrap_or("").trim_end().to_ascii_uppercase();
        let device = matches!(stem.as_str(), "CON" | "PRN" | "AUX" | "NUL" | "CONIN$" | "CONOUT$")
            || ((stem.starts_with("COM") || stem.starts_with("LPT")) && stem.len() == 4 && stem.as_bytes()[3].is_ascii_digit());
        if device {
            return false;
        }
    } else if part.contains('/') {
        return false;
    }
    true
}

/// The WHATWG URL parser's path: `\` is `/` in an http URL, and `.`/`..`
/// segments (also as `%2e`) are applied. Returns the serialized pathname.
pub fn url_pathname(raw: &str) -> String {
    let raw = raw.split(['?', '#']).next().unwrap_or("");
    // An absolute-form target (http://host/path): keep only the path.
    let raw = match raw.find("://") {
        Some(at) if !raw.starts_with('/') => {
            let after = &raw[at + 3..];
            match after.find(['/', '\\']) {
                Some(slash) => &after[slash..],
                None => "/",
            }
        }
        _ => raw,
    };
    let mut out: Vec<&str> = Vec::new();
    let parts: Vec<&str> = raw.split(['/', '\\']).collect();
    let last = parts.len().saturating_sub(1);
    for (i, part) in parts.iter().enumerate().skip(1) {
        let lower = part.to_ascii_lowercase();
        let single = lower == "." || lower == "%2e";
        let double = matches!(lower.as_str(), ".." | ".%2e" | "%2e." | "%2e%2e");
        if double {
            out.pop();
            if i == last {
                out.push("");
            }
        } else if single {
            if i == last {
                out.push("");
            }
        } else {
            out.push(part);
        }
    }
    format!("/{}", out.join("/"))
}

/// `decodeURIComponent`: None where it would throw (a bad escape, or bytes
/// that are not UTF-8).
pub fn decode_uri_component(s: &str) -> Option<String> {
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' {
            let hi = (*bytes.get(i + 1)? as char).to_digit(16)?;
            let lo = (*bytes.get(i + 2)? as char).to_digit(16)?;
            out.push((hi * 16 + lo) as u8);
            i += 3;
        } else {
            out.push(bytes[i]);
            i += 1;
        }
    }
    String::from_utf8(out).ok()
}

/// Where `path.resolve(dir, '.' + req_path)` lands, as segments relative to
/// `dir`, or None when `path.relative(dir, it)` starts with `..` (outside, or
/// a name that itself starts with two dots).
pub fn resolve_inside(dir: &Path, req_path: &str) -> Option<Vec<String>> {
    let base: Vec<String> = dir
        .components()
        .filter_map(|c| match c {
            std::path::Component::Normal(s) => Some(s.to_string_lossy().into_owned()),
            _ => None,
        })
        .collect();
    let mut full = base.clone();
    let separators: &[char] = if cfg!(windows) { &['/', '\\'] } else { &['/'] };
    for part in req_path.split(separators) {
        match part {
            "" | "." => {}
            ".." => {
                full.pop();
            }
            other => full.push(other.to_string()),
        }
    }
    let inside = full.len() >= base.len() && full[..base.len()] == base[..];
    if !inside {
        return None;
    }
    let rel = full[base.len()..].to_vec();
    if rel.first().is_some_and(|first| first.starts_with("..")) {
        return None;
    }
    Some(rel)
}

/// `path.extname(file).toLowerCase()`.
pub fn extname(name: &str) -> String {
    match name.rfind('.') {
        Some(0) | None => String::new(),
        Some(at) => name[at..].to_ascii_lowercase(),
    }
}

pub fn mime_type(ext: &str) -> &'static str {
    match ext {
        ".html" => "text/html",
        ".js" => "application/javascript",
        ".css" => "text/css",
        ".json" => "application/json",
        ".png" => "image/png",
        ".jpg" => "image/jpeg",
        ".svg" => "image/svg+xml",
        ".woff" => "font/woff",
        ".woff2" => "font/woff2",
        ".ttf" => "font/ttf",
        ".ico" => "image/x-icon",
        ".wasm" => "application/wasm",
        ".glsl" | ".fs" | ".vs" => "text/plain",
        _ => "application/octet-stream",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn whatwg_paths() {
        assert_eq!(url_pathname("/a/../b"), "/b");
        assert_eq!(url_pathname("/%2e%2e/x"), "/x");
        assert_eq!(url_pathname("/..\\..\\x?y"), "/x");
        assert_eq!(url_pathname("/%2e%2e%2fdist-other%2fsecret"), "/%2e%2e%2fdist-other%2fsecret");
        assert_eq!(url_pathname("/a/."), "/a/");
        assert_eq!(url_pathname("http://h:1/x/y"), "/x/y");
    }

    #[test]
    fn paths_stay_inside() {
        let dir = Path::new("/app/dist");
        assert_eq!(resolve_inside(dir, "/index.html"), Some(vec!["index.html".to_string()]));
        assert_eq!(resolve_inside(dir, "/../dist-other/secret"), None);
        assert_eq!(resolve_inside(dir, "/../dist/x.js"), Some(vec!["x.js".to_string()]));
        assert_eq!(resolve_inside(dir, "/..foo"), None);
        assert_eq!(resolve_inside(dir, "/a/../../.."), None);
        assert_eq!(decode_uri_component("%ZZ"), None);
        assert_eq!(decode_uri_component("%C3%28"), None);
        assert_eq!(decode_uri_component("a%20b").as_deref(), Some("a b"));
        assert_eq!(extname(".htaccess"), "");
        assert_eq!(extname("a.B.JS"), ".js");
    }

    #[test]
    fn reads_an_asar_archive() {
        let dir = std::env::temp_dir().join(format!("ga-asar-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let header = br#"{"files":{"dist":{"files":{"index.html":{"size":5,"offset":"0"},"a.js":{"size":3,"offset":"5"},"u.bin":{"size":2,"unpacked":true}}}}}"#;
        let mut pickle = Vec::new();
        let padded = header.len().div_ceil(4) * 4;
        pickle.extend_from_slice(&((padded + 4) as u32).to_le_bytes());
        pickle.extend_from_slice(&(header.len() as u32).to_le_bytes());
        pickle.extend_from_slice(header);
        pickle.resize(8 + padded, 0);
        let mut file = Vec::new();
        file.extend_from_slice(&4u32.to_le_bytes());
        file.extend_from_slice(&(pickle.len() as u32).to_le_bytes());
        file.extend_from_slice(&pickle);
        file.extend_from_slice(b"hello");
        file.extend_from_slice(b"js!");
        let archive = dir.join("app.asar");
        fs::write(&archive, file).unwrap();
        fs::create_dir_all(dir.join("app.asar.unpacked/dist")).unwrap();
        fs::write(dir.join("app.asar.unpacked/dist/u.bin"), b"ok").unwrap();
        let root = Root::new(archive.join("dist"));
        let p = |s: &str| vec![s.to_string()];
        assert!(root.is_file(&p("index.html")));
        assert_eq!(root.read(&p("index.html")).unwrap(), b"hello");
        assert_eq!(root.read(&p("a.js")).unwrap(), b"js!");
        assert_eq!(root.read(&p("u.bin")).unwrap(), b"ok");
        assert!(!root.is_file(&p("missing.js")));
        assert!(!root.is_file(&[]));
        fs::remove_dir_all(dir).ok();
    }
}
