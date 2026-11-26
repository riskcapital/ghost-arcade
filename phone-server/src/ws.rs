//! The WebSocket port. Upgrades become relay connections once the pairing
//! token checks out; the only plain request it answers is /pair/check.

use crate::config::Config;
use crate::hub::{Event, Handle, Out, Shared};
use crate::{files, js, pairing};
use bytes::Bytes;
use futures_util::{SinkExt, StreamExt};
use http_body_util::Full;
use hyper::body::Incoming;
use hyper::header::{self, HeaderMap, HeaderValue};
use hyper::{Request, Response, StatusCode};
use hyper_util::rt::TokioIo;
use serde_json::Value;
use std::net::SocketAddr;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, AtomicU64, AtomicUsize, Ordering};
use std::time::Duration;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;
use tokio::sync::{Notify, mpsc};
use tokio_tungstenite::WebSocketStream;
use tokio_tungstenite::tungstenite::error::CapacityError;
use tokio_tungstenite::tungstenite::handshake::derive_accept_key;
use tokio_tungstenite::tungstenite::protocol::frame::CloseFrame;
use tokio_tungstenite::tungstenite::protocol::{Role, WebSocketConfig};
use tokio_tungstenite::tungstenite::{Error as WsError, Message};

/// 10 MB, past which a message closes the connection with 1009 (prevents OOM).
pub const MAX_PAYLOAD: usize = 10 * 1024 * 1024;
/// 200 messages a second per client; past that they are dropped.
const RATE_LIMIT: u32 = 200;

static NEXT_ID: AtomicU64 = AtomicU64::new(1);

pub fn text_response(status: StatusCode, content_type: Option<&str>, body: impl Into<Bytes>) -> Response<Full<Bytes>> {
    let mut res = Response::new(Full::new(body.into()));
    *res.status_mut() = status;
    if let Some(ct) = content_type {
        res.headers_mut().insert(header::CONTENT_TYPE, HeaderValue::from_str(ct).expect("static header"));
    }
    res
}

/// The first value of a header Node keeps only once.
pub fn header_first<'a>(headers: &'a HeaderMap, name: &str) -> Option<&'a str> {
    headers.get(name).and_then(|v| v.to_str().ok())
}

/// A header Node joins when it is repeated.
pub fn header_joined(headers: &HeaderMap, name: &str, sep: &str) -> Option<String> {
    let parts: Vec<&str> = headers.get_all(name).iter().filter_map(|v| v.to_str().ok()).collect();
    (!parts.is_empty()).then(|| parts.join(sep))
}

/// `socket.remoteAddress` as Node writes it.
pub fn node_address(addr: &SocketAddr) -> String {
    addr.ip().to_string()
}

fn wants_upgrade(req: &Request<Incoming>) -> bool {
    let connection_upgrade = req
        .headers()
        .get_all(header::CONNECTION)
        .iter()
        .filter_map(|v| v.to_str().ok())
        .flat_map(|v| v.split(','))
        .any(|t| t.trim().eq_ignore_ascii_case("upgrade"));
    connection_upgrade && req.headers().contains_key(header::UPGRADE)
}

/// What ws's abortHandshake writes.
fn abort(status: StatusCode, message: Option<&str>) -> Response<Full<Bytes>> {
    let message = message.unwrap_or_else(|| status.canonical_reason().unwrap_or(""));
    let mut res = text_response(status, Some("text/html"), message.to_string());
    res.headers_mut().insert(header::CONNECTION, HeaderValue::from_static("close"));
    res
}

fn key_valid(key: &str) -> bool {
    key.len() == 24 && key.ends_with("==") && key[..22].bytes().all(|b| b.is_ascii_alphanumeric() || b == b'+' || b == b'/')
}

/// ws's subprotocol.parse: comma separated tokens, no repeats.
fn parse_protocols(header: &str) -> Option<Vec<String>> {
    let mut out: Vec<String> = Vec::new();
    for part in header.split(',') {
        let p = part.trim_matches([' ', '\t']);
        let tchar = |b: u8| b.is_ascii_alphanumeric() || b"!#$%&'*+-.^_`|~".contains(&b);
        if p.is_empty() || !p.bytes().all(tchar) || out.iter().any(|o| o == p) {
            return None;
        }
        out.push(p.to_string());
    }
    Some(out)
}

/// The app shell's origin: capacitor:// on iOS, http(s)://localhost on Android.
fn is_phone_app_origin(origin: &str) -> bool {
    let o = origin.to_ascii_lowercase();
    ["capacitor://localhost", "ionic://localhost", "http://localhost", "https://localhost"].contains(&o.as_str())
}

/// `new URL('http://' + host).hostname`, for an address someone dialled.
fn hostname_of(host: &str) -> Option<String> {
    let host = host.rsplit('@').next().unwrap_or(host);
    if host.is_empty() {
        return None;
    }
    if let Some(rest) = host.strip_prefix('[') {
        let end = rest.find(']')?;
        let addr: std::net::Ipv6Addr = rest[..end].parse().ok()?;
        let after = &rest[end + 1..];
        if !(after.is_empty() || after.strip_prefix(':').is_some_and(|p| p.bytes().all(|b| b.is_ascii_digit()))) {
            return None;
        }
        return Some(format!("[{addr}]"));
    }
    let (name, port) = host.split_once(':').unwrap_or((host, ""));
    if !port.bytes().all(|b| b.is_ascii_digit()) || name.is_empty() {
        return None;
    }
    if name.contains([' ', '#', '%', '/', '<', '>', '?', '\\', '^', '|', '[', ']']) {
        return None;
    }
    Some(name.to_lowercase())
}

fn asset_base_for(headers: &HeaderMap, config: &Config) -> Option<String> {
    if !is_phone_app_origin(&header_joined(headers, "origin", ", ").unwrap_or_default()) {
        return None;
    }
    let host = hostname_of(header_first(headers, "host").unwrap_or(""))?;
    let host = if host.contains(':') && !host.starts_with('[') { format!("[{host}]") } else { host };
    Some(format!("http://{host}:{}", config.http_port_text))
}

pub async fn serve(listener: TcpListener, shared: Arc<Shared>, events: mpsc::UnboundedSender<Event>, config: Arc<Config>) {
    loop {
        let Ok((stream, addr)) = listener.accept().await else { continue };
        let _ = stream.set_nodelay(true);
        let (shared, events, config) = (shared.clone(), events.clone(), config.clone());
        tokio::spawn(async move {
            let service = hyper::service::service_fn(move |req| {
                let (shared, events, config) = (shared.clone(), events.clone(), config.clone());
                async move { Ok::<_, std::convert::Infallible>(handle(req, addr, shared, events, config)) }
            });
            let _ = hyper::server::conn::http1::Builder::new()
                .serve_connection(TokioIo::new(stream), service)
                .with_upgrades()
                .await;
        });
    }
}

fn handle(req: Request<Incoming>, addr: SocketAddr, shared: Arc<Shared>, events: mpsc::UnboundedSender<Event>, config: Arc<Config>) -> Response<Full<Bytes>> {
    let address = node_address(&addr);
    let target = req.uri().to_string();
    let presented = pairing::presented_token(header_first(req.headers(), "authorization"), &target, None, None);
    let paired = pairing::token_matches(shared.token().as_deref(), &presented);

    if !wants_upgrade(&req) {
        return if files::url_pathname(&target) == "/pair/check" {
            // Readable from any origin: it only says whether the token is right.
            let mut res = text_response(if paired { StatusCode::NO_CONTENT } else { StatusCode::UNAUTHORIZED }, None, Bytes::new());
            res.headers_mut().insert(header::ACCESS_CONTROL_ALLOW_ORIGIN, HeaderValue::from_static("*"));
            res.headers_mut().insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
            return res;
        } else if paired {
            text_response(StatusCode::UPGRADE_REQUIRED, Some("text/plain"), "Upgrade Required")
        } else {
            shared.note_refused(&address, "request");
            text_response(StatusCode::UNAUTHORIZED, Some("text/plain"), "Unauthorized")
        };
    }

    // ws's handleUpgrade checks, in its order.
    if req.method() != hyper::Method::GET {
        return abort(StatusCode::METHOD_NOT_ALLOWED, Some("Invalid HTTP method"));
    }
    if !header_first(req.headers(), "upgrade").is_some_and(|u| u.eq_ignore_ascii_case("websocket")) {
        return abort(StatusCode::BAD_REQUEST, Some("Invalid Upgrade header"));
    }
    let key = header_first(req.headers(), "sec-websocket-key").unwrap_or("").to_string();
    if !key_valid(&key) {
        return abort(StatusCode::BAD_REQUEST, Some("Missing or invalid Sec-WebSocket-Key header"));
    }
    let version = header_first(req.headers(), "sec-websocket-version").unwrap_or("").trim().to_string();
    if version != "13" && version != "8" {
        let mut res = abort(StatusCode::BAD_REQUEST, Some("Missing or invalid Sec-WebSocket-Version header"));
        res.headers_mut().insert("sec-websocket-version", HeaderValue::from_static("13, 8"));
        return res;
    }
    let protocols = match header_joined(req.headers(), "sec-websocket-protocol", ", ") {
        Some(h) => match parse_protocols(&h) {
            Some(p) => p,
            None => return abort(StatusCode::BAD_REQUEST, Some("Invalid Sec-WebSocket-Protocol header")),
        },
        None => Vec::new(),
    };
    // Bound to every interface so phones can reach it, which is why an
    // upgrade without the pairing token is refused before a socket exists.
    let generation = shared.generation.load(Ordering::SeqCst);
    if !paired {
        shared.note_refused(&address, "WebSocket connection");
        return abort(StatusCode::UNAUTHORIZED, None);
    }

    let asset_base = asset_base_for(req.headers(), &config);
    let mut res = Response::new(Full::new(Bytes::new()));
    *res.status_mut() = StatusCode::SWITCHING_PROTOCOLS;
    let h = res.headers_mut();
    h.insert(header::UPGRADE, HeaderValue::from_static("websocket"));
    h.insert(header::CONNECTION, HeaderValue::from_static("Upgrade"));
    h.insert(header::SEC_WEBSOCKET_ACCEPT, HeaderValue::from_str(&derive_accept_key(key.as_bytes())).expect("base64"));
    if let Some(first) = protocols.first()
        && let Ok(v) = HeaderValue::from_str(first) {
            h.insert(header::SEC_WEBSOCKET_PROTOCOL, v);
        }
    tokio::spawn(async move {
        let Ok(upgraded) = hyper::upgrade::on(req).await else { return };
        let config = WebSocketConfig::default().max_message_size(Some(MAX_PAYLOAD)).max_frame_size(Some(MAX_PAYLOAD));
        let ws = WebSocketStream::from_raw_socket(TokioIo::new(upgraded), Role::Server, Some(config)).await;
        run_connection(ws, address, asset_base, generation, shared, events).await;
    });
    res
}

async fn run_connection<S>(mut ws: WebSocketStream<S>, address: String, asset_base: Option<String>, generation: u64, shared: Arc<Shared>, events: mpsc::UnboundedSender<Event>)
where
    S: tokio::io::AsyncRead + tokio::io::AsyncWrite + Unpin,
{
    let id = NEXT_ID.fetch_add(1, Ordering::SeqCst);
    let (tx, mut rx) = mpsc::unbounded_channel();
    let handle = Handle {
        tx,
        queued: Arc::new(AtomicUsize::new(0)),
        terminate: Arc::new(Notify::new()),
        last_heard: Arc::new(AtomicU64::new(shared.now_ms())),
        open: Arc::new(AtomicBool::new(true)),
    };
    let (queued, terminate, last_heard, open) = (handle.queued.clone(), handle.terminate.clone(), handle.last_heard.clone(), handle.open.clone());
    if events.send(Event::Connected { id, handle, remote: address.clone(), asset_base, generation }).is_err() {
        return;
    }

    let mut msg_count = 0u32;
    let mut msg_reset = std::time::Instant::now();
    let mut close_deadline: Option<tokio::time::Instant> = None;

    loop {
        let deadline = close_deadline;
        tokio::select! {
            biased;
            _ = terminate.notified() => break,
            _ = async { tokio::time::sleep_until(deadline.unwrap()).await }, if deadline.is_some() => break,
            out = rx.recv() => match out {
                Some(Out::Text(text)) => {
                    let len = text.len();
                    let sent = ws.send(Message::Text(text)).await;
                    queued.fetch_sub(len, Ordering::SeqCst);
                    if sent.is_err() { break; }
                }
                Some(Out::Ping) => { if ws.send(Message::Ping(Bytes::new())).await.is_err() { break; } }
                Some(Out::Close(code, reason, wait)) => {
                    if close_deadline.is_none() {
                        let frame = CloseFrame { code: code.into(), reason: reason.into() };
                        if ws.send(Message::Close(Some(frame))).await.is_err() { break; }
                        close_deadline = Some(tokio::time::Instant::now() + wait);
                    }
                }
                None => break,
            },
            frame = ws.next() => match frame {
                Some(Ok(Message::Text(text))) => incoming(text.as_str(), id, &open, &last_heard, &shared, &events, &mut msg_count, &mut msg_reset),
                Some(Ok(Message::Binary(data))) => incoming(&String::from_utf8_lossy(&data), id, &open, &last_heard, &shared, &events, &mut msg_count, &mut msg_reset),
                Some(Ok(Message::Pong(_))) => last_heard.store(shared.now_ms(), Ordering::SeqCst),
                Some(Ok(_)) => {}
                Some(Err(WsError::Capacity(CapacityError::MessageTooLong { .. }))) => {
                    // ws closes with 1009 (Message Too Big). Its peer is still
                    // sending the oversized message, so read it off before
                    // closing; a socket closed with unread data resets, and the
                    // peer could lose the close frame.
                    open.store(false, Ordering::SeqCst);
                    let raw = ws.get_mut();
                    if raw.write_all(&[0x88, 0x02, 0x03, 0xF1]).await.is_ok() && raw.flush().await.is_ok() {
                        let mut sink = vec![0u8; 64 * 1024];
                        let drain = async { while matches!(raw.read(&mut sink).await, Ok(n) if n > 0) {} };
                        let _ = tokio::time::timeout(Duration::from_secs(30), drain).await;
                    }
                    break;
                }
                Some(Err(_)) | None => break,
            },
        }
    }
    open.store(false, Ordering::SeqCst);
    let _ = events.send(Event::Closed { id });
}

#[allow(clippy::too_many_arguments)]
fn incoming(text: &str, id: u64, open: &AtomicBool, last_heard: &AtomicU64, shared: &Shared, events: &mpsc::UnboundedSender<Event>, count: &mut u32, reset: &mut std::time::Instant) {
    // A socket being closed (a pairing reset, say) no longer speaks for a
    // paired device, so nothing it sends meanwhile is handled.
    if !open.load(Ordering::SeqCst) {
        return;
    }
    last_heard.store(shared.now_ms(), Ordering::SeqCst);
    if reset.elapsed() > Duration::from_millis(1000) {
        *count = 0;
        *reset = std::time::Instant::now();
    }
    *count += 1;
    if *count > RATE_LIMIT {
        return;
    }
    match serde_json::from_str::<Value>(text) {
        Ok(Value::Object(msg)) => {
            let Some(kind) = msg.get("type").and_then(Value::as_str) else {
                eprintln!("[!] Invalid message structure, ignoring");
                return;
            };
            if js::len16(kind) > 64 {
                return;
            }
            let _ = events.send(Event::Message { id, msg });
        }
        Ok(_) => eprintln!("[!] Invalid message structure, ignoring"),
        Err(err) => eprintln!("[!] Failed to parse message: {err}"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn handshake_checks() {
        assert!(key_valid("dGhlIHNhbXBsZSBub25jZQ=="));
        assert!(!key_valid("dGhlIHNhbXBsZSBub25jZQ="));
        assert_eq!(parse_protocols("a, b").unwrap(), vec!["a", "b"]);
        assert!(parse_protocols("a, a").is_none());
        assert!(parse_protocols("a,,b").is_none());
        assert!(is_phone_app_origin("capacitor://localhost"));
        assert!(is_phone_app_origin("HTTP://LOCALHOST"));
        assert!(!is_phone_app_origin("http://localhost:5173"));
        assert_eq!(hostname_of("192.168.1.4:9001").as_deref(), Some("192.168.1.4"));
        assert_eq!(hostname_of("[0:0::1]:9001").as_deref(), Some("[::1]"));
        assert_eq!(hostname_of("Host.Local").as_deref(), Some("host.local"));
        assert_eq!(hostname_of(""), None);
        assert_eq!(hostname_of("a:b"), None);
    }
}
