//! One pipeline per effect for the shared effect-pass shader.
//!
//! `effect-pass/render` (nativeEffectPass.ts) holds every effect in one
//! fragment shader and picks one by the code in its uniforms
//! (`u.effect.x`). The GPU sizes the shader's registers for the largest
//! effect in it, so even an invert or a hue turn ran at the speed of the
//! heaviest one: several milliseconds a pass on an M-series GPU, which was
//! most of the GPU time of a deck with effects. An effect pass's code never
//! changes while its graph is installed (another effect is another graph),
//! so each pass gets a copy of the shader with its code written in as a
//! constant; the compiler drops every other effect from it. Every effect's
//! own instructions are unchanged.
//!
//! Until a specialised pipeline has been built (on a worker), the pass
//! keeps the shared one, so a newly added effect never holds the frame.
//!
//! Metal only for now: there every effect but those in `SHARED_ONLY` was
//! checked to draw byte-for-byte what the shared shader draws (a copy with a
//! constant is a different program to the shader compiler, which may round
//! a result differently). The other backends keep the shared shader until
//! they are checked the same way. `GA_CORE_GENERIC_EFFECT_SHADER=1` turns
//! it off everywhere.

use std::{cell::RefCell, collections::HashMap, sync::Arc, sync::OnceLock};

pub const EFFECT_SHADER_ID: &str = "effect-pass/render";
const CODE_READ: &str = "let code = u32(round(u.effect.x));";
/// Byte offset of `u.effect.x` in the effect uniform block.
const CODE_OFFSET: usize = 16;

#[derive(Clone)]
pub struct Generic {
    pub cache_key: String,
    pub source: Arc<str>,
}

struct Registry {
    /// Specialised cache key (the shared key names the source by hash) ->
    /// source, or None when that source cannot be specialised.
    sources: HashMap<String, Option<Arc<str>>>,
    /// Specialised cache key -> the shared shader it came from.
    generic: HashMap<String, Generic>,
}

thread_local! {
    static REGISTRY: RefCell<Registry> = RefCell::new(Registry { sources: HashMap::new(), generic: HashMap::new() });
}

/// Effect codes whose specialised copy did not match the shared shader
/// byte for byte on Metal (off by one in a few bytes: the compiler rounds
/// their trigonometry differently once the code is a constant): they keep
/// the shared shader. Scanlines, then the 3D hero visuals: club laser grid,
/// crystal shard field, disco mirror ball, donut constellation, helix
/// particle stream, laser slice, light paint, lissajous knot, phase lab,
/// sphere wireframe, string orb, torus tunnel, tube lattice, voxel cube
/// cluster.
const SHARED_ONLY: &[u32] = &[13, 97, 131, 140, 150, 151, 152, 154, 155, 156, 157, 158, 159, 163, 182];

thread_local! {
    static BACKEND_OK: std::cell::Cell<bool> = const { std::cell::Cell::new(false) };
}

/// The renderer's backend, once the device exists.
pub fn set_backend(backend: wgpu::Backend) {
    BACKEND_OK.with(|ok| ok.set(backend == wgpu::Backend::Metal));
}

fn disabled() -> bool {
    static OFF: OnceLock<bool> = OnceLock::new();
    *OFF.get_or_init(|| std::env::var("GA_CORE_GENERIC_EFFECT_SHADER").is_ok_and(|v| v == "1"))
}

/// The effect code in an effect uniform block, if it holds one.
pub fn code_in_uniform(bytes: &[u8]) -> Option<u32> {
    let raw = bytes.get(CODE_OFFSET..CODE_OFFSET + 4)?;
    let value = f32::from_le_bytes(raw.try_into().ok()?);
    (value.is_finite() && value >= 0.0 && value < 4096.0).then(|| value.round() as u32)
}

/// `cache_key` and `source` for this pass with `code` written in, or None
/// when the source does not read its code the expected way.
pub fn specialise(cache_key: &str, source: &Arc<str>, code: u32) -> Option<(String, Arc<str>)> {
    if disabled() || !BACKEND_OK.with(|ok| ok.get()) || SHARED_ONLY.contains(&code) {
        return None;
    }
    // Every queued effect graph asks, every frame: answer from the map, and
    // read the (large) source only the first time a key is seen.
    let specialised_key = format!("{cache_key}:effect-code={code}");
    REGISTRY.with(|registry| {
        let mut registry = registry.borrow_mut();
        if let Some(found) = registry.sources.get(&specialised_key) {
            return found.clone().map(|source| (specialised_key, source));
        }
        if registry.sources.len() > 512 {
            registry.sources.clear();
        }
        let specialised = (source.matches(CODE_READ).count() == 1)
            .then(|| Arc::<str>::from(source.replace(CODE_READ, &format!("let code = {code}u;"))));
        registry.sources.insert(specialised_key.clone(), specialised.clone());
        if specialised.is_some() {
            registry.generic.insert(
                specialised_key.clone(),
                Generic { cache_key: cache_key.to_string(), source: Arc::clone(source) },
            );
        }
        specialised.map(|source| (specialised_key, source))
    })
}

thread_local! {
    static DRAWS: std::cell::Cell<(u64, u64)> = const { std::cell::Cell::new((0, 0)) };
}

/// Count one effect pass drawn with its own pipeline (true) or the shared one.
pub fn note_draw(specialised: bool) {
    DRAWS.with(|draws| {
        let (own, shared) = draws.get();
        draws.set(if specialised { (own + 1, shared) } else { (own, shared + 1) });
    });
}

/// Effect passes drawn so far: (with their own pipeline, with the shared one).
pub fn draws() -> (u64, u64) {
    DRAWS.with(|draws| draws.get())
}

/// The shared shader a specialised pass came from.
pub fn generic_for(cache_key: &str) -> Option<Generic> {
    REGISTRY.with(|registry| registry.borrow().generic.get(cache_key).cloned())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn writes_the_code_in_and_keeps_the_rest() {
        set_backend(wgpu::Backend::Metal);
        let source: Arc<str> = Arc::from("fn a() {}\nfn apply() { let code = u32(round(u.effect.x)); if (code == 7u) {} }");
        let (key, specialised) = specialise("graph-render:x", &source, 7).expect("specialised");
        assert_eq!(key, "graph-render:x:effect-code=7");
        assert_eq!(&*specialised, "fn a() {}\nfn apply() { let code = 7u; if (code == 7u) {} }");
        assert_eq!(generic_for(&key).map(|g| g.cache_key), Some("graph-render:x".to_string()));
        let other: Arc<str> = Arc::from("fn apply() {}");
        assert!(specialise("k", &other, 1).is_none());
        assert!(specialise("graph-render:x", &source, SHARED_ONLY[0]).is_none(), "listed codes keep the shared shader");
        set_backend(wgpu::Backend::Vulkan);
        assert!(specialise("graph-render:y", &source, 7).is_none(), "other backends keep the shared shader");
    }

    #[test]
    fn reads_the_code_from_the_uniform_block() {
        let mut bytes = vec![0u8; 112];
        bytes[16..20].copy_from_slice(&14.0f32.to_le_bytes());
        assert_eq!(code_in_uniform(&bytes), Some(14));
        assert_eq!(code_in_uniform(&bytes[..10]), None);
    }
}
