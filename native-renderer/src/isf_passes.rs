//! ISF 2.0 multi-pass planning and ISF audio-texture data.
//!
//! Pure CPU side of the native ISF host: reads the `PASSES` /
//! `PERSISTENT_BUFFERS` metadata into a pass plan, evaluates the
//! `WIDTH`/`HEIGHT` size expressions ("$WIDTH/2", "max($HEIGHT/4, 16.0)"),
//! and turns analyser spectra into the 1-row RGBA rows the `audio` /
//! `audioFFT` inputs sample. The GPU side (targets, ping-pong, uploads)
//! lives with the renderer in main.rs; everything here is unit-tested
//! without a device.

use serde_json::Value;

/// Pass targets a shader can declare. Each one is a sampled texture in the
/// shared ISF bind group, so this is bounded by the per-stage texture limit
/// (16 by default: 1 source array + 8 targets + 2 audio rows = 11).
pub const MAX_ISF_PASS_TARGETS: usize = 8;
/// Width of an audio row when the input declares no `MAX`.
pub const ISF_AUDIO_DEFAULT_WIDTH: u32 = 512;
pub const ISF_AUDIO_MAX_WIDTH: u32 = 2048;
/// Longest spectrum/waveform the core keeps from `set_audio_spectrum`.
pub const ISF_AUDIO_MAX_SOURCE_SAMPLES: usize = 4096;
/// Largest physical pass target edge. Targets scale with the output slot, so
/// this only bites on absurd size expressions.
pub const ISF_PASS_TARGET_MAX_EDGE: u32 = 4096;

/// Image codes the native ISF GLSL host hands to its sampling dispatcher.
/// Non-negative codes are source-frame array layers; negative ones select
/// the pass targets and audio rows bound next to that array.
pub fn isf_pass_target_image_code(index: usize) -> f32 {
    -(index as f32 + 1.0)
}
pub const ISF_IMAGE_CODE_AUDIO_FFT: f32 = -9.0;
pub const ISF_IMAGE_CODE_AUDIO_WAVEFORM: f32 = -10.0;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum IsfAudioKind {
    Fft,
    Waveform,
}

impl IsfAudioKind {
    pub fn image_code(self) -> f32 {
        match self {
            IsfAudioKind::Fft => ISF_IMAGE_CODE_AUDIO_FFT,
            IsfAudioKind::Waveform => ISF_IMAGE_CODE_AUDIO_WAVEFORM,
        }
    }
}

/// A named buffer passes render into and later passes (or later frames, when
/// persistent) sample.
#[derive(Clone, Debug, PartialEq)]
pub struct IsfTargetSpec {
    pub name: String,
    pub persistent: bool,
    pub float: bool,
    /// Size expressions in the shader's virtual pixels. None = render size.
    pub width: Option<String>,
    pub height: Option<String>,
}

#[derive(Clone, Debug, PartialEq)]
pub struct IsfPassSpec {
    /// Index into `IsfPassPlan::targets`; None renders to the output.
    pub target: Option<usize>,
}

#[derive(Clone, Debug, Default, PartialEq)]
pub struct IsfPassPlan {
    pub passes: Vec<IsfPassSpec>,
    pub targets: Vec<IsfTargetSpec>,
    /// Targets past MAX_ISF_PASS_TARGETS. Their passes are skipped and the
    /// names sample transparent black instead of failing to compile.
    pub dropped_targets: Vec<String>,
}

impl IsfPassPlan {
    /// True when the shader needs the pass-aware host: more than one pass or
    /// any named buffer.
    pub fn is_multipass(&self) -> bool {
        self.passes.len() > 1 || !self.targets.is_empty() || !self.dropped_targets.is_empty()
    }

    /// Passes to run, never empty: a shader without PASSES is one output pass.
    pub fn effective_passes(&self) -> Vec<IsfPassSpec> {
        if self.passes.is_empty() {
            vec![IsfPassSpec { target: None }]
        } else {
            self.passes.clone()
        }
    }

    pub fn target_index(&self, name: &str) -> Option<usize> {
        self.targets.iter().position(|target| target.name == name)
    }
}

fn size_expr_value(value: Option<&Value>) -> Option<String> {
    match value? {
        Value::String(text) => {
            let trimmed = text.trim();
            (!trimmed.is_empty()).then(|| trimmed.to_string())
        }
        Value::Number(number) => number.as_f64().map(|value| format!("{value}")),
        _ => None,
    }
}

fn truthy(value: Option<&Value>) -> bool {
    match value {
        Some(Value::Bool(flag)) => *flag,
        Some(Value::Number(number)) => number.as_f64().is_some_and(|value| value != 0.0),
        Some(Value::String(text)) => matches!(text.trim().to_ascii_lowercase().as_str(), "true" | "1" | "yes"),
        _ => false,
    }
}

/// Read `PASSES` (ISF 2) and `PERSISTENT_BUFFERS` (ISF 1: an array of names
/// or an object of name -> {WIDTH, HEIGHT, FLOAT}) into a plan. Target
/// order is first appearance, which is also the binding slot.
pub fn parse_isf_pass_plan(metadata: &Value) -> IsfPassPlan {
    let mut plan = IsfPassPlan::default();
    let upsert = |plan: &mut IsfPassPlan, name: &str| -> Option<usize> {
        let name = name.trim();
        if name.is_empty() || !is_glsl_identifier(name) {
            return None;
        }
        if let Some(index) = plan.target_index(name) {
            return Some(index);
        }
        if plan.dropped_targets.iter().any(|dropped| dropped == name) {
            return None;
        }
        if plan.targets.len() >= MAX_ISF_PASS_TARGETS {
            plan.dropped_targets.push(name.to_string());
            return None;
        }
        plan.targets.push(IsfTargetSpec {
            name: name.to_string(),
            persistent: false,
            float: false,
            width: None,
            height: None,
        });
        Some(plan.targets.len() - 1)
    };

    if let Some(passes) = metadata.get("PASSES").and_then(Value::as_array) {
        for pass in passes {
            let target_name = pass.get("TARGET").and_then(Value::as_str).map(str::trim).filter(|name| !name.is_empty());
            let target = match target_name {
                Some(name) => {
                    let index = upsert(&mut plan, name);
                    if index.is_none() {
                        // Over the target cap (or an invalid name): skip the
                        // pass rather than let it overwrite the output.
                        continue;
                    }
                    index
                }
                None => None,
            };
            if let Some(index) = target {
                let spec = &mut plan.targets[index];
                spec.persistent |= truthy(pass.get("PERSISTENT"));
                spec.float |= truthy(pass.get("FLOAT"));
                if spec.width.is_none() {
                    spec.width = size_expr_value(pass.get("WIDTH"));
                }
                if spec.height.is_none() {
                    spec.height = size_expr_value(pass.get("HEIGHT"));
                }
            }
            plan.passes.push(IsfPassSpec { target });
        }
    }

    match metadata.get("PERSISTENT_BUFFERS") {
        Some(Value::Array(names)) => {
            for name in names.iter().filter_map(Value::as_str) {
                if let Some(index) = upsert(&mut plan, name) {
                    plan.targets[index].persistent = true;
                }
            }
        }
        Some(Value::Object(buffers)) => {
            for (name, spec) in buffers {
                if let Some(index) = upsert(&mut plan, name) {
                    let target = &mut plan.targets[index];
                    target.persistent = true;
                    target.float |= truthy(spec.get("FLOAT"));
                    if target.width.is_none() {
                        target.width = size_expr_value(spec.get("WIDTH"));
                    }
                    if target.height.is_none() {
                        target.height = size_expr_value(spec.get("HEIGHT"));
                    }
                }
            }
        }
        Some(Value::String(name)) => {
            if let Some(index) = upsert(&mut plan, name) {
                plan.targets[index].persistent = true;
            }
        }
        _ => {}
    }
    plan
}

fn is_glsl_identifier(name: &str) -> bool {
    let mut chars = name.chars();
    let Some(first) = chars.next() else {
        return false;
    };
    (first == '_' || first.is_ascii_alphabetic()) && chars.all(|ch| ch == '_' || ch.is_ascii_alphanumeric())
}

// ── Size expressions ────────────────────────────────────────────────────

#[derive(Clone, Debug, PartialEq)]
enum Token {
    Number(f64),
    Ident(String),
    Op(char),
    LParen,
    RParen,
    Comma,
}

fn tokenize(expr: &str) -> Option<Vec<Token>> {
    let chars = expr.chars().collect::<Vec<_>>();
    let mut tokens = Vec::new();
    let mut index = 0usize;
    while index < chars.len() {
        let ch = chars[index];
        if ch.is_whitespace() {
            index += 1;
        } else if ch.is_ascii_digit() || (ch == '.' && chars.get(index + 1).is_some_and(|next| next.is_ascii_digit())) {
            let start = index;
            while index < chars.len() && (chars[index].is_ascii_digit() || chars[index] == '.') {
                index += 1;
            }
            if index < chars.len() && (chars[index] == 'e' || chars[index] == 'E') {
                let mut look = index + 1;
                if look < chars.len() && (chars[look] == '+' || chars[look] == '-') {
                    look += 1;
                }
                if look < chars.len() && chars[look].is_ascii_digit() {
                    index = look;
                    while index < chars.len() && chars[index].is_ascii_digit() {
                        index += 1;
                    }
                }
            }
            let text = chars[start..index].iter().collect::<String>();
            tokens.push(Token::Number(text.parse().ok()?));
        } else if ch == '$' || ch == '_' || ch.is_ascii_alphabetic() {
            let start = if ch == '$' { index + 1 } else { index };
            index += 1;
            while index < chars.len() && (chars[index] == '_' || chars[index].is_ascii_alphanumeric()) {
                index += 1;
            }
            let name = chars[start..index].iter().collect::<String>();
            if name.is_empty() {
                return None;
            }
            tokens.push(Token::Ident(name));
        } else {
            tokens.push(match ch {
                '+' | '-' | '*' | '/' | '%' | '^' => Token::Op(ch),
                '(' => Token::LParen,
                ')' => Token::RParen,
                ',' => Token::Comma,
                _ => return None,
            });
            index += 1;
        }
    }
    Some(tokens)
}

struct Parser<'a> {
    tokens: Vec<Token>,
    cursor: usize,
    vars: &'a dyn Fn(&str) -> Option<f64>,
}

impl Parser<'_> {
    fn peek(&self) -> Option<&Token> {
        self.tokens.get(self.cursor)
    }

    fn next(&mut self) -> Option<Token> {
        let token = self.tokens.get(self.cursor).cloned();
        self.cursor += 1;
        token
    }

    fn expr(&mut self) -> Option<f64> {
        let mut value = self.term()?;
        while let Some(Token::Op(op @ ('+' | '-'))) = self.peek().cloned() {
            self.cursor += 1;
            let rhs = self.term()?;
            value = if op == '+' { value + rhs } else { value - rhs };
        }
        Some(value)
    }

    fn term(&mut self) -> Option<f64> {
        let mut value = self.power()?;
        while let Some(Token::Op(op @ ('*' | '/' | '%'))) = self.peek().cloned() {
            self.cursor += 1;
            let rhs = self.power()?;
            value = match op {
                '*' => value * rhs,
                '/' => value / rhs,
                _ => value % rhs,
            };
        }
        Some(value)
    }

    fn power(&mut self) -> Option<f64> {
        let base = self.unary()?;
        if let Some(Token::Op('^')) = self.peek() {
            self.cursor += 1;
            let exponent = self.power()?;
            return Some(base.powf(exponent));
        }
        Some(base)
    }

    fn unary(&mut self) -> Option<f64> {
        match self.peek() {
            Some(Token::Op('-')) => {
                self.cursor += 1;
                Some(-self.unary()?)
            }
            Some(Token::Op('+')) => {
                self.cursor += 1;
                self.unary()
            }
            _ => self.atom(),
        }
    }

    fn atom(&mut self) -> Option<f64> {
        match self.next()? {
            Token::Number(value) => Some(value),
            Token::LParen => {
                let value = self.expr()?;
                matches!(self.next()?, Token::RParen).then_some(value)
            }
            Token::Ident(name) => {
                if let Some(Token::LParen) = self.peek() {
                    self.cursor += 1;
                    let mut args = Vec::new();
                    if !matches!(self.peek(), Some(Token::RParen)) {
                        loop {
                            args.push(self.expr()?);
                            match self.next()? {
                                Token::Comma => continue,
                                Token::RParen => break,
                                _ => return None,
                            }
                        }
                    } else {
                        self.cursor += 1;
                    }
                    call_function(&name, &args)
                } else {
                    (self.vars)(&name)
                }
            }
            _ => None,
        }
    }
}

fn call_function(name: &str, args: &[f64]) -> Option<f64> {
    let one = || (args.len() == 1).then(|| args[0]);
    Some(match name.to_ascii_lowercase().as_str() {
        "min" if !args.is_empty() => args.iter().copied().fold(f64::INFINITY, f64::min),
        "max" if !args.is_empty() => args.iter().copied().fold(f64::NEG_INFINITY, f64::max),
        "floor" => one()?.floor(),
        "ceil" => one()?.ceil(),
        "round" => one()?.round(),
        "trunc" | "int" => one()?.trunc(),
        "abs" => one()?.abs(),
        "sqrt" => one()?.sqrt(),
        "pow" if args.len() == 2 => args[0].powf(args[1]),
        "clamp" if args.len() == 3 => args[0].clamp(args[1].min(args[2]), args[2].max(args[1])),
        _ => return None,
    })
}

/// Evaluate an ISF `WIDTH`/`HEIGHT` expression. `$WIDTH`/`$HEIGHT` and
/// `$inputName` resolve through `vars` (the leading `$` is optional).
/// Returns None for anything unparsable or non-finite; the caller falls
/// back to the render size.
pub fn eval_isf_size_expr(expr: &str, vars: &dyn Fn(&str) -> Option<f64>) -> Option<f64> {
    let tokens = tokenize(expr)?;
    if tokens.is_empty() {
        return None;
    }
    let mut parser = Parser { tokens, cursor: 0, vars };
    let value = parser.expr()?;
    (parser.cursor == parser.tokens.len() && value.is_finite()).then_some(value)
}

/// Resolve one target's size in the shader's virtual pixels.
pub fn resolve_isf_target_size(
    spec: &IsfTargetSpec,
    render_width: f32,
    render_height: f32,
    inputs: &dyn Fn(&str) -> Option<f64>,
) -> (f32, f32) {
    let render_width = render_width.max(1.0);
    let render_height = render_height.max(1.0);
    let vars = |name: &str| -> Option<f64> {
        match name {
            "WIDTH" => Some(render_width as f64),
            "HEIGHT" => Some(render_height as f64),
            _ => inputs(name),
        }
    };
    let eval = |expr: &Option<String>, fallback: f32| -> f32 {
        expr.as_deref()
            .and_then(|expr| eval_isf_size_expr(expr, &vars))
            .map(|value| (value.floor() as f32).clamp(1.0, 16384.0))
            .unwrap_or(fallback)
    };
    (eval(&spec.width, render_width), eval(&spec.height, render_height))
}

/// Physical texture size for a target. The ISF output renders into a square
/// slot of `output_edge` pixels that stands for the virtual render size, so a
/// target keeps the same pixels-per-virtual-pixel density as the output.
pub fn isf_physical_target_size(
    virtual_size: (f32, f32),
    render_size: (f32, f32),
    output_edge: u32,
) -> (u32, u32) {
    let scale_x = output_edge as f32 / render_size.0.max(1.0);
    let scale_y = output_edge as f32 / render_size.1.max(1.0);
    let edge = |value: f32| (value.round() as i64).clamp(1, ISF_PASS_TARGET_MAX_EDGE as i64) as u32;
    (edge(virtual_size.0 * scale_x), edge(virtual_size.1 * scale_y))
}

// ── Audio rows ──────────────────────────────────────────────────────────

/// Width of an audio input's row: its `MAX` when declared, else the default.
pub fn isf_audio_width(max: Option<f64>) -> u32 {
    max.filter(|value| value.is_finite() && *value >= 1.0)
        .map(|value| (value.round() as u32).clamp(1, ISF_AUDIO_MAX_WIDTH))
        .unwrap_or(ISF_AUDIO_DEFAULT_WIDTH)
}

/// Resample normalized (0..1) analyser data into an RGBA8 row of
/// `out.len() / 4` texels. FFT takes the peak of each bin group so a narrow
/// `MAX` still shows transients; waveform point-samples each texel's centre
/// so amplitude survives decimation. Writes in place (no allocation).
pub fn fill_isf_audio_row(kind: IsfAudioKind, source: &[f32], out: &mut [u8]) {
    let width = out.len() / 4;
    if width == 0 {
        return;
    }
    let fallback = match kind {
        IsfAudioKind::Fft => 0.0,
        IsfAudioKind::Waveform => 0.5,
    };
    for texel in 0..width {
        let value = if source.is_empty() {
            fallback
        } else {
            match kind {
                IsfAudioKind::Fft => {
                    let start = texel * source.len() / width;
                    let end = ((texel + 1) * source.len() / width).max(start + 1).min(source.len());
                    source[start.min(source.len() - 1)..end]
                        .iter()
                        .copied()
                        .fold(0.0f32, f32::max)
                }
                IsfAudioKind::Waveform => {
                    let center = ((texel as f32 + 0.5) * source.len() as f32 / width as f32) as usize;
                    source[center.min(source.len() - 1)]
                }
            }
        };
        let byte = (value.clamp(0.0, 1.0) * 255.0).round() as u8;
        let base = texel * 4;
        out[base] = byte;
        out[base + 1] = byte;
        out[base + 2] = byte;
        out[base + 3] = 255;
    }
}

/// Stand-in rows when no live spectrum is flowing (no analyser, or output
/// windows fed only band levels): FFT slopes from bass to high the way the
/// scalar `sampleFFT` fallback always has, waveform is a level-scaled sine.
pub fn fill_isf_audio_row_from_bands(
    kind: IsfAudioKind,
    bass: f32,
    mid: f32,
    high: f32,
    level: f32,
    time: f32,
    out: &mut [u8],
) {
    let width = out.len() / 4;
    for texel in 0..width {
        let u = (texel as f32 + 0.5) / width.max(1) as f32;
        let value = match kind {
            IsfAudioKind::Fft => {
                let slope = bass + (high - bass) * u;
                let hump = mid * (1.0 - ((u - 0.35) / 0.25).powi(2)).max(0.0);
                slope.max(hump)
            }
            IsfAudioKind::Waveform => {
                0.5 + 0.5 * ((u + time * 0.1) * std::f32::consts::TAU).sin() * level.max(0.001)
            }
        };
        let byte = (value.clamp(0.0, 1.0) * 255.0).round() as u8;
        let base = texel * 4;
        out[base] = byte;
        out[base + 1] = byte;
        out[base + 2] = byte;
        out[base + 3] = 255;
    }
}

/// Latest analyser frame from `set_audio_spectrum`, kept normalized 0..1.
/// The vectors are reused across updates so steady-state audio costs no
/// allocation.
#[derive(Debug, Default)]
pub struct IsfAudioSpectrum {
    pub fft: Vec<f32>,
    pub waveform: Vec<f32>,
    pub active: bool,
    pub seq: u64,
    pub received_at: Option<std::time::Instant>,
}

impl IsfAudioSpectrum {
    /// Live = an active analyser frame arrived recently. Stale data must not
    /// freeze bars on screen after the producer stops.
    pub fn is_live(&self, now: std::time::Instant) -> bool {
        self.active
            && self
                .received_at
                .is_some_and(|at| now.saturating_duration_since(at) <= std::time::Duration::from_millis(1500))
    }

    /// Replace one channel from bytes (0..255 -> 0..1) without reallocating.
    pub fn set_from_bytes(target: &mut Vec<f32>, bytes: &[u8]) {
        target.clear();
        target.extend(bytes.iter().take(ISF_AUDIO_MAX_SOURCE_SAMPLES).map(|byte| *byte as f32 / 255.0));
    }

    /// Replace one channel from JSON numbers already in 0..1.
    pub fn set_from_numbers(target: &mut Vec<f32>, values: &[Value]) {
        target.clear();
        target.extend(
            values
                .iter()
                .take(ISF_AUDIO_MAX_SOURCE_SAMPLES)
                .map(|value| value.as_f64().unwrap_or(0.0).clamp(0.0, 1.0) as f32),
        );
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn no_inputs(_: &str) -> Option<f64> {
        None
    }

    #[test]
    fn pass_plan_reads_isf2_targets_persistence_float_and_sizes() {
        let plan = parse_isf_pass_plan(&json!({
            "PASSES": [
                { "TARGET": "trail", "PERSISTENT": true, "FLOAT": true },
                { "TARGET": "half", "WIDTH": "$WIDTH/2", "HEIGHT": "$HEIGHT/2" },
                { "TARGET": "half" },
                {}
            ]
        }));
        assert!(plan.is_multipass());
        assert_eq!(plan.passes.len(), 4);
        assert_eq!(plan.targets.len(), 2);
        assert_eq!(plan.passes[0].target, Some(0));
        assert_eq!(plan.passes[1].target, Some(1));
        assert_eq!(plan.passes[2].target, Some(1));
        assert_eq!(plan.passes[3].target, None);
        assert!(plan.targets[0].persistent && plan.targets[0].float);
        assert!(!plan.targets[1].persistent && !plan.targets[1].float);
        assert_eq!(plan.targets[1].width.as_deref(), Some("$WIDTH/2"));
    }

    #[test]
    fn pass_plan_accepts_isf1_persistent_buffers_in_both_shapes() {
        let plan = parse_isf_pass_plan(&json!({
            "PERSISTENT_BUFFERS": ["feedback"],
            "PASSES": [{ "TARGET": "feedback" }, {}]
        }));
        assert!(plan.targets[0].persistent);

        let plan = parse_isf_pass_plan(&json!({
            "PERSISTENT_BUFFERS": { "accum": { "WIDTH": 64, "HEIGHT": "$HEIGHT", "FLOAT": true } },
            "PASSES": [{ "TARGET": "accum" }, {}]
        }));
        assert_eq!(plan.targets.len(), 1);
        assert!(plan.targets[0].persistent && plan.targets[0].float);
        assert_eq!(plan.targets[0].width.as_deref(), Some("64"));
    }

    #[test]
    fn pass_plan_without_passes_is_single_pass_and_caps_targets() {
        let plan = parse_isf_pass_plan(&json!({ "INPUTS": [] }));
        assert!(!plan.is_multipass());
        assert_eq!(plan.effective_passes(), vec![IsfPassSpec { target: None }]);

        let passes = (0..10).map(|i| json!({ "TARGET": format!("b{i}") })).chain([json!({})]).collect::<Vec<_>>();
        let plan = parse_isf_pass_plan(&json!({ "PASSES": passes }));
        assert_eq!(plan.targets.len(), MAX_ISF_PASS_TARGETS);
        assert_eq!(plan.dropped_targets, vec!["b8".to_string(), "b9".to_string()]);
        // Over-cap passes are skipped, the output pass survives.
        assert_eq!(plan.passes.len(), MAX_ISF_PASS_TARGETS + 1);
        assert_eq!(plan.passes.last().unwrap().target, None);
    }

    #[test]
    fn size_expressions_cover_isf_idioms() {
        let vars = |name: &str| match name {
            "WIDTH" => Some(1920.0),
            "HEIGHT" => Some(1080.0),
            "blurLevel" => Some(3.0),
            _ => None,
        };
        assert_eq!(eval_isf_size_expr("$WIDTH/2", &vars), Some(960.0));
        assert_eq!(eval_isf_size_expr("$HEIGHT / 4 + 10", &vars), Some(280.0));
        assert_eq!(eval_isf_size_expr("floor($WIDTH/3)", &vars), Some(640.0));
        assert_eq!(eval_isf_size_expr("max($WIDTH/$blurLevel, 16)", &vars), Some(640.0));
        assert_eq!(eval_isf_size_expr("-(-$WIDTH) * 0.25", &vars), Some(480.0));
        assert_eq!(eval_isf_size_expr("2^3", &vars), Some(8.0));
        assert_eq!(eval_isf_size_expr("pow(2, 10)", &vars), Some(1024.0));
        assert_eq!(eval_isf_size_expr("1e2", &vars), Some(100.0));
        assert_eq!(eval_isf_size_expr("$WIDTH/0", &vars), None);
        assert_eq!(eval_isf_size_expr("$UNKNOWN", &vars), None);
        assert_eq!(eval_isf_size_expr("$WIDTH)", &vars), None);
        assert_eq!(eval_isf_size_expr("", &vars), None);
    }

    #[test]
    fn target_sizes_resolve_and_fall_back_to_render_size() {
        let spec = IsfTargetSpec {
            name: "half".into(),
            persistent: false,
            float: false,
            width: Some("$WIDTH/2".into()),
            height: Some("garbage((".into()),
        };
        assert_eq!(resolve_isf_target_size(&spec, 1920.0, 1080.0, &no_inputs), (960.0, 1080.0));
        let full = IsfTargetSpec { width: None, height: None, ..spec };
        assert_eq!(resolve_isf_target_size(&full, 640.0, 360.0, &no_inputs), (640.0, 360.0));
    }

    #[test]
    fn physical_target_size_tracks_output_density() {
        // 1920x1080 virtual rendered into a 1024 slot.
        assert_eq!(isf_physical_target_size((1920.0, 1080.0), (1920.0, 1080.0), 1024), (1024, 1024));
        assert_eq!(isf_physical_target_size((960.0, 540.0), (1920.0, 1080.0), 1024), (512, 512));
        assert_eq!(isf_physical_target_size((0.1, 0.1), (1920.0, 1080.0), 1024), (1, 1));
        assert_eq!(
            isf_physical_target_size((1.0e6, 10.0), (100.0, 100.0), 1024),
            (ISF_PASS_TARGET_MAX_EDGE, 102)
        );
    }

    #[test]
    fn audio_width_honours_max() {
        assert_eq!(isf_audio_width(None), ISF_AUDIO_DEFAULT_WIDTH);
        assert_eq!(isf_audio_width(Some(16.0)), 16);
        assert_eq!(isf_audio_width(Some(0.0)), ISF_AUDIO_DEFAULT_WIDTH);
        assert_eq!(isf_audio_width(Some(1.0e9)), ISF_AUDIO_MAX_WIDTH);
    }

    #[test]
    fn audio_rows_resample_fft_by_peak_and_waveform_by_centre() {
        let fft = (0..8).map(|i| i as f32 / 7.0).collect::<Vec<_>>();
        let mut row = [0u8; 4 * 4];
        fill_isf_audio_row(IsfAudioKind::Fft, &fft, &mut row);
        // Groups of two bins -> each texel keeps the louder one.
        assert_eq!([row[0], row[4], row[8], row[12]], [36, 109, 182, 255]);
        assert_eq!(row[3], 255);
        assert_eq!(row[1], row[0]);

        let wave = [0.0, 0.0, 0.2, 0.0, 0.0, 0.0, 0.9, 0.0];
        let mut row = [0u8; 2 * 4];
        fill_isf_audio_row(IsfAudioKind::Waveform, &wave, &mut row);
        assert_eq!([row[0], row[4]], [51, 230]);

        let mut row = [7u8; 3 * 4];
        fill_isf_audio_row(IsfAudioKind::Waveform, &[], &mut row);
        assert_eq!(row[0], 128);
        fill_isf_audio_row(IsfAudioKind::Fft, &[], &mut row);
        assert_eq!(row[0], 0);

        // Upsampling a short spectrum still fills every texel.
        let mut row = [0u8; 8 * 4];
        fill_isf_audio_row(IsfAudioKind::Fft, &[1.0, 0.0], &mut row);
        assert_eq!(row[0], 255);
        assert_eq!(row[7 * 4], 0);
    }

    #[test]
    fn band_fallback_rows_follow_the_scalar_bands() {
        let mut row = [0u8; 64 * 4];
        fill_isf_audio_row_from_bands(IsfAudioKind::Fft, 0.8, 0.0, 0.1, 0.5, 0.0, &mut row);
        assert!(row[0] > row[63 * 4]);
        let mut silent = [0u8; 16 * 4];
        fill_isf_audio_row_from_bands(IsfAudioKind::Waveform, 0.0, 0.0, 0.0, 0.0, 0.0, &mut silent);
        assert!(silent.chunks(4).all(|texel| (127..=129).contains(&texel[0])));
    }

    #[test]
    fn spectrum_goes_stale_and_reuses_capacity() {
        let mut spectrum = IsfAudioSpectrum::default();
        let now = std::time::Instant::now();
        assert!(!spectrum.is_live(now));
        IsfAudioSpectrum::set_from_bytes(&mut spectrum.fft, &[0, 255, 128]);
        assert_eq!(spectrum.fft, vec![0.0, 1.0, 128.0 / 255.0]);
        let capacity = spectrum.fft.capacity();
        IsfAudioSpectrum::set_from_bytes(&mut spectrum.fft, &[1, 2]);
        assert_eq!(spectrum.fft.capacity(), capacity);
        spectrum.active = true;
        spectrum.received_at = Some(now);
        assert!(spectrum.is_live(now));
        assert!(!spectrum.is_live(now + std::time::Duration::from_secs(3)));
        IsfAudioSpectrum::set_from_numbers(&mut spectrum.waveform, &[json!(0.25), json!(2.0)]);
        assert_eq!(spectrum.waveform, vec![0.25, 1.0]);
    }
}
