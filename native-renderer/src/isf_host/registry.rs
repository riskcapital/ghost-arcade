//! The shader registry: precompiled shaders and their eviction.

use crate::*;

#[derive(Clone, Debug, Serialize)]
pub(crate) struct ShaderRecord {
    pub(crate) shader_id: String,
    pub(crate) stage: String,
    pub(crate) entry: String,
    pub(crate) source_kind: String,
    pub(crate) source_hash: u64,
    pub(crate) source_bytes: usize,
    pub(crate) entry_points: Vec<String>,
    pub(crate) compiled_at_ms: u64,
}

/// The `count` least recently used layer shaders that are registered and
/// that no layer is bound to, oldest first.
pub(crate) fn shader_eviction_victims(
    last_used: &HashMap<String, u64>,
    registry: &HashMap<String, ShaderRecord>,
    bound: &HashSet<String>,
    count: usize,
) -> Vec<String> {
    let mut candidates = last_used
        .iter()
        .filter(|(id, _)| registry.contains_key(*id) && !bound.contains(*id))
        .map(|(id, tick)| (*tick, id))
        .collect::<Vec<_>>();
    candidates.sort_unstable();
    candidates.into_iter().take(count).map(|(_, id)| id.clone()).collect()
}

impl App {
    pub(crate) fn apply_precompile_shader(&mut self, command: &Value) {
        self.stats.shader_precompile_queued = self.stats.shader_precompile_queued.saturating_add(1);
        let Some(shader_id) = string_at(command, &["shader_id"]) else {
            self.stats.shader_precompile_dropped =
                self.stats.shader_precompile_dropped.saturating_add(1);
            return;
        };
        let Some(source) = string_at(command, &["source"]) else {
            self.stats.shader_precompile_dropped =
                self.stats.shader_precompile_dropped.saturating_add(1);
            return;
        };
        let stage = string_at(command, &["stage"]).unwrap_or_else(|| "module".to_string());
        let entry = string_at(command, &["entry"]).unwrap_or_else(|| "main".to_string());

        let cap = self.shader_precompile_queue_cap as usize;
        if self.shader_registry.len() >= cap && !self.shader_registry.contains_key(&shader_id) {
            // Every ISF edit and clip adds a record; make room from layer
            // shaders nothing shows any more instead of refusing new ones.
            self.evict_unbound_layer_shaders(self.shader_registry.len() + 1 - cap);
        }
        if self.shader_registry.len() >= cap && !self.shader_registry.contains_key(&shader_id) {
            self.stats.shader_precompile_dropped =
                self.stats.shader_precompile_dropped.saturating_add(1);
            self.last_shader_error =
                Some(format!("shader registry cap reached; dropped {shader_id}"));
            return;
        }

        let source_kind = classify_native_shader_source(&source);
        match source_kind {
            NativeShaderSourceKind::Wgsl => {}
            NativeShaderSourceKind::IsfGlsl | NativeShaderSourceKind::Glsl => {
                match probe_native_glsl_source(&source, native_glsl_stage_for_label(&stage)) {
                    Ok(probe) => {
                        let native_source =
                            native_glsl_probe_source(&source, probe.kind).into_owned();
                        let isf_inputs = matches!(probe.kind, NativeShaderSourceKind::IsfGlsl)
                            .then(|| parse_native_isf_inputs(&source))
                            .unwrap_or_default();
                        let record = ShaderRecord {
                            shader_id: shader_id.clone(),
                            stage,
                            entry,
                            source_kind: probe.kind.label().to_string(),
                            source_hash: stable_hash64(&source),
                            source_bytes: source.len(),
                            entry_points: probe.entry_points,
                            compiled_at_ms: epoch_ms().min(u64::MAX as u128) as u64,
                        };
                        self.shader_registry.insert(shader_id.clone(), record);
                        self.evicted_shader_ids.remove(&stable_hash64(&shader_id));
                        self.shader_sources
                            .insert(shader_id.clone(), Arc::<str>::from(native_source));
                        let host = matches!(probe.kind, NativeShaderSourceKind::IsfGlsl)
                            .then(|| native_isf_host_info(&source))
                            .filter(NativeIsfHostInfo::needs_pass_host);
                        match host {
                            Some(host) => {
                                // Every precompile is a (re)load: a new
                                // generation drops persistent buffers.
                                self.isf_shader_generation = self.isf_shader_generation.wrapping_add(1);
                                self.shader_isf_hosts
                                    .insert(shader_id.clone(), (Arc::new(host), self.isf_shader_generation));
                            }
                            None => {
                                self.shader_isf_hosts.remove(&shader_id);
                            }
                        }
                        self.shader_isf_inputs.insert(shader_id, isf_inputs);
                        self.stats.shader_precompile_compiled =
                            self.stats.shader_precompile_compiled.saturating_add(1);
                        self.stats.shader_cache_entries = self.shader_registry.len() as u64;
                        self.stats.precompiled_vertex_shaders =
                            self.precompiled_shader_count("vertex") as u64;
                        self.stats.precompiled_pixel_shaders =
                            self.precompiled_shader_count("pixel") as u64;
                        self.last_shader_error = None;
                    }
                    Err(err) => {
                        self.stats.shader_precompile_failed =
                            self.stats.shader_precompile_failed.saturating_add(1);
                        self.shader_isf_inputs.remove(&shader_id);
                        self.shader_isf_hosts.remove(&shader_id);
                        self.last_shader_error = Some(format!(
                            "{shader_id}: native GLSL/ISF parse probe failed: {err}; no browser fallback is allowed"
                        ));
                    }
                }
                return;
            }
        }

        match naga::front::wgsl::parse_str(&source) {
            Ok(module) => {
                let entry_points = module
                    .entry_points
                    .iter()
                    .map(|entry| entry.name.clone())
                    .collect::<Vec<_>>();
                let record = ShaderRecord {
                    shader_id: shader_id.clone(),
                    stage,
                    entry,
                    source_kind: source_kind.label().to_string(),
                    source_hash: stable_hash64(&source),
                    source_bytes: source.len(),
                    entry_points,
                    compiled_at_ms: epoch_ms().min(u64::MAX as u128) as u64,
                };
                self.shader_registry.insert(shader_id.clone(), record);
                self.evicted_shader_ids.remove(&stable_hash64(&shader_id));
                self.shader_sources
                    .insert(shader_id.clone(), Arc::<str>::from(source));
                self.shader_isf_inputs.remove(&shader_id);
                self.shader_isf_hosts.remove(&shader_id);
                self.stats.shader_precompile_compiled =
                    self.stats.shader_precompile_compiled.saturating_add(1);
                self.stats.shader_cache_entries = self.shader_registry.len() as u64;
                self.stats.precompiled_vertex_shaders =
                    self.precompiled_shader_count("vertex") as u64;
                self.stats.precompiled_pixel_shaders =
                    self.precompiled_shader_count("pixel") as u64;
                self.last_shader_error = None;
            }
            Err(err) => {
                self.stats.shader_precompile_failed =
                    self.stats.shader_precompile_failed.saturating_add(1);
                self.shader_isf_inputs.remove(&shader_id);
                self.shader_isf_hosts.remove(&shader_id);
                self.last_shader_error = Some(format!("{shader_id}: {err}"));
            }
        }
    }

    /// Drop the `count` least recently used layer shaders that no layer is
    /// bound to, from every shader-keyed map.
    pub(crate) fn evict_unbound_layer_shaders(&mut self, count: usize) {
        let bound: HashSet<String> = self.isf_layer_bindings.values()
            .chain(self.scene_layers.values().filter_map(|layer| layer.shader_id.as_ref()))
            .cloned()
            .collect();
        let victims = shader_eviction_victims(&self.isf_shader_last_used, &self.shader_registry, &bound, count);
        if self.evicted_shader_ids.len() + victims.len() > 262_144 {
            self.evicted_shader_ids.clear();
        }
        for id in &victims {
            self.shader_registry.remove(id);
            self.shader_sources.remove(id);
            self.shader_isf_inputs.remove(id);
            self.shader_isf_hosts.remove(id);
            self.isf_uniforms.remove(id);
            self.isf_time_anchors.remove(id);
            self.isf_shader_last_used.remove(id);
            self.evicted_shader_ids.insert(stable_hash64(id));
        }
        // Uniforms and use times for shaders that never registered (a parse
        // error) have no other removal path.
        let registry = &self.shader_registry;
        self.isf_uniforms.retain(|id, _| registry.contains_key(id) || bound.contains(id));
        self.isf_time_anchors.retain(|id, _| registry.contains_key(id) || bound.contains(id));
        self.isf_shader_last_used.retain(|id, _| registry.contains_key(id) || bound.contains(id));
        let hashes: HashSet<u64> = registry.values().map(|record| record.source_hash).collect();
        self.shader_reads_inputs.retain(|hash, _| hashes.contains(hash));
        self.stats.shader_cache_entries = self.shader_registry.len() as u64;
    }

    pub(crate) fn precompiled_shader_count(&self, stage: &str) -> u32 {
        self.shader_registry
            .values()
            .filter(|record| record.stage.eq_ignore_ascii_case(stage))
            .count()
            .min(u32::MAX as usize) as u32
    }

    pub(crate) fn shader_registry_snapshot(&self) -> Vec<ShaderRecord> {
        let mut shaders = self.shader_registry.values().cloned().collect::<Vec<_>>();
        shaders.sort_by(|a, b| a.shader_id.cmp(&b.shader_id));
        shaders
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_registry_cap_drops_only_unbound_layer_shaders_oldest_first() {
        let record = |id: &str| ShaderRecord {
            shader_id: id.to_string(), stage: "pixel".to_string(), entry: "main".to_string(),
            source_kind: NativeShaderSourceKind::IsfGlsl.label().to_string(), source_hash: 1,
            source_bytes: 1, entry_points: vec!["main".to_string()], compiled_at_ms: 1,
        };
        let registry: HashMap<String, ShaderRecord> = ["stdlib:tonemap", "clip:a", "clip:b", "clip:c", "clip:d"]
            .into_iter().map(|id| (id.to_string(), record(id))).collect();
        // A graph shader is never bound to a layer, so it has no use time.
        let last_used: HashMap<String, u64> = [("clip:a", 4), ("clip:b", 1), ("clip:c", 2), ("clip:d", 3), ("clip:gone", 0)]
            .into_iter().map(|(id, tick)| (id.to_string(), tick)).collect();
        let bound: HashSet<String> = ["clip:c".to_string()].into_iter().collect();
        assert_eq!(shader_eviction_victims(&last_used, &registry, &bound, 2), vec!["clip:b", "clip:d"]);
        assert_eq!(shader_eviction_victims(&last_used, &registry, &bound, 10), vec!["clip:b", "clip:d", "clip:a"]);
        assert!(shader_eviction_victims(&last_used, &registry, &bound, 0).is_empty());
    }
}
