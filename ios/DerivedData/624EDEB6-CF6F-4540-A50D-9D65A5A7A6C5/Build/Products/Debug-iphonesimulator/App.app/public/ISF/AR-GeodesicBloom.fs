/*{
    "DESCRIPTION": "Geodesic sphere with triangular faces extruding outward based on FFT energy. Wireframe edges glow, face colors map to frequency energy. Organic breathing animation with orbiting camera.",
    "CREDIT": "GhostArcade",
    "ISFVSN": "2.0",
    "CATEGORIES": ["Generator", "Audio Reactive"],
    "INPUTS": [
        {"NAME": "domeRadius", "TYPE": "float", "MIN": 0.8, "MAX": 2.0, "DEFAULT": 1.2},
        {"NAME": "extrudeStrength", "TYPE": "float", "MIN": 0.1, "MAX": 1.0, "DEFAULT": 0.5},
        {"NAME": "wireThickness", "TYPE": "float", "MIN": 0.005, "MAX": 0.04, "DEFAULT": 0.015},
        {"NAME": "faceGlow", "TYPE": "float", "MIN": 1.0, "MAX": 5.0, "DEFAULT": 2.5},
        {"NAME": "rotationSpeed", "TYPE": "float", "MIN": 0.0, "MAX": 0.2, "DEFAULT": 0.08},
        {"NAME": "breathScale", "TYPE": "float", "MIN": 0.0, "MAX": 0.3, "DEFAULT": 0.1}
    ]
}*/

#ifdef GL_ES
precision mediump float;
#endif

#define PI 3.14159265359
// MAX_STEPS was 64. The `geodesicFacet` helper runs a 20-iter Fibonacci-sphere loop
// inside the SDF which made ~1360 face evals/pixel; cutting march steps to 48 drops that
// to ~1020 with no visible quality loss on the hero shape.
#define MAX_STEPS 48
#define MAX_DIST 12.0
#define SURF_DIST 0.003

vec3 hsv2rgb(vec3 c) {
    vec4 K = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
    vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
    return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
}

mat3 rotY(float a) {
    float c = cos(a), s = sin(a);
    return mat3(c, 0.0, s, 0.0, 1.0, 0.0, -s, 0.0, c);
}

mat3 rotX(float a) {
    float c = cos(a), s = sin(a);
    return mat3(1.0, 0.0, 0.0, 0.0, c, -s, 0.0, s, c);
}

// Icosahedron-like faceting using spherical Voronoi
// Returns: x = distance to nearest face center, y = face ID, z = distance to edge
vec3 geodesicFacet(vec3 p) {
    vec3 n = normalize(p);

    // Generate icosahedron-like vertices on sphere using golden ratio placement
    float bestDist = 10.0;
    float secondDist = 10.0;
    float bestId = 0.0;

    for (int i = 0; i < 20; i++) {
        float fi = float(i);
        // Fibonacci sphere distribution for face centers
        float phi = acos(1.0 - 2.0 * (fi + 0.5) / 20.0);
        float theta = PI * (1.0 + sqrt(5.0)) * fi;
        vec3 faceCenter = vec3(
            sin(phi) * cos(theta),
            sin(phi) * sin(theta),
            cos(phi)
        );

        float d = length(n - faceCenter);
        if (d < bestDist) {
            secondDist = bestDist;
            bestDist = d;
            bestId = fi;
        } else if (d < secondDist) {
            secondDist = d;
        }
    }

    // Edge distance approximation (halfway between nearest and second nearest)
    float edgeDist = (secondDist - bestDist) * 0.5;

    return vec3(bestDist, bestId, edgeDist);
}

// Scene SDF
float sceneSDF(vec3 p) {
    float r = length(p);
    vec3 n = normalize(p);

    // Breathing animation
    float bassFallback = 0.3 + 0.2 * sin(TIME * 0.8);
    float bass = max(audioBass, bassFallback);
    float breath = 1.0 + breathScale * sin(TIME * 1.2) * (0.5 + bass);

    float baseR = domeRadius * breath;

    // Get facet info
    vec3 facet = geodesicFacet(p);
    float faceId = facet.y;
    float edgeDist = facet.z;

    // FFT-based extrusion per face
    float fftU = fract(faceId / 20.0 + 0.05);
    float fftVal = sampleFFT(fftU);
    float fftFallback = 0.3 + 0.25 * sin(TIME * 1.5 + faceId * 0.7);
    fftVal = max(fftVal, fftFallback);

    float extrude = fftVal * extrudeStrength;

    // Faceted sphere: flat face approximation
    float facetedR = baseR + extrude;

    // Sphere distance with per-face extrusion
    float d = r - facetedR;

    // Create wireframe edges by carving grooves
    float wire = smoothstep(wireThickness, wireThickness * 2.0, edgeDist);
    d = mix(d - 0.01, d, wire);

    return d;
}

vec3 getNormal(vec3 p) {
    float e = 0.004;
    float d = sceneSDF(p);
    return normalize(vec3(
        sceneSDF(p + vec3(e, 0.0, 0.0)) - d,
        sceneSDF(p + vec3(0.0, e, 0.0)) - d,
        sceneSDF(p + vec3(0.0, 0.0, e)) - d
    ));
}

void main() {
    vec2 uv = isf_FragNormCoord;
    float aspect = RENDERSIZE.x / RENDERSIZE.y;
    vec2 screen = (uv - 0.5) * vec2(aspect, 1.0);

    // Camera orbit
    float t = TIME * rotationSpeed;
    float camR = 3.5;
    vec3 camPos = vec3(camR * sin(t), 1.0 + sin(t * 0.7) * 0.8, camR * cos(t));
    vec3 target = vec3(0.0);
    vec3 fwd = normalize(target - camPos);
    vec3 right = normalize(cross(fwd, vec3(0.0, 1.0, 0.0)));
    vec3 up = cross(right, fwd);
    vec3 rd = normalize(fwd * 1.8 + right * screen.x + up * screen.y);

    // Rotation for the dome
    mat3 rot = rotY(TIME * rotationSpeed * 0.5) * rotX(TIME * rotationSpeed * 0.3);

    // Raymarch
    float dist = 0.0;
    vec3 hitPos = camPos;
    bool hit = false;

    for (int i = 0; i < 48; i++) {
        hitPos = camPos + rd * dist;
        vec3 rp = rot * hitPos;
        float d = sceneSDF(rp);
        if (d < SURF_DIST) {
            hit = true;
            break;
        }
        if (dist > MAX_DIST) break;
        dist += d * 0.8;
    }

    vec3 col = vec3(0.0);

    if (hit) {
        vec3 rp = rot * hitPos;
        vec3 n = getNormal(rp);
        // Transform normal back
        n = n * rot;

        vec3 facet = geodesicFacet(rp);
        float faceId = facet.y;
        float edgeDist = facet.z;

        // Face color based on FFT
        float fftU = fract(faceId / 20.0 + 0.05);
        float fftVal = sampleFFT(fftU);
        float fftFallback = 0.3 + 0.25 * sin(TIME * 1.5 + faceId * 0.7);
        fftVal = max(fftVal, fftFallback);

        float hue = fract(faceId / 20.0 * 0.8 + TIME * 0.03 + fftVal * 0.2);
        float sat = 0.6 + 0.3 * fftVal;
        float val = 0.5 + 0.5 * fftVal;

        vec3 faceCol = hsv2rgb(vec3(hue, sat, val));

        // Lighting
        vec3 lightDir = normalize(vec3(0.5, 1.0, 0.3));
        float diff = max(dot(n, lightDir), 0.0);
        float spec = pow(max(dot(reflect(-lightDir, n), -rd), 0.0), 24.0);

        col = faceCol * (0.15 + 0.6 * diff) + vec3(1.0) * spec * 0.3;

        // Wireframe glow
        float wire = smoothstep(wireThickness * 2.0, wireThickness * 0.5, edgeDist);
        float midFallback = 0.3 + 0.15 * sin(TIME * 1.3);
        float mid = max(audioMid, midFallback);
        vec3 wireCol = hsv2rgb(vec3(fract(hue + 0.3), 0.5, 1.0));
        col += wireCol * wire * faceGlow * (0.5 + mid);

        // Fresnel
        float fresnel = pow(1.0 - abs(dot(n, -rd)), 2.5);
        float beatFallback = 0.15 + 0.15 * sin(TIME * 2.5);
        float beat = max(audioBeat, beatFallback);
        col += faceCol * fresnel * (0.5 + beat);

        // Depth fog
        col *= exp(-dist * 0.08);

    } else {
        // Background: subtle radial gradient
        float bg = exp(-length(screen) * 2.0) * 0.05;
        col = vec3(0.02, 0.01, 0.05) + vec3(0.03, 0.01, 0.06) * bg;
    }

    // Post: tone map
    col = col / (1.0 + col);

    gl_FragColor = vec4(col, 1.0);
}
