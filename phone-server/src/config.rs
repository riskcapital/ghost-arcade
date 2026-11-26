//! Startup settings, from the same environment variables the JS server reads,
//! plus where the files it serves are (the JS server works those out from its
//! own location; this binary is told).

use serde_json::Value;
use std::path::PathBuf;

pub struct Config {
    pub bind_host: String,
    pub ws_port: u16,
    pub http_port: u16,
    /// `process.env.WS_PORT || 9001`, as /info reports it: the variable's
    /// text when it is set, the number otherwise.
    pub ws_port_info: Value,
    pub http_port_info: Value,
    /// The configured HTTP port as text (the cookie is named after it).
    pub http_port_text: String,
    pub dist_dir: PathBuf,
    pub public_dir: Option<PathBuf>,
    pub shaders_dir: PathBuf,
}

fn port(var: &str, fallback: u16) -> (u16, Value, String) {
    match std::env::var(var).ok().filter(|v| !v.is_empty()) {
        Some(text) => (text.trim().parse().unwrap_or(fallback), Value::String(text.clone()), text),
        None => (fallback, Value::from(fallback), fallback.to_string()),
    }
}

fn dir(var: &str) -> Option<PathBuf> {
    std::env::var_os(var).filter(|v| !v.is_empty()).map(PathBuf::from)
}

impl Config {
    pub fn from_env() -> Config {
        let (ws_port, ws_port_info, _) = port("WS_PORT", 9001);
        let (http_port, http_port_info, http_port_text) = port("HTTP_PORT", 9002);
        let here = std::env::current_dir().unwrap_or_default();
        Config {
            bind_host: std::env::var("GA_REMOTE_BIND_HOST").ok().filter(|v| !v.is_empty()).unwrap_or_else(|| "0.0.0.0".into()),
            ws_port,
            http_port,
            ws_port_info,
            http_port_info,
            http_port_text,
            dist_dir: dir("GA_PHONE_DIST_DIR").unwrap_or_else(|| here.join("dist")),
            public_dir: dir("GA_PHONE_PUBLIC_DIR"),
            shaders_dir: dir("GA_PHONE_SHADERS_DIR").unwrap_or_else(|| here.join("user-shaders")),
        }
    }

    pub fn cookie_name(&self) -> String {
        format!("ga_pair_{}", self.http_port_text)
    }
}
