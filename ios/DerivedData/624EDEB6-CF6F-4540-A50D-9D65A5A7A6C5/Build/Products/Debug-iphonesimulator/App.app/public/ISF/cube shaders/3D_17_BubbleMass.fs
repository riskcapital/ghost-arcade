/*{
    "DESCRIPTION": "Cluster of translucent iridescent bubbles with Fresnel effect and thin-film interference coloring, layered transparency",
    "CREDIT": "GhostArcade",
    "ISFVSN": "2",
    "CATEGORIES": ["Generator", "3D SDF"],
    "INPUTS": [
        {"NAME": "speed", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0.0, "MAX": 3.0},
        {"NAME": "intensity", "TYPE": "float", "DEFAULT": 1.0, "MIN": 0.2, "MAX": 3.0},
        {"NAME": "camDist", "TYPE": "float", "DEFAULT": 5.0, "MIN": 2.0, "MAX": 12.0},
        {"NAME": "colorShift", "TYPE": "float", "DEFAULT": 0.0, "MIN": 0.0, "MAX": 6.28},
        {"NAME": "bubbleSize", "TYPE": "float", "DEFAULT": 0.6, "MIN": 0.1, "MAX": 1.5},
        {"NAME": "transparency", "TYPE": "float", "DEFAULT": 0.7, "MIN": 0.1, "MAX": 1.0}
    ]
}*/

#ifdef GL_ES
precision highp float;
#endif

// --- Hash ---
float hash31(vec3 p) {
    p = fract(p * vec3(443.897, 441.423, 437.195));
    p += dot(p, p.yzx + 19.19);
    return fract((p.x + p.y) * p.z);
}

vec3 hash33(vec3 p) {
    return vec3(hash31(p), hash31(p + 71.7), hash31(p + 143.3));
}

// --- Thin-film interference approximation ---
vec3 thinFilmColor(float thickness, float shift) {
    // Approximate spectral interference bands
    float t = thickness * 6.28 + shift;
    vec3 col;
    col.r = 0.5 + 0.5 * sin(t);
    col.g = 0.5 + 0.5 * sin(t + 2.094);
    col.b = 0.5 + 0.5 * sin(t + 4.188);
    return col;
}

// --- Bubble positions (procedural, not array) ---
vec3 bubblePos(int idx) {
    float fi = float(idx);
    float angle1 = fi * 2.399 + 0.5;  // golden angle spacing
    float angle2 = fi * 1.7 + 0.3;
    float r = 1.2 + 0.8 * sin(fi * 0.73);
    return vec3(
        r * cos(angle1) * sin(angle2),
        r * sin(angle1) * 0.7,
        r * cos(angle2)
    );
}

float bubbleRadius(int idx) {
    float fi = float(idx);
    return bubbleSize * (0.5 + 0.5 * fract(fi * 0.618 + 0.3));
}

// --- Scene: find nearest bubble ---
float gBubbleIdx;

float map(vec3 p) {
    float t = TIME * speed;
    float d = 100.0;
    gBubbleIdx = 0.0;

    for (int i = 0; i < 12; i++) {
        float fi = float(i);
        vec3 center = bubblePos(i);
        // Gentle floating motion
        center.y += sin(t * 0.5 + fi * 1.3) * 0.3;
        center.x += cos(t * 0.4 + fi * 0.9) * 0.15;
        center.z += sin(t * 0.3 + fi * 1.7) * 0.15;

        float r = bubbleRadius(i) * (1.0 + audioBeat * 0.15);
        float sd = length(p - center) - r;

        // Use shell thickness for bubble wall
        float shell = abs(sd) - 0.02;

        if (shell < d) {
            d = shell;
            gBubbleIdx = fi;
        }
    }
    return d;
}

// --- Normal ---
vec3 calcNormal(vec3 p) {
    vec2 e = vec2(0.001, 0.0);
    return normalize(vec3(
        map(p + e.xyy) - map(p - e.xyy),
        map(p + e.yxy) - map(p - e.yxy),
        map(p + e.yyx) - map(p - e.yyx)
    ));
}

// --- Fresnel (Schlick approximation) ---
float fresnel(vec3 n, vec3 rd, float f0) {
    float dt = 1.0 - max(dot(n, -rd), 0.0);
    return f0 + (1.0 - f0) * dt * dt * dt * dt * dt;
}

void main() {
    vec2 uv = (gl_FragCoord.xy - 0.5 * RENDERSIZE) / RENDERSIZE.y;
    float t = TIME * speed;

    // Camera orbit
    float camAngle = t * 0.35;
    float camH = sin(t * 0.2) * 1.0;
    vec3 ro = vec3(
        cos(camAngle) * camDist,
        camH + 0.5,
        sin(camAngle) * camDist
    );
    vec3 target = vec3(0.0, 0.0, 0.0);

    vec3 fwd = normalize(target - ro);
    vec3 right = normalize(cross(fwd, vec3(0.0, 1.0, 0.0)));
    vec3 up = cross(right, fwd);
    vec3 rd = normalize(fwd + uv.x * right + uv.y * up);

    // Bright gradient background
    vec3 bgTop = vec3(0.9, 0.92, 0.98);
    vec3 bgBot = vec3(0.95, 0.93, 0.9);
    vec3 bgColor = mix(bgBot, bgTop, uv.y + 0.5);

    // Accumulate color through multiple bubble layers
    vec3 col = vec3(0.0);
    float alpha = 0.0;
    float dist = 0.0;
    int hitCount = 0;

    for (int step = 0; step < 100; step++) {
        vec3 p = ro + rd * dist;
        float d = map(p);

        if (d < 0.002) {
            float bubIdx = gBubbleIdx;
            vec3 n = calcNormal(p);

            // Fresnel: edges more opaque
            float fres = fresnel(n, rd, 0.04);

            // Thin-film iridescence based on angle and bubble index
            float filmThickness = dot(n, -rd) * 2.0 + bubIdx * 0.7;
            vec3 iridescent = thinFilmColor(filmThickness, colorShift);

            // Reflected environment (fake)
            vec3 reflDir = reflect(rd, n);
            float envBright = 0.5 + 0.5 * reflDir.y;
            vec3 envCol = mix(vec3(0.85, 0.88, 0.95), vec3(0.95, 0.95, 1.0), envBright);

            // Combine: iridescent color with Fresnel-weighted reflection
            vec3 bubbleCol = mix(iridescent * 0.6, envCol, fres);

            // Specular highlight
            vec3 lightDir = normalize(vec3(2.0, 4.0, 1.0));
            vec3 halfDir = normalize(lightDir - rd);
            float spec = pow(max(dot(n, halfDir), 0.0), 64.0) * 0.8;
            bubbleCol += vec3(spec);

            // Layer this bubble onto accumulated color
            float layerAlpha = fres * (1.0 - transparency * 0.7) + 0.1;
            layerAlpha *= intensity * 0.8;
            col = col * (1.0 - layerAlpha) + bubbleCol * layerAlpha;
            alpha = alpha + layerAlpha * (1.0 - alpha);

            hitCount++;
            if (hitCount >= 5) break;

            // Push ray past this surface
            dist += 0.05;
            continue;
        }

        if (dist > 30.0) break;
        dist += d;
    }

    // Composite over background
    col = col + bgColor * (1.0 - alpha);

    // Audio-reactive shimmer
    float shimmer = 1.0 + audioHigh * 0.15 * intensity;
    col *= shimmer;

    // Soft vignette
    float vignette = 1.0 - 0.2 * length(uv);
    col *= vignette;

    col = clamp(col, 0.0, 1.0);
    gl_FragColor = vec4(col, 1.0);
}
