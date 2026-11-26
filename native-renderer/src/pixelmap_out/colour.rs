//! Fixture sampling and colour calibration: a port of
//! `sampleWLEDSourcePixels`, `calibrateWLEDPixels` and `fillWLEDTestPattern`
//! in `src/lib/wled/mapping.ts`, in the same f64 arithmetic and the same
//! order of operations, so a frame gives the same DMX values as the editor
//! path (`tests.rs` checks against values the TS made).

use std::sync::OnceLock;

/// JS `clamp` from mapping.ts: a non-finite value becomes `min`.
fn clamp(value: f64, min: f64, max: f64) -> f64 {
    if !value.is_finite() {
        return min;
    }
    value.min(max).max(min)
}

fn clamp01(value: f64) -> f64 {
    clamp(value, 0.0, 1.0)
}

/// JS `Math.round`: halves go toward +infinity.
pub(crate) fn js_round(value: f64) -> f64 {
    let floor = value.floor();
    if value - floor >= 0.5 { floor + 1.0 } else { floor }
}

fn srgb_to_linear_exact(value: f64) -> f64 {
    let encoded = clamp01(value / 255.0);
    if encoded <= 0.04045 {
        encoded / 12.92
    } else {
        ((encoded + 0.055) / 1.055).powf(2.4)
    }
}

/// `srgbByteToLinear` for a byte, from a table (the same values).
fn srgb_byte_to_linear(value: u8) -> f64 {
    static TABLE: OnceLock<[f64; 256]> = OnceLock::new();
    TABLE.get_or_init(|| std::array::from_fn(|index| srgb_to_linear_exact(index as f64)))[value as usize]
}

fn linear_to_srgb_byte(value: f64) -> f64 {
    let linear = clamp01(value);
    let encoded = if linear <= 0.0031308 {
        linear * 12.92
    } else {
        1.055 * linear.powf(1.0 / 2.4) - 0.055
    };
    clamp01(encoded) * 255.0
}

fn gamma_correct(value: f64, gamma: f64) -> f64 {
    if gamma == 1.0 || gamma <= 0.0 {
        return value;
    }
    clamp01(value / 255.0).powf(gamma) * 255.0
}

fn rgb_to_hsv(red: u8, green: u8, blue: u8) -> (f64, f64, f64) {
    let r = red as f64 / 255.0;
    let g = green as f64 / 255.0;
    let b = blue as f64 / 255.0;
    let max = r.max(g).max(b);
    let min = r.min(g).min(b);
    let delta = max - min;
    let mut hue = 0.0;
    if delta > 0.0 {
        hue = if max == r {
            ((g - b) / delta) % 6.0
        } else if max == g {
            (b - r) / delta + 2.0
        } else {
            (r - g) / delta + 4.0
        };
        hue = ((hue / 6.0) + 1.0) % 1.0;
    }
    (hue, if max <= 0.0 { 0.0 } else { delta / max }, max)
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum SamplingMode {
    Exact,
    Average,
    Dominant,
    Highlight,
    Palette,
    LumaHue,
}

impl SamplingMode {
    pub(crate) fn parse(value: Option<&str>) -> Self {
        match value {
            Some("exact") => Self::Exact,
            Some("dominant") => Self::Dominant,
            Some("highlight") => Self::Highlight,
            Some("palette") => Self::Palette,
            Some("luma-hue") => Self::LumaHue,
            _ => Self::Average,
        }
    }
}

struct Accumulator {
    linear: [f64; 3],
    samples: u32,
    dominant: [[f64; 4]; 12],
    highlight: [f64; 3],
    highlight_score: f64,
}

impl Accumulator {
    fn new() -> Self {
        Self { linear: [0.0; 3], samples: 0, dominant: [[0.0; 4]; 12], highlight: [0.0; 3], highlight_score: -1.0 }
    }

    fn add(&mut self, red: u8, green: u8, blue: u8) {
        let lr = srgb_byte_to_linear(red);
        let lg = srgb_byte_to_linear(green);
        let lb = srgb_byte_to_linear(blue);
        self.linear[0] += lr;
        self.linear[1] += lg;
        self.linear[2] += lb;
        self.samples += 1;
        let (hue, saturation, value) = rgb_to_hsv(red, green, blue);
        let bin = ((hue * 12.0).floor() as usize).min(11);
        let weight = (saturation * (0.25 + value * 0.75)).max(0.015);
        let entry = &mut self.dominant[bin];
        entry[0] += lr * weight;
        entry[1] += lg * weight;
        entry[2] += lb * weight;
        entry[3] += weight;
        let luma = lr * 0.2126 + lg * 0.7152 + lb * 0.0722;
        let score = luma * (0.35 + saturation * 0.65);
        if score > self.highlight_score {
            self.highlight_score = score;
            self.highlight = [lr, lg, lb];
        }
    }

    fn resolve(&self, mode: SamplingMode, exact: [f64; 3]) -> [f64; 3] {
        if mode == SamplingMode::Exact {
            return exact;
        }
        let count = self.samples.max(1) as f64;
        let average = [self.linear[0] / count, self.linear[1] / count, self.linear[2] / count];
        match mode {
            SamplingMode::Average => return average,
            SamplingMode::Highlight => return self.highlight,
            _ => {}
        }
        let mut bin = 0;
        for index in 1..12 {
            if self.dominant[index][3] > self.dominant[bin][3] {
                bin = index;
            }
        }
        let weight = self.dominant[bin][3].max(0.0001);
        let dominant = [self.dominant[bin][0] / weight, self.dominant[bin][1] / weight, self.dominant[bin][2] / weight];
        if matches!(mode, SamplingMode::Dominant | SamplingMode::Palette) {
            return dominant;
        }
        let average_luma = average[0] * 0.2126 + average[1] * 0.7152 + average[2] * 0.0722;
        let dominant_luma = (dominant[0] * 0.2126 + dominant[1] * 0.7152 + dominant[2] * 0.0722).max(0.0001);
        let scale = average_luma / dominant_luma;
        [dominant[0] * scale, dominant[1] * scale, dominant[2] * scale]
    }
}

/// A frame to sample: tightly packed 4-byte pixels, top row first.
pub(crate) struct Frame<'a> {
    pub pixels: &'a [u8],
    pub width: usize,
    pub height: usize,
    /// Channel offsets of red, green and blue in each pixel.
    pub rgb: [usize; 3],
}

impl Frame<'_> {
    fn at(&self, offset: usize) -> (u8, u8, u8) {
        let get = |channel: usize| self.pixels.get(offset + self.rgb[channel]).copied().unwrap_or(0);
        (get(0), get(1), get(2))
    }
}

/// `sampleWLEDSourcePixels`: sample normalized points into uncalibrated sRGB bytes.
pub(crate) fn sample_points(frame: &Frame, points: &[[f64; 2]], sample_radius: f64, mode: SamplingMode, output: &mut [u8]) {
    let width = frame.width.max(1);
    let height = frame.height.max(1);
    let radius = js_round(clamp(sample_radius, 0.0, 0.12) * width.min(height) as f64).max(0.0) as i64;
    for (led, point) in points.iter().enumerate() {
        if led * 3 + 2 >= output.len() {
            break;
        }
        let cx = js_round(clamp01(point[0]) * (width - 1) as f64) as i64;
        let cy = js_round(clamp01(point[1]) * (height - 1) as f64) as i64;
        let (er, eg, eb) = frame.at((cy as usize * width + cx as usize) * 4);
        let exact = [srgb_byte_to_linear(er), srgb_byte_to_linear(eg), srgb_byte_to_linear(eb)];
        let mut accumulator = Accumulator::new();
        for y in (cy - radius).max(0)..=(cy + radius).min(height as i64 - 1) {
            for x in (cx - radius).max(0)..=(cx + radius).min(width as i64 - 1) {
                let (r, g, b) = frame.at((y as usize * width + x as usize) * 4);
                accumulator.add(r, g, b);
            }
        }
        let sampled = accumulator.resolve(mode, exact);
        output[led * 3] = js_round(linear_to_srgb_byte(sampled[0])) as u8;
        output[led * 3 + 1] = js_round(linear_to_srgb_byte(sampled[1])) as u8;
        output[led * 3 + 2] = js_round(linear_to_srgb_byte(sampled[2])) as u8;
    }
}

/// Brightness, gamma and calibration for one fixture, as the project holds
/// them (clamped here exactly where mapping.ts clamps them).
#[derive(Clone, Debug, Default, PartialEq)]
pub(crate) struct PixelOptions {
    pub brightness: Option<f64>,
    pub gamma: Option<f64>,
    pub red_gain: Option<f64>,
    pub green_gain: Option<f64>,
    pub blue_gain: Option<f64>,
    pub saturation: Option<f64>,
    pub black_threshold: Option<f64>,
    pub smoothing: Option<f64>,
    pub color_matrix: Option<Vec<f64>>,
}

fn calibrate_one(red: f64, green: f64, blue: f64, options: &PixelOptions, previous: Option<&[u8]>, offset: usize) -> [f64; 3] {
    let saturation = clamp(options.saturation.unwrap_or(1.0), 0.0, 2.0);
    let to_linear = |value: f64| srgb_to_linear_exact(value);
    let mut lr = to_linear(red);
    let mut lg = to_linear(green);
    let mut lb = to_linear(blue);
    let source_luma = lr * 0.2126 + lg * 0.7152 + lb * 0.0722;
    lr = source_luma + (lr - source_luma) * saturation;
    lg = source_luma + (lg - source_luma) * saturation;
    lb = source_luma + (lb - source_luma) * saturation;

    const IDENTITY: [f64; 9] = [1.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0];
    let m: &[f64] = match options.color_matrix.as_deref() {
        Some(matrix) if matrix.len() == 9 && matrix.iter().all(|v| v.is_finite()) => matrix,
        _ => &IDENTITY,
    };
    let mr = lr * m[0] + lg * m[1] + lb * m[2];
    let mg = lr * m[3] + lg * m[4] + lb * m[5];
    let mb = lr * m[6] + lg * m[7] + lb * m[8];
    let mut r = mr * clamp(options.red_gain.unwrap_or(1.0), 0.0, 2.0);
    let mut g = mg * clamp(options.green_gain.unwrap_or(1.0), 0.0, 2.0);
    let mut b = mb * clamp(options.blue_gain.unwrap_or(1.0), 0.0, 2.0);

    let threshold = clamp(options.black_threshold.unwrap_or(0.0), 0.0, 0.5);
    if source_luma < threshold {
        r = 0.0;
        g = 0.0;
        b = 0.0;
    }

    let brightness = clamp01(options.brightness.unwrap_or(1.0));
    let gamma = clamp(options.gamma.unwrap_or(1.0), 0.5, 3.0);
    r = gamma_correct(linear_to_srgb_byte(r * brightness), gamma);
    g = gamma_correct(linear_to_srgb_byte(g * brightness), gamma);
    b = gamma_correct(linear_to_srgb_byte(b * brightness), gamma);

    let smoothing = clamp(options.smoothing.unwrap_or(0.0), 0.0, 0.95);
    if let Some(previous) = previous
        && previous.len() > offset + 2
        && smoothing > 0.0
    {
        r = previous[offset] as f64 * smoothing + r * (1.0 - smoothing);
        g = previous[offset + 1] as f64 * smoothing + g * (1.0 - smoothing);
        b = previous[offset + 2] as f64 * smoothing + b * (1.0 - smoothing);
    }
    [r, g, b]
}

fn store(output: &mut [u8], offset: usize, value: [f64; 3]) {
    for channel in 0..3 {
        output[offset + channel] = js_round(clamp(value[channel], 0.0, 255.0)) as u8;
    }
}

/// `calibrateWLEDPixels`.
pub(crate) fn calibrate(source: &[u8], output: &mut [u8], options: &PixelOptions, previous: Option<&[u8]>) {
    let length = source.len().min(output.len());
    let mut offset = 0;
    while offset + 2 < length {
        let value = calibrate_one(source[offset] as f64, source[offset + 1] as f64, source[offset + 2] as f64, options, previous, offset);
        store(output, offset, value);
        offset += 3;
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum TestPattern {
    Off,
    Solid,
    Rainbow,
    Chase,
}

impl TestPattern {
    pub(crate) fn parse(value: Option<&str>) -> Self {
        match value {
            Some("solid") => Self::Solid,
            Some("rainbow") => Self::Rainbow,
            Some("chase") => Self::Chase,
            _ => Self::Off,
        }
    }
}

/// `parseWLEDHexColor`: white unless the text is #rrggbb.
pub(crate) fn parse_hex_color(hex: Option<&str>) -> [u8; 3] {
    let text = hex.unwrap_or("");
    let digits = text.strip_prefix('#').unwrap_or(text);
    if digits.len() == 6 && digits.bytes().all(|b| b.is_ascii_hexdigit()) {
        let value = u32::from_str_radix(digits, 16).unwrap_or(0xffffff);
        return [(value >> 16) as u8, (value >> 8) as u8, value as u8];
    }
    [255, 255, 255]
}

/// `fillWLEDTestPattern`, in physical LED order with the same calibration.
pub(crate) fn fill_test_pattern(pattern: TestPattern, color: [u8; 3], now_ms: f64, output: &mut [u8], options: &PixelOptions, previous: Option<&[u8]>) {
    let count = output.len() / 3;
    let chase = if count > 0 { (now_ms / 80.0).floor() as usize % count } else { 0 };
    let solid = [color[0] as f64, color[1] as f64, color[2] as f64];
    for index in 0..count {
        let source = match pattern {
            TestPattern::Rainbow => {
                let hue = if count <= 1 { 0.0 } else { index as f64 / count as f64 };
                let phase = hue * 6.0;
                let channel = |offset: f64| 255.0 * clamp01((((phase + offset) % 6.0) - 3.0).abs() - 1.0);
                [channel(0.0), channel(4.0), channel(2.0)]
            }
            TestPattern::Chase => if index == chase { solid } else { [0.0; 3] },
            _ => solid,
        };
        let value = calibrate_one(source[0], source[1], source[2], options, previous, index * 3);
        store(output, index * 3, value);
    }
}
