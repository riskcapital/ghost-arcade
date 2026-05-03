/*{
    "DESCRIPTION": "Linocut woodblock print aesthetic with hatching lines and audio-reactive depth",
    "CREDIT": "Shrink Wrap",
    "ISFVSN": "2",
    "CATEGORIES": ["Generator"],
    "INPUTS": [
        {"NAME": "speed", "TYPE": "float", "DEFAULT": 0.3, "MIN": 0.0, "MAX": 1.5},
        {"NAME": "hatchDensity", "TYPE": "float", "DEFAULT": 30.0, "MIN": 10.0, "MAX": 80.0},
        {"NAME": "hatchAngle", "TYPE": "float", "DEFAULT": 0.78, "MIN": 0.0, "MAX": 3.14},
        {"NAME": "contrast", "TYPE": "float", "DEFAULT": 1.5, "MIN": 0.5, "MAX": 3.0},
        {"NAME": "inkColor", "TYPE": "float", "DEFAULT": 0.0, "MIN": 0.0, "MAX": 1.0}
    ]
}*/

float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float a = hash(i);
    float b = hash(i + vec2(1.0, 0.0));
    float c = hash(i + vec2(0.0, 1.0));
    float d = hash(i + vec2(1.0, 1.0));
    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

float fbm(vec2 p) {
    float v = 0.0;
    float a = 0.5;
    for (float i = 0.0; i < 5.0; i++) {
        v += a * noise(p);
        p *= 2.0;
        a *= 0.5;
    }
    return v;
}

vec2 rotate2D(vec2 p, float a) {
    float c = cos(a);
    float s = sin(a);
    return vec2(p.x * c - p.y * s, p.x * s + p.y * c);
}

void main() {
    vec2 uv = gl_FragCoord.xy / RENDERSIZE;
    float aspect = RENDERSIZE.x / RENDERSIZE.y;
    float t = TIME * speed;

    // Audio reactivity
    float bassDepth = audioBass * 0.4;
    float midDetail = 1.0 + audioMid * 0.5;
    float beatInk = audioBeat * 0.3;
    float levelBright = 1.0 + audioLevel * 0.3;

    // Generate underlying "image" using noise (landscape-like shapes)
    vec2 noisePos = uv * vec2(aspect, 1.0) * 2.0 + vec2(t * 0.2, 0.0);
    float shape = fbm(noisePos * midDetail);

    // Add circular forms
    vec2 center = vec2(0.5 * aspect, 0.5);
    float circ = length(uv * vec2(aspect, 1.0) - center + vec2(sin(t) * 0.2, cos(t * 0.7) * 0.15));
    shape += smoothstep(0.4, 0.1, circ) * 0.5;
    shape += bassDepth;

    // Convert to "darkness" level for hatching
    float darkness = 1.0 - clamp(shape * contrast, 0.0, 1.0);

    // Hatching layers at different angles and densities
    float hatch = 0.0;

    // Layer 1: primary hatch
    vec2 h1 = rotate2D(uv * RENDERSIZE, hatchAngle);
    float line1 = smoothstep(0.3, 0.5, abs(sin(h1.x * hatchDensity / RENDERSIZE.y * 200.0)));
    hatch += (1.0 - line1) * step(0.2, darkness);

    // Layer 2: cross hatch for medium tones
    vec2 h2 = rotate2D(uv * RENDERSIZE, hatchAngle + 1.57);
    float line2 = smoothstep(0.3, 0.5, abs(sin(h2.x * hatchDensity / RENDERSIZE.y * 200.0)));
    hatch += (1.0 - line2) * step(0.45, darkness);

    // Layer 3: diagonal fill for darkest areas
    vec2 h3 = rotate2D(uv * RENDERSIZE, hatchAngle + 0.78);
    float line3 = smoothstep(0.3, 0.5, abs(sin(h3.x * hatchDensity * 1.5 / RENDERSIZE.y * 200.0)));
    hatch += (1.0 - line3) * step(0.7, darkness);

    hatch = clamp(hatch, 0.0, 1.0);

    // Ink color (black to colored)
    vec3 ink = mix(
        vec3(0.05, 0.05, 0.08),
        vec3(0.15, 0.05, 0.02),
        inkColor
    );

    // Paper color
    vec3 paper = vec3(0.92, 0.88, 0.82) * levelBright;

    // Add subtle paper texture
    float paperTex = 0.95 + 0.05 * noise(uv * 500.0);
    paper *= paperTex;

    // Compose
    vec3 col = mix(paper, ink, hatch);

    // Beat darkening
    col = mix(col, ink, beatInk);

    gl_FragColor = vec4(col, 1.0);
}
