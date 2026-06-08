/*{
    "DESCRIPTION": "Nebula dissolve - transforms point cloud into cosmic dust and nebula clouds",
    "CREDIT": "Shrink Wrap",
    "ISFVSN": "2",
    "CATEGORIES": ["Point Cloud FX"],
    "INPUTS": [
        {"NAME": "inputImage", "TYPE": "image"},
        {"NAME": "dissolveAmount", "TYPE": "float", "DEFAULT": 0.3, "MIN": 0.0, "MAX": 1.0, "LABEL": "Dissolve"},
        {"NAME": "nebulaScale", "TYPE": "float", "DEFAULT": 3.0, "MIN": 0.5, "MAX": 10.0, "LABEL": "Nebula Scale"},
        {"NAME": "dustDensity", "TYPE": "float", "DEFAULT": 0.6, "MIN": 0.0, "MAX": 1.0, "LABEL": "Dust Density"},
        {"NAME": "cosmicColor1", "TYPE": "color", "DEFAULT": [0.8, 0.2, 0.5, 1.0], "LABEL": "Color A"},
        {"NAME": "cosmicColor2", "TYPE": "color", "DEFAULT": [0.2, 0.3, 0.9, 1.0], "LABEL": "Color B"},
        {"NAME": "starSparkle", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0.0, "MAX": 1.0, "LABEL": "Sparkle"},
        {"NAME": "swirl", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0.0, "MAX": 2.0, "LABEL": "Swirl"}
    ]
}*/

#ifdef GL_ES
precision highp float;
#endif

uniform float TIME;
uniform vec2 RENDERSIZE;

// Simplex-ish noise
vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec2 mod289(vec2 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec3 permute(vec3 x) { return mod289(((x * 34.0) + 1.0) * x); }

float snoise(vec2 v) {
    const vec4 C = vec4(0.211324865405187, 0.366025403784439, -0.577350269189626, 0.024390243902439);
    vec2 i = floor(v + dot(v, C.yy));
    vec2 x0 = v - i + dot(i, C.xx);
    vec2 i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
    vec4 x12 = x0.xyxy + C.xxzz;
    x12.xy -= i1;
    i = mod289(i);
    vec3 p = permute(permute(i.y + vec3(0.0, i1.y, 1.0)) + i.x + vec3(0.0, i1.x, 1.0));
    vec3 m = max(0.5 - vec3(dot(x0, x0), dot(x12.xy, x12.xy), dot(x12.zw, x12.zw)), 0.0);
    m = m * m; m = m * m;
    vec3 x = 2.0 * fract(p * C.www) - 1.0;
    vec3 h = abs(x) - 0.5;
    vec3 ox = floor(x + 0.5);
    vec3 a0 = x - ox;
    m *= 1.79284291400159 - 0.85373472095314 * (a0 * a0 + h * h);
    vec3 g;
    g.x = a0.x * x0.x + h.x * x0.y;
    g.yz = a0.yz * x12.xz + h.yz * x12.yw;
    return 130.0 * dot(m, g);
}

float fbm(vec2 p) {
    float f = 0.0, w = 0.5;
    for (int i = 0; i < 5; i++) {
        f += w * snoise(p);
        p *= 2.0; w *= 0.5;
    }
    return f;
}

void main() {
    vec2 uv = gl_FragCoord.xy / RENDERSIZE;
    vec2 centered = uv - 0.5;

    // Swirl distortion
    float angle = length(centered) * swirl * 3.0 + TIME * 0.2;
    float s = sin(angle), c = cos(angle);
    vec2 swirlUV = vec2(centered.x * c - centered.y * s, centered.x * s + centered.y * c) + 0.5;

    vec4 src = IMG_NORM_PIXEL(inputImage, mix(uv, swirlUV, dissolveAmount * 0.5));
    float brightness = dot(src.rgb, vec3(0.299, 0.587, 0.114));

    // Nebula noise
    float t = TIME * 0.15;
    vec2 noiseCoord = uv * nebulaScale + vec2(t, t * 0.7);
    float nebula1 = fbm(noiseCoord);
    float nebula2 = fbm(noiseCoord * 1.5 + 3.7);

    // Dissolve threshold based on noise
    float dissolveEdge = smoothstep(dissolveAmount - 0.1, dissolveAmount + 0.1, nebula1 * 0.5 + 0.5);
    float edgeGlow = smoothstep(dissolveAmount - 0.05, dissolveAmount, nebula1 * 0.5 + 0.5) *
                     (1.0 - smoothstep(dissolveAmount, dissolveAmount + 0.05, nebula1 * 0.5 + 0.5));

    // Cosmic dust colors
    vec3 dustColor = mix(cosmicColor1.rgb, cosmicColor2.rgb, nebula2 * 0.5 + 0.5);
    dustColor *= dustDensity * (0.5 + nebula1 * 0.5);

    // Star sparkles
    float sparkle = 0.0;
    if (starSparkle > 0.01) {
        vec2 sparkleUV = floor(uv * 200.0);
        float sparkleRand = fract(sin(dot(sparkleUV, vec2(12.9898, 78.233))) * 43758.5453);
        sparkle = step(0.998 - starSparkle * 0.01, sparkleRand) * (sin(TIME * 3.0 + sparkleRand * 100.0) * 0.5 + 0.5);
    }

    // Composite
    vec3 result = src.rgb * dissolveEdge;
    result += dustColor * (1.0 - dissolveEdge) * brightness;
    result += (cosmicColor1.rgb + cosmicColor2.rgb) * 0.5 * edgeGlow * 3.0;
    result += vec3(sparkle) * starSparkle;

    float alpha = max(src.a * dissolveEdge, dustDensity * brightness * (1.0 - dissolveEdge));
    alpha = max(alpha, edgeGlow);

    gl_FragColor = vec4(result, alpha);
}
