//! Shader source handling: classifying WGSL, ISF and GLSL, reading ISF
//! metadata and inputs, preprocessing GLSL for the host, and probing it.

use crate::*;

pub(crate) fn looks_like_wgsl(source: &str) -> bool {
    let s = source.trim();
    s.contains("@vertex")
        || s.contains("@fragment")
        || s.contains("@compute")
        || s.contains("var<")
        || s.contains("vec2<")
        || s.contains("vec3<")
        || s.contains("vec4<")
        || (s.contains("fn ") && s.contains("->"))
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum NativeShaderSourceKind {
    Wgsl,
    IsfGlsl,
    Glsl,
}

impl NativeShaderSourceKind {
    pub(crate) fn label(self) -> &'static str {
        match self {
            NativeShaderSourceKind::Wgsl => "WGSL",
            NativeShaderSourceKind::IsfGlsl => "ISF/GLSL",
            NativeShaderSourceKind::Glsl => "GLSL",
        }
    }

    pub(crate) fn from_label(label: &str) -> Self {
        match label.trim().to_ascii_lowercase().as_str() {
            "isf/glsl" | "isf-glsl" | "isf" => NativeShaderSourceKind::IsfGlsl,
            "glsl" => NativeShaderSourceKind::Glsl,
            _ => NativeShaderSourceKind::Wgsl,
        }
    }
}

#[derive(Clone, Debug)]
pub(crate) struct NativeGlslParseProbe {
    pub(crate) kind: NativeShaderSourceKind,
    pub(crate) entry_points: Vec<String>,
}

pub(crate) fn classify_native_shader_source(source: &str) -> NativeShaderSourceKind {
    if looks_like_wgsl(source) {
        return NativeShaderSourceKind::Wgsl;
    }
    let (body, has_isf_header) = strip_isf_json_header(source);
    if has_isf_header || looks_like_isf_glsl(body) {
        NativeShaderSourceKind::IsfGlsl
    } else {
        NativeShaderSourceKind::Glsl
    }
}

/// Whether a shader samples any image (its input, an image input, a pass
/// buffer). One that does not (a generator) needs no input copies.
pub(crate) fn native_shader_reads_inputs(source: &str) -> bool {
    let (body, _) = strip_isf_json_header(source);
    ["IMG_", "texture", "sampler", "inputImage", "ghost_source_frames", "textureSample"]
        .iter()
        .any(|marker| body.contains(marker))
}

pub(crate) fn looks_like_isf_glsl(source: &str) -> bool {
    let s = source;
    s.contains("RENDERSIZE")
        || s.contains("isf_FragNormCoord")
        || s.contains("IMG_NORM_PIXEL")
        || s.contains("IMG_PIXEL")
        || s.contains("PASSINDEX")
        || s.contains("gl_FragColor")
        || s.contains("gl_FragCoord")
}

pub(crate) fn looks_like_isf_metadata(comment: &str) -> bool {
    let trimmed = comment.trim();
    if !trimmed.starts_with('{') {
        return false;
    }
    trimmed.contains("\"ISFVSN\"")
        || trimmed.contains("\"INPUTS\"")
        || trimmed.contains("\"PASSES\"")
        || trimmed.contains("\"CATEGORIES\"")
}

pub(crate) fn isf_json_header(source: &str) -> Option<&str> {
    let trimmed = source.trim_start();
    let comment_body = trimmed.strip_prefix("/*")?;
    let end = comment_body.find("*/")?;
    let header = &comment_body[..end];
    looks_like_isf_metadata(header).then_some(header)
}

pub(crate) fn strip_isf_json_header(source: &str) -> (&str, bool) {
    let trimmed = source.trim_start();
    let Some(comment_body) = trimmed.strip_prefix("/*") else {
        return (source, false);
    };
    let Some(end) = comment_body.find("*/") else {
        return (source, false);
    };
    let header = &comment_body[..end];
    if !looks_like_isf_metadata(header) {
        return (source, false);
    }
    (&comment_body[end + 2..], true)
}

pub(crate) fn is_valid_glsl_identifier(name: &str) -> bool {
    let mut chars = name.chars();
    let Some(first) = chars.next() else {
        return false;
    };
    (first == '_' || first.is_ascii_alphabetic())
        && chars.all(|ch| ch == '_' || ch.is_ascii_alphanumeric())
}

pub(crate) fn native_isf_input_kind(input_type: &str) -> NativeIsfInputKind {
    match input_type.trim().to_ascii_lowercase().as_str() {
        "float" => NativeIsfInputKind::Float,
        "bool" => NativeIsfInputKind::Bool,
        "long" => NativeIsfInputKind::Long,
        "point2d" | "point" => NativeIsfInputKind::Point2D,
        "color" => NativeIsfInputKind::Color,
        "event" => NativeIsfInputKind::Event,
        "image" => NativeIsfInputKind::Image,
        "audio" | "audiowaveform" => NativeIsfInputKind::AudioWaveform,
        "audiofft" => NativeIsfInputKind::AudioFft,
        _ => NativeIsfInputKind::Unsupported,
    }
}

pub(crate) fn native_isf_input_components(kind: NativeIsfInputKind) -> usize {
    match kind {
        NativeIsfInputKind::Point2D => 2,
        NativeIsfInputKind::Color => 4,
        // Image inputs carry one float: the source-frame array layer to
        // sample. -1 means unbound -> the shader falls back to its own
        // input frame, which is also the pre-image-input behavior.
        NativeIsfInputKind::Image => 1,
        // Audio rows are fixed texture bindings, not params.
        NativeIsfInputKind::AudioFft | NativeIsfInputKind::AudioWaveform => 0,
        NativeIsfInputKind::Unsupported => 0,
        NativeIsfInputKind::Float
        | NativeIsfInputKind::Bool
        | NativeIsfInputKind::Long
        | NativeIsfInputKind::Event => 1,
    }
}

pub(crate) fn default_values_for_isf_input(input: &Value, kind: NativeIsfInputKind) -> [f32; 4] {
    let default = input.get("DEFAULT");
    match kind {
        // 0 = unbound (biased slot+1 encoding): survives the zero-filled
        // default params a shader gets before its first uniforms push.
        NativeIsfInputKind::Image => [0.0, 0.0, 0.0, 0.0],
        NativeIsfInputKind::Bool => {
            let value = default
                .and_then(Value::as_bool)
                .map(|value| if value { 1.0 } else { 0.0 })
                .or_else(|| default.and_then(Value::as_f64).map(|value| value as f32))
                .unwrap_or(0.0);
            [value, 0.0, 0.0, 0.0]
        }
        NativeIsfInputKind::Long => {
            let value = default.and_then(Value::as_f64).unwrap_or(0.0).round() as f32;
            [value, 0.0, 0.0, 0.0]
        }
        NativeIsfInputKind::Point2D => {
            let values = default
                .and_then(Value::as_array)
                .map(|values| {
                    [
                        values.first().and_then(Value::as_f64).unwrap_or(0.5) as f32,
                        values.get(1).and_then(Value::as_f64).unwrap_or(0.5) as f32,
                        0.0,
                        0.0,
                    ]
                })
                .unwrap_or([0.5, 0.5, 0.0, 0.0]);
            values
        }
        NativeIsfInputKind::Color => default
            .and_then(Value::as_array)
            .map(|values| {
                [
                    values.first().and_then(Value::as_f64).unwrap_or(1.0) as f32,
                    values.get(1).and_then(Value::as_f64).unwrap_or(1.0) as f32,
                    values.get(2).and_then(Value::as_f64).unwrap_or(1.0) as f32,
                    values.get(3).and_then(Value::as_f64).unwrap_or(1.0) as f32,
                ]
            })
            .unwrap_or([1.0, 1.0, 1.0, 1.0]),
        NativeIsfInputKind::Float | NativeIsfInputKind::Event => {
            let value = default
                .and_then(Value::as_f64)
                .unwrap_or_else(|| input.get("MIN").and_then(Value::as_f64).unwrap_or(0.0))
                as f32;
            [value, 0.0, 0.0, 0.0]
        }
        NativeIsfInputKind::AudioFft
        | NativeIsfInputKind::AudioWaveform
        | NativeIsfInputKind::Unsupported => [0.0; 4],
    }
}

pub(crate) fn sanitize_isf_json_header(header: &str) -> String {
    let mut output = String::with_capacity(header.len());
    for line in header.lines() {
        let mut in_string = false;
        let mut escaped = false;
        let mut cut = line.len();
        for (index, ch) in line.char_indices() {
            if escaped {
                escaped = false;
                continue;
            }
            match ch {
                '\\' if in_string => escaped = true,
                '"' => in_string = !in_string,
                '/' if !in_string && line[index..].starts_with("//") => {
                    cut = index;
                    break;
                }
                _ => {}
            }
        }
        output.push_str(&line[..cut]);
        output.push('\n');
    }
    output
}

pub(crate) fn native_isf_metadata(source: &str) -> Option<Value> {
    let header = isf_json_header(source)?;
    let sanitized_header = sanitize_isf_json_header(header);
    serde_json::from_str::<Value>(sanitized_header.trim()).ok()
}

/// Everything the pass-aware ISF host needs beyond the scalar inputs: the
/// pass plan and which audio rows the shader samples (and at what width).
#[derive(Clone, Debug, Default, PartialEq)]
pub(crate) struct NativeIsfHostInfo {
    pub(crate) plan: IsfPassPlan,
    /// Width of the audioFFT row the shader samples, if it samples one.
    pub(crate) fft_width: Option<u32>,
    /// Width of the audio (waveform) row the shader samples, if any.
    pub(crate) waveform_width: Option<u32>,
}

impl NativeIsfHostInfo {
    /// Pass targets or audio rows route the shader through the pass-aware
    /// host (image dispatch + extra bindings). Everything else keeps the
    /// original single-pass prelude untouched.
    pub(crate) fn needs_pass_host(&self) -> bool {
        self.plan.is_multipass() || self.fft_width.is_some() || self.waveform_width.is_some()
    }
}

pub(crate) fn glsl_references_identifier(body: &str, name: &str) -> bool {
    let bytes = body.as_bytes();
    let mut search = 0usize;
    while let Some(found) = body[search..].find(name) {
        let start = search + found;
        let end = start + name.len();
        let before_ok = start == 0 || !(bytes[start - 1] == b'_' || bytes[start - 1].is_ascii_alphanumeric());
        let after_ok = end >= bytes.len() || !(bytes[end] == b'_' || bytes[end].is_ascii_alphanumeric());
        if before_ok && after_ok {
            return true;
        }
        search = end;
    }
    false
}

pub(crate) fn native_isf_host_info(source: &str) -> NativeIsfHostInfo {
    let (body, _) = strip_isf_json_header(source);
    let plan = native_isf_metadata(source)
        .map(|metadata| parse_isf_pass_plan(&metadata))
        .unwrap_or_default();
    let bindings = parse_native_isf_inputs(source);
    let declared_width = |kind: NativeIsfInputKind| {
        bindings
            .iter()
            .find(|binding| binding.kind == kind)
            .map(|binding| binding.audio_width)
    };
    let declared = |name: &str| bindings.iter().any(|binding| binding.name == name);
    // Built-in rows every ISF shader may reference without declaring them,
    // matching the browser host: audioFFT/audioWaveform samplers and the
    // sampleFFT()/sampleWaveform() helpers.
    let builtin_fft = (!declared("audioFFT") && glsl_references_identifier(body, "audioFFT"))
        || glsl_references_identifier(body, "sampleFFT");
    let builtin_wave = (!declared("audioWaveform") && glsl_references_identifier(body, "audioWaveform"))
        || glsl_references_identifier(body, "sampleWaveform");
    let fft_width = declared_width(NativeIsfInputKind::AudioFft)
        .or_else(|| builtin_fft.then_some(ISF_AUDIO_DEFAULT_WIDTH));
    let waveform_width = declared_width(NativeIsfInputKind::AudioWaveform)
        .or_else(|| builtin_wave.then_some(ISF_AUDIO_DEFAULT_WIDTH));
    NativeIsfHostInfo { plan, fft_width, waveform_width }
}

pub(crate) fn parse_native_isf_inputs(source: &str) -> Vec<NativeIsfInputBinding> {
    let Some(metadata) = native_isf_metadata(source) else {
        return Vec::new();
    };
    let Some(inputs) = metadata.get("INPUTS").and_then(Value::as_array) else {
        return Vec::new();
    };
    let mut bindings = Vec::with_capacity(inputs.len());
    let mut cursor = 0usize;
    for input in inputs {
        let Some(name) = input.get("NAME").and_then(Value::as_str) else {
            continue;
        };
        if !is_valid_glsl_identifier(name) {
            continue;
        }
        let kind = input
            .get("TYPE")
            .and_then(Value::as_str)
            .map(native_isf_input_kind)
            .unwrap_or(NativeIsfInputKind::Unsupported);
        let components = native_isf_input_components(kind);
        let offset = if components > 0 && cursor + components <= MAX_NATIVE_ISF_PARAM_FLOATS {
            let offset = Some(cursor);
            cursor += components;
            offset
        } else {
            None
        };
        let audio_width = if matches!(kind, NativeIsfInputKind::AudioFft | NativeIsfInputKind::AudioWaveform) {
            isf_audio_width(input.get("MAX").and_then(Value::as_f64))
        } else {
            0
        };
        bindings.push(NativeIsfInputBinding {
            name: name.to_string(),
            kind,
            offset,
            components,
            default_values: default_values_for_isf_input(input, kind),
            audio_width,
        });
    }
    bindings
}

pub(crate) fn native_param_component(offset: usize) -> Option<String> {
    if offset >= MAX_NATIVE_ISF_PARAM_FLOATS {
        return None;
    }
    let component = ["x", "y", "z", "w"][offset % 4];
    Some(format!("PARAMS{}.{}", offset / 4, component))
}

pub(crate) fn glsl_float_literal(value: f32) -> String {
    if value.is_finite() {
        format!("{value:.8}")
    } else {
        "0.0".to_string()
    }
}

pub(crate) fn native_isf_input_expr(binding: &NativeIsfInputBinding) -> Option<String> {
    let scalar_at = |component: usize| {
        binding
            .offset
            .and_then(|offset| native_param_component(offset + component))
            .unwrap_or_else(|| glsl_float_literal(binding.default_values[component]))
    };
    match binding.kind {
        NativeIsfInputKind::Float | NativeIsfInputKind::Event => Some(scalar_at(0)),
        NativeIsfInputKind::Bool => Some(format!("({} > 0.5)", scalar_at(0))),
        NativeIsfInputKind::Long => Some(format!("int(round({}))", scalar_at(0))),
        NativeIsfInputKind::Point2D => Some(format!("vec2({}, {})", scalar_at(0), scalar_at(1))),
        NativeIsfInputKind::Color => Some(format!(
            "vec4({}, {}, {}, {})",
            scalar_at(0),
            scalar_at(1),
            scalar_at(2),
            scalar_at(3)
        )),
        NativeIsfInputKind::Image => Some(format!(
            "(({0}) >= 0.5 ? ({0}) - 1.0 : frame_seed_inputs.w)",
            scalar_at(0)
        )),
        NativeIsfInputKind::AudioFft => Some(glsl_float_literal(IsfAudioKind::Fft.image_code())),
        NativeIsfInputKind::AudioWaveform => {
            Some(glsl_float_literal(IsfAudioKind::Waveform.image_code()))
        }
        NativeIsfInputKind::Unsupported => None,
    }
}

pub(crate) fn uniform_declares_any_name(line: &str, names: &[String]) -> bool {
    let trimmed = line.trim();
    if !trimmed.starts_with("uniform ") || !trimmed.ends_with(';') {
        return false;
    }
    names.iter().any(|name| {
        let token = format!("{name};");
        trimmed.ends_with(&token) || trimmed.contains(&format!(" {name};"))
    })
}

pub(crate) fn native_fallback_uniform_declaration(line: &str) -> Option<String> {
    let declaration = line.trim().strip_prefix("uniform ")?.strip_suffix(';')?;
    let mut tokens = declaration.split_whitespace();
    let kind = tokens.next()?;
    let name = tokens.next()?;
    if tokens.next().is_some() || !is_valid_glsl_identifier(name) {
        return None;
    }
    let initializer = match kind {
        "float" => "1.0",
        "int" => "1",
        "bool" => "true",
        "vec2" => "vec2(1.0)",
        "vec3" => "vec3(1.0)",
        "vec4" => "vec4(1.0)",
        _ => return None,
    };
    Some(format!("{kind} {name} = {initializer};"))
}

pub(crate) fn maybe_global_initializer_macro(line: &str) -> Option<String> {
    let trimmed = line.trim();
    let semicolon = trimmed.strip_suffix(';')?;
    let (kind, rest) = ["float", "vec2", "vec3", "vec4"].iter().find_map(|kind| {
        semicolon
            .strip_prefix(kind)
            .map(|rest| (*kind, rest.trim_start()))
    })?;
    let (name, expr) = rest.split_once('=')?;
    let name = name.trim();
    let expr = expr.trim();
    if !is_valid_glsl_identifier(name) {
        return None;
    }
    let depends_on_native_uniform = [
        "RENDERSIZE",
        "renderSize",
        "TIME",
        "TIMEDELTA",
        "FRAMEINDEX",
        "DATE",
        "audio",
        "PARAMS",
    ]
    .iter()
    .any(|needle| expr.contains(needle));
    if !depends_on_native_uniform {
        return None;
    }
    Some(format!(
        "#define {name} ({expr}) /* native lifted {kind} uniform initializer */"
    ))
}

pub(crate) fn replace_glsl_identifier(source: &str, from: &str, to: &str) -> String {
    let mut out = String::with_capacity(source.len());
    let mut token = String::new();
    let flush_token = |out: &mut String, token: &mut String| {
        if token == from {
            out.push_str(to);
        } else {
            out.push_str(token);
        }
        token.clear();
    };
    for ch in source.chars() {
        if ch == '_' || ch.is_ascii_alphanumeric() {
            token.push(ch);
        } else {
            if !token.is_empty() {
                flush_token(&mut out, &mut token);
            }
            out.push(ch);
        }
    }
    if !token.is_empty() {
        flush_token(&mut out, &mut token);
    }
    out
}

pub(crate) fn has_glsl_define(source: &str, name: &str) -> bool {
    source.lines().any(|line| {
        let trimmed = line.trim_start();
        trimmed
            .strip_prefix("#define")
            .map(|rest| {
                let rest = rest.trim_start();
                rest == name
                    || rest
                        .strip_prefix(name)
                        .map(|tail| tail.starts_with(char::is_whitespace) || tail.starts_with('('))
                        .unwrap_or(false)
            })
            .unwrap_or(false)
    })
}

pub(crate) fn native_isf_shadertoy_alias_macros(body: &str) -> String {
    let aliases = [
        ("iResolution", "vec3(RENDERSIZE, 1.0)"),
        ("iTime", "TIME"),
        ("iGlobalTime", "TIME"),
        ("iFrame", "FRAMEINDEX"),
    ];
    let mut output = String::new();
    for (name, expr) in aliases {
        if body.contains(name) && !has_glsl_define(body, name) {
            output.push_str(&format!("#define {name} ({expr})\n"));
        }
    }
    output
}

pub(crate) fn native_isf_audio_alias_macros(input_bindings: &[NativeIsfInputBinding]) -> String {
    let aliases = [
        ("audioLevel", "AUDIO0.x"),
        ("audioBass", "AUDIO0.y"),
        ("audioMid", "AUDIO0.z"),
        ("audioHigh", "AUDIO1.x"),
        ("audioBeat", "AUDIO1.y"),
        ("audioBeatPhase", "AUDIO1.z"),
        ("audioBPM", "AUDIO1.w"),
        ("audioSpectralCentroid", "AUDIO2.x"),
    ];
    let declared_inputs = input_bindings
        .iter()
        .map(|binding| binding.name.as_str())
        .collect::<HashSet<_>>();
    aliases
        .iter()
        .filter(|(name, _)| !declared_inputs.contains(name))
        .map(|(name, expr)| format!("#define {name} {expr}\n"))
        .collect()
}

pub(crate) fn native_isf_input_glsl_type(kind: NativeIsfInputKind) -> Option<&'static str> {
    match kind {
        NativeIsfInputKind::Float | NativeIsfInputKind::Event => Some("float"),
        NativeIsfInputKind::Bool => Some("bool"),
        NativeIsfInputKind::Long => Some("int"),
        NativeIsfInputKind::Point2D => Some("vec2"),
        NativeIsfInputKind::Color => Some("vec4"),
        NativeIsfInputKind::Image
        | NativeIsfInputKind::AudioFft
        | NativeIsfInputKind::AudioWaveform => Some("float"),
        NativeIsfInputKind::Unsupported => None,
    }
}

pub(crate) fn inject_native_isf_input_state(source: &str, input_bindings: &[NativeIsfInputBinding]) -> String {
    let active = input_bindings
        .iter()
        .filter_map(|binding| {
            Some((
                binding,
                native_isf_input_glsl_type(binding.kind)?,
                native_isf_input_expr(binding)?,
            ))
        })
        .collect::<Vec<_>>();
    if active.is_empty() {
        return source.to_string();
    }
    let mut globals = String::new();
    let mut assignments = String::new();
    for (binding, kind, expr) in active {
        globals.push_str(&format!("{kind} {};\n", binding.name));
        assignments.push_str(&format!("\n  {} = {expr};", binding.name));
    }
    let Some(main_start) = source.find("void main") else {
        return format!("{globals}\n{source}");
    };
    let Some(relative_brace) = source[main_start..].find('{') else {
        return format!("{globals}\n{source}");
    };
    let brace = main_start + relative_brace;
    let mut output = String::with_capacity(globals.len() + source.len() + assignments.len() + 2);
    output.push_str(&globals);
    output.push('\n');
    output.push_str(&source[..=brace]);
    output.push_str(&assignments);
    output.push_str(&source[brace + 1..]);
    output
}

pub(crate) fn collect_isf_image_arg_names(body: &str) -> Vec<String> {
    let mut names = Vec::new();
    for marker in ["IMG_NORM_PIXEL(", "IMG_PIXEL(", "IMG_SIZE(", "texture2D("] {
        let mut search = 0usize;
        while let Some(found) = body[search..].find(marker) {
            let arg_start = search + found + marker.len();
            search = arg_start;
            let rest = &body[arg_start..];
            let end = rest
                .find(|c: char| c == ',' || c == ')')
                .unwrap_or(rest.len());
            let candidate = rest[..end].trim();
            if is_valid_glsl_identifier(candidate) && !names.iter().any(|n| n == candidate) {
                names.push(candidate.to_string());
            }
        }
    }
    names
}

pub(crate) fn preprocess_native_isf_glsl_body(
    body: &str,
    input_bindings: &[NativeIsfInputBinding],
    host: Option<&NativeIsfHostInfo>,
) -> String {
    let mut input_names = input_bindings
        .iter()
        .map(|binding| binding.name.clone())
        .collect::<Vec<_>>();
    // Pass targets are images the host binds itself: strip any
    // `uniform sampler2D <target>;` the shader declares for them.
    let target_names = host
        .map(|host| {
            host.plan
                .targets
                .iter()
                .map(|target| target.name.clone())
                .chain(host.plan.dropped_targets.iter().cloned())
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    input_names.extend(target_names.iter().cloned());
    let mut reserved_names = vec![
        "RENDERSIZE".to_string(),
        "renderSize".to_string(),
        "TIME".to_string(),
        "TIMEDELTA".to_string(),
        "FRAMEINDEX".to_string(),
        "DATE".to_string(),
        "audioFFT".to_string(),
        "audioWaveform".to_string(),
        "audioLevel".to_string(),
        "audioBass".to_string(),
        "audioMid".to_string(),
        "audioHigh".to_string(),
        "audioBeat".to_string(),
        "audioBeatPhase".to_string(),
        "audioBPM".to_string(),
        "audioSpectralCentroid".to_string(),
        "iResolution".to_string(),
        "iTime".to_string(),
        "iGlobalTime".to_string(),
        "iFrame".to_string(),
    ];
    reserved_names.extend(input_names.iter().cloned());
    let mut output = String::with_capacity(body.len());
    for line in body.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with("```") {
            continue;
        }
        if trimmed.starts_with("precision ") && trimmed.ends_with(';') {
            continue;
        }
        if trimmed.starts_with("#version") {
            continue;
        }
        if trimmed.starts_with("varying ") && trimmed.ends_with(';') {
            continue;
        }
        if trimmed.starts_with("attribute ") && trimmed.ends_with(';') {
            continue;
        }
        if uniform_declares_any_name(trimmed, &reserved_names) {
            continue;
        }
        if trimmed.starts_with("uniform ") && trimmed.ends_with(';') {
            if let Some(declaration) = native_fallback_uniform_declaration(trimmed) {
                output.push_str(&declaration);
                output.push('\n');
            }
            continue;
        }
        if line.trim_start() == line
            && let Some(macro_line) = maybe_global_initializer_macro(trimmed)
        {
            output.push_str(&macro_line);
            output.push('\n');
            continue;
        }
        output.push_str(line);
        output.push('\n');
    }
    let output = replace_glsl_identifier(&output, "centroid", "ghost_centroid");
    let output = replace_glsl_identifier(&output, "gl_FragCoord", "ghost_FragCoord");
    let mut all_bindings = input_bindings.to_vec();
    let mut target_consts = String::new();
    if let Some(host) = host {
        // Built-in audio rows referenced without an INPUTS entry.
        for (name, kind, width) in [
            ("audioFFT", NativeIsfInputKind::AudioFft, host.fft_width),
            ("audioWaveform", NativeIsfInputKind::AudioWaveform, host.waveform_width),
        ] {
            if width.is_some()
                && !all_bindings.iter().any(|binding| binding.name == name)
                && glsl_references_identifier(&output, name)
            {
                all_bindings.push(NativeIsfInputBinding {
                    name: name.to_string(),
                    kind,
                    offset: None,
                    components: 0,
                    default_values: [0.0; 4],
                    audio_width: width.unwrap_or(ISF_AUDIO_DEFAULT_WIDTH),
                });
            }
        }
        for (index, target) in host.plan.targets.iter().enumerate() {
            target_consts.push_str(&format!(
                "const float {} = {};\n",
                target.name,
                glsl_float_literal(isf_pass_target_image_code(index))
            ));
        }
        for name in &host.plan.dropped_targets {
            // Unknown image code: the dispatcher returns transparent black.
            target_consts.push_str(&format!("const float {name} = -99.0;\n"));
        }
    }
    for name in collect_isf_image_arg_names(body) {
        let already_bound = all_bindings.iter().any(|binding| binding.name == name);
        if already_bound || has_glsl_define(body, &name) || target_names.contains(&name) {
            continue;
        }
        // Unbound synthetic image binding: offset None packs nothing, and the
        // -1 default makes the GLSL expression fall back to the layer's own
        // input frame.
        all_bindings.push(NativeIsfInputBinding {
            name,
            kind: NativeIsfInputKind::Image,
            offset: None,
            components: 0,
            default_values: [0.0, 0.0, 0.0, 0.0],
            audio_width: 0,
        });
    }
    if target_consts.is_empty() {
        inject_native_isf_input_state(&output, &all_bindings)
    } else {
        inject_native_isf_input_state(&format!("{target_consts}{output}"), &all_bindings)
    }
}

pub(crate) fn value_as_native_f32(value: Option<&Value>, fallback: f32) -> f32 {
    match value {
        Some(Value::Number(number)) => number.as_f64().unwrap_or(fallback as f64) as f32,
        Some(Value::Bool(value)) => {
            if *value {
                1.0
            } else {
                0.0
            }
        }
        Some(Value::String(value)) => value.parse::<f32>().unwrap_or(fallback),
        _ => fallback,
    }
}

pub(crate) fn array_value_as_native_f32(value: Option<&Value>, index: usize, fallback: f32) -> f32 {
    value
        .and_then(Value::as_array)
        .and_then(|values| values.get(index))
        .map(|value| value_as_native_f32(Some(value), fallback))
        .unwrap_or(fallback)
}

pub(crate) fn object_xy_value_as_native_f32(value: Option<&Value>, key: &str, fallback: f32) -> f32 {
    value
        .and_then(Value::as_object)
        .and_then(|object| object.get(key))
        .map(|value| value_as_native_f32(Some(value), fallback))
        .unwrap_or(fallback)
}

pub(crate) fn native_isf_binding_values(command: &Value, binding: &NativeIsfInputBinding) -> [f32; 4] {
    let floats = command.get("float_inputs").unwrap_or(&Value::Null);
    let points = command.get("point_inputs").unwrap_or(&Value::Null);
    let colors = command.get("color_inputs").unwrap_or(&Value::Null);
    match binding.kind {
        NativeIsfInputKind::Float | NativeIsfInputKind::Event => [
            value_as_native_f32(floats.get(&binding.name), binding.default_values[0]),
            0.0,
            0.0,
            0.0,
        ],
        NativeIsfInputKind::Bool | NativeIsfInputKind::Long => [
            value_as_native_f32(floats.get(&binding.name), binding.default_values[0]),
            0.0,
            0.0,
            0.0,
        ],
        NativeIsfInputKind::Point2D => {
            let value = points
                .get(&binding.name)
                .or_else(|| floats.get(&binding.name));
            [
                array_value_as_native_f32(
                    value,
                    0,
                    object_xy_value_as_native_f32(value, "x", binding.default_values[0]),
                ),
                array_value_as_native_f32(
                    value,
                    1,
                    object_xy_value_as_native_f32(value, "y", binding.default_values[1]),
                ),
                0.0,
                0.0,
            ]
        }
        NativeIsfInputKind::Color => {
            let value = colors
                .get(&binding.name)
                .or_else(|| floats.get(&binding.name));
            [
                array_value_as_native_f32(value, 0, binding.default_values[0]),
                array_value_as_native_f32(value, 1, binding.default_values[1]),
                array_value_as_native_f32(value, 2, binding.default_values[2]),
                array_value_as_native_f32(value, 3, binding.default_values[3]),
            ]
        }
        NativeIsfInputKind::Image
        | NativeIsfInputKind::AudioFft
        | NativeIsfInputKind::AudioWaveform
        | NativeIsfInputKind::Unsupported => binding.default_values,
    }
}

pub(crate) fn native_isf_input_params(
    command: &Value,
    bindings: &[NativeIsfInputBinding],
) -> [f32; MAX_NATIVE_ISF_PARAM_FLOATS] {
    let mut params = [0.0; MAX_NATIVE_ISF_PARAM_FLOATS];
    for binding in bindings {
        let Some(offset) = binding.offset else {
            continue;
        };
        let values = native_isf_binding_values(command, binding);
        for i in 0..binding.components.min(4) {
            if let Some(slot) = params.get_mut(offset + i) {
                *slot = values[i];
            }
        }
    }
    params
}

pub(crate) fn native_glsl_stage_for_label(stage: &str) -> naga::ShaderStage {
    match stage.trim().to_ascii_lowercase().as_str() {
        "vertex" | "vs" => naga::ShaderStage::Vertex,
        "compute" | "cs" => naga::ShaderStage::Compute,
        _ => naga::ShaderStage::Fragment,
    }
}

pub(crate) fn native_glsl_probe_source(source: &str, kind: NativeShaderSourceKind) -> Cow<'_, str> {
    let (body, _) = strip_isf_json_header(source);
    let input_bindings = parse_native_isf_inputs(source);
    let host_info = matches!(kind, NativeShaderSourceKind::IsfGlsl)
        .then(|| native_isf_host_info(source))
        .filter(NativeIsfHostInfo::needs_pass_host);
    let owned_body;
    let body = if matches!(kind, NativeShaderSourceKind::IsfGlsl) {
        owned_body = preprocess_native_isf_glsl_body(body, &input_bindings, host_info.as_ref());
        owned_body.trim_start()
    } else {
        body.trim_start()
    };
    if body.starts_with("#version") && !matches!(kind, NativeShaderSourceKind::IsfGlsl) {
        return Cow::Owned(body.to_string());
    }
    let prelude = match kind {
        NativeShaderSourceKind::IsfGlsl => {
            let shadertoy_alias_macros = native_isf_shadertoy_alias_macros(body);
            let audio_alias_macros = native_isf_audio_alias_macros(&input_bindings);
            let mut prelude = r#"#version 450 core
layout(location = 0) in vec2 isf_FragNormCoord;
layout(location = 0) out vec4 gl_FragColor;
layout(set = 0, binding = 0) uniform GhostNativeShaderUniforms {
  vec4 resolution_time;
  vec4 frame_seed_inputs;
  vec4 DATE;
  vec4 AUDIO0;
  vec4 AUDIO1;
  vec4 PARAMS0;
  vec4 PARAMS1;
  vec4 AUDIO2;
  vec4 PARAMS2;
  vec4 PARAMS3;
  vec4 PARAMS4;
  vec4 PARAMS5;
  vec4 PARAMS6;
  vec4 PARAMS7;
  vec4 PARAMS8;
  vec4 PARAMS9;
  vec4 PARAMS10;
  vec4 PARAMS11;
  vec4 PARAMS12;
  vec4 PARAMS13;
  vec4 PARAMS14;
  vec4 PARAMS15;{host_block_tail}
};
layout(set = 0, binding = 1) uniform texture2DArray ghost_source_frames;
layout(set = 0, binding = 2) uniform sampler ghost_source_sampler;
#define RENDERSIZE resolution_time.xy
#define renderSize RENDERSIZE
#define TIME resolution_time.z
#define TIMEDELTA resolution_time.w
#define FRAMEINDEX int(round(frame_seed_inputs.x))
#define vUv isf_FragNormCoord
#define texCoord isf_FragNormCoord
#define ghost_FragCoord vec4(isf_FragNormCoord * RENDERSIZE, 0.0, 1.0)
"#
            .replace("{host_block_tail}", if host_info.is_some() { NATIVE_ISF_HOST_BLOCK_TAIL } else { "" });
            prelude.push_str(if host_info.is_some() {
                NATIVE_ISF_HOST_PRELUDE
            } else {
                NATIVE_ISF_SINGLE_PASS_PRELUDE
            });
            for (name, expr) in [
                ("IMG_THIS_PIXEL", "#define IMG_THIS_PIXEL(img) IMG_NORM_PIXEL(img, isf_FragNormCoord)\n"),
                ("IMG_THIS_NORM_PIXEL", "#define IMG_THIS_NORM_PIXEL(img) IMG_NORM_PIXEL(img, isf_FragNormCoord)\n"),
            ] {
                if !has_glsl_define(body, name) {
                    prelude.push_str(expr);
                }
            }
            prelude.push_str(&shadertoy_alias_macros);
            prelude.push_str(&audio_alias_macros);
            prelude
        }
        NativeShaderSourceKind::Glsl => r#"#version 450 core
layout(location = 0) out vec4 gl_FragColor;
"#
        .to_string(),
        NativeShaderSourceKind::Wgsl => "".to_string(),
    };
    Cow::Owned(format!("{prelude}\n{body}"))
}

/// Original single-pass image macros: every image is a source-frame layer.
pub(crate) const NATIVE_ISF_SINGLE_PASS_PRELUDE: &str = r#"#define PASSINDEX 0
#define texture2D(img, coord) texture(sampler2DArray(ghost_source_frames, ghost_source_sampler), vec3((coord), (img)))
#define IMG_NORM_PIXEL(img, coord) texture(sampler2DArray(ghost_source_frames, ghost_source_sampler), vec3((coord), (img)))
#define IMG_PIXEL(img, coord) IMG_NORM_PIXEL(img, (coord) / RENDERSIZE)
#define IMG_SIZE(img) RENDERSIZE
float sampleFFT(float u) {
  return mix(AUDIO0.y, AUDIO1.x, clamp(u, 0.0, 1.0));
}
float sampleWaveform(float u) {
  return sin((clamp(u, 0.0, 1.0) + TIME * 0.1) * 6.28318530718) * max(AUDIO0.x, 0.001);
}
"#;

/// Uniform-block tail the pass-aware host appends (mirrors the append-only
/// tail of `NativeShaderUniforms`). ISF_PASS = (PASSINDEX, pass count,
/// output width, output height) in virtual pixels; ISF_PASS_SIZE packs two
/// target sizes per vec4; ISF_AUDIO = (live spectrum, FFT width, waveform
/// width, 0).
pub(crate) const NATIVE_ISF_HOST_BLOCK_TAIL: &str = "
  vec4 ISF_PASS;
  vec4 ISF_PASS_SIZE[4];
  vec4 ISF_AUDIO;";

/// Pass-aware image macros. An image is a float code: >= 0 is a source-frame
/// array layer (inputs), -1..-8 the pass targets, -9 the audioFFT row, -10
/// the audio waveform row. Pass targets are written y-up like the output
/// slot, so they are read with a flipped v.
pub(crate) const NATIVE_ISF_HOST_PRELUDE: &str = r#"layout(set = 0, binding = 3) uniform texture2D ghost_isf_pass0;
layout(set = 0, binding = 4) uniform texture2D ghost_isf_pass1;
layout(set = 0, binding = 5) uniform texture2D ghost_isf_pass2;
layout(set = 0, binding = 6) uniform texture2D ghost_isf_pass3;
layout(set = 0, binding = 7) uniform texture2D ghost_isf_pass4;
layout(set = 0, binding = 8) uniform texture2D ghost_isf_pass5;
layout(set = 0, binding = 9) uniform texture2D ghost_isf_pass6;
layout(set = 0, binding = 10) uniform texture2D ghost_isf_pass7;
layout(set = 0, binding = 11) uniform texture2D ghost_isf_audio_fft;
layout(set = 0, binding = 12) uniform texture2D ghost_isf_audio_wave;
vec4 ghost_isf_image(float img, vec2 coord) {
  if (img > -0.5) {
    return texture(sampler2DArray(ghost_source_frames, ghost_source_sampler), vec3(coord, img));
  }
  vec2 flipped = vec2(coord.x, 1.0 - coord.y);
  if (img > -1.5) { return textureLod(sampler2D(ghost_isf_pass0, ghost_source_sampler), flipped, 0.0); }
  if (img > -2.5) { return textureLod(sampler2D(ghost_isf_pass1, ghost_source_sampler), flipped, 0.0); }
  if (img > -3.5) { return textureLod(sampler2D(ghost_isf_pass2, ghost_source_sampler), flipped, 0.0); }
  if (img > -4.5) { return textureLod(sampler2D(ghost_isf_pass3, ghost_source_sampler), flipped, 0.0); }
  if (img > -5.5) { return textureLod(sampler2D(ghost_isf_pass4, ghost_source_sampler), flipped, 0.0); }
  if (img > -6.5) { return textureLod(sampler2D(ghost_isf_pass5, ghost_source_sampler), flipped, 0.0); }
  if (img > -7.5) { return textureLod(sampler2D(ghost_isf_pass6, ghost_source_sampler), flipped, 0.0); }
  if (img > -8.5) { return textureLod(sampler2D(ghost_isf_pass7, ghost_source_sampler), flipped, 0.0); }
  if (img > -9.5) { return textureLod(sampler2D(ghost_isf_audio_fft, ghost_source_sampler), coord, 0.0); }
  if (img > -10.5) { return textureLod(sampler2D(ghost_isf_audio_wave, ghost_source_sampler), coord, 0.0); }
  return vec4(0.0);
}
vec2 ghost_isf_image_size(float img) {
  if (img > -0.5) { return ISF_PASS.zw; }
  if (img > -8.5) {
    int index = int(round(-img)) - 1;
    vec4 pair = ISF_PASS_SIZE[index / 2];
    return (index % 2 == 0) ? pair.xy : pair.zw;
  }
  if (img > -9.5) { return vec2(ISF_AUDIO.y, 1.0); }
  if (img > -10.5) { return vec2(ISF_AUDIO.z, 1.0); }
  return vec2(1.0);
}
#define PASSINDEX int(round(ISF_PASS.x))
#define texture2D(img, coord) ghost_isf_image((img), (coord))
#define IMG_NORM_PIXEL(img, coord) ghost_isf_image((img), (coord))
#define IMG_PIXEL(img, coord) ghost_isf_image((img), (coord) / ghost_isf_image_size(img))
#define IMG_SIZE(img) ghost_isf_image_size(img)
float sampleFFT(float u) {
  float x = clamp(u, 0.0, 1.0);
  return ISF_AUDIO.x > 0.5
    ? textureLod(sampler2D(ghost_isf_audio_fft, ghost_source_sampler), vec2(x, 0.5), 0.0).r
    : mix(AUDIO0.y, AUDIO1.x, x);
}
float sampleWaveform(float u) {
  float x = clamp(u, 0.0, 1.0);
  return ISF_AUDIO.x > 0.5
    ? textureLod(sampler2D(ghost_isf_audio_wave, ghost_source_sampler), vec2(x, 0.5), 0.0).r * 2.0 - 1.0
    : sin((x + TIME * 0.1) * 6.28318530718) * max(AUDIO0.x, 0.001);
}
"#;

pub(crate) fn probe_native_glsl_source_with_stage(
    source: &str,
    kind: NativeShaderSourceKind,
    stage: naga::ShaderStage,
) -> Result<NativeGlslParseProbe, String> {
    let source = native_glsl_probe_source(source, kind);
    let mut frontend = naga::front::glsl::Frontend::default();
    let options = naga::front::glsl::Options::from(stage);
    match frontend.parse(&options, source.as_ref()) {
        Ok(module) => Ok(NativeGlslParseProbe {
            kind,
            entry_points: module
                .entry_points
                .iter()
                .map(|entry| entry.name.clone())
                .collect(),
        }),
        Err(err) => Err(err.to_string()),
    }
}

pub(crate) fn probe_native_glsl_source(
    source: &str,
    stage: naga::ShaderStage,
) -> Result<NativeGlslParseProbe, String> {
    let kind = classify_native_shader_source(source);
    probe_native_glsl_source_with_stage(source, kind, stage)
}

pub(crate) fn native_fragment_entry(record: &ShaderRecord, source: &str) -> Option<String> {
    let kind = NativeShaderSourceKind::from_label(&record.source_kind);
    let preferred = record.entry.trim();
    match kind {
        NativeShaderSourceKind::Wgsl => {
            if !native_wgsl_fragment_supported(source) {
                return None;
            }
            if !preferred.is_empty() && record.entry_points.iter().any(|entry| entry == preferred) {
                return Some(preferred.to_string());
            }
            ["fs_main", "main"].iter().find_map(|candidate| {
                record
                    .entry_points
                    .iter()
                    .any(|entry| entry == candidate)
                    .then(|| candidate.to_string())
            })
        }
        NativeShaderSourceKind::IsfGlsl | NativeShaderSourceKind::Glsl => {
            if !preferred.is_empty() && record.entry_points.iter().any(|entry| entry == preferred) {
                return Some(preferred.to_string());
            }
            ["main", "fs_main"].iter().find_map(|candidate| {
                record
                    .entry_points
                    .iter()
                    .any(|entry| entry == candidate)
                    .then(|| candidate.to_string())
            })
        }
    }
}

pub(crate) fn native_compute_entry(record: &ShaderRecord, source: &str) -> Option<String> {
    if NativeShaderSourceKind::from_label(&record.source_kind) != NativeShaderSourceKind::Wgsl {
        return None;
    }
    if !source.trim().contains("@compute") {
        return None;
    }
    let preferred = record.entry.trim();
    if !preferred.is_empty() && record.entry_points.iter().any(|entry| entry == preferred) {
        return Some(preferred.to_string());
    }
    ["cs_main", "main"].iter().find_map(|candidate| {
        record
            .entry_points
            .iter()
            .any(|entry| entry == candidate)
            .then(|| candidate.to_string())
    })
}

pub(crate) fn native_wgsl_fragment_supported(source: &str) -> bool {
    let source = source.trim();
    source.contains("@fragment") && native_wgsl_bindings_supported(source)
}

pub(crate) fn native_wgsl_bindings_supported(source: &str) -> bool {
    if !source.contains("@group") && !source.contains("@binding") {
        return true;
    }
    all_wgsl_attribute_indices_at_most(source, "@group", 0)
        && all_wgsl_attribute_indices_at_most(source, "@binding", 2)
}

pub(crate) fn all_wgsl_attribute_indices_at_most(source: &str, attribute: &str, max_supported: u32) -> bool {
    let mut rest = source;
    while let Some(index) = rest.find(attribute) {
        rest = &rest[index + attribute.len()..];
        let Some(open_index) = rest.find('(') else {
            return false;
        };
        rest = &rest[open_index + 1..];
        let trimmed = rest.trim_start();
        let digits = trimmed
            .chars()
            .take_while(|ch| ch.is_ascii_digit())
            .collect::<String>();
        let Ok(value) = digits.parse::<u32>() else {
            return false;
        };
        if value > max_supported {
            return false;
        }
    }
    true
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn native_shader_source_classifier_separates_wgsl_isf_and_glsl() {
        assert_eq!(
            classify_native_shader_source(
                "@fragment fn fs_main() -> @location(0) vec4<f32> { return vec4<f32>(1.0); }"
            ),
            NativeShaderSourceKind::Wgsl
        );
        assert_eq!(
            classify_native_shader_source(
                r#"/*{"ISFVSN":"2","INPUTS":[]}*/ void main(){ gl_FragColor = vec4(TIME); }"#
            ),
            NativeShaderSourceKind::IsfGlsl
        );
        assert_eq!(
            classify_native_shader_source("#version 450 core\nvoid main(){}"),
            NativeShaderSourceKind::Glsl
        );
    }

    #[test]
    fn native_glsl_probe_strips_isf_header_and_parses_fragment() {
        let probe = probe_native_glsl_source(
            r#"/*{"ISFVSN":"2","INPUTS":[]}*/
void main() {
  gl_FragColor = vec4(isf_FragNormCoord, TIME, 1.0);
}"#,
            naga::ShaderStage::Fragment,
        )
        .expect("minimal ISF-style GLSL should parse through the native probe");

        assert_eq!(probe.kind, NativeShaderSourceKind::IsfGlsl);
        assert!(probe.entry_points.iter().any(|entry| entry == "main"));
    }

    #[test]
    fn native_glsl_probe_maps_declared_isf_inputs_to_native_params() {
        let source = r#"/*{
  "ISFVSN": "2",
  "INPUTS": [
    { "NAME": "speed", "TYPE": "float", "DEFAULT": 0.5 },
    { "NAME": "scale", "TYPE": "float", "DEFAULT": 2.0 },
    { "NAME": "enabled", "TYPE": "bool", "DEFAULT": true },
    { "NAME": "origin", "TYPE": "point2D", "DEFAULT": [0.25, 0.75] }
  ]
}*/
void main() {
  vec2 uv = isf_FragNormCoord * scale + origin;
  float pulse = enabled ? sin(TIME * speed) : 0.0;
  gl_FragColor = vec4(uv, pulse, 1.0);
}"#;
        let native_source =
            native_glsl_probe_source(source, NativeShaderSourceKind::IsfGlsl).into_owned();
        assert!(native_source.contains("bool enabled;"));
        assert!(native_source.contains("enabled = (PARAMS0.z > 0.5);"));
        let probe = probe_native_glsl_source(source, naga::ShaderStage::Fragment)
            .expect("ISF input macros should let raw controls parse natively");
        assert_eq!(probe.kind, NativeShaderSourceKind::IsfGlsl);

        let bindings = parse_native_isf_inputs(source);
        assert_eq!(bindings.len(), 4);
        assert_eq!(bindings[0].offset, Some(0));
        assert_eq!(bindings[3].offset, Some(3));
        let params = native_isf_input_params(
            &json!({
                "float_inputs": {
                    "speed": 1.25,
                    "scale": 3.5,
                    "enabled": false
                },
                "point_inputs": {
                    "origin": [0.1, 0.9]
                }
            }),
            &bindings,
        );
        assert_eq!(params[0], 1.25);
        assert_eq!(params[1], 3.5);
        assert_eq!(params[2], 0.0);
        assert_eq!(params[3], 0.1);
        assert_eq!(params[4], 0.9);
    }

    #[test]
    fn native_isf_inputs_extend_beyond_the_legacy_eight_float_block() {
        let inputs = (0..20)
            .map(|index| {
                json!({
                    "NAME": format!("control{index}"),
                    "TYPE": "float",
                    "DEFAULT": index as f32 / 10.0,
                })
            })
            .collect::<Vec<_>>();
        let source = format!(
            "/*{}*/\nvoid main() {{ gl_FragColor = vec4(control19); }}",
            json!({ "ISFVSN": "2", "INPUTS": inputs })
        );
        let bindings = parse_native_isf_inputs(&source);
        assert_eq!(bindings.len(), 20);
        assert_eq!(bindings[19].offset, Some(19));
        let native_source =
            native_glsl_probe_source(&source, NativeShaderSourceKind::IsfGlsl).into_owned();
        assert!(native_source.contains("PARAMS4.w"));
        probe_native_glsl_source(&source, naga::ShaderStage::Fragment)
            .expect("extended ISF parameter block should compile natively");
    }

    #[test]
    fn native_isf_inputs_preserve_legal_local_shadowing() {
        let source = r#"/*{
  "ISFVSN": "2",
  "INPUTS": [{ "NAME": "scale", "TYPE": "float", "DEFAULT": 2.0 }]
}*/
float localScale(vec2 p) {
  float scale = length(p);
  return scale;
}
void main() {
  gl_FragColor = vec4(localScale(isf_FragNormCoord) * scale);
}"#;
        let native_source =
            native_glsl_probe_source(source, NativeShaderSourceKind::IsfGlsl).into_owned();
        assert!(native_source.contains("float scale = length(p);"));
        probe_native_glsl_source(source, naga::ShaderStage::Fragment)
            .expect("local variables may shadow ISF input globals");
    }

    #[test]
    fn native_isf_declared_audio_controls_override_builtin_audio_aliases() {
        let source = r#"/*{
  "ISFVSN": "2",
  "INPUTS": [{ "NAME": "audioBass", "TYPE": "float", "DEFAULT": 0.25 }]
}*/
void main() {
  gl_FragColor = vec4(audioBass);
}"#;
        let native_source =
            native_glsl_probe_source(source, NativeShaderSourceKind::IsfGlsl).into_owned();
        assert!(native_source.contains("float audioBass;"));
        assert!(!native_source.contains("#define audioBass AUDIO0.y"));
        probe_native_glsl_source(source, naga::ShaderStage::Fragment)
            .expect("declared audio-named controls should remain ordinary ISF inputs");
    }

    #[test]
    fn native_glsl_host_lifts_unbound_scalar_uniforms_from_generic_fs_exports() {
        let source = r#"```glsl
uniform vec2 iResolution;
uniform float iTime;
uniform float gain;
void main() {
  gl_FragColor = vec4(gl_FragCoord.xy / iResolution, gain + iTime * 0.0, 1.0);
}
```"#;
        let native_source =
            native_glsl_probe_source(source, NativeShaderSourceKind::IsfGlsl).into_owned();
        assert!(native_source.contains("float gain = 1.0;"));
        assert!(!native_source.contains("uniform float gain"));
        probe_native_glsl_source(source, naga::ShaderStage::Fragment)
            .expect("generic fullscreen GLSL uniforms should be hosted without user conversion");
    }

    #[test]
    fn native_glsl_host_centers_fragment_coordinates_in_the_virtual_render_size() {
        let source = r#"/*{"ISFVSN":"2","INPUTS":[]}*/
void main() {
  vec2 uv = gl_FragCoord.xy / RENDERSIZE;
  gl_FragColor = vec4(uv, 0.0, 1.0);
}"#;
        let native_source =
            native_glsl_probe_source(source, NativeShaderSourceKind::IsfGlsl).into_owned();

        assert!(
            native_source
                .contains("#define ghost_FragCoord vec4(isf_FragNormCoord * RENDERSIZE, 0.0, 1.0)")
        );
        assert!(native_source.contains("ghost_FragCoord.xy / RENDERSIZE"));
        assert!(!native_source.contains("vec2 uv = gl_FragCoord.xy"));
        probe_native_glsl_source(source, naga::ShaderStage::Fragment)
            .expect("virtual fragment coordinates should compile through the native host");
    }

    #[test]
    fn native_isf_metadata_allows_line_comments_in_input_defaults() {
        let bindings = parse_native_isf_inputs(
            r#"/*{
  "ISFVSN": "2",
  "INPUTS": [
    { "NAME": "fractalDepth", "TYPE": "float", "DEFAULT": 4.0 // AI-exported label comment
    }
  ]
}*/
void main() { gl_FragColor = vec4(fractalDepth); }"#,
        );

        assert_eq!(bindings.len(), 1);
        assert_eq!(bindings[0].name, "fractalDepth");
        assert_eq!(bindings[0].default_values[0], 4.0);
    }

    #[test]
    fn native_isf_multipass_source_binds_targets_and_parses() {
        let source = r#"/*{
  "ISFVSN": "2",
  "INPUTS": [ { "NAME": "inputImage", "TYPE": "image" }, { "NAME": "decay", "TYPE": "float", "DEFAULT": 0.9 } ],
  "PERSISTENT_BUFFERS": ["trail"],
  "PASSES": [ { "TARGET": "trail", "PERSISTENT": true }, { "TARGET": "half", "WIDTH": "$WIDTH/2" }, {} ]
}*/
uniform sampler2D trail;
void main() {
  vec2 uv = isf_FragNormCoord;
  if (PASSINDEX == 0) {
    gl_FragColor = max(IMG_NORM_PIXEL(trail, uv) * decay, IMG_THIS_PIXEL(inputImage));
  } else if (PASSINDEX == 1) {
    gl_FragColor = IMG_PIXEL(trail, gl_FragCoord.xy) * vec4(IMG_SIZE(trail) / RENDERSIZE, 1.0, 1.0);
  } else {
    gl_FragColor = texture2D(half, uv);
  }
}"#;
        let host = native_isf_host_info(source);
        assert!(host.needs_pass_host());
        assert_eq!(host.plan.targets.len(), 2);
        assert!(host.plan.targets[0].persistent);
        assert_eq!(host.fft_width, None);
        let native = native_glsl_probe_source(source, NativeShaderSourceKind::IsfGlsl).into_owned();
        assert!(native.contains("const float trail = -1.00000000;"));
        assert!(native.contains("const float half = -2.00000000;"));
        assert!(native.contains("#define PASSINDEX int(round(ISF_PASS.x))"));
        assert!(!native.contains("uniform sampler2D trail"));
        // The target must not be rebound as a synthetic input-frame image.
        assert!(!native.contains("float trail;"));
        probe_native_glsl_source(source, naga::ShaderStage::Fragment)
            .expect("multi-pass ISF should parse through the native probe");
    }

    #[test]
    fn native_isf_audio_inputs_become_fixed_rows_not_params() {
        let source = r#"/*{
  "ISFVSN": "2",
  "INPUTS": [
    { "NAME": "fft", "TYPE": "audioFFT", "MAX": 16 },
    { "NAME": "gain", "TYPE": "float", "DEFAULT": 1.0 },
    { "NAME": "wave", "TYPE": "audio" }
  ]
}*/
void main() {
  float a = IMG_PIXEL(fft, vec2(3.5, 0.5)).r * gain;
  float b = IMG_NORM_PIXEL(wave, isf_FragNormCoord).r + sampleFFT(0.2);
  gl_FragColor = vec4(a, b, IMG_SIZE(fft).x / 16.0, 1.0);
}"#;
        let bindings = parse_native_isf_inputs(source);
        assert_eq!(bindings[0].kind, NativeIsfInputKind::AudioFft);
        assert_eq!(bindings[0].audio_width, 16);
        assert_eq!(bindings[0].offset, None);
        // The float after an audio input keeps param slot 0.
        assert_eq!(bindings[1].offset, Some(0));
        assert_eq!(bindings[2].kind, NativeIsfInputKind::AudioWaveform);
        assert_eq!(bindings[2].audio_width, isf_passes::ISF_AUDIO_DEFAULT_WIDTH);
        let host = native_isf_host_info(source);
        assert_eq!(host.fft_width, Some(16));
        assert!(!host.plan.is_multipass());
        let native = native_glsl_probe_source(source, NativeShaderSourceKind::IsfGlsl).into_owned();
        assert!(native.contains("fft = -9.00000000;"));
        assert!(native.contains("wave = -10.00000000;"));
        probe_native_glsl_source(source, naga::ShaderStage::Fragment)
            .expect("audio ISF should parse through the native probe");

        // Builtin rows referenced without an INPUTS entry route the same way.
        let builtin = "/*{\"ISFVSN\":\"2\",\"INPUTS\":[]}*/\nvoid main() { gl_FragColor = texture2D(audioFFT, vec2(isf_FragNormCoord.x, 0.5)); }";
        assert_eq!(native_isf_host_info(builtin).fft_width, Some(isf_passes::ISF_AUDIO_DEFAULT_WIDTH));
        assert!(native_glsl_probe_source(builtin, NativeShaderSourceKind::IsfGlsl).contains("audioFFT = -9.00000000;"));
        probe_native_glsl_source(builtin, naga::ShaderStage::Fragment).expect("builtin audioFFT parses");
    }

    #[test]
    fn native_single_pass_isf_keeps_the_original_prelude() {
        let source = "/*{\"ISFVSN\":\"2\",\"INPUTS\":[]}*/\nvoid main() { gl_FragColor = vec4(float(PASSINDEX)); }";
        assert!(!native_isf_host_info(source).needs_pass_host());
        let native = native_glsl_probe_source(source, NativeShaderSourceKind::IsfGlsl).into_owned();
        assert!(native.contains("#define PASSINDEX 0"));
        assert!(!native.contains("ISF_PASS"));
        assert!(!native.contains("ghost_isf_pass0"));
    }

    #[test]
    fn native_shader_uniforms_keep_legacy_prefix_and_append_pass_tail() {
        assert_eq!(std::mem::offset_of!(NativeShaderUniforms, params_extra), 8 * 16);
        assert_eq!(
            std::mem::offset_of!(NativeShaderUniforms, isf_pass),
            8 * 16 + NATIVE_ISF_EXTRA_PARAM_VEC4S * 16
        );
        assert_eq!(std::mem::size_of::<NativeShaderUniforms>() % 16, 0);
        let uniforms = NativeShaderUniforms::from_isf("s", None, 640, 360, [0.0; MAX_NATIVE_ISF_PARAM_FLOATS], 0);
        assert_eq!(uniforms.isf_pass, [0.0, 1.0, 640.0, 360.0]);
    }

    #[test]
    fn native_glsl_probe_reports_invalid_source_without_browser_fallback() {
        let error = probe_native_glsl_source("void main( {", naga::ShaderStage::Fragment)
            .expect_err("invalid GLSL should stay a native parse error");

        assert!(!error.is_empty());
    }

    #[test]
    fn native_glsl_shader_records_resolve_fragment_but_not_compute() {
        let record = ShaderRecord {
            shader_id: "isf".to_string(),
            stage: "pixel".to_string(),
            entry: "main".to_string(),
            source_kind: NativeShaderSourceKind::IsfGlsl.label().to_string(),
            source_hash: 123,
            source_bytes: 42,
            entry_points: vec!["main".to_string()],
            compiled_at_ms: 1,
        };

        assert_eq!(
            native_fragment_entry(&record, "#version 450 core\nvoid main(){}"),
            Some("main".to_string())
        );
        assert_eq!(
            native_compute_entry(&record, "#version 450 core\nvoid main(){}"),
            None
        );
        assert!(native_shader_pipeline_key(&record, "isf", "main").contains("ISF/GLSL"));
    }
}
