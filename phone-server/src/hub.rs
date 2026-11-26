//! The relay itself: who is connected, the state a phone is synced with, and
//! what each message does. One task owns all of it and handles one event at a
//! time, in the order they arrive, as the single-threaded JS server does, so
//! the routing rules come out the same.

use crate::access;
use crate::js::{self, TypeError};
use crate::pairing;
use indexmap::IndexMap;
use serde_json::{Map, Value, json};
use std::sync::atomic::{AtomicBool, AtomicU64, AtomicUsize, Ordering};
use std::sync::{Arc, RwLock};
use std::time::{Duration, Instant};
use tokio::sync::{Notify, mpsc, oneshot};
use tokio_tungstenite::tungstenite::Utf8Bytes;

/// The most a client may have queued and unsent before it is dropped.
pub const MAX_BUFFERED_BYTES: usize = 8 * 1024 * 1024;
pub const HEARTBEAT: Duration = Duration::from_secs(10);
pub const HEARTBEAT_TIMEOUT_MS: u64 = 25_000;

/// What the connection task writes to its socket, in order.
pub enum Out {
    Text(Utf8Bytes),
    Ping,
    /// A close frame; the task then waits this long for the peer's.
    Close(u16, String, Duration),
}

/// State shared with the listeners, which check tokens before the hub hears
/// of a connection.
pub struct Shared {
    pub token: RwLock<Option<String>>,
    /// Bumped on every token change. A connection let in under an older one
    /// is closed as if it had been open at the reset.
    pub generation: AtomicU64,
    pub credential: RwLock<Option<String>>,
    pub started: Instant,
    pub refused: std::sync::Mutex<(u64, Option<Instant>)>,
}

impl Shared {
    pub fn now_ms(&self) -> u64 {
        self.started.elapsed().as_millis() as u64
    }

    pub fn token(&self) -> Option<String> {
        self.token.read().unwrap().clone()
    }

    pub fn credential(&self) -> Option<String> {
        self.credential.read().unwrap().clone()
    }

    /// One line every few seconds about refused attempts, however many there are.
    pub fn note_refused(&self, address: &str, what: &str) {
        let mut refused = self.refused.lock().unwrap();
        refused.0 += 1;
        if refused.1.is_some_and(|at| at.elapsed() < Duration::from_secs(5)) {
            return;
        }
        eprintln!("[!] Refused unpaired {what} from {address} ({} since last report)", refused.0);
        refused.0 = 0;
        refused.1 = Some(Instant::now());
    }
}

/// The connection task's side of a client.
#[derive(Clone)]
pub struct Handle {
    pub tx: mpsc::UnboundedSender<Out>,
    pub queued: Arc<AtomicUsize>,
    pub terminate: Arc<Notify>,
    pub last_heard: Arc<AtomicU64>,
    /// `readyState === OPEN`. Cleared the moment the server closes or drops it.
    pub open: Arc<AtomicBool>,
}

pub enum Event {
    Connected { id: u64, handle: Handle, remote: String, asset_base: Option<String>, generation: u64 },
    Message { id: u64, msg: Map<String, Value> },
    Closed { id: u64 },
    SetToken(String, oneshot::Sender<()>),
    SetCredential(Value, oneshot::Sender<()>),
    Heartbeat,
    Reap(Vec<u64>),
}

struct Client {
    handle: Handle,
    remote: String,
    studio_address: String,
    studio_peers: Vec<String>,
    studio_client: Option<Value>,
    studio_client_seen: Option<String>,
    asset_base: Option<String>,
}

impl Client {
    fn is_open(&self) -> bool {
        self.handle.open.load(Ordering::SeqCst)
    }
}

pub struct Hub {
    shared: Arc<Shared>,
    events: mpsc::UnboundedSender<Event>,
    clients: IndexMap<u64, Client>,
    desktop: Option<u64>,
    /// `projectState`; None is `undefined` (a sync that carried no project).
    project: Option<Value>,
    media: Value,
    vj_clips: Option<Value>,
    compositions: Value,
    output_frozen: bool,
    show_state: Option<Value>,
    shader_library: Vec<Value>,
    /// `privateRoutes`, in insertion order (the oldest is dropped first).
    routes: IndexMap<String, u64>,
    last_heartbeat_ms: u64,
}

const THUMBNAIL_MESSAGES: &[&str] = &["vj_clips_sync", "library_sync", "shader_library_sync"];

const ALLOWED_LAYER_SHAPES: &[&str] = &["rectangle", "circle", "ellipse", "triangle", "polygon", "star", "line", "polyline", "custom"];

fn create_mesh_grid(rows: u32, cols: u32) -> Value {
    let points: Vec<Value> = (0..rows)
        .map(|r| {
            Value::Array(
                (0..cols)
                    .map(|c| json!({ "x": num(c as f64 / (cols - 1) as f64), "y": num(r as f64 / (rows - 1) as f64) }))
                    .collect(),
            )
        })
        .collect();
    json!({ "rows": rows, "cols": cols, "points": points })
}

/// A computed number, written the way JSON.stringify writes it.
fn num(f: f64) -> Value {
    if f.fract() == 0.0 && f.abs() < 9.0e15 {
        json!(f as i64)
    } else {
        json!(f)
    }
}

fn default_layer_shape(kind: &str) -> Value {
    let base = |extra: Value| {
        let mut params = json!({ "feather": 0, "rotation": 0 });
        if let (Some(p), Some(e)) = (params.as_object_mut(), extra.as_object()) {
            for (k, v) in e {
                p.insert(k.clone(), v.clone());
            }
        }
        params
    };
    match kind {
        "circle" => json!({
            "type": kind, "enabled": true, "params": base(json!({ "radiusX": 1.0, "radiusY": 1.0 })),
            "controlPoints": [{ "x": 0.2, "y": 0.8 }, { "x": 0.8, "y": 0.8 }, { "x": 0.2, "y": 0.2 }, { "x": 0.8, "y": 0.2 }, { "x": 0.5, "y": 0.5 }],
        }),
        "ellipse" => json!({ "type": kind, "enabled": true, "params": base(json!({ "radiusX": 1.0, "radiusY": 0.7 })) }),
        "triangle" => json!({
            "type": kind, "enabled": true, "params": base(json!({ "triangleType": "equilateral" })),
            "controlPoints": [{ "x": 0.5, "y": 0.88 }, { "x": 0.14, "y": 0.14 }, { "x": 0.86, "y": 0.14 }],
        }),
        "polygon" => json!({ "type": kind, "enabled": true, "params": base(json!({ "sides": 6 })) }),
        "star" => json!({ "type": kind, "enabled": true, "params": base(json!({ "sides": 5, "innerRadius": 0.4 })) }),
        "line" => json!({
            "type": kind, "enabled": true,
            "params": base(json!({ "lineWidth": 0.05, "linePoints": [{ "x": 0.2, "y": 0.5 }, { "x": 0.8, "y": 0.5 }], "lineCap": "round" })),
        }),
        "polyline" => json!({
            "type": kind, "enabled": true,
            "params": base(json!({
                "lineWidth": 0.03,
                "linePoints": [{ "x": 0.1, "y": 0.5 }, { "x": 0.3, "y": 0.2 }, { "x": 0.5, "y": 0.8 }, { "x": 0.7, "y": 0.3 }, { "x": 0.9, "y": 0.6 }],
                "lineCap": "round",
            })),
        }),
        "custom" => json!({ "type": "custom", "enabled": true, "params": base(json!({ "customPoints": [], "customClosed": false })) }),
        _ => json!({ "type": "rectangle", "enabled": true, "params": base(json!({})) }),
    }
}

fn serialize(v: &Value) -> String {
    serde_json::to_string(v).unwrap_or_else(|_| "null".into())
}

fn obj(map: Map<String, Value>) -> Value {
    Value::Object(map)
}

/// `{ ...msg, from }`.
fn stamped(msg: &Map<String, Value>, from: &str) -> Value {
    let mut out = msg.clone();
    out.insert("from".into(), Value::String(from.into()));
    Value::Object(out)
}

fn rewrite_thumbnails(value: &Value, base: &str, token: &str) -> Value {
    let fix = |src: &Value| -> Value {
        let Some(s) = src.as_str() else { return src.clone() };
        if !(s.starts_with("./") || (s.starts_with('/') && !s.starts_with("//"))) {
            return src.clone();
        }
        let path_part = s.strip_prefix("./").or_else(|| s.strip_prefix('/')).unwrap_or(s);
        let sep = if path_part.contains('?') { '&' } else { '?' };
        Value::String(format!("{base}/{path_part}{sep}{}={}", pairing::PAIRING_QUERY_PARAM, encode_uri_component(token)))
    };
    match value {
        Value::Array(items) => Value::Array(items.iter().map(|v| rewrite_thumbnails(v, base, token)).collect()),
        Value::Object(map) => Value::Object(
            map.iter()
                .map(|(k, v)| (k.clone(), if k == "thumbnail" { fix(v) } else { rewrite_thumbnails(v, base, token) }))
                .collect(),
        ),
        other => other.clone(),
    }
}

fn encode_uri_component(s: &str) -> String {
    let mut out = String::new();
    for b in s.bytes() {
        if b.is_ascii_alphanumeric() || b"-_.!~*'()".contains(&b) {
            out.push(b as char);
        } else {
            out.push_str(&format!("%{b:02X}"));
        }
    }
    out
}

/// `layers.find(l => l.id === id)` on `projectState`, with its TypeErrors.
fn find_layer<'a>(project: &'a mut Option<Value>, id: Option<&Value>) -> Result<Option<&'a mut Value>, TypeError> {
    let layers = match project {
        None | Some(Value::Null) => return Err(TypeError),
        Some(Value::Object(map)) => map.get_mut("layers"),
        Some(_) => None,
    };
    let Some(Value::Array(layers)) = layers else { return Err(TypeError) };
    for layer in layers.iter_mut() {
        let lid = js::get(Some(layer), "id")?;
        if js::strict_eq(lid, id) {
            // `if (layer)` / `layer &&` / `layer?.x`: a falsy match counts as none.
            return Ok(js::truthy(Some(&*layer)).then_some(layer));
        }
    }
    Ok(None)
}

/// `list.find(e => e.id === id)` where `list` may be anything (`?.find`).
fn find_by_id<'a>(list: Option<&'a mut Value>, id: Option<&Value>) -> Result<Option<&'a mut Value>, TypeError> {
    match list {
        None | Some(Value::Null) => Ok(None),
        Some(Value::Array(items)) => {
            for item in items.iter_mut() {
                if js::strict_eq(js::get(Some(item), "id")?, id) {
                    return Ok(Some(item));
                }
            }
            Ok(None)
        }
        // Not a function on anything else.
        Some(_) => Err(TypeError),
    }
}

fn prop_mut<'a>(v: &'a mut Value, key: &str) -> Option<&'a mut Value> {
    v.as_object_mut()?.get_mut(key)
}

/// `{ ...(target.params || {}), ...params }` assigned to `target.params`.
fn merge_params(target: &mut Value, params: &Map<String, Value>) -> Result<(), TypeError> {
    let current = js::get(Some(target), "params")?;
    let mut merged = if js::truthy(current) { js::spread(current) } else { Map::new() };
    for (k, v) in params {
        merged.insert(k.clone(), v.clone());
    }
    js::set(target, "params", Some(Value::Object(merged)))
}

fn toggle(target: &mut Value, key: &str) -> Result<(), TypeError> {
    let now = js::truthy(js::get(Some(target), key)?);
    js::set(target, key, Some(Value::Bool(!now)))
}

/// The clip count the JS server logs; the TypeErrors computing it stopped it
/// from passing the update on.
fn vj_clip_count(state: Option<&Value>) -> Result<usize, TypeError> {
    let blocks = match state {
        None | Some(Value::Null) => return Ok(0),
        Some(v) => js::get(Some(v), "blocks")?,
    };
    match blocks {
        None | Some(Value::Null) => Ok(0),
        Some(Value::Array(blocks)) => {
            let mut total = 0;
            for b in blocks {
                let Some(Value::Array(grid)) = js::get(Some(b), "clipGrid")? else { return Err(TypeError) };
                for cell in grid {
                    match cell {
                        Value::Array(inner) => total += inner.iter().filter(|c| !c.is_null()).count(),
                        Value::Null => {}
                        _ => total += 1,
                    }
                }
            }
            Ok(total)
        }
        Some(_) => Err(TypeError),
    }
}

fn id_like(v: Option<&Value>, max: usize, extra: &[char]) -> Option<String> {
    let s = v?.as_str()?;
    let n = s.chars().count();
    ((1..=max).contains(&n) && s.chars().all(|c| js::is_word(c) || extra.contains(&c))).then(|| s.to_string())
}

fn kind_of(msg: &Map<String, Value>) -> &str {
    msg.get("type").and_then(Value::as_str).unwrap_or("")
}

impl Hub {
    pub fn new(shared: Arc<Shared>, events: mpsc::UnboundedSender<Event>) -> Hub {
        Hub {
            last_heartbeat_ms: shared.now_ms(),
            shared,
            events,
            clients: IndexMap::new(),
            desktop: None,
            project: Some(json!({
                "id": "default", "name": "Untitled Project", "width": 1920, "height": 1080, "layers": [], "selectedLayerId": null,
            })),
            media: json!([]),
            vj_clips: None,
            compositions: json!([]),
            output_frozen: false,
            show_state: None,
            shader_library: Vec::new(),
            routes: IndexMap::new(),
        }
    }

    pub async fn run(mut self, mut rx: mpsc::UnboundedReceiver<Event>) {
        while let Some(event) = rx.recv().await {
            self.handle_event(event);
        }
    }

    fn handle_event(&mut self, event: Event) {
        match event {
            Event::Connected { id, handle, remote, asset_base, generation } => {
                if generation != self.shared.generation.load(Ordering::SeqCst) {
                    // Let in under a token that has since been reset.
                    handle.open.store(false, Ordering::SeqCst);
                    let _ = handle.tx.send(Out::Close(pairing::PAIRING_RESET_CLOSE_CODE, "unpaired".into(), Duration::from_secs(1)));
                    return;
                }
                self.connected(id, handle, remote, asset_base);
            }
            Event::Message { id, msg } => {
                if self.clients.get(&id).is_some_and(Client::is_open) {
                    self.handle_message(id, msg);
                }
            }
            Event::Closed { id } => self.closed(id),
            Event::SetToken(raw, ack) => {
                self.set_token(&raw);
                let _ = ack.send(());
            }
            Event::SetCredential(raw, ack) => {
                self.set_credential(&raw);
                let _ = ack.send(());
            }
            Event::Heartbeat => self.heartbeat(),
            Event::Reap(ids) => {
                for id in ids {
                    if let Some(c) = self.clients.get(&id) {
                        c.handle.open.store(false, Ordering::SeqCst);
                        c.handle.terminate.notify_one();
                    }
                }
            }
        }
    }

    // ── Sending ──────────────────────────────────────────────────────

    fn is_open(&self, id: u64) -> bool {
        self.clients.get(&id).is_some_and(Client::is_open)
    }

    fn terminate(&self, id: u64) {
        if let Some(c) = self.clients.get(&id) {
            c.handle.open.store(false, Ordering::SeqCst);
            c.handle.terminate.notify_one();
        }
    }

    fn close(&self, id: u64, code: u16, reason: &str, wait: Duration) {
        if let Some(c) = self.clients.get(&id) {
            c.handle.open.store(false, Ordering::SeqCst);
            let _ = c.handle.tx.send(Out::Close(code, reason.into(), wait));
        }
    }

    /// `ws.send`: queued in order, nothing checked.
    fn push(&self, id: u64, data: Utf8Bytes) {
        if let Some(c) = self.clients.get(&id) {
            if !c.is_open() {
                return;
            }
            c.handle.queued.fetch_add(data.len(), Ordering::SeqCst);
            let _ = c.handle.tx.send(Out::Text(data));
        }
    }

    /// `sendTo`: unless it is too far behind, in which case it is dropped.
    fn send_to(&self, id: u64, data: Utf8Bytes) {
        let Some(c) = self.clients.get(&id) else { return };
        let queued = c.handle.queued.load(Ordering::SeqCst);
        if queued > MAX_BUFFERED_BYTES {
            eprintln!("[!] {} has {}MB unsent, dropping it", c.remote, queued / 1_048_576);
            self.terminate(id);
            return;
        }
        self.push(id, data);
    }

    fn payload_for(&self, id: u64, msg: &Value, shared: &Utf8Bytes) -> Utf8Bytes {
        let Some(c) = self.clients.get(&id) else { return shared.clone() };
        let token = self.shared.token();
        let kind = msg.get("type").and_then(Value::as_str).unwrap_or("");
        match (&c.asset_base, token) {
            (Some(base), Some(token)) if THUMBNAIL_MESSAGES.contains(&kind) => serialize(&rewrite_thumbnails(msg, base, &token)).into(),
            _ => shared.clone(),
        }
    }

    fn broadcast(&self, sender: u64, msg: &Value) {
        let data: Utf8Bytes = serialize(msg).into();
        for (&id, c) in &self.clients {
            if id != sender && c.is_open() {
                let payload = self.payload_for(id, msg, &data);
                self.send_to(id, payload);
            }
        }
    }

    fn broadcast_all(&self, msg: &Value) {
        let data: Utf8Bytes = serialize(msg).into();
        for (&id, c) in &self.clients {
            if c.is_open() {
                let payload = self.payload_for(id, msg, &data);
                self.send_to(id, payload);
            }
        }
    }

    fn broadcast_client_count(&self) {
        self.broadcast_all(&json!({ "type": "client_count", "count": self.clients.len() }));
    }

    fn send_desktop(&self, msg: &Value) {
        if let Some(d) = self.desktop
            && self.is_open(d) {
                self.send_to(d, serialize(msg).into());
            }
    }

    fn reply(&self, id: u64, msg: &Value) {
        self.push(id, serialize(msg).into());
    }

    // ── Connections ──────────────────────────────────────────────────

    fn connected(&mut self, id: u64, handle: Handle, remote: String, asset_base: Option<String>) {
        eprintln!("[+] Client connected: {remote}");
        handle.last_heard.store(self.shared.now_ms(), Ordering::SeqCst);
        let studio_address = js::slice16(&js::replace_units(&remote, |c| js::is_word(c) || matches!(c, '.' | ':' | '-'), '_'), 39);
        self.clients.insert(
            id,
            Client { handle, remote, studio_address, studio_peers: Vec::new(), studio_client: None, studio_client_seen: None, asset_base },
        );
        let mut sync = Map::new();
        sync.insert("type".into(), "sync".into());
        if let Some(p) = &self.project {
            sync.insert("project".into(), p.clone());
        }
        self.reply(id, &obj(sync));
        if js::has_length(&self.media) {
            let msg = json!({ "type": "library_sync", "library": self.media });
            let shared = serialize(&msg).into();
            self.push(id, self.payload_for(id, &msg, &shared));
        }
        if let Some(vj) = &self.vj_clips {
            let msg = json!({ "type": "vj_clips_sync", "vjClips": vj });
            let shared = serialize(&msg).into();
            self.push(id, self.payload_for(id, &msg, &shared));
        }
        if js::has_length(&self.compositions) {
            self.reply(id, &json!({ "type": "compositions_sync", "compositions": self.compositions }));
        }
        self.reply(id, &json!({ "type": "output_freeze_state", "frozen": self.output_frozen }));
        if let Some(state) = &self.show_state {
            self.reply(id, &json!({ "type": "show_state", "state": state }));
        }
        if !self.shader_library.is_empty() {
            let msg = json!({ "type": "shader_library_sync", "shaders": self.shader_library });
            let shared = serialize(&msg).into();
            self.push(id, self.payload_for(id, &msg, &shared));
        }
        self.broadcast_client_count();
    }

    fn closed(&mut self, id: u64) {
        let Some(client) = self.clients.shift_remove(&id) else { return };
        eprintln!("[-] Client disconnected: {}", client.remote);
        let gone: Vec<String> = self.routes.iter().filter(|(_, owner)| **owner == id).map(|(k, _)| k.clone()).collect();
        for key in gone {
            self.routes.shift_remove(&key);
            if Some(id) != self.desktop {
                self.phone_route_gone(&key);
            }
        }
        if client.studio_client.is_some() {
            self.send_studio_peers();
        }
        if Some(id) == self.desktop {
            self.desktop = None;
            self.show_state = None;
            eprintln!("[!] Desktop client disconnected");
        }
        self.broadcast_client_count();
    }

    fn set_token(&mut self, raw: &str) {
        let next = Some(pairing::normalize(raw)).filter(|t| !t.is_empty());
        if next == self.shared.token() {
            return;
        }
        *self.shared.token.write().unwrap() = next;
        self.shared.generation.fetch_add(1, Ordering::SeqCst);
        let ids: Vec<u64> = self.clients.keys().copied().collect();
        for &id in &ids {
            self.close(id, pairing::PAIRING_RESET_CLOSE_CODE, "unpaired", Duration::from_secs(30));
        }
        // A client can stall the closing handshake; this makes sure it goes.
        let events = self.events.clone();
        tokio::spawn(async move {
            tokio::time::sleep(Duration::from_secs(1)).await;
            let _ = events.send(Event::Reap(ids));
        });
    }

    fn set_credential(&mut self, raw: &Value) {
        let value = raw.as_str().filter(|s| js::len16(s) >= 32).map(str::to_string);
        *self.shared.credential.write().unwrap() = value;
        if let Some(d) = self.desktop.take() {
            self.close(d, 4401, "host credential changed", Duration::from_secs(30));
        }
    }

    fn heartbeat(&mut self) {
        let now = self.shared.now_ms();
        // A stalled loop has not read the pongs that came in meanwhile.
        let on_time = now.saturating_sub(self.last_heartbeat_ms) < HEARTBEAT.as_millis() as u64 * 3 / 2;
        self.last_heartbeat_ms = now;
        let ids: Vec<u64> = self.clients.keys().copied().collect();
        for id in ids {
            let c = &self.clients[&id];
            if !c.is_open() {
                continue;
            }
            let heard = c.handle.last_heard.load(Ordering::SeqCst);
            if on_time && now.saturating_sub(heard) > HEARTBEAT_TIMEOUT_MS {
                eprintln!("[!] No answer from {} for {}s, dropping it", c.remote, (now - heard) / 1000);
                self.terminate(id);
                continue;
            }
            let _ = c.handle.tx.send(Out::Ping);
        }
    }

    // ── Studio routing ───────────────────────────────────────────────

    fn studio_peer_id(&mut self, id: u64, msg: &Map<String, Value>) -> String {
        let own = id_like(msg.get("clientId"), 40, &['-']).map(|c| format!(":{c}")).unwrap_or_default();
        let Some(c) = self.clients.get_mut(&id) else { return format!("unknown{own}") };
        let peer = format!("{}{own}", if c.studio_address.is_empty() { "unknown" } else { &c.studio_address });
        if c.studio_peers.len() < 8 && !c.studio_peers.contains(&peer) {
            c.studio_peers.push(peer.clone());
        }
        peer
    }

    fn send_studio_peers(&self) {
        let peers: Vec<Value> = self
            .clients
            .iter()
            .filter(|(id, c)| Some(**id) != self.desktop && c.is_open())
            .filter_map(|(_, c)| c.studio_client.clone())
            .take(8)
            .collect();
        self.send_desktop(&json!({ "type": "studio_peers", "peers": peers }));
    }

    fn send_to_studio_peer(&self, sender: u64, msg: &Map<String, Value>) {
        let Some(to) = msg.get("to").and_then(Value::as_str) else { return };
        let data: Utf8Bytes = serialize(&obj(msg.clone())).into();
        for (&id, c) in &self.clients {
            if id != sender && c.is_open() && c.studio_peers.iter().any(|p| p == to) {
                self.send_to(id, data.clone());
            }
        }
    }

    fn phone_route_gone(&self, key: &str) {
        let (kind, id) = key.split_once(':').unwrap_or((key, ""));
        let reason = "phone-disconnected";
        match kind {
            "camera" => self.send_desktop(&json!({ "type": "phone_camera_stop", "sessionId": id, "reason": reason })),
            "automap" => self.send_desktop(&json!({ "type": "studio_automap_request", "requestId": id, "seq": 0, "op": "camera_gone", "reason": reason })),
            "depth" => self.send_desktop(&json!({ "type": "studio_depth_scan_progress", "requestId": id, "stage": "error", "message": "The phone disconnected.", "reason": reason })),
            "scan" => self.send_desktop(&json!({ "type": "studio_scan_abort", "requestId": id, "reason": reason })),
            _ => {}
        }
    }

    fn routes_of(&self, owner: u64) -> Vec<String> {
        self.routes.iter().filter(|(_, o)| **o == owner).map(|(k, _)| k.clone()).collect()
    }

    /// `relayPrivate`: a route belongs to the first phone that uses its id;
    /// only that phone and the desktop hear what travels on it.
    fn relay_private(&mut self, sender: u64, msg: &Value, kind: &str, id: Option<&Value>, may_start: bool) {
        let Some(id) = id_like(id, 128, &['.', ':', '-']) else { return };
        let key = format!("{kind}:{id}");
        let mut owner = self.routes.get(&key).copied();
        if Some(sender) == self.desktop {
            if let Some(o) = owner
                && self.is_open(o) {
                    self.send_to(o, serialize(msg).into());
                }
        } else {
            if let Some(o) = owner
                && o != sender && !self.is_open(o) && may_start {
                    owner = None;
                }
            if owner.is_none() && may_start {
                let mine = self.routes_of(sender);
                if mine.len() >= 8 {
                    self.routes.shift_remove(&mine[0]);
                }
                self.routes.insert(key.clone(), sender);
                owner = Some(sender);
            }
            if owner != Some(sender) {
                return;
            }
            self.send_desktop(msg);
        }
        let m = msg.as_object().expect("relayed messages are objects");
        let t = kind_of(m);
        let ends = t == "phone_camera_stop"
            || t == "studio_calibration_status"
            || (t == "studio_automap_reply" && m.get("done") == Some(&Value::Bool(true)))
            || (kind == "scan" && access::scan_message_ends(m))
            || (kind == "depth" && access::depth_message_ends(m));
        if ends {
            self.routes.shift_remove(&key);
        }
    }

    // ── Messages ─────────────────────────────────────────────────────

    fn handle_message(&mut self, sender: u64, msg: Map<String, Value>) {
        let kind = kind_of(&msg).to_string();
        if access::is_host_message(&kind) && Some(sender) != self.desktop {
            return;
        }
        // A TypeError in the JS server stopped the handler where it was.
        let _ = self.dispatch(sender, &kind, msg);
    }

    fn dispatch(&mut self, sender: u64, kind: &str, msg: Map<String, Value>) -> Result<(), TypeError> {
        let whole = obj(msg.clone());
        match kind {
            "register_desktop" => {
                let address = self.clients.get(&sender).map(|c| c.remote.clone()).unwrap_or_default();
                if !access::authorized_host(self.shared.credential().as_deref(), msg.get("credential"), &address) {
                    self.reply(sender, &json!({ "type": "error", "code": "host_authorization_required" }));
                    return Ok(());
                }
                if let Some(d) = self.desktop
                    && d != sender {
                        self.close(d, 4409, "host replaced", Duration::from_secs(30));
                    }
                self.desktop = Some(sender);
                self.reply(sender, &json!({ "type": "desktop_registered" }));
                self.send_studio_peers();
                eprintln!("[*] Desktop client registered");
            }
            "sync" => {
                self.project = msg.get("project").cloned();
                let mut out = Map::new();
                out.insert("type".into(), "sync".into());
                if let Some(p) = &self.project {
                    out.insert("project".into(), p.clone());
                }
                self.broadcast(sender, &obj(out));
            }
            "control_point" => {
                let corner = msg.get("corner").and_then(Value::as_str).unwrap_or("");
                if !["topLeft", "topRight", "bottomLeft", "bottomRight"].contains(&corner) {
                    return Ok(());
                }
                let Some((x, y)) = position(&msg) else { return Ok(()) };
                if let Some(layer) = find_layer(&mut self.project, msg.get("layerId"))?
                    && js::truthy(js::get(Some(layer), "corners")?) {
                        let corners = prop_mut(layer, "corners").expect("checked above");
                        js::set(corners, corner, Some(json!({ "x": x, "y": y })))?;
                    }
                self.broadcast_all(&whole);
            }
            "mesh_point" => {
                let (Some(row), Some(col)) = (js::integer(msg.get("row")), js::integer(msg.get("col"))) else { return Ok(()) };
                if row < 0.0 || col < 0.0 {
                    return Ok(());
                }
                let Some((x, y)) = position(&msg) else { return Ok(()) };
                if let Some(layer) = find_layer(&mut self.project, msg.get("layerId"))? {
                    let grid = js::get(Some(layer), "meshGrid")?;
                    if js::truthy(grid)
                        && let Some(Value::Array(points)) = prop_mut(layer, "meshGrid").and_then(|g| prop_mut(g, "points"))
                            && let Some(Value::Array(cells)) = points.get_mut(row as usize).filter(|_| row < 4.0e9)
                                && col < cells.len() as f64 {
                                    cells[col as usize] = json!({ "x": x, "y": y });
                                }
                }
                self.broadcast_all(&whole);
            }
            "parameter" => {
                let Some(param) = msg.get("param").and_then(Value::as_str) else { return Ok(()) };
                if !["opacity", "blendMode", "visible"].contains(&param) {
                    return Ok(());
                }
                if let Some(layer) = find_layer(&mut self.project, msg.get("layerId"))? {
                    match (param, msg.get("value")) {
                        ("opacity", Some(Value::Number(n))) => {
                            let v = n.as_f64().unwrap_or(0.0).clamp(0.0, 1.0);
                            js::set(layer, "opacity", Some(num(v)))?;
                        }
                        ("blendMode", Some(Value::String(s))) if js::len16(s) < 32 => {
                            js::set(layer, "blendMode", Some(Value::String(s.clone())))?;
                        }
                        ("visible", Some(Value::Bool(b))) => js::set(layer, "visible", Some(Value::Bool(*b)))?,
                        _ => {}
                    }
                }
                self.broadcast_all(&whole);
            }
            "sync_request" => {
                let mut out = Map::new();
                out.insert("type".into(), "sync".into());
                if let Some(p) = &self.project {
                    out.insert("project".into(), p.clone());
                }
                self.reply(sender, &obj(out));
            }
            "select_layer" => {
                match &mut self.project {
                    Some(p @ Value::Object(_)) => js::set(p, "selectedLayerId", msg.get("layerId").cloned())?,
                    Some(Value::Array(_)) => {}
                    _ => return Err(TypeError),
                }
                self.broadcast_all(&whole);
            }
            "warp_mode" => {
                if let Some(layer) = find_layer(&mut self.project, msg.get("layerId"))? {
                    js::set(layer, "warpMode", msg.get("mode").cloned())?;
                    if msg.get("mode").and_then(Value::as_str) == Some("mesh") && !js::truthy(js::get(Some(layer), "meshGrid")?) {
                        js::set(layer, "meshGrid", Some(create_mesh_grid(4, 4)))?;
                    }
                }
                self.broadcast_all(&whole);
            }
            "mesh_resize" => {
                let (Some(rows), Some(cols)) = (js::integer(msg.get("rows")), js::integer(msg.get("cols"))) else { return Ok(()) };
                if !(2.0..=32.0).contains(&rows) || !(2.0..=32.0).contains(&cols) {
                    return Ok(());
                }
                if let Some(layer) = find_layer(&mut self.project, msg.get("layerId"))? {
                    js::set(layer, "meshGrid", Some(create_mesh_grid(rows as u32, cols as u32)))?;
                }
                self.broadcast_all(&whole);
            }
            "set_layer_source" => {
                if !access::permitted_source(&msg, Some(&self.media), &self.shader_library) {
                    return Ok(());
                }
                eprintln!(
                    "[*] Set layer source: {} -> {}:{}",
                    js::to_string(msg.get("layerId")),
                    js::to_string(msg.get("sourceType")),
                    js::to_string(msg.get("sourceName"))
                );
                self.broadcast_all(&whole);
            }
            "add_mapping_layer_effect" => {
                let effect = msg.get("effect");
                let effect_ok = js::truthy(effect)
                    && js::string(js::get(effect, "id")?).is_some()
                    && js::string(js::get(effect, "type")?).is_some();
                if let Some(layer) = find_layer(&mut self.project, msg.get("layerId"))?
                    && effect_ok {
                        if !matches!(js::get(Some(layer), "effects")?, Some(Value::Array(_))) {
                            js::set(layer, "effects", Some(json!([])))?;
                        }
                        let effect = effect.expect("checked above");
                        let effect_id = js::get(Some(effect), "id")?;
                        if let Some(Value::Array(effects)) = prop_mut(layer, "effects") {
                            let mut exists = false;
                            for e in effects.iter() {
                                if js::strict_eq(js::get(Some(e), "id")?, effect_id) {
                                    exists = true;
                                    break;
                                }
                            }
                            if !exists {
                                effects.push(effect.clone());
                            }
                        }
                        eprintln!("[*] Add mapping layer effect: {} -> {}", js::to_string(msg.get("layerId")), js::to_string(js::get(Some(effect), "type")?));
                        self.broadcast(sender, &whole);
                    }
            }
            "remove_mapping_layer_effect" => {
                if let Some(layer) = find_layer(&mut self.project, msg.get("layerId"))?
                    && js::string(msg.get("effectId")).is_some() {
                        let current = js::get(Some(layer), "effects")?;
                        let kept: Vec<Value> = match current {
                            v if !js::truthy(v) => Vec::new(),
                            Some(Value::Array(items)) => {
                                let mut kept = Vec::new();
                                for e in items {
                                    if !js::strict_eq(js::get(Some(e), "id")?, msg.get("effectId")) {
                                        kept.push(e.clone());
                                    }
                                }
                                kept
                            }
                            _ => return Err(TypeError),
                        };
                        js::set(layer, "effects", Some(Value::Array(kept)))?;
                        eprintln!("[*] Remove mapping layer effect: {} -> {}", js::to_string(msg.get("layerId")), js::to_string(msg.get("effectId")));
                        self.broadcast(sender, &whole);
                    }
            }
            "toggle_mapping_layer_effect" => {
                let found = match find_layer(&mut self.project, msg.get("layerId"))? {
                    Some(layer) => {
                        let list = prop_mut(layer, "effects");
                        match find_by_id(list, msg.get("effectId"))? {
                            Some(effect) => {
                                toggle(effect, "enabled")?;
                                true
                            }
                            None => false,
                        }
                    }
                    None => false,
                };
                if found {
                    eprintln!("[*] Toggle mapping layer effect: {} -> {}", js::to_string(msg.get("layerId")), js::to_string(msg.get("effectId")));
                    self.broadcast(sender, &whole);
                }
            }
            "update_mapping_layer_effect_params" => {
                let mut done = false;
                if let Some(layer) = find_layer(&mut self.project, msg.get("layerId"))?
                    && let Some(effect) = find_by_id(prop_mut(layer, "effects"), msg.get("effectId"))?
                        && let Some(params) = js::plain_object(msg.get("params")) {
                            merge_params(effect, params)?;
                            done = true;
                        }
                if done {
                    self.broadcast(sender, &whole);
                }
            }
            "set_mapping_layer_shape" => {
                let shape_type = msg.get("shapeType");
                let allowed = match shape_type {
                    Some(Value::Null) => true,
                    Some(Value::String(s)) => ALLOWED_LAYER_SHAPES.contains(&s.as_str()),
                    _ => false,
                };
                if let Some(layer) = find_layer(&mut self.project, msg.get("layerId"))?
                    && allowed {
                        js::set(layer, "cropRegion", Some(Value::Null))?;
                        let shape = match shape_type {
                            Some(Value::String(s)) if !s.is_empty() => default_layer_shape(s),
                            _ => Value::Null,
                        };
                        js::set(layer, "layerShape", Some(shape))?;
                        let name = shape_type.and_then(Value::as_str).filter(|s| !s.is_empty()).unwrap_or("none");
                        eprintln!("[*] Set mapping layer shape: {} -> {name}", js::to_string(msg.get("layerId")));
                        self.broadcast(sender, &whole);
                    }
            }
            "toggle_mapping_layer_shape" => {
                let mut done = false;
                if let Some(layer) = find_layer(&mut self.project, msg.get("layerId"))?
                    && js::truthy(js::get(Some(layer), "layerShape")?) {
                        toggle(prop_mut(layer, "layerShape").expect("checked above"), "enabled")?;
                        done = true;
                    }
                if done {
                    self.broadcast(sender, &whole);
                }
            }
            "clear_mapping_layer_shape" => {
                if let Some(layer) = find_layer(&mut self.project, msg.get("layerId"))? {
                    js::set(layer, "layerShape", Some(Value::Null))?;
                    self.broadcast(sender, &whole);
                }
            }
            "update_mapping_layer_shape_params" => {
                let mut done = false;
                if let Some(layer) = find_layer(&mut self.project, msg.get("layerId"))?
                    && js::truthy(js::get(Some(layer), "layerShape")?)
                        && let Some(params) = js::plain_object(msg.get("params")) {
                            merge_params(prop_mut(layer, "layerShape").expect("checked above"), params)?;
                            done = true;
                        }
                if done {
                    self.broadcast(sender, &whole);
                }
            }
            "library_sync" => {
                self.media = msg.get("library").filter(|v| js::truthy(Some(v))).cloned().unwrap_or_else(|| json!([]));
                eprintln!("[*] Media library updated: {} items", length_text(&self.media));
                self.broadcast(sender, &json!({ "type": "library_sync", "library": self.media }));
            }
            "vj_clips_sync" => {
                self.vj_clips = msg.get("vjClips").filter(|v| js::truthy(Some(v))).cloned();
                let count = vj_clip_count(self.vj_clips.as_ref())?;
                let blocks = self.vj_clips.as_ref().and_then(|v| v.get("blocks")).and_then(Value::as_array).map_or(0, Vec::len);
                eprintln!("[*] VJ clips updated: {count} clips in {blocks} blocks");
                let mut out = Map::new();
                out.insert("type".into(), "vj_clips_sync".into());
                out.insert("vjClips".into(), self.vj_clips.clone().unwrap_or(Value::Null));
                self.broadcast(sender, &obj(out));
            }
            "compositions_sync" => {
                self.compositions = msg.get("compositions").filter(|v| js::truthy(Some(v))).cloned().unwrap_or_else(|| json!([]));
                eprintln!("[*] Compositions updated: {} presets", length_text(&self.compositions));
                self.broadcast(sender, &json!({ "type": "compositions_sync", "compositions": self.compositions }));
            }
            // Mobile-originated controls the desktop applies; never echoed
            // to the phone that sent them.
            "trigger_vj_clip" | "trigger_vj_column" | "stop_vj_layer" | "stop_all_vj" | "set_vj_block" | "set_vj_live"
            | "set_vj_layer_opacity" | "set_vj_layer_blend_mode" | "set_vj_master_opacity" | "load_composition"
            | "add_vj_layer_effect" | "remove_vj_layer_effect" | "toggle_vj_layer_effect" | "update_vj_layer_effect_params"
            | "update_vj_shader_value" | "add_vj_comp_effect" | "remove_vj_comp_effect" | "toggle_vj_comp_effect"
            | "update_vj_comp_effect_params" | "add_vj_clip_effect" | "remove_vj_clip_effect" | "toggle_vj_clip_effect"
            | "update_vj_clip_effect_params" | "lightpainting_hover" | "lightpainting_stroke_start" | "lightpainting_stroke_point"
            | "lightpainting_stroke_end" | "lightpainting_undo" | "lightpainting_clear" | "studio_capabilities"
            | "set_vj_crossfader_enabled" | "set_vj_crossfader_value" | "set_vj_crossfader_transition" | "set_vj_crossfader_curve"
            | "set_vj_crossfader_blend_mode" | "vj_cut_to_a" | "vj_cut_to_b" | "set_vj_quantization" | "clear_vj_pending_triggers"
            | "set_vj_macro_value" | "recall_vj_snapshot" | "save_vj_snapshot" | "vj_tap_tempo" | "vj_clear_manual_bpm"
            | "toggle_vj_layer_solo" | "toggle_vj_layer_mute" | "beat_pulse" | "set_output_freeze" => {
                if !kind.starts_with("lightpainting_") && !matches!(kind, "studio_capabilities" | "beat_pulse" | "set_vj_master_opacity") {
                    eprintln!("[*] {kind}");
                }
                self.broadcast(sender, &whole);
            }
            "studio_scene" | "studio_world_action" | "studio_world_view" => {
                let from = self.studio_peer_id(sender, &msg);
                self.send_desktop(&stamped(&msg, &from));
            }
            "studio_scene_status" => self.send_to_studio_peer(sender, &msg),
            "studio_calibration_offer" | "studio_calibration_status" => {
                self.relay_private(sender, &whole, "calibration", msg.get("requestId"), kind == "studio_calibration_offer");
            }
            "studio_calibration_chunk" => {
                if Some(sender) == self.desktop || !access::calibration_chunk_allowed(&msg) {
                    return Ok(());
                }
                self.relay_private(sender, &whole, "calibration", msg.get("requestId"), true);
            }
            "studio_scan_offer" | "studio_scan_chunk" | "studio_scan_abort" | "studio_scan_status" => {
                if !access::scan_message_allowed(&msg) {
                    return Ok(());
                }
                self.relay_private(sender, &whole, "scan", msg.get("requestId"), kind == "studio_scan_offer");
            }
            "studio_depth_capture_offer" => {
                let capture = msg.get("capture").cloned().unwrap_or(Value::Null);
                let bytes = js::len16(&serialize(&capture));
                if !access::depth_message_allowed(&msg, bytes) {
                    return Ok(());
                }
                let from = self.studio_peer_id(sender, &msg);
                self.relay_private(sender, &stamped(&msg, &from), "depth", msg.get("requestId"), true);
            }
            "studio_depth_capture_status" | "studio_depth_scan_progress" => {
                if !access::depth_message_allowed(&msg, 0) {
                    return Ok(());
                }
                self.relay_private(sender, &whole, "depth", msg.get("requestId"), false);
            }
            "studio_automap_diagnostics" => {
                if Some(sender) == self.desktop || !access::diagnostics_message_allowed(&msg) {
                    return Ok(());
                }
                let from = self.studio_peer_id(sender, &msg);
                self.send_desktop(&stamped(&msg, &from));
            }
            "studio_automap_request" | "studio_automap_reply" => {
                self.relay_private(sender, &whole, "automap", msg.get("requestId"), kind == "studio_automap_request");
            }
            "studio_flux" => self.send_desktop(&whole),
            "studio_capabilities_request" => {
                let from = self.studio_peer_id(sender, &msg);
                let client = access::describe_client(msg.get("client"));
                let seen = serialize(&json!({ "from": from, "client": client }));
                if let (Some(client), Some(c)) = (client, self.clients.get_mut(&sender))
                    && c.studio_client_seen.as_deref() != Some(&seen) {
                        let mut entry = Map::new();
                        entry.insert("id".into(), Value::String(from.clone()));
                        entry.extend(client);
                        c.studio_client = Some(Value::Object(entry));
                        c.studio_client_seen = Some(seen);
                        self.send_studio_peers();
                    }
                self.send_desktop(&stamped(&msg, &from));
            }
            "studio_depth_scan_request" => {
                if !access::depth_message_allowed(&msg, 0) {
                    return Ok(());
                }
                let to = msg.get("to").and_then(Value::as_str).unwrap_or("");
                let target = self
                    .clients
                    .iter()
                    .find(|(id, c)| **id != sender && c.is_open() && c.studio_peers.iter().any(|p| p == to))
                    .map(|(id, _)| *id);
                let Some(target) = target else {
                    self.send_desktop(&json!({
                        "type": "studio_depth_scan_progress", "requestId": msg.get("requestId"), "stage": "error",
                        "message": "That phone is no longer connected.",
                    }));
                    return Ok(());
                };
                let mine = self.routes_of(target);
                if mine.len() >= 8 {
                    self.routes.shift_remove(&mine[0]);
                }
                let request_id = msg.get("requestId").and_then(Value::as_str).unwrap_or("");
                self.routes.insert(format!("depth:{request_id}"), target);
                self.send_to(target, serialize(&whole).into());
            }
            "phone_camera_offer" | "phone_camera_answer" | "phone_camera_ice" | "phone_camera_stop" | "phone_vision_native_start"
            | "phone_vision_command" | "phone_vision_status" | "phone_vision_native_frame" => {
                self.relay_private(sender, &whole, "camera", msg.get("sessionId"), kind != "phone_camera_stop");
            }
            "output_freeze_state" => {
                self.output_frozen = js::truthy(msg.get("frozen"));
                eprintln!("[*] Desktop -> output_freeze_state: {}", self.output_frozen);
                self.broadcast(sender, &whole);
            }
            "show_state" => {
                let state = msg.get("state");
                if !matches!(state, Some(Value::Object(_) | Value::Array(_))) {
                    return Ok(());
                }
                self.show_state = state.cloned();
                self.broadcast(sender, &json!({ "type": "show_state", "state": state }));
            }
            "shader_library_sync" => {
                self.shader_library = msg.get("shaders").and_then(Value::as_array).cloned().unwrap_or_default();
                eprintln!("[*] Shader library updated: {} shaders", self.shader_library.len());
                self.broadcast(sender, &json!({ "type": "shader_library_sync", "shaders": self.shader_library }));
            }
            other => eprintln!("[?] Unknown message type: {other}"),
        }
        Ok(())
    }
}

/// `msg.position` with finite numeric x and y.
fn position(msg: &Map<String, Value>) -> Option<(Value, Value)> {
    let p = msg.get("position").filter(|p| js::truthy(Some(p)))?;
    let x = js::get(Some(p), "x").ok()??;
    let y = js::get(Some(p), "y").ok()??;
    (x.is_number() && y.is_number()).then(|| (x.clone(), y.clone()))
}

fn length_text(v: &Value) -> String {
    match v {
        Value::Array(items) => items.len().to_string(),
        Value::String(s) => js::len16(s).to_string(),
        Value::Object(m) => m.get("length").map_or("undefined".into(), |l| js::to_string(Some(l))),
        _ => "undefined".into(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mesh_grid_matches_the_js_one() {
        let grid = create_mesh_grid(2, 3);
        assert_eq!(serialize(&grid), r#"{"rows":2,"cols":3,"points":[[{"x":0,"y":0},{"x":0.5,"y":0},{"x":1,"y":0}],[{"x":0,"y":1},{"x":0.5,"y":1},{"x":1,"y":1}]]}"#);
    }

    #[test]
    fn layer_shapes_match_the_js_ones() {
        assert_eq!(serialize(&default_layer_shape("rectangle")), r#"{"type":"rectangle","enabled":true,"params":{"feather":0,"rotation":0}}"#);
        assert_eq!(serialize(&default_layer_shape("nope")), r#"{"type":"rectangle","enabled":true,"params":{"feather":0,"rotation":0}}"#);
        assert_eq!(serialize(&default_layer_shape("star")), r#"{"type":"star","enabled":true,"params":{"feather":0,"rotation":0,"sides":5,"innerRadius":0.4}}"#);
    }

    #[test]
    fn thumbnails_point_at_this_machine() {
        let msg = json!({ "type": "library_sync", "library": [{ "thumbnail": "./ISF/a.png", "x": { "thumbnail": "/b.png?v=1" } }, { "thumbnail": "//cdn/x.png" }] });
        let out = rewrite_thumbnails(&msg, "http://10.0.0.2:9002", "TOKEN");
        assert_eq!(out["library"][0]["thumbnail"], "http://10.0.0.2:9002/ISF/a.png?pair=TOKEN");
        assert_eq!(out["library"][0]["x"]["thumbnail"], "http://10.0.0.2:9002/b.png?v=1&pair=TOKEN");
        assert_eq!(out["library"][1]["thumbnail"], "//cdn/x.png");
    }

    #[test]
    fn type_errors_where_js_throws() {
        let mut project = Some(json!({ "layers": [null, { "id": "a" }] }));
        assert_eq!(find_layer(&mut project, Some(&json!("a"))).map(|l| l.is_some()), Err(TypeError));
        let mut project = Some(json!({ "layers": [{ "id": "a" }] }));
        assert!(find_layer(&mut project, Some(&json!("a"))).unwrap().is_some());
        let mut none = None;
        assert_eq!(find_layer(&mut none, None).map(|l| l.is_some()), Err(TypeError));
        assert_eq!(vj_clip_count(Some(&json!({ "blocks": [{ "clipGrid": [[1, null], [null, 2]] }] }))), Ok(2));
        assert_eq!(vj_clip_count(Some(&json!({ "blocks": [{}] }))), Err(TypeError));
    }
}
