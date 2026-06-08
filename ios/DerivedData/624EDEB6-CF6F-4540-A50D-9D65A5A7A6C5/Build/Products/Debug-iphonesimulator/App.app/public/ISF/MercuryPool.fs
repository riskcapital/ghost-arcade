/*{
    "CREDIT": "GhostArcade",
    "DESCRIPTION": "Rippling mercury pool with caustic reflections",
    "ISFVSN": "2.0",
    "CATEGORIES": ["Generator"],
    "INPUTS": [
        {"NAME": "rippleSpeed", "TYPE": "float", "MIN": 0.1, "MAX": 2.0, "DEFAULT": 0.5},
        {"NAME": "rippleScale", "TYPE": "float", "MIN": 1.0, "MAX": 10.0, "DEFAULT": 4.0},
        {"NAME": "turbulence", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.4},
        {"NAME": "reflectionSharp", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.7},
        {"NAME": "tint", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.0}
    ]
}*/

#ifdef GL_ES
precision highp float;
#endif

#define PI 3.14159265359

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

// Ripple function
float ripple(vec2 p, vec2 center, float t, float freq) {
    float d = length(p - center);
    return sin(d * freq - t * 5.0) * exp(-d * 2.0);
}

vec3 hsv2rgb(vec3 c) {
    vec4 K = vec4(1.0, 2.0/3.0, 1.0/3.0, 3.0);
    vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
    return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
}

void main() {
    vec2 uv = (gl_FragCoord.xy - 0.5 * RENDERSIZE) / RENDERSIZE.y;
    float t = TIME * rippleSpeed;

    vec2 p = uv * rippleScale;

    // Multiple ripple sources
    float height = 0.0;

    // Central ripples
    height += ripple(p, vec2(0.0), t, 10.0) * 0.3;
    height += ripple(p, vec2(sin(t * 0.3) * 0.5, cos(t * 0.4) * 0.5), t * 1.2, 12.0) * 0.2;
    height += ripple(p, vec2(cos(t * 0.5) * 0.7, sin(t * 0.6) * 0.4), t * 0.8, 8.0) * 0.25;

    // Add turbulent noise
    float turb = noise(p * 3.0 + t) * 0.5 + noise(p * 6.0 - t * 0.5) * 0.25;
    height += (turb - 0.375) * turbulence;

    // Calculate normals from height
    float eps = 0.02;

    float hL = ripple(p - vec2(eps, 0.0), vec2(0.0), t, 10.0) * 0.3;
    float hR = ripple(p + vec2(eps, 0.0), vec2(0.0), t, 10.0) * 0.3;
    float hD = ripple(p - vec2(0.0, eps), vec2(0.0), t, 10.0) * 0.3;
    float hU = ripple(p + vec2(0.0, eps), vec2(0.0), t, 10.0) * 0.3;

    hL += (noise((p - vec2(eps, 0.0)) * 3.0 + t) - 0.5) * turbulence;
    hR += (noise((p + vec2(eps, 0.0)) * 3.0 + t) - 0.5) * turbulence;
    hD += (noise((p - vec2(0.0, eps)) * 3.0 + t) - 0.5) * turbulence;
    hU += (noise((p + vec2(0.0, eps)) * 3.0 + t) - 0.5) * turbulence;

    vec3 normal = normalize(vec3(hL - hR, hD - hU, eps * 5.0));

    // Lighting
    vec3 lightDir = normalize(vec3(0.3, 0.5, 1.0));
    vec3 viewDir = vec3(0.0, 0.0, 1.0);
    vec3 reflectDir = reflect(-lightDir, normal);

    float diffuse = max(dot(normal, lightDir), 0.0);
    float specPower = mix(8.0, 64.0, reflectionSharp);
    float specular = pow(max(dot(reflectDir, viewDir), 0.0), specPower);

    // Fresnel
    float fresnel = pow(1.0 - max(dot(normal, viewDir), 0.0), 3.0);

    // Mercury base color
    vec3 mercuryColor = vec3(0.85, 0.85, 0.9);
    if (tint > 0.01) {
        mercuryColor = mix(mercuryColor, hsv2rgb(vec3(tint, 0.3, 0.9)), 0.5);
    }

    // Caustics pattern
    float caustic = noise(p * 5.0 + normal.xy * 3.0 + t * 0.5);
    caustic = pow(caustic, 2.0) * 2.0;

    vec3 col = mercuryColor * (0.3 + diffuse * 0.3);
    col += vec3(1.0) * specular;
    col += mercuryColor * caustic * 0.2;
    col += mercuryColor * fresnel * 0.4;

    // Subtle color variation
    float colorVar = noise(uv * 2.0 + t * 0.1);
    col *= 0.9 + colorVar * 0.2;

    // Highlight streaks
    float streak = pow(max(0.0, height), 3.0);
    col += vec3(1.0, 1.0, 0.95) * streak * 0.5;

    gl_FragColor = vec4(col, 1.0);
}
