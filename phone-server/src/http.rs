//! The HTTP port: the phone web app, /info, and the desktop's shader API.

use crate::config::Config;
use crate::files::{self, Root};
use crate::hub::Shared;
use crate::ws::{header_first, header_joined, node_address, text_response};
use crate::{access, pairing, shaders};
use bytes::Bytes;
use http_body_util::{BodyExt, Full, Limited};
use hyper::body::Incoming;
use hyper::header::{self, HeaderValue};
use hyper::{Method, Request, Response, StatusCode};
use hyper_util::rt::TokioIo;
use serde_json::{Value, json};
use std::net::SocketAddr;
use std::sync::Arc;
use tokio::net::TcpListener;

/// Request bodies past this are refused by dropping the connection, as the
/// JS server's `req.destroy()` does.
const MAX_BODY_SIZE: usize = 5 * 1024 * 1024;

const UNPAIRED_MESSAGE: &str = "This device isn't paired. Scan the QR code in Ghost Arcade to pair it again.";

fn unpaired_page() -> String {
    format!(
        r#"<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8">
    <title>Ghost Arcade</title>
    <meta name="viewport" content="width=device-width, initial-scale=1">
  </head>
  <body style="font-family: sans-serif; padding: 24px; text-align: center; background: #111; color: #eee;">
    <h1>Ghost Arcade</h1>
    <p>{UNPAIRED_MESSAGE}</p>
    <form method="get" action="/#/mobile" style="margin-top: 24px;">
      <p><label for="pair">Or type the pairing code from Connect Mobile in Ghost Arcade:</label></p>
      <input id="pair" name="{}" autocomplete="off" autocapitalize="characters" spellcheck="false"
        style="font-size: 18px; padding: 10px; text-align: center; width: 16em; max-width: 90%;">
      <p><button type="submit" style="font-size: 16px; padding: 10px 24px;">Pair</button></p>
    </form>
  </body>
</html>"#,
        pairing::PAIRING_QUERY_PARAM
    )
}

pub fn local_ips() -> Vec<String> {
    if_addrs::get_if_addrs()
        .map(|list| {
            list.into_iter()
                .filter(|i| !i.is_loopback())
                .filter_map(|i| match i.ip() {
                    std::net::IpAddr::V4(v4) => Some(v4.to_string()),
                    _ => None,
                })
                .collect()
        })
        .unwrap_or_default()
}

/// `/^https?:\/\/(localhost|127\.0\.0\.1|192\.168\.\d+\.\d+|10\.\d+\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+)(:\d+)?$/`
pub fn local_origin(origin: &str) -> bool {
    let Some(rest) = origin.strip_prefix("http://").or_else(|| origin.strip_prefix("https://")) else { return false };
    let (host, port) = match rest.split_once(':') {
        Some((h, p)) => (h, Some(p)),
        None => (rest, None),
    };
    if port.is_some_and(|p| p.is_empty() || !p.bytes().all(|b| b.is_ascii_digit())) {
        return false;
    }
    if host == "localhost" || host == "127.0.0.1" {
        return true;
    }
    let parts: Vec<&str> = host.split('.').collect();
    let digits = |s: &str| !s.is_empty() && s.bytes().all(|b| b.is_ascii_digit());
    match parts.as_slice() {
        ["192", "168", a, b] => digits(a) && digits(b),
        ["10", a, b, c] => digits(a) && digits(b) && digits(c),
        ["172", second, a, b] => {
            let ok = matches!(second.as_bytes(), [b'1', b'6'..=b'9'] | [b'2', b'0'..=b'9'] | [b'3', b'0'..=b'1']);
            ok && digits(a) && digits(b)
        }
        _ => false,
    }
}

pub struct Http {
    pub config: Arc<Config>,
    pub shared: Arc<Shared>,
    pub dist: Root,
    pub public: Option<Root>,
}

pub async fn serve(listener: TcpListener, http: Arc<Http>) {
    loop {
        let Ok((stream, addr)) = listener.accept().await else { continue };
        let http = http.clone();
        tokio::spawn(async move {
            let service = hyper::service::service_fn(move |req| {
                let http = http.clone();
                async move { http.handle(req, addr).await }
            });
            let _ = hyper::server::conn::http1::Builder::new().serve_connection(TokioIo::new(stream), service).await;
        });
    }
}

fn json_response(status: StatusCode, v: &Value) -> Response<Full<Bytes>> {
    text_response(status, Some("application/json"), serde_json::to_string(v).unwrap_or_default())
}

#[derive(Debug)]
pub struct Dropped;
impl std::fmt::Display for Dropped {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("request body too large")
    }
}
impl std::error::Error for Dropped {}

impl Http {
    async fn handle(self: Arc<Self>, req: Request<Incoming>, addr: SocketAddr) -> Result<Response<Full<Bytes>>, Dropped> {
        let origin = header_joined(req.headers(), "origin", ", ").unwrap_or_default();
        let mut res = self.route(req, addr).await?;
        // Set on every answer, before anything else, as the JS server does.
        let h = res.headers_mut();
        h.insert("referrer-policy", HeaderValue::from_static("no-referrer"));
        h.insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
        let allow = if origin.is_empty() {
            "*".to_string()
        } else if local_origin(&origin) {
            origin
        } else {
            "null".to_string()
        };
        h.insert(header::ACCESS_CONTROL_ALLOW_ORIGIN, HeaderValue::from_str(&allow).unwrap_or(HeaderValue::from_static("null")));
        h.insert(header::ACCESS_CONTROL_ALLOW_METHODS, HeaderValue::from_static("GET, POST, DELETE, OPTIONS"));
        h.insert(header::ACCESS_CONTROL_ALLOW_HEADERS, HeaderValue::from_static("Content-Type, Authorization, X-GA-Desktop"));
        Ok(res)
    }

    async fn route(&self, req: Request<Incoming>, addr: SocketAddr) -> Result<Response<Full<Bytes>>, Dropped> {
        let address = node_address(&addr);
        let method = req.method().clone();
        // Browsers never send credentials on a preflight, and answering one
        // reads and changes nothing, so it comes before the token check.
        if method == Method::OPTIONS {
            return Ok(text_response(StatusCode::NO_CONTENT, None, Bytes::new()));
        }
        let safe_method = method == Method::GET || method == Method::HEAD;
        let target = req.uri().to_string();
        let cookie = header_joined(req.headers(), "cookie", "; ");
        let cookie_name = self.config.cookie_name();
        let presented = pairing::presented_token(
            header_first(req.headers(), "authorization"),
            &target,
            cookie.as_deref(),
            safe_method.then_some(cookie_name.as_str()),
        );
        let token = self.shared.token();
        if !pairing::token_matches(token.as_deref(), &presented) {
            self.shared.note_refused(&address, "HTTP request");
            let wants_page = method == Method::GET && header_joined(req.headers(), "accept", ", ").is_some_and(|a| a.contains("text/html"));
            return Ok(if wants_page {
                text_response(StatusCode::UNAUTHORIZED, Some("text/html; charset=utf-8"), unpaired_page())
            } else {
                json_response(StatusCode::UNAUTHORIZED, &json!({ "error": "unpaired" }))
            });
        }

        // A phone that came through the QR code has the token in its URL; its
        // page's own scripts, styles and images get it from this cookie.
        let set_cookie = pairing::query_has(&target, pairing::PAIRING_QUERY_PARAM);
        let mut res = self.route_paired(req, &address, &target, &method, safe_method).await?;
        if set_cookie {
            let token = token.unwrap_or_default();
            let value = format!("{cookie_name}={token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=31536000");
            if let Ok(v) = HeaderValue::from_str(&value) {
                res.headers_mut().insert(header::SET_COOKIE, v);
            }
        }
        Ok(res)
    }

    async fn route_paired(&self, req: Request<Incoming>, address: &str, target: &str, method: &Method, safe_method: bool) -> Result<Response<Full<Bytes>>, Dropped> {
        // The pairing token never authorizes a change; only the desktop's
        // credential does, and only from this machine.
        if !safe_method && !access::authorized_host_header(self.shared.credential().as_deref(), header_joined(req.headers(), "x-ga-desktop", ", ").as_deref(), address) {
            return Ok(json_response(StatusCode::FORBIDDEN, &json!({ "error": "desktop_authorization_required" })));
        }
        let pathname = files::url_pathname(target);
        let shaders_dir = self.config.shaders_dir.clone();

        if pathname == "/api/shaders" {
            if method == Method::GET {
                let listed = tokio::task::spawn_blocking(move || shaders::list(&shaders_dir)).await.unwrap_or_else(|e| Err(e.to_string()));
                return Ok(match listed {
                    Ok(list) => json_response(StatusCode::OK, &list),
                    Err(e) => json_response(StatusCode::INTERNAL_SERVER_ERROR, &json!({ "error": e })),
                });
            }
            if method == Method::POST {
                let body = match Limited::new(req.into_body(), MAX_BODY_SIZE).collect().await {
                    Ok(b) => b.to_bytes(),
                    Err(_) => return Err(Dropped),
                };
                let shader: Value = if body.is_empty() {
                    json!({})
                } else {
                    match serde_json::from_slice(&body) {
                        Ok(v) => v,
                        Err(e) => return Ok(json_response(StatusCode::BAD_REQUEST, &json!({ "error": e.to_string() }))),
                    }
                };
                let id = shader.get("id").cloned();
                let saved = tokio::task::spawn_blocking(move || shaders::save(&shaders_dir, &shader)).await.unwrap_or(false);
                return Ok(if saved {
                    let mut out = serde_json::Map::new();
                    out.insert("success".into(), Value::Bool(true));
                    if let Some(id) = id {
                        out.insert("id".into(), id);
                    }
                    json_response(StatusCode::CREATED, &Value::Object(out))
                } else {
                    json_response(StatusCode::INTERNAL_SERVER_ERROR, &json!({ "error": "Failed to save shader" }))
                });
            }
        }

        if pathname.starts_with("/api/shaders/") && method == Method::DELETE {
            let shader_id = pathname.rsplit('/').next().unwrap_or("").to_string();
            let valid = (1..=128).contains(&shader_id.len()) && shader_id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-');
            if !valid {
                return Ok(json_response(StatusCode::BAD_REQUEST, &json!({ "error": "Invalid shader ID" })));
            }
            let deleted = tokio::task::spawn_blocking(move || shaders::delete(&shaders_dir, &shader_id)).await.unwrap_or(false);
            return Ok(json_response(if deleted { StatusCode::OK } else { StatusCode::NOT_FOUND }, &json!({ "success": deleted })));
        }

        if pathname == "/info" {
            return Ok(json_response(
                StatusCode::OK,
                &json!({ "wsPort": self.config.ws_port_info, "httpPort": self.config.http_port_info, "ips": local_ips() }),
            ));
        }

        Ok(self.static_file(&pathname).await)
    }

    async fn static_file(&self, pathname: &str) -> Response<Full<Bytes>> {
        let req_path = if pathname == "/" {
            "/index.html".to_string()
        } else {
            match files::decode_uri_component(pathname) {
                Some(p) => p,
                None => return text_response(StatusCode::BAD_REQUEST, None, "Invalid path"),
            }
        };
        let Some(rel) = files::resolve_inside(&self.dist.dir, &req_path) else {
            return text_response(StatusCode::FORBIDDEN, Some("text/plain"), "Forbidden");
        };
        // Files read off the async threads, like the shader library.
        let found = {
            let dist = &self.dist;
            let public = self.public.as_ref();
            tokio::task::block_in_place(|| {
                if dist.is_file(&rel) {
                    return Some((rel.clone(), dist.read(&rel)));
                }
                // A development checkout's dist/ is whatever was built last;
                // public/ still has files added since.
                if let Some(public) = public
                    && let Some(prel) = files::resolve_inside(&public.dir, &req_path)
                        && public.is_file(&prel) {
                            return Some((prel.clone(), public.read(&prel)));
                        }
                let index = vec!["index.html".to_string()];
                dist.is_file(&index).then(|| (index.clone(), dist.read(&index)))
            })
        };
        match found {
            Some((rel, Some(data))) => {
                let name = rel.last().cloned().unwrap_or_default();
                text_response(StatusCode::OK, Some(files::mime_type(&files::extname(&name))), data)
            }
            Some((_, None)) => text_response(StatusCode::INTERNAL_SERVER_ERROR, None, "Internal Server Error"),
            None => {
                let ip = local_ips().into_iter().next().unwrap_or_else(|| "localhost".into());
                let page = format!(
                    "\n      <!DOCTYPE html>\n      <html>\n        <head>\n          <title>Ghost Arcade Mobile</title>\n          <meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">\n        </head>\n        <body style=\"font-family: sans-serif; padding: 20px; text-align: center; background: #111; color: #eee;\">\n          <h1>Ghost Arcade Mobile</h1>\n          <p>WebSocket Server: ws://{ip}:{}</p>\n          <p>Mobile interface not found. Please rebuild the app.</p>\n        </body>\n      </html>\n    ",
                    crate::js::to_string(Some(&self.config.ws_port_info))
                );
                text_response(StatusCode::OK, Some("text/html"), page)
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn local_origins() {
        for ok in ["http://localhost", "http://localhost:1420", "https://127.0.0.1", "http://192.168.0.5:9002", "http://10.1.2.3", "http://172.16.0.1", "http://172.31.9.9:1"] {
            assert!(local_origin(ok), "{ok}");
        }
        for bad in ["http://172.32.0.1", "http://evil.com", "http://localhost.evil.com", "http://localhost:", "capacitor://localhost", "http://192.168.1.1.evil", "HTTP://localhost", "http://10.0.0.1/x"] {
            assert!(!local_origin(bad), "{bad}");
        }
    }
}
