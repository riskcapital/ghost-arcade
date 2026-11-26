//! Ghost Arcade's phone remote server: the LAN WebSocket relay and the HTTP
//! server that hands phones the web app, as a process of its own so neither
//! the editor's main process nor the render core carries its traffic.
//!
//! It speaks exactly what server/ws-server.js speaks, to phones and to the
//! desktop. The app starts it through server/phone-server-rust.js, which
//! gives it its settings in the environment and the pairing token and desktop
//! credential on stdin (never in the environment or arguments), one JSON
//! object a line:
//!
//!   {"id":1,"cmd":"token","value":"..."}       -> {"event":"ack","id":1}
//!   {"id":2,"cmd":"credential","value":"..."}  -> {"event":"ack","id":2}
//!   {"cmd":"shutdown"}
//!
//! Once both ports listen it writes {"event":"ready","wsPort":..,"httpPort":..}
//! on stdout. When stdin closes (the app went away) it exits. Logs go to
//! stderr.

mod access;
mod config;
mod files;
mod http;
mod hub;
mod js;
mod pairing;
mod shaders;
mod ws;

use config::Config;
use hub::{Event, Hub, Shared};
use serde_json::{Value, json};
use std::io::Write;
use std::sync::atomic::AtomicU64;
use std::sync::{Arc, Mutex, RwLock};
use std::time::Instant;
use tokio::io::AsyncBufReadExt;
use tokio::net::TcpListener;
use tokio::sync::{mpsc, oneshot};

fn emit(v: Value) {
    let mut out = std::io::stdout().lock();
    let _ = writeln!(out, "{v}");
    let _ = out.flush();
}

async fn bind(host: &str, port: u16, what: &str) -> TcpListener {
    match TcpListener::bind((host, port)).await {
        Ok(l) => l,
        Err(e) => {
            eprintln!("[!] {what} server could not listen on port {port}: {e}");
            emit(json!({ "event": "error", "what": what, "message": e.to_string(), "code": format!("{:?}", e.kind()) }));
            std::process::exit(1);
        }
    }
}

fn main() {
    let runtime = tokio::runtime::Builder::new_multi_thread().worker_threads(2).enable_all().build().expect("tokio runtime");
    runtime.block_on(run());
}

async fn run() {
    let config = Arc::new(Config::from_env());
    let token = Some(pairing::normalize(&std::env::var("GA_PAIRING_TOKEN").unwrap_or_default())).filter(|t| !t.is_empty());
    let credential = std::env::var("GA_DESKTOP_CREDENTIAL").ok().filter(|c| !c.is_empty());
    let shared = Arc::new(Shared {
        token: RwLock::new(token),
        generation: AtomicU64::new(0),
        credential: RwLock::new(credential),
        started: Instant::now(),
        refused: Mutex::new((0, None)),
    });

    let ws_listener = bind(&config.bind_host, config.ws_port, "WebSocket").await;
    let http_listener = bind(&config.bind_host, config.http_port, "HTTP").await;
    let ws_port = ws_listener.local_addr().map(|a| a.port()).unwrap_or(0);
    let http_port = http_listener.local_addr().map(|a| a.port()).unwrap_or(0);

    let (events, rx) = mpsc::unbounded_channel();
    let hub = tokio::spawn(Hub::new(shared.clone(), events.clone()).run(rx));
    // A hub that panicked has dropped every phone; going away lets the app
    // notice and take over with the JS server rather than sit there deaf.
    tokio::spawn(async move {
        let _ = hub.await;
        eprintln!("[!] Phone server relay stopped unexpectedly");
        std::process::exit(70);
    });
    tokio::spawn(ws::serve(ws_listener, shared.clone(), events.clone(), config.clone()));
    let http = Arc::new(http::Http {
        dist: files::Root::new(config.dist_dir.clone()),
        public: config.public_dir.clone().map(files::Root::new),
        config: config.clone(),
        shared: shared.clone(),
    });
    tokio::spawn(http::serve(http_listener, http));
    let heartbeat_events = events.clone();
    tokio::spawn(async move {
        let mut tick = tokio::time::interval_at(tokio::time::Instant::now() + hub::HEARTBEAT, hub::HEARTBEAT);
        loop {
            tick.tick().await;
            if heartbeat_events.send(Event::Heartbeat).is_err() {
                break;
            }
        }
    });

    eprintln!("[*] Phone server: WebSocket on {}:{ws_port}, HTTP on {}:{http_port}", config.bind_host, config.bind_host);
    emit(json!({ "event": "ready", "wsPort": ws_port, "httpPort": http_port }));

    let mut lines = tokio::io::BufReader::new(tokio::io::stdin()).lines();
    while let Ok(Some(line)) = lines.next_line().await {
        let Ok(cmd) = serde_json::from_str::<Value>(&line) else { continue };
        let id = cmd.get("id").cloned().unwrap_or(Value::Null);
        let value = cmd.get("value").cloned().unwrap_or(Value::Null);
        let (ack, done) = oneshot::channel();
        let event = match cmd.get("cmd").and_then(Value::as_str) {
            Some("token") => Event::SetToken(value.as_str().unwrap_or("").to_string(), ack),
            Some("credential") => Event::SetCredential(value, ack),
            Some("shutdown") => break,
            _ => continue,
        };
        if events.send(event).is_err() {
            break;
        }
        let _ = done.await;
        emit(json!({ "event": "ack", "id": id }));
    }
    eprintln!("[*] Shutting down phone server");
    std::process::exit(0);
}
