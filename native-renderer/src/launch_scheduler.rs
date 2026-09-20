//! Bounded, cancellable prepared command transactions. This queue does not
//! construct graphs or decode assets; callers must prepare those before enqueue.
use serde_json::{json, Value};
use std::{collections::{HashMap, HashSet, VecDeque}, time::{Duration, Instant}};
const MAX_PENDING: usize = 64;
const MAX_BYTES: usize = 2 * 1024 * 1024;
const MAX_LANES: usize = 128;
const MAX_RESOURCES: usize = 512;
pub struct Launch {
    pub id: String,
    pub lane: String,
    pub revision: u64,
    pub commands: Value,
    pub expected_sources: Value,
    pub due: Instant,
    pub beat: Option<f64>,
    expires: Instant,
    bytes: usize,
    resources: HashSet<String>,
}
#[derive(Default)]
pub struct Scheduler {
    pending: Vec<Launch>,
    revisions: HashMap<String, u64>,
    resource_revisions: HashMap<String, u64>,
    receipts: VecDeque<(Value, Instant)>,
    serial: u64,
}
impl Scheduler {
    pub fn enqueue(&mut self, args: &Value, now: Instant, max_commands: usize) -> Result<Value, String> {
        let id = args["id"].as_str().filter(|s| !s.is_empty() && s.len() <= 128).ok_or("invalid launch id")?;
        let lane = args["lane"].as_str().filter(|s| !s.is_empty() && s.len() <= 128).ok_or("invalid launch lane")?;
        let revision = args["revision"].as_u64().filter(|n| *n > 0).ok_or("invalid launch revision")?;
        if self.revisions.get(lane).is_some_and(|r| revision <= *r) { return Err("stale launch revision".into()); }
        if !self.revisions.contains_key(lane) && self.revisions.len() >= MAX_LANES { return Err("launch lane limit reached".into()); }
        let commands = args["commands"].as_array().filter(|c| !c.is_empty() && c.len() <= max_commands.min(256)).ok_or("invalid launch command count")?;
        // Only prepared layer/media mutations. No output resize, compilation,
        // capture, recursive scheduling or arbitrary graph upload on a deadline.
        for c in commands {
            let kind = c["type"].as_str().unwrap_or("");
            if !matches!(kind, "bind_media_source" | "set_media_source_playback" | "set_layer_visibility" | "set_layer_color" | "start_prepared_transition") {
                return Err(format!("command is not a prepared launch mutation: {kind}"));
            }
            let allowed: &[&str] = match kind {
                "start_prepared_transition" => &["type", "layer_id", "token", "sources"],
                "set_layer_visibility" => &["type", "layer_id", "visible"],
                "set_layer_color" => &["type", "layer_id", "rgba"],
                "bind_media_source" => &["type", "layer_id", "source_id", "uri", "source_type"],
                _ => &["type", "source_id", "uri", "time_seconds", "paused", "seek_generation"],
            };
            if c.as_object().unwrap().keys().any(|k| !allowed.contains(&k.as_str())) { return Err("unprepared launch field".into()); }
            if kind == "start_prepared_transition" {
                if c["token"].as_u64().filter(|token| *token > 0).is_none() { return Err("invalid transition token".into()); }
                let sources = c["sources"].as_array().filter(|sources| sources.len() == 2).ok_or("transition requires two prepared sources")?;
                for source in sources {
                    if source["source_id"].as_str().is_none_or(|id| id.is_empty() || id.len() > 256)
                        || source.get("seek_generation").is_some_and(|v| v.as_u64().is_none()) { return Err("invalid transition source".into()); }
                }
            }
            if kind == "set_media_source_playback" {
                if c.get("time_seconds").is_some_and(|v| v.as_f64().is_none_or(|x| !x.is_finite() || x < 0.0))
                    || c.get("paused").is_some_and(|v| !v.is_boolean())
                    || c.get("seek_generation").is_some_and(|v| v.as_u64().is_none()) { return Err("invalid playback launch".into()); }
            }
            if kind == "set_layer_visibility" && !c["visible"].is_boolean() { return Err("invalid visibility".into()); }
            if kind == "set_layer_color" && c["rgba"].as_array().is_none_or(|v| v.len() != 4 || v.iter().any(|n| n.as_f64().is_none_or(|x| !x.is_finite()))) { return Err("invalid color".into()); }
            let field = if kind == "set_media_source_playback" { "source_id" } else { "layer_id" };
            if c[field].as_str().is_none_or(|s| s.is_empty() || s.len() > 256) { return Err(format!("invalid {field}")); }
            if kind == "bind_media_source" && c["source_id"].as_str().is_none_or(|s| s.is_empty()) { return Err("invalid source_id".into()); }
        }
        let delay = args["delay_ms"].as_f64().filter(|v| v.is_finite() && *v >= 0.0 && *v <= 60000.0).ok_or("delay_ms must be within 0..60000")?;
        let beat = match args.get("beat") { None => None, Some(v) => Some(v.as_f64().filter(|v| v.is_finite()).ok_or("invalid launch beat")?) };
        let mut resources: HashSet<String> = commands.iter().filter_map(|c| c["layer_id"].as_str().map(|id| format!("layer:{id}"))).collect();
        if let Some(guards) = args.get("expected_sources").filter(|value| !value.is_null()) {
            let guards = guards.as_object().filter(|g| g.len() <= 64).ok_or("invalid expected source guards")?;
            for (layer, guard) in guards {
                if layer.is_empty() || layer.len() > 256 || guard["source_id"].as_str().is_none_or(|id| id.is_empty() || id.len() > 256)
                    || guard.get("seek_generation").is_some_and(|v| v.as_u64().is_none()) { return Err("invalid expected source guard".into()); }
                resources.insert(format!("layer:{layer}"));
            }
        }
        let mut transition_layers = HashSet::new();
        if commands.iter().filter(|c| c["type"] == "start_prepared_transition")
            .any(|c| !transition_layers.insert(c["layer_id"].as_str().unwrap())) {
            return Err("duplicate transition start".into());
        }
        // Graph-input conflicts need the installed graph and are checked by
        // the renderer before any command in the transaction is applied.
        // Source playback is shared even when different layers/decks bind it.
        // Fence bindings too: a queued seek must not invalidate another launch's
        // prepared frame. Namespace keys so a layer and source may share an ID.
        for command in commands {
            if let Some(id) = command["source_id"].as_str() {
                resources.insert(format!("source:{id}"));
            }
        }
        for source in commands.iter().filter_map(|c| c["sources"].as_array()).flatten() {
            resources.insert(format!("source:{}", source["source_id"].as_str().unwrap()));
        }
        if resources.iter().any(|key| self.resource_revisions.get(key).is_some_and(|current| revision <= *current)) {
            return Err("stale launch resource revision".into());
        }
        if self.resource_revisions.len() + resources.iter().filter(|key| !self.resource_revisions.contains_key(*key)).count() > MAX_RESOURCES {
            return Err("launch resource limit reached".into());
        }
        let bytes = serde_json::to_vec(args).map_err(|e| e.to_string())?.len();
        let retained = |p: &&Launch| p.lane != lane && p.resources.is_disjoint(&resources);
        let remaining_bytes: usize = self.pending.iter().filter(retained).map(|p| p.bytes).sum();
        if bytes + remaining_bytes > MAX_BYTES || self.pending.iter().filter(retained).count() >= MAX_PENDING { return Err("launch queue budget exceeded".into()); }
        // A row action supersedes an overlapping column as a whole. Resource
        // fences also reject an older cross-lane enqueue that arrives late.
        for launch in std::mem::take(&mut self.pending) {
            if launch.lane == lane || !launch.resources.is_disjoint(&resources) { self.record(&launch, "replaced", Value::Null); }
            else { self.pending.push(launch); }
        }
        for key in &resources { self.resource_revisions.insert(key.clone(), revision); }
        self.revisions.insert(lane.to_string(), revision);
        self.pending.push(Launch { id: id.into(), lane: lane.into(), revision, commands: args["commands"].clone(), expected_sources: args["expected_sources"].clone(),
            due: now + Duration::from_secs_f64(delay / 1000.0), beat, expires: now + Duration::from_secs(65), bytes, resources });
        Ok(json!({"accepted": true, "id": id, "lane": lane, "revision": revision}))
    }
    fn record(&mut self, launch: &Launch, state: &str, extra: Value) {
        self.serial += 1;
        self.receipts.push_back((json!({"serial":self.serial,"id":launch.id,"lane":launch.lane,"revision":launch.revision,"state":state,"detail":extra}), Instant::now()));
        while self.receipts.len() > 128 { self.receipts.pop_front(); }
    }
    fn cancel_lane(&mut self, lane: &str, state: &str) {
        let all = std::mem::take(&mut self.pending);
        for launch in all { if launch.lane == lane { self.record(&launch, state, Value::Null); } else { self.pending.push(launch); } }
    }
    pub fn cancel(&mut self, lane: &str, revision: u64) -> Result<(), String> {
        if lane.is_empty() || lane.len() > 128 || revision == 0 { return Err("invalid launch cancellation".into()); }
        if self.revisions.get(lane).is_some_and(|r| revision < *r) { return Err("stale launch cancellation".into()); }
        if !self.revisions.contains_key(lane) && self.revisions.len() >= MAX_LANES { return Err("launch lane limit reached".into()); }
        self.revisions.insert(lane.into(), revision);
        self.cancel_lane(lane, "cancelled"); Ok(())
    }
    pub fn clear(&mut self) {
        for launch in std::mem::take(&mut self.pending) { self.record(&launch, "cancelled", Value::Null); }
        // Keep revision fences: delayed messages must not resurrect cancelled work.
    }
    pub fn references_source(&self, id: &str) -> bool {
        self.pending.iter().any(|launch| launch.commands.as_array().unwrap().iter().any(|command| command["source_id"].as_str() == Some(id)
            || command["sources"].as_array().is_some_and(|sources| sources.iter().any(|source| source["source_id"].as_str() == Some(id)))))
    }
    pub fn has_pending(&self) -> bool { !self.pending.is_empty() }
    pub fn take_due(&mut self, now: Instant, beat: Option<f64>) -> Vec<Launch> {
        let mut due = Vec::new();
        for launch in std::mem::take(&mut self.pending) {
            if now >= launch.expires { self.record(&launch, "expired", Value::Null); }
            else if launch.beat.map_or(now >= launch.due, |target| beat.is_some_and(|current| current >= target)) { due.push(launch); }
            else { self.pending.push(launch); }
        }
        due
    }
    pub fn complete(&mut self, launch: &Launch, detail: Value) { self.record(launch, "applied", detail); }
    pub fn reject(&mut self, launch: &Launch, reason: &str) { self.record(launch, "rejected", json!(reason)); }
    pub fn status(&self) -> Value { json!({"pending":self.pending.iter().map(|p| json!({"id":p.id,"lane":p.lane,"revision":p.revision})).collect::<Vec<_>>(),"receipts":self.receipts.iter().map(|(value, at)| { let mut value=value.clone(); value["age_ms"]=json!(at.elapsed().as_secs_f64()*1000.0); value }).collect::<Vec<_>>(),"serial":self.serial}) }
}
#[cfg(test)] mod tests {
    use super::*;
    fn request(revision:u64) -> Value { json!({"id":format!("launch-{revision}"),"lane":"A:0","revision":revision,"delay_ms":100,"commands":[{"type":"set_layer_visibility","layer_id":"layer","visible":true}]}) }
    #[test] fn deadline_and_revision_fences() {
        let now=Instant::now(); let mut q=Scheduler::default();
        q.enqueue(&request(1),now,100).unwrap();
        assert!(q.take_due(now,None).is_empty());
        q.enqueue(&request(2),now,100).unwrap();
        assert!(q.cancel("A:0",1).is_err());
        let due=q.take_due(now+Duration::from_millis(100),None);
        assert_eq!(due.len(),1); assert_eq!(due[0].revision,2);
        q.complete(&due[0],json!({}));
        assert!(q.enqueue(&request(1),now,100).is_err());
        assert!(!q.has_pending());
    }
    #[test] fn link_requires_clock_and_obeys_changed_tempo() {
        let now=Instant::now();let mut q=Scheduler::default();let mut p=request(1);p["beat"]=json!(8);
        q.enqueue(&p,now,100).unwrap();
        assert!(q.take_due(now+Duration::from_secs(1),None).is_empty());
        assert!(q.take_due(now+Duration::from_secs(1),Some(7.9)).is_empty());
        assert_eq!(q.take_due(now+Duration::from_secs(1),Some(8.0)).len(),1);
    }
    #[test] fn cancelled_or_expired_work_never_fires() {
        let now=Instant::now();let mut q=Scheduler::default();q.enqueue(&request(1),now,100).unwrap();q.cancel("A:0",1).unwrap();
        assert!(q.take_due(now+Duration::from_secs(1),None).is_empty());
        q.enqueue(&request(2),now,100).unwrap();assert!(q.take_due(now+Duration::from_secs(66),None).is_empty());
        assert_eq!(q.status()["receipts"][1]["state"],"expired");
    }
    #[test] fn rejects_unsafe_commands_without_replacing_pending() {
        let now=Instant::now();let mut q=Scheduler::default();q.enqueue(&request(1),now,100).unwrap();let mut p=request(2);p["commands"][0]["type"]=json!("set_output");
        assert!(q.enqueue(&p,now,100).is_err());assert_eq!(q.take_due(now+Duration::from_secs(1),None)[0].revision,1);
    }
    #[test] fn row_supersedes_entire_column_and_fences_late_cross_lane_enqueue() {
        let now=Instant::now(); let mut q=Scheduler::default();
        let mut column=request(1); column["lane"]=json!("column:A");
        column["commands"].as_array_mut().unwrap().push(json!({"type":"set_layer_visibility","layer_id":"other-row","visible":true}));
        q.enqueue(&column,now,100).unwrap();
        q.enqueue(&request(3),now,100).unwrap();
        assert_eq!(q.status()["receipts"][0]["state"],"replaced");
        column["revision"]=json!(2);
        assert!(q.enqueue(&column,now,100).unwrap_err().contains("resource revision"));
        let due=q.take_due(now+Duration::from_secs(1),None);
        assert_eq!(due.len(),1); assert_eq!(due[0].lane,"A:0");
    }
    #[test] fn column_supersedes_rows_but_preserves_non_overlapping_work() {
        let now=Instant::now(); let mut q=Scheduler::default();
        q.enqueue(&request(1),now,100).unwrap();
        let mut independent=request(2); independent["lane"]=json!("A:2"); independent["commands"][0]["layer_id"]=json!("unrelated");
        q.enqueue(&independent,now,100).unwrap();
        let mut column=request(3); column["lane"]=json!("column:A");
        q.enqueue(&column,now,100).unwrap();
        let due=q.take_due(now+Duration::from_secs(1),None);
        assert_eq!(due.len(),2); assert!(due.iter().any(|p| p.lane=="A:2"));
        assert!(due.iter().any(|p| p.lane=="column:A"));
    }
    #[test] fn malformed_guards_do_not_replace_valid_pending_work() {
        let now=Instant::now(); let mut q=Scheduler::default(); q.enqueue(&request(1),now,100).unwrap();
        let mut invalid=request(2); invalid["expected_sources"]=json!({"layer":{"source_id":17}});
        assert!(q.enqueue(&invalid,now,100).is_err());
        assert_eq!(q.take_due(now+Duration::from_secs(1),None)[0].revision,1);
    }

    #[test] fn shared_sources_supersede_across_decks_and_fence_late_arrivals() {
        let now=Instant::now(); let mut q=Scheduler::default();
        let mut a=request(1);
        a["commands"]=json!([{"type":"set_media_source_playback","source_id":"shared","paused":false,"seek_generation":1}]);
        q.enqueue(&a,now,100).unwrap();
        let mut b=request(3); b["lane"]=json!("B:0");
        b["commands"]=json!([{"type":"bind_media_source","layer_id":"other","source_id":"shared"}]);
        q.enqueue(&b,now,100).unwrap();
        assert_eq!(q.status()["receipts"][0]["state"],"replaced");
        a["revision"]=json!(2);
        assert!(q.enqueue(&a,now,100).unwrap_err().contains("resource revision"));
        assert_eq!(q.take_due(now+Duration::from_secs(1),None)[0].lane,"B:0");
    }
    #[test] fn layer_and_source_resource_names_do_not_collide() {
        let now=Instant::now(); let mut q=Scheduler::default();
        q.enqueue(&request(1),now,100).unwrap();
        let mut other=request(2); other["lane"]=json!("B:0");
        other["commands"]=json!([{"type":"set_media_source_playback","source_id":"layer","paused":false}]);
        q.enqueue(&other,now,100).unwrap();
        assert_eq!(q.take_due(now+Duration::from_secs(1),None).len(),2);
    }

    #[test] fn transition_sources_are_pinned_and_participate_in_conflicts() {
        let now=Instant::now(); let mut q=Scheduler::default(); let mut fade=request(1);
        fade["commands"]=json!([{"type":"start_prepared_transition","layer_id":"fade","token":7,
            "sources":[{"source_id":"old"},{"source_id":"new","seek_generation":2}]}]);
        q.enqueue(&fade,now,100).unwrap(); assert!(q.references_source("new"));
        let mut row=request(2); row["lane"]=json!("B:0");
        row["commands"]=json!([{"type":"set_media_source_playback","source_id":"new","paused":false}]);
        q.enqueue(&row,now,100).unwrap();
        assert_eq!(q.status()["receipts"][0]["state"],"replaced");
        assert_eq!(q.take_due(now+Duration::from_secs(1),None).len(),1);
    }
    #[test] fn transition_rejects_malformed_sources_but_allows_mixed_transactions() {
        let now=Instant::now(); let mut q=Scheduler::default(); let mut fade=request(1);
        fade["commands"]=json!([{"type":"start_prepared_transition","layer_id":"fade","token":7,"sources":[]}]);
        assert!(q.enqueue(&fade,now,100).is_err());
        fade["commands"][0]["sources"]=json!([{"source_id":"old"},{"source_id":"new"}]);
        fade["commands"].as_array_mut().unwrap().push(json!({"type":"bind_media_source","layer_id":"input","source_id":"other"}));
        assert!(q.enqueue(&fade,now,100).is_ok());
    }

}
