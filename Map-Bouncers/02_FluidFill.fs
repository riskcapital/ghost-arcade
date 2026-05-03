/*{
    "DESCRIPTION": "Fluid simulation that fills the frame from the bottom with animated wave surface",
    "CREDIT": "LumiVision ISF Collection",
    "ISFVSN": "2.0",
    "CATEGORIES": ["Generator", "Projection Mapping"],
    "INPUTS": [
        {"NAME": "fillLevel", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.5},
        {"NAME": "waveHeight", "TYPE": "float", "MIN": 0.0, "MAX": 0.15, "DEFAULT": 0.04},
        {"NAME": "waveSpeed", "TYPE": "float", "MIN": 0.1, "MAX": 5.0, "DEFAULT": 1.5},
        {"NAME": "waveFreq", "TYPE": "float", "MIN": 1.0, "MAX": 20.0, "DEFAULT": 6.0},
        {"NAME": "fluidColor", "TYPE": "color", "DEFAULT": [0.1, 0.4, 0.9, 1.0]},
        {"NAME": "surfaceFoam", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.5},
        {"NAME": "turbulence", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.3}
    ]
}*/

float noise(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

float smoothNoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float a = noise(i);
    float b = noise(i + vec2(1.0, 0.0));
    float c = noise(i + vec2(0.0, 1.0));
    float d = noise(i + vec2(1.0, 1.0));
    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

void main() {
    vec2 uv = isf_FragNormCoord;
    float t = TIME * waveSpeed;
    float wave = sin(uv.x * waveFreq * 6.2832 + t) * waveHeight;
    wave += sin(uv.x * waveFreq * 3.0 + t * 1.3) * waveHeight * 0.5;
    wave += sin(uv.x * waveFreq * 7.0 - t * 0.7) * waveHeight * 0.25;
    float turb = smoothNoise(uv * 10.0 + TIME * 0.5) * turbulence * 0.03;
    float surface = fillLevel + wave + turb;
    float edgeWaveL = sin(uv.y * 12.0 + t * 1.1) * 0.005 * waveHeight * 10.0;
    float edgeWaveR = sin(uv.y * 14.0 - t * 0.9) * 0.005 * waveHeight * 10.0;
    float inFluid = step(uv.y, surface);
    float nearEdge = (1.0 - smoothstep(0.0, 0.03, uv.x)) + (1.0 - smoothstep(0.97, 1.0, uv.x));
    float meniscus = nearEdge * 0.02 * inFluid;
    inFluid = max(inFluid, step(uv.y, surface + meniscus));
    float surfaceDist = abs(uv.y - surface);
    float foamLine = smoothstep(0.02, 0.0, surfaceDist) * surfaceFoam;
    float depth = (surface - uv.y) / max(surface, 0.001);
    depth = clamp(depth, 0.0, 1.0);
    vec3 deepColor = fluidColor.rgb * 0.4;
    vec3 shallowColor = fluidColor.rgb * 1.2;
    vec3 fluidCol = mix(shallowColor, deepColor, depth);
    float caustic = smoothNoise(uv * 20.0 + vec2(t * 0.3, t * 0.2));
    fluidCol += caustic * 0.1 * (1.0 - depth * 0.5);
    fluidCol += vec3(foamLine);
    vec3 col = mix(vec3(0.0), fluidCol, inFluid);
    gl_FragColor = vec4(col, inFluid > 0.5 ? 1.0 : 0.0);
}
