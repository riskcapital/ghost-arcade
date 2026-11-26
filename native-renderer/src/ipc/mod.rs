//! The core's RPC channel: request and event types, the fast path for
//! read-only calls, and the stdin reader / stdout writer threads.

use crate::*;

mod dispatch;
mod json_args;
pub(crate) use json_args::*;

#[derive(Debug)]
pub(crate) enum UserEvent {
    /// The owning broker closed its command pipe (including app crashes).
    OwnerDisconnected,
    Rpc(RpcRequest),
    NativeVideoFrameDecoded(NativeVideoFrameDecodeResult),
    NativeImageDecoded(String, String, Result<(usize, usize, Vec<u8>), String>),
    VideoPrefetched(VideoPrefetchResult),
    GpuFrameCompleted,
    GpuFrameFailed(String),
    /// The output window's display refreshed (display_pacing.rs).
    DisplayRefresh,
    /// Fire-and-forget nudge from the stdin reader: someone just read the
    /// published snapshot, so refresh it for the next reader. Carries no reply
    /// and takes no part in the `queued`/`applied` ordering contract, because
    /// republishing can only make the snapshot newer, never older.
    RepublishRpcSnapshot,
}

#[derive(Debug, Deserialize)]
pub(crate) struct RpcRequest {
    pub(crate) id: u64,
    pub(crate) method: String,
    #[serde(default)]
    pub(crate) params: Value,
    #[serde(skip)]
    pub(crate) ingress_bytes: u64,
}

/// Observability and transport reads. These are answered from the published
/// snapshot **even while commands are still queued for the main thread**.
///
/// That is the whole point: the stall the operator sees is a long main-thread
/// command (a shader warm-up batch, a big scene ingest, a full-resolution
/// readback) holding the loop while the editor's pumps pile up behind it. If
/// these waited their turn they would time out together, the preview would stop
/// seeing the output frame counter advance, and the display link would park —
/// which is what reads as "the renderer froze".
///
/// Serving them one command stale is harmless. `status` is a monitoring readout
/// and `output_shared_texture` is surface metadata; both are already sampled
/// asynchronously, and neither is correlated by the caller against a command it
/// just sent.
pub(crate) const RPC_FAST_PATH_UNORDERED_METHODS: &[&str] = &[
    "status",
    "get_status",
    "stats",
    "get_stats",
    "output_shared_texture",
    "get_output_shared_texture",
];

/// The payloads served by the fast path, rebuilt as one immutable unit so a
/// reader can never observe a torn mix of old and new fields.
///
/// `get_layers_snapshot` is not among them. The Electron scene reconciler
/// asks for it at most once a second, while the snapshot is rebuilt after
/// every RPC and every frame: building every layer's entry each time was
/// most of the publish cost with hundreds of layers. It is answered on the
/// main thread, in order with the commands before it.
#[derive(Default)]
pub(crate) struct PublishedRpcSnapshot {
    /// Shared with the next publishes until they are rebuilt (see
    /// `refresh_rpc_snapshot`).
    pub(crate) status: Arc<Value>,
    pub(crate) stats: Arc<Value>,
    pub(crate) output_shared_texture: Value,
}

impl PublishedRpcSnapshot {
    pub(crate) fn get(&self, method: &str) -> Option<&Value> {
        match method {
            "status" | "get_status" => Some(self.status.as_ref()),
            "stats" | "get_stats" => Some(self.stats.as_ref()),
            "output_shared_texture" | "get_output_shared_texture" => {
                Some(&self.output_shared_texture)
            }
            _ => None,
        }
    }
}

/// Lets read-only queries be answered off the render thread.
///
/// The core services RPC and rendering on the same winit thread, so a query
/// issued while a heavy frame is encoding used to sit behind it. At 60 Hz that
/// is invisible; when the editor also runs two unthrottled `output_shared_texture`
/// pumps and a pixel-carrying `frame_snapshot` pump through the same stdio pipe,
/// the queue depth is what turns one slow frame into a multi-second RPC timeout.
///
/// Synchronisation contract:
/// * `queued` is incremented **only** by the stdin reader thread, once for every
///   request it forwards to the main thread. `applied` is incremented **only**
///   by the main thread, after that request has been fully handled *and* after a
///   fresh snapshot has been published.
/// * Only reads whose callers don't correlate them with commands they just
///   sent (status, stats, the output texture handle) are served from the
///   snapshot. A read that must follow the commands before it (the layers
///   snapshot) goes to the main thread and queues behind them.
/// * Because only the reader writes `queued` and only the main thread writes
///   `applied`, neither counter needs a CAS; a `Release` store paired with an
///   `Acquire` load carries the published snapshot across the thread boundary.
pub(crate) struct RpcFastPath {
    pub(crate) snapshot: Mutex<Option<Arc<PublishedRpcSnapshot>>>,
    pub(crate) queued: AtomicU64,
    pub(crate) queued_bytes: AtomicU64,
    pub(crate) applied: AtomicU64,
    /// Epoch-ms at which a fast-path-eligible query last arrived. The render
    /// loop only pays for republishing while something is actually polling, so
    /// an offline export or a headless probe never carries the cost.
    pub(crate) interest_at_ms: AtomicU64,
    /// Set when a republish nudge is already on its way to the main thread, so a
    /// burst of polls collapses into one refresh instead of one per request.
    pub(crate) republish_pending: AtomicU64,
    /// Non-zero while the render clock is in manual mode (offline export).
    ///
    /// The fast path is disabled entirely in that mode. Offline export drives
    /// one sim step per distinct `render_clock_time`, and it depends on the
    /// event loop being woken often enough to render each of those frames —
    /// wakes that the editor's own `status` polling incidentally supplies.
    /// Answering those polls off-thread removed the wakes and left ~40% of
    /// exported frames without a sim step. Export has no live preview to
    /// protect and cares only about determinism, so it keeps the old path.
    pub(crate) manual_clock: AtomicU64,
}

/// How long after the last read-only query the render loop keeps republishing.
pub(crate) const RPC_FAST_PATH_INTEREST_WINDOW_MS: u64 = 4_000;

/// Between RPCs, status and stats are rebuilt at most this often (~15 Hz)
/// unless something a poller waits on changed.
pub(crate) const RPC_SNAPSHOT_REFRESH: Duration = Duration::from_millis(66);

/// Frequent main-thread queries that change nothing `status` or `stats`
/// report, so the snapshot need not be rebuilt for them.
pub(crate) const RPC_READ_ONLY_METHODS: &[&str] = &[
    "layers_snapshot", "get_layers_snapshot", "launch_status",
    "get_layer_source_readiness", "get_source_frame_readiness", "audio_scope",
];

/// Recent frame submission intervals, kept in arrival order and sorted, so
/// the stats percentiles need no copy or sort when stats are built.
#[derive(Default)]
pub(crate) struct IntervalWindow {
    pub(crate) arrival: VecDeque<f64>,
    pub(crate) sorted: Vec<f64>,
}

impl IntervalWindow {
    pub(crate) const CAPACITY: usize = 2048;

    pub(crate) fn push(&mut self, value: f64) {
        if self.arrival.len() >= Self::CAPACITY {
            if let Some(old) = self.arrival.pop_front() {
                let at = self.sorted.partition_point(|v| v.total_cmp(&old).is_lt());
                if at < self.sorted.len() {
                    self.sorted.remove(at);
                }
            }
        }
        self.arrival.push_back(value);
        let at = self.sorted.partition_point(|v| v.total_cmp(&value).is_le());
        self.sorted.insert(at, value);
    }

    pub(crate) fn len(&self) -> usize {
        self.sorted.len()
    }

    pub(crate) fn max(&self) -> Option<f64> {
        self.sorted.last().copied()
    }

    pub(crate) fn percentile(&self, p: f64) -> Option<f64> {
        self.sorted.get((self.sorted.len().saturating_sub(1) as f64 * p).ceil() as usize).copied()
    }
}

impl RpcFastPath {
    pub(crate) fn new() -> Self {
        Self {
            snapshot: Mutex::new(None),
            queued: AtomicU64::new(0),
            queued_bytes: AtomicU64::new(0),
            applied: AtomicU64::new(0),
            interest_at_ms: AtomicU64::new(0),
            republish_pending: AtomicU64::new(0),
            manual_clock: AtomicU64::new(0),
        }
    }

    pub(crate) fn set_manual_clock(&self, manual: bool) {
        self.manual_clock
            .store(u64::from(manual), Ordering::Relaxed);
    }

    pub(crate) fn manual_clock(&self) -> bool {
        self.manual_clock.load(Ordering::Relaxed) != 0
    }

    /// True when this caller owns the outstanding republish nudge and should
    /// post the event; false when one is already queued.
    pub(crate) fn claim_republish(&self) -> bool {
        self.republish_pending
            .compare_exchange(0, 1, Ordering::AcqRel, Ordering::Acquire)
            .is_ok()
    }

    pub(crate) fn release_republish(&self) {
        self.republish_pending.store(0, Ordering::Release);
    }

    pub(crate) fn note_interest(&self) {
        self.interest_at_ms
            .store(scene_bridge_epoch_ms(), Ordering::Relaxed);
    }

    pub(crate) fn wants_publish(&self) -> bool {
        scene_bridge_epoch_ms().saturating_sub(self.interest_at_ms.load(Ordering::Relaxed))
            <= RPC_FAST_PATH_INTEREST_WINDOW_MS
    }

    pub(crate) fn read(&self) -> Option<Arc<PublishedRpcSnapshot>> {
        self.snapshot.lock().ok().and_then(|guard| guard.clone())
    }

    pub(crate) fn publish(&self, snapshot: PublishedRpcSnapshot) {
        if let Ok(mut guard) = self.snapshot.lock() {
            *guard = Some(Arc::new(snapshot));
        }
    }
}

pub(crate) fn spawn_stdout_writer(response_rx: Receiver<String>) {
    // Before any reply: tells a broker that asked for binary frames that
    // this core speaks them.
    let hello = ipc_frames::init_from_env();
    thread::spawn(move || {
        let stdout = io::stdout();
        let mut lock = stdout.lock();
        if let Some(hello) = hello {
            let _ = writeln!(lock, "{hello}");
            let _ = lock.flush();
        }
        while let Ok(line) = response_rx.recv() {
            let _ = ipc_frames::write_line(&mut lock, &line);
            let _ = lock.flush();
        }
    });
}

pub(crate) fn spawn_stdin_reader(
    proxy: winit::event_loop::EventLoopProxy<UserEvent>,
    response_tx: Sender<String>,
    fast_path: Arc<RpcFastPath>,
) {
    thread::spawn(move || {
        let mut input = io::stdin().lock();
        loop {
            const MAX_RPC_BYTES: u64 = 64 * 1024 * 1024;
            // A message is one JSON line, optionally preceded by a frame of
            // binary payloads it refers to (see ipc_frames).
            let message = match ipc_frames::read_message(&mut input, MAX_RPC_BYTES) {
                ipc_frames::ReadOutcome::Message(message) => message,
                ipc_frames::ReadOutcome::Closed => break,
                ipc_frames::ReadOutcome::Fatal(err) => {
                    eprintln!("[GhostRenderCore] {err}; closing input");
                    break;
                }
            };
            let message_bytes = message.byte_len();
            let blobs = message.blobs;
            let Ok(line) = String::from_utf8(message.line) else { continue; };
            if line.trim().is_empty() {
                continue;
            }
            match serde_json::from_str::<RpcRequest>(&line) {
                Ok(mut req) => {
                    if let Err(err) = ipc_frames::splice_blobs(&mut req.params, &blobs) {
                        if req.id != 0 {
                            let _ = response_tx.send(json!({ "id": req.id, "ok": false, "error": err }).to_string());
                        }
                        continue;
                    }
                    drop(blobs);
                    // Read-only queries are answered here, on the reader thread,
                    // from the snapshot the render loop republishes each frame —
                    // so a saturated GPU can no longer make `status` or
                    // `output_shared_texture` miss their deadline. The `idle()`
                    // gate keeps them ordered behind any command still in flight.
                    let unordered = RPC_FAST_PATH_UNORDERED_METHODS.contains(&req.method.as_str());
                    if unordered && !fast_path.manual_clock() {
                        fast_path.note_interest();
                        if req.id != 0 {
                            if let Some(result) = fast_path
                                .read()
                                .and_then(|snapshot| snapshot.get(&req.method).cloned())
                            {
                                let _ = response_tx.send(
                                    json!({ "id": req.id, "ok": true, "result": result })
                                        .to_string(),
                                );
                                // Ask the loop to refresh what we just served.
                                // Without this a poller that only ever issues
                                // fast-path methods would pin the snapshot
                                // forever whenever the loop is otherwise idle —
                                // background work such as video pre-roll would
                                // never become visible.
                                if fast_path.claim_republish() {
                                    let _ = proxy.send_event(UserEvent::RepublishRpcSnapshot);
                                }
                                continue;
                            }
                        }
                    }
                    let bytes = message_bytes;
                    while fast_path.queued.load(Ordering::Acquire).saturating_sub(fast_path.applied.load(Ordering::Acquire)) >= 256
                        || fast_path.queued_bytes.load(Ordering::Acquire).saturating_add(bytes) > MAX_RPC_BYTES {
                        thread::sleep(Duration::from_millis(2));
                    }
                    req.ingress_bytes = bytes;
                    fast_path.queued_bytes.fetch_add(bytes, Ordering::Relaxed);
                    fast_path.queued.fetch_add(1, Ordering::Relaxed);
                    let _ = proxy.send_event(UserEvent::Rpc(req));
                }
                Err(err) => {
                    eprintln!("[GhostRenderCore] bad rpc: {err}");
                }
            }
        }
        // EOF and terminal read failures mean there is no longer an owner.
        // Exit through the event loop, just like the explicit shutdown RPC,
        // so native windows and GPU resources receive normal teardown.
        let _ = proxy.send_event(UserEvent::OwnerDisconnected);
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn interval_percentiles_match_a_full_sort_of_the_window() {
        let mut window = IntervalWindow::default();
        let mut all = Vec::new();
        let mut seed = 7_u64;
        for _ in 0..2600 {
            seed = seed.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407);
            // Few distinct values, so duplicates leave the window too.
            let value = (seed >> 58) as f64 * 0.5;
            window.push(value);
            all.push(value);
            let mut expected = all[all.len().saturating_sub(IntervalWindow::CAPACITY)..].to_vec();
            expected.sort_by(f64::total_cmp);
            let pick = |p: f64| expected.get((expected.len().saturating_sub(1) as f64 * p).ceil() as usize).copied();
            assert_eq!(window.len(), expected.len());
            assert_eq!(window.percentile(0.99), pick(0.99));
            assert_eq!(window.percentile(0.999), pick(0.999));
            assert_eq!(window.max(), expected.last().copied());
        }
        assert!(IntervalWindow::default().percentile(0.99).is_none());
    }
}
