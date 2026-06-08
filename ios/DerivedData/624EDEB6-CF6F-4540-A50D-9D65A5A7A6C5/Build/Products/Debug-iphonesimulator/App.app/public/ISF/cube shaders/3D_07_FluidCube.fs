/*{
    "DESCRIPTION": "Volumetric fluid smoke inside a transparent glass cube with FBM density",
    "CREDIT": "GhostArcade",
    "ISFVSN": "2",
    "CATEGORIES": ["Generator", "3D SDF"],
    "INPUTS": [
        {"NAME": "speed", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0.0, "MAX": 3.0},
        {"NAME": "intensity", "TYPE": "float", "DEFAULT": 1.0, "MIN": 0.2, "MAX": 3.0},
        {"NAME": "camDist", "TYPE": "float", "DEFAULT": 4.0, "MIN": 2.0, "MAX": 8.0},
        {"NAME": "colorShift", "TYPE": "float", "DEFAULT": 0.0, "MIN": 0.0, "MAX": 6.28},
        {"NAME": "fluidDensity", "TYPE": "float", "DEFAULT": 1.5, "MIN": 0.2, "MAX": 4.0},
        {"NAME": "turbulence", "TYPE": "float", "DEFAULT": 1.0, "MIN": 0.1, "MAX": 3.0}
    ]
}*/

#ifdef GL_ES
precision highp float;
#endif

// 3D noise
float noise3(vec3 p) {
    vec3 i = floor(p);
    vec3 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float n = dot(i, vec3(1.0, 57.0, 113.0));
    return mix(
        mix(
            mix(fract(sin(n) * 43758.5), fract(sin(n + 1.0) * 43758.5), f.x),
            mix(fract(sin(n + 57.0) * 43758.5), fract(sin(n + 58.0) * 43758.5), f.x),
            f.y
        ),
        mix(
            mix(fract(sin(n + 113.0) * 43758.5), fract(sin(n + 114.0) * 43758.5), f.x),
            mix(fract(sin(n + 170.0) * 43758.5), fract(sin(n + 171.0) * 43758.5), f.x),
            f.y
        ),
        f.z
    );
}

// Fractal Brownian Motion
float fbm(vec3 p, float t) {
    float val = 0.0;
    float amp = 0.5;
    float freq = 1.0;
    vec3 shift = vec3(t * 0.3, t * 0.2, t * 0.15);
    for (int i = 0; i < 5; i++) {
        val += amp * noise3(p * freq + shift);
        shift *= 1.3;
        freq *= 2.02;
        amp *= 0.52;
    }
    return val;
}

// Box SDF
float sdBox(vec3 p, vec3 b) {
    vec3 q = abs(p) - b;
    return length(max(q, 0.0)) + min(max(q.x, max(q.y, q.z)), 0.0);
}

// Ray-box intersection (returns tNear, tFar)
vec2 boxIntersect(vec3 ro, vec3 rd, vec3 boxSize) {
    vec3 invRd = 1.0 / rd;
    vec3 t0 = (-boxSize - ro) * invRd;
    vec3 t1 = (boxSize - ro) * invRd;
    vec3 tmin = min(t0, t1);
    vec3 tmax = max(t0, t1);
    float tNear = max(max(tmin.x, tmin.y), tmin.z);
    float tFar = min(min(tmax.x, tmax.y), tmax.z);
    return vec2(tNear, tFar);
}

// Wireframe cube edges - distance to nearest edge
float cubeEdges(vec3 p, float size, float thickness) {
    vec3 ap = abs(p);
    // Distance to the 12 edges of a cube
    float dx = abs(ap.x - size);
    float dy = abs(ap.y - size);
    float dz = abs(ap.z - size);
    // Edge along X axis (where y and z are at size)
    float ex = max(dy, dz);
    // Edge along Y axis
    float ey = max(dx, dz);
    // Edge along Z axis
    float ez = max(dx, dy);
    float edgeDist = min(min(ex, ey), ez);
    return smoothstep(thickness + 0.02, thickness, edgeDist);
}

// HSV to RGB
vec3 hsv2rgb(vec3 c) {
    vec3 p = abs(fract(c.xxx + vec3(1.0, 2.0/3.0, 1.0/3.0)) * 6.0 - 3.0);
    return c.z * mix(vec3(1.0), clamp(p - 1.0, 0.0, 1.0), c.y);
}

void main() {
    vec2 uv = (gl_FragCoord.xy - 0.5 * RENDERSIZE) / min(RENDERSIZE.x, RENDERSIZE.y);
    float t = TIME * speed;

    // Camera orbit
    float ca = t * 0.25;
    float camY = 1.5 + sin(t * 0.15) * 0.8;
    vec3 ro = vec3(sin(ca) * camDist, camY, cos(ca) * camDist);
    vec3 ta = vec3(0.0, 0.0, 0.0);
    vec3 ww = normalize(ta - ro);
    vec3 uu = normalize(cross(ww, vec3(0.0, 1.0, 0.0)));
    vec3 vv = cross(uu, ww);
    vec3 rd = normalize(uv.x * uu + uv.y * vv + 1.8 * ww);

    vec3 col = vec3(0.01, 0.01, 0.02); // dark background

    // Box dimensions
    float boxSize = 1.2;
    vec3 bSize = vec3(boxSize);

    // Intersect ray with cube volume
    vec2 tBox = boxIntersect(ro, rd, bSize);

    if (tBox.x < tBox.y && tBox.y > 0.0) {
        float tStart = max(tBox.x, 0.0);
        float tEnd = tBox.y;

        // Volume ray marching
        int numSteps = 48;
        float stepSize = (tEnd - tStart) / float(numSteps);

        vec3 accumColor = vec3(0.0);
        float accumAlpha = 0.0;

        float audioBoost = 1.0 + audioBass * 0.5 + audioMid * 0.3;

        for (int i = 0; i < 48; i++) {
            if (accumAlpha > 0.95) break;

            float fi = float(i);
            float tCur = tStart + fi * stepSize;
            vec3 p = ro + rd * tCur;

            // Normalize position to [-1,1] within cube
            vec3 np = p / boxSize;

            // FBM noise density
            vec3 noisePos = np * 2.5 * turbulence;
            float density = fbm(noisePos, t);

            // Rising fluid motion
            density += fbm(noisePos + vec3(0.0, -t * 0.5, 0.0), t * 0.7) * 0.5;

            // Shape: more dense toward center-bottom, less at edges
            float edgeFade = 1.0 - smoothstep(0.5, 1.0, length(np));
            float bottomBias = smoothstep(-1.0, 0.3, -np.y);
            density = density * edgeFade * (0.5 + bottomBias * 0.5);

            // Threshold and scale density
            density = max(0.0, density - 0.35) * fluidDensity * audioBoost;

            if (density > 0.001) {
                // Beer's law absorption coloring
                float absorption = density * stepSize * 3.0;

                // Blue/cyan fluid color with position variation
                float hue = 0.55 + np.y * 0.05 + colorShift / 6.28;
                hue = fract(hue);
                vec3 fluidCol = hsv2rgb(vec3(hue, 0.6, 0.9));

                // Lighter in thin areas, deeper color in thick areas
                fluidCol = mix(vec3(0.7, 0.85, 1.0), fluidCol, clamp(absorption * 2.0, 0.0, 1.0));

                // Simple lighting within volume
                float lightAmount = 0.4 + 0.6 * smoothstep(-0.5, 1.0, np.y);
                fluidCol *= lightAmount * intensity;

                // Accumulate (front-to-back compositing)
                float alpha = 1.0 - exp(-absorption);
                accumColor += fluidCol * alpha * (1.0 - accumAlpha);
                accumAlpha += alpha * (1.0 - accumAlpha);
            }
        }

        col = mix(col, accumColor, accumAlpha);

        // Wireframe cube overlay
        // Sample along the entry/exit points for edge glow
        vec3 pEntry = ro + rd * tStart;
        vec3 pExit = ro + rd * tEnd;

        float edge1 = cubeEdges(pEntry, boxSize, 0.04);
        float edge2 = cubeEdges(pExit, boxSize, 0.04);
        float edgeGlow = max(edge1, edge2 * (1.0 - accumAlpha * 0.7));

        vec3 edgeColor = vec3(0.4, 0.6, 0.8);
        col += edgeColor * edgeGlow * 0.3;
    }

    // Check cube edges even for rays that miss the volume (edge-on view)
    if (tBox.x < tBox.y + 0.1) {
        float tEdge = max(tBox.x, 0.0);
        vec3 pEdge = ro + rd * tEdge;
        float edgeOnly = cubeEdges(pEdge, boxSize, 0.03);
        col += vec3(0.3, 0.5, 0.7) * edgeOnly * 0.15;
    }

    // Vignette
    vec2 vuv = gl_FragCoord.xy / RENDERSIZE;
    float vig = 1.0 - 0.35 * length((vuv - 0.5) * 1.6);
    col *= vig;

    // Tone mapping
    col = col / (col + vec3(1.0));
    col = pow(col, vec3(0.95));

    gl_FragColor = vec4(col, 1.0);
}
