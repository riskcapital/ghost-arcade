//! The user shader library on disk (/api/shaders), written the way the JS
//! server writes it: one code file per shader plus index.json, each replaced
//! atomically, and an index that does not parse moved aside rather than
//! overwritten.

use crate::js;
use serde_json::{Map, Value, json};
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::sync::atomic::{AtomicU64, Ordering};

/// The JS server is single-threaded; so are these.
static LOCK: Mutex<()> = Mutex::new(());
static SERIAL: AtomicU64 = AtomicU64::new(0);

/// Node's `path.join(dir, name)`: joined, then `.` and `..` applied, so a
/// name that is absolute is still joined below `dir` rather than replacing it.
pub fn node_join(dir: &Path, name: &str) -> PathBuf {
    let mut out = dir.to_path_buf();
    let separators: &[char] = if cfg!(windows) { &['/', '\\'] } else { &['/'] };
    for part in name.split(separators) {
        match part {
            "" | "." => {}
            ".." => {
                out.pop();
            }
            other => out.push(other),
        }
    }
    out
}

/// `writeFileAtomicSync`: a temp file beside the target, flushed, then moved
/// over it (retried on Windows while something holds the target open).
pub fn write_atomic(target: &Path, data: &[u8]) -> std::io::Result<()> {
    let file = match fs::symlink_metadata(target) {
        Ok(m) if m.file_type().is_symlink() => fs::canonicalize(target).unwrap_or_else(|_| target.to_path_buf()),
        _ => target.to_path_buf(),
    };
    let serial = SERIAL.fetch_add(1, Ordering::SeqCst) + 1;
    let mut temp = file.as_os_str().to_owned();
    temp.push(format!(".saving-{}-{serial}", std::process::id()));
    let temp = PathBuf::from(temp);
    let result = (|| {
        let mut f = fs::File::create(&temp)?;
        f.write_all(data)?;
        f.sync_all()?;
        drop(f);
        let delays = [50u64, 100, 200, 400, 750];
        let mut attempt = 0;
        loop {
            match fs::rename(&temp, &file) {
                Ok(()) => return Ok(()),
                Err(e) if cfg!(windows) && attempt < delays.len() && matches!(e.kind(), std::io::ErrorKind::PermissionDenied | std::io::ErrorKind::ResourceBusy) => {
                    std::thread::sleep(std::time::Duration::from_millis(delays[attempt]));
                    attempt += 1;
                }
                Err(e) => return Err(e),
            }
        }
    })();
    if result.is_err() {
        let _ = fs::remove_file(&temp);
    }
    result
}

fn ensure_dir(dir: &Path) {
    if !dir.exists()
        && fs::create_dir_all(dir).is_ok() {
            eprintln!("[*] Created shader library directory: {}", dir.display());
        }
}

fn extension(kind: Option<&Value>) -> &'static str {
    match kind.and_then(Value::as_str) {
        Some("shader-isf") => ".fs",
        Some("threejs") => ".three.html",
        Some("p5js") => ".p5.html",
        _ => ".shader",
    }
}

fn safe(v: Option<&Value>, fallback: &str, max: usize) -> String {
    let text = if js::truthy(v) { js::to_string(v) } else { fallback.to_string() };
    let replaced = js::replace_units(&text, |c| c.is_ascii_alphanumeric() || c == '-' || c == '_', '_');
    js::slice16(&replaced, max)
}

/// `getShaderFilename`.
fn shader_filename(shader: &Value) -> Result<String, String> {
    let name = js::get(Some(shader), "name").map_err(|_| "TypeError".to_string())?;
    let id = js::get(Some(shader), "id").map_err(|_| "TypeError".to_string())?;
    let safe_name = safe(name, "untitled", 50);
    let safe_id = safe(id, "", 64);
    if safe_id.is_empty() {
        return Err("Invalid shader ID".into());
    }
    Ok(format!("{safe_name}-{safe_id}{}", extension(shader.get("type"))))
}

fn pretty(v: &Value) -> String {
    serde_json::to_string_pretty(v).unwrap_or_default()
}

fn now_ms() -> u128 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis()).unwrap_or(0)
}

/// `readShaderIndexForUpdate`.
fn index_for_update(path: &Path) -> Result<Value, String> {
    let text = match fs::read(path) {
        Ok(bytes) => String::from_utf8_lossy(&bytes).into_owned(),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(json!({ "shaders": [] })),
        Err(e) => return Err(e.to_string()),
    };
    if let Ok(index) = serde_json::from_str::<Value>(&text)
        && matches!(index.get("shaders"), Some(Value::Array(_))) && index.is_object() {
            return Ok(index);
        }
    let mut aside = path.as_os_str().to_owned();
    aside.push(format!(".unreadable-{}", now_ms()));
    fs::rename(path, &aside).map_err(|e| e.to_string())?;
    eprintln!("[!] Shader index could not be parsed; kept it as {} and started a new one", PathBuf::from(aside).display());
    Ok(json!({ "shaders": [] }))
}

pub fn save(dir: &Path, shader: &Value) -> bool {
    let _guard = LOCK.lock().unwrap_or_else(|e| e.into_inner());
    ensure_dir(dir);
    let result = (|| -> Result<(), String> {
        let filename = shader_filename(shader)?;
        let index_path = dir.join("index.json");
        let mut index = index_for_update(&index_path)?;
        let Some(code) = shader.get("code").and_then(Value::as_str) else {
            return Err("The \"data\" argument must be a string".into());
        };
        write_atomic(&dir.join(&filename), code.as_bytes()).map_err(|e| e.to_string())?;
        let mut entry: Map<String, Value> = js::spread(Some(shader));
        entry.insert("filename".into(), Value::String(filename.clone()));
        entry.shift_remove("code");
        let shaders = index.get_mut("shaders").and_then(Value::as_array_mut).expect("checked when read");
        let mut existing = None;
        for (i, s) in shaders.iter().enumerate() {
            if js::strict_eq(js::get(Some(s), "id").map_err(|_| "TypeError".to_string())?, shader.get("id")) {
                existing = Some(i);
                break;
            }
        }
        match existing {
            Some(i) => shaders[i] = Value::Object(entry),
            None => shaders.push(Value::Object(entry)),
        }
        write_atomic(&index_path, pretty(&index).as_bytes()).map_err(|e| e.to_string())?;
        eprintln!("[+] Saved shader: {filename}");
        Ok(())
    })();
    match result {
        Ok(()) => true,
        Err(e) => {
            eprintln!("[!] Failed to save shader: {e}");
            false
        }
    }
}

pub fn delete(dir: &Path, shader_id: &str) -> bool {
    let _guard = LOCK.lock().unwrap_or_else(|e| e.into_inner());
    ensure_dir(dir);
    let index_path = dir.join("index.json");
    if !index_path.exists() {
        return false;
    }
    let result = (|| -> Result<bool, String> {
        let text = fs::read_to_string(&index_path).map_err(|e| e.to_string())?;
        let mut index: Value = serde_json::from_str(&text).map_err(|e| e.to_string())?;
        let id = Value::String(shader_id.into());
        let Some(Value::Array(shaders)) = js::get(Some(&index), "shaders").map_err(|_| "TypeError".to_string())?.cloned() else {
            return Err("TypeError".into());
        };
        let mut found = None;
        for s in &shaders {
            if js::strict_eq(js::get(Some(s), "id").map_err(|_| "TypeError".to_string())?, Some(&id)) {
                found = Some(s.clone());
                break;
            }
        }
        let Some(entry) = found else { return Ok(false) };
        let Some(filename) = entry.get("filename").and_then(Value::as_str) else { return Err("TypeError".into()) };
        let path = node_join(dir, filename);
        if path.exists() {
            fs::remove_file(&path).map_err(|e| e.to_string())?;
        }
        let mut kept = Vec::new();
        for s in shaders {
            if !js::strict_eq(js::get(Some(&s), "id").map_err(|_| "TypeError".to_string())?, Some(&id)) {
                kept.push(s);
            }
        }
        js::set(&mut index, "shaders", Some(Value::Array(kept))).map_err(|_| "TypeError".to_string())?;
        write_atomic(&index_path, pretty(&index).as_bytes()).map_err(|e| e.to_string())?;
        eprintln!("[-] Deleted shader: {filename}");
        Ok(true)
    })();
    match result {
        Ok(found) => found,
        Err(e) => {
            eprintln!("[!] Failed to delete shader: {e}");
            false
        }
    }
}

/// GET /api/shaders: every shader with its code. Err is a 500.
pub fn list(dir: &Path) -> Result<Value, String> {
    let _guard = LOCK.lock().unwrap_or_else(|e| e.into_inner());
    ensure_dir(dir);
    let index_path = dir.join("index.json");
    let shaders = if index_path.exists() {
        let loaded = (|| -> Result<Value, String> {
            let text = fs::read_to_string(&index_path).map_err(|e| e.to_string())?;
            let index: Value = serde_json::from_str(&text).map_err(|e| e.to_string())?;
            let shaders = js::get(Some(&index), "shaders").map_err(|_| "TypeError".to_string())?;
            Ok(shaders.filter(|v| js::truthy(Some(v))).cloned().unwrap_or_else(|| json!([])))
        })();
        match loaded {
            Ok(v) => v,
            Err(e) => {
                eprintln!("[!] Failed to load shader index: {e}");
                json!([])
            }
        }
    } else {
        json!([])
    };
    let Value::Array(entries) = shaders else {
        return Err("index.shaders.map is not a function".into());
    };
    let mut out = Vec::with_capacity(entries.len());
    for entry in entries {
        if entry.is_null() {
            return Err("Cannot read properties of null (reading 'id')".into());
        }
        let with_code = match entry.get("filename").and_then(Value::as_str) {
            Some(filename) => {
                let path = node_join(dir, filename);
                match fs::read(&path) {
                    Ok(bytes) if path.is_file() => {
                        let mut map = js::spread(Some(&entry));
                        map.insert("code".into(), Value::String(String::from_utf8_lossy(&bytes).into_owned()));
                        Value::Object(map)
                    }
                    _ => entry,
                }
            }
            None => entry,
        };
        out.push(with_code);
    }
    Ok(Value::Array(out))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("ga-shaders-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        dir
    }

    #[test]
    fn saves_lists_and_deletes() {
        let dir = temp_dir("roundtrip");
        assert!(!save(&dir, &json!({})));
        assert!(save(&dir, &json!({ "id": "a/b", "name": "My Shader!", "type": "shader-isf", "code": "void main(){}" })));
        assert!(dir.join("My_Shader_-a_b.fs").is_file());
        let listed = list(&dir).unwrap();
        assert_eq!(listed[0]["code"], "void main(){}");
        assert_eq!(listed[0]["filename"], "My_Shader_-a_b.fs");
        assert!(save(&dir, &json!({ "id": "a/b", "name": "My Shader!", "type": "shader-isf", "code": "v2" })));
        assert_eq!(list(&dir).unwrap().as_array().unwrap().len(), 1);
        assert!(!delete(&dir, "nope"));
        assert!(delete(&dir, "a/b"));
        assert!(!dir.join("My_Shader_-a_b.fs").exists());
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn moves_an_unreadable_index_aside() {
        let dir = temp_dir("aside");
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join("index.json"), "{not json").unwrap();
        assert!(save(&dir, &json!({ "id": "x", "code": "c" })));
        let aside = fs::read_dir(&dir).unwrap().filter_map(|e| e.ok()).any(|e| e.file_name().to_string_lossy().starts_with("index.json.unreadable-"));
        assert!(aside);
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn join_is_nodes() {
        assert_eq!(node_join(Path::new("/a/b"), "/etc/x"), PathBuf::from("/a/b/etc/x"));
        assert_eq!(node_join(Path::new("/a/b"), "../c"), PathBuf::from("/a/c"));
    }
}
