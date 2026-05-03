/*{
    "DESCRIPTION": "Voxelized terrain landscape with Minecraft-like stepped blocks, height-based coloring, and audio-reactive terrain pulse",
    "CREDIT": "GhostArcade",
    "ISFVSN": "2",
    "CATEGORIES": ["Generator", "3D SDF"],
    "INPUTS": [
        {"NAME": "speed", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0.0, "MAX": 3.0},
        {"NAME": "intensity", "TYPE": "float", "DEFAULT": 1.0, "MIN": 0.2, "MAX": 3.0},
        {"NAME": "camDist", "TYPE": "float", "DEFAULT": 6.0, "MIN": 2.0, "MAX": 15.0},
        {"NAME": "colorShift", "TYPE": "float", "DEFAULT": 0.0, "MIN": 0.0, "MAX": 6.28},
        {"NAME": "terrainHeight", "TYPE": "float", "DEFAULT": 2.0, "MIN": 0.5, "MAX": 5.0},
        {"NAME": "voxelSize", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0.1, "MAX": 1.5}
    ]
}*/

#ifdef GL_ES
precision highp float;
#endif

// --- Hash functions ---
float hash21(vec2 p) {
    p = fract(p * vec2(443.897, 441.423));
    p += dot(p, p + 19.19);
    return fract(p.x * p.y);
}

float hash31(vec3 p) {
    p = fract(p * vec3(443.897, 441.423, 437.195));
    p += dot(p, p.yzx + 19.19);
    return fract((p.x + p.y) * p.z);
}

// --- Value noise ---
float noise2D(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float a = hash21(i);
    float b = hash21(i + vec2(1.0, 0.0));
    float c = hash21(i + vec2(0.0, 1.0));
    float d = hash21(i + vec2(1.0, 1.0));
    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

// --- FBM noise for terrain ---
float fbm(vec2 p) {
    float val = 0.0;
    float amp = 0.5;
    for (int i = 0; i < 4; i++) {
        val += amp * noise2D(p);
        p *= 2.0;
        amp *= 0.5;
    }
    return val;
}

// --- Terrain height at xz, quantized to voxel steps ---
float terrainAt(vec2 xz) {
    float n = fbm(xz * 0.3);
    float h = n * terrainHeight * (1.0 + audioBeat * 0.5 * intensity);
    // Quantize to voxel grid
    h = floor(h / voxelSize) * voxelSize;
    return h;
}

// --- SDF box ---
float sdBox(vec3 p, vec3 b) {
    vec3 d = abs(p) - b;
    return min(max(d.x, max(d.y, d.z)), 0.0) + length(max(d, 0.0));
}

// --- Scene map: voxel terrain ---
vec3 gVoxelId;

float map(vec3 p) {
    // Quantize xz to voxel grid
    float vs = voxelSize;
    vec2 cellXZ = floor(p.xz / vs) * vs + vs * 0.5;
    float h = terrainAt(cellXZ);

    // Column of voxels from ground to height
    // Represent as a single tall box from 0 to h
    float halfH = max(h * 0.5, vs * 0.5);
    vec3 boxCenter = vec3(cellXZ.x, halfH, cellXZ.y);
    vec3 localP = p - boxCenter;
    // Snap X and Z
    localP.x = p.x - cellXZ.x;
    localP.z = p.z - cellXZ.y;

    float d = sdBox(localP, vec3(vs * 0.48, halfH, vs * 0.48));

    gVoxelId = vec3(cellXZ.x, h, cellXZ.y);
    return d;
}

// --- Normal ---
vec3 calcNormal(vec3 p) {
    vec2 e = vec2(0.002, 0.0);
    return normalize(vec3(
        map(p + e.xyy) - map(p - e.xyy),
        map(p + e.yxy) - map(p - e.yxy),
        map(p + e.yyx) - map(p - e.yyx)
    ));
}

// --- Terrain color by height ---
vec3 terrainColor(float h, float maxH, float shift) {
    float t = clamp(h / max(maxH, 0.01), 0.0, 1.0);
    // Green -> brown -> white
    vec3 green = vec3(0.25, 0.6, 0.2);
    vec3 brown = vec3(0.55, 0.35, 0.15);
    vec3 snow = vec3(0.95, 0.95, 0.97);

    vec3 col;
    if (t < 0.4) {
        col = mix(green, brown, t / 0.4);
    } else {
        col = mix(brown, snow, (t - 0.4) / 0.6);
    }

    // Apply color shift as hue rotation
    float cs = cos(shift);
    float ss = sin(shift);
    float r = col.r * cs - col.g * ss;
    float g = col.r * ss + col.g * cs;
    col.r = clamp(r, 0.0, 1.0);
    col.g = clamp(g, 0.0, 1.0);

    return col;
}

void main() {
    vec2 uv = (gl_FragCoord.xy - 0.5 * RENDERSIZE) / RENDERSIZE.y;
    float t = TIME * speed;

    // Camera orbits over the terrain
    float camAngle = t * 0.3;
    float camY = camDist * 0.6 + sin(t * 0.15) * 1.5;
    vec3 ro = vec3(
        cos(camAngle) * camDist,
        camY,
        sin(camAngle) * camDist
    );
    vec3 target = vec3(0.0, terrainHeight * 0.3, 0.0);

    // Camera matrix
    vec3 fwd = normalize(target - ro);
    vec3 right = normalize(cross(fwd, vec3(0.0, 1.0, 0.0)));
    vec3 up = cross(right, fwd);
    vec3 rd = normalize(fwd + uv.x * right + uv.y * up);

    // Sky gradient background
    vec3 skyTop = vec3(0.4, 0.6, 0.9);
    vec3 skyBottom = vec3(0.7, 0.8, 0.95);
    vec3 bgColor = mix(skyBottom, skyTop, max(uv.y + 0.3, 0.0));

    vec3 col = bgColor;

    // Ray march
    float dist = 0.0;
    bool hit = false;
    for (int i = 0; i < 80; i++) {
        vec3 p = ro + rd * dist;
        float d = map(p);
        if (d < 0.002) {
            hit = true;
            break;
        }
        if (dist > 40.0) break;
        dist += d;
    }

    if (hit) {
        vec3 p = ro + rd * dist;
        map(p);
        vec3 vid = gVoxelId;

        vec3 n = calcNormal(p);

        float maxH = terrainHeight * (1.0 + audioBeat * 0.5 * intensity);
        vec3 matCol = terrainColor(vid.y, maxH, colorShift);

        // Top face gets slightly different shade
        if (n.y > 0.7 && vid.y > maxH * 0.65) {
            matCol = mix(matCol, vec3(0.95, 0.95, 0.97), 0.5);
        }

        // Directional light
        vec3 lightDir = normalize(vec3(2.0, 5.0, 3.0));
        float diff = max(dot(n, lightDir), 0.0);
        float ambient = 0.3;

        // Subtle voxel edge darkening
        vec3 cellLocal = fract(p / voxelSize);
        float edgeDist = min(min(cellLocal.x, 1.0 - cellLocal.x),
                           min(cellLocal.z, 1.0 - cellLocal.z));
        float edgeFactor = smoothstep(0.0, 0.08, edgeDist);

        float lighting = ambient + diff * 0.7;
        col = matCol * lighting * edgeFactor * intensity;

        // Fog
        float fog = 1.0 - exp(-0.003 * dist * dist);
        col = mix(col, bgColor, fog);
    }

    // Audio-reactive vignette
    float vignette = 1.0 - 0.25 * length(uv) * (1.0 + audioBass * 0.4);
    col *= vignette;

    col = clamp(col, 0.0, 1.0);
    gl_FragColor = vec4(col, 1.0);
}
