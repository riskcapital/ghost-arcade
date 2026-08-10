/*{
    "DESCRIPTION": "Raymarched crystal prism field — rotating refractive shards catching rainbow light. Beats strike the prisms; highs scatter the spectrum.",
    "CREDIT": "Ghost Arcade LIVE pack",
    "ISFVSN": "2",
    "CATEGORIES": ["3D Room", "Audio Reactive"],
    "INPUTS": [
        {"NAME": "shardCount", "TYPE": "float", "DEFAULT": 0.6,  "MIN": 0.2, "MAX": 1.0},
        {"NAME": "spin",       "TYPE": "float", "DEFAULT": 0.3,  "MIN": 0.0, "MAX": 1.0},
        {"NAME": "refraction", "TYPE": "float", "DEFAULT": 0.6,  "MIN": 0.0, "MAX": 1.0},
        {"NAME": "brightness", "TYPE": "float", "DEFAULT": 1.1,  "MIN": 0.2, "MAX": 1.8},
        {"NAME": "hueDrift",   "TYPE": "float", "DEFAULT": 0.04, "MIN": 0.0, "MAX": 0.3}
    ]
}*/

#ifdef GL_ES
precision highp float;
#endif

mat2 rot(float a) {
    float c = cos(a);
    float s = sin(a);
    return mat2(c, -s, s, c);
}

float sdOcta(vec3 p, float s) {
    p = abs(p);
    return (p.x + p.y + p.z - s) * 0.57735027;
}

float hash11(float n) {
    return fract(sin(n) * 43758.5453);
}

// Scene: a ring of spinning octahedral shards around the view axis.
float map(vec3 p, float t, float beatKick) {
    float d = 1e5;
    for (int i = 0; i < 6; i++) {
        float fi = float(i);
        float a = fi * 1.047198 + t * (0.3 + hash11(fi * 7.1) * 0.4);
        vec3 q = p;
        q.xy -= vec2(cos(a), sin(a)) * (1.15 + 0.25 * sin(t * 0.7 + fi * 2.2));
        q.z -= sin(t * 0.5 + fi * 1.3) * 0.45;
        q.xy = rot(t * (0.6 + hash11(fi * 3.3) * 0.8) + fi) * q.xy;
        q.yz = rot(t * 0.45 + fi * 0.9) * q.yz;
        float size = 0.34 + hash11(fi * 11.7) * 0.22 + beatKick * 0.1;
        d = min(d, sdOcta(q, size));
    }
    // Center anchor crystal.
    vec3 q = p;
    q.xy = rot(t * 0.2) * q.xy;
    q.xz = rot(t * 0.13) * q.xz;
    d = min(d, sdOcta(q, 0.5 + beatKick * 0.15));
    return d;
}

vec3 calcNormal(vec3 p, float t, float beatKick) {
    vec2 e = vec2(0.004, 0.0);
    return normalize(vec3(
        map(p + e.xyy, t, beatKick) - map(p - e.xyy, t, beatKick),
        map(p + e.yxy, t, beatKick) - map(p - e.yxy, t, beatKick),
        map(p + e.yyx, t, beatKick) - map(p - e.yyx, t, beatKick)
    ));
}

vec3 spectrum(float h) {
    return 0.5 + 0.5 * cos(6.2831 * (h + vec3(0.0, 0.33, 0.67)));
}

void main() {
    vec2 uv = (gl_FragCoord.xy - 0.5 * RENDERSIZE.xy) / RENDERSIZE.y;

    float bass = max(audioBass, 0.3 + 0.12 * sin(TIME * 0.45));
    float high = max(audioHigh, 0.2 + 0.1 * sin(TIME * 0.8));
    float beat = audioBeat;
    float beatKick = beat * 0.8;

    float t = TIME * (0.4 + spin * 0.8);
    float hue = TIME * hueDrift;

    vec3 ro = vec3(0.0, 0.0, -3.2);
    vec3 rd = normalize(vec3(uv, 1.35));
    rd.xy = rot(sin(t * 0.19) * 0.15) * rd.xy;

    // Background: deep vignette, a spectral halo ring, and a floor glow
    // pool so the shards feel staged rather than floating in void.
    float bgRing = exp(-abs(length(uv) - 0.62 - bass * 0.1) * 7.0);
    vec3 col = mix(vec3(0.01, 0.008, 0.022), vec3(0.035, 0.02, 0.06), length(uv));
    col += spectrum(hue + 0.5) * bgRing * 0.13 * (0.7 + bass * 0.5);
    col += spectrum(hue + 0.1) * exp(-pow((uv.y + 0.42) / 0.18, 2.0)) * 0.12;

    // March.
    float z = 0.0;
    float hit = -1.0;
    vec3 p = ro;
    for (int i = 0; i < 48; i++) {
        p = ro + rd * z;
        float d = map(p, t, beatKick);
        if (d < 0.004) { hit = 1.0; break; }
        z += d * 0.85;
        if (z > 8.0) break;
    }

    if (hit > 0.0) {
        vec3 n = calcNormal(p, t, beatKick);
        vec3 viewDir = -rd;
        float fres = pow(1.0 - max(dot(n, viewDir), 0.0), 2.5);

        // Facet shading: crisp key light + spectral refraction shimmer.
        vec3 l = normalize(vec3(0.5, 0.8, -0.4));
        float diff = max(dot(n, l), 0.0);
        float spec = pow(max(dot(reflect(-l, n), viewDir), 0.0), 60.0);

        // Rainbow dispersion keyed to the facet normal — each face splits
        // white light differently, and highs scatter the split further.
        float facetKey = dot(n, vec3(0.577)) * (3.0 + refraction * 5.0 + high * 2.5);
        vec3 disp = spectrum(hue + facetKey);

        // Glass body: dark interior, dispersion glow that strengthens toward
        // facet edges (fresnel), plus a hot white spark on the key light.
        vec3 body = mix(vec3(0.01, 0.013, 0.03), disp * 0.16, refraction * 0.5);
        col = body;
        col += disp * pow(fres, 2.0) * (2.6 + beatKick * 1.6);
        col += vec3(1.0) * spec * 3.2;
        col += vec3(0.9, 0.95, 1.0) * pow(max(dot(reflect(-normalize(vec3(-0.6, -0.5, -0.3)), n), viewDir), 0.0), 40.0) * 0.8;
        col += disp * diff * 0.2;
        // Internal caustic shimmer: a second spectral band sliding across
        // the facet as the shard rotates.
        col += spectrum(hue + facetKey * 1.7 + t * 0.3) * pow(fres, 3.0) * 0.9;

        // Depth fog toward the back shards.
        col = mix(col, vec3(0.01, 0.008, 0.02), clamp(z / 8.0, 0.0, 0.85));
    }

    // Beat flash: prisms answer the kick with a spectral bloom at center.
    col += spectrum(hue) * exp(-length(uv) * 3.2) * beat * 0.5;

    col *= brightness;
    col = col / (col + 0.8);
    col = pow(col, vec3(0.85));
    col += (fract(sin(dot(gl_FragCoord.xy + fract(TIME), vec2(12.9898, 78.233))) * 43758.5453) - 0.5) / 255.0;

    gl_FragColor = vec4(col, 1.0);
}
