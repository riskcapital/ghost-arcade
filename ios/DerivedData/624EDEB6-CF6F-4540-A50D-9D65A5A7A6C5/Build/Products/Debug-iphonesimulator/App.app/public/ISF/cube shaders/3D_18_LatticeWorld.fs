/*{
    "DESCRIPTION": "3D lattice grid structure with spheres at intersection nodes, metallic silver finish, domain repetition for infinite grid",
    "CREDIT": "GhostArcade",
    "ISFVSN": "2",
    "CATEGORIES": ["Generator", "3D SDF"],
    "INPUTS": [
        {"NAME": "speed", "TYPE": "float", "DEFAULT": 0.3, "MIN": 0.0, "MAX": 3.0},
        {"NAME": "intensity", "TYPE": "float", "DEFAULT": 1.0, "MIN": 0.2, "MAX": 3.0},
        {"NAME": "camDist", "TYPE": "float", "DEFAULT": 6.0, "MIN": 2.0, "MAX": 15.0},
        {"NAME": "colorShift", "TYPE": "float", "DEFAULT": 0.0, "MIN": 0.0, "MAX": 6.28},
        {"NAME": "gridSpacing", "TYPE": "float", "DEFAULT": 2.0, "MIN": 0.5, "MAX": 5.0},
        {"NAME": "nodeSize", "TYPE": "float", "DEFAULT": 0.2, "MIN": 0.05, "MAX": 0.8}
    ]
}*/

#ifdef GL_ES
precision highp float;
#endif

// --- Cylinder SDFs along each axis ---
float sdCylX(vec3 p, float r) {
    return length(p.yz) - r;
}

float sdCylY(vec3 p, float r) {
    return length(p.xz) - r;
}

float sdCylZ(vec3 p, float r) {
    return length(p.xy) - r;
}

// --- Sphere SDF ---
float sdSphere(vec3 p, float r) {
    return length(p) - r;
}

// --- Scene map with domain repetition ---
float gIsNode;  // 1.0 if we hit a node sphere, 0.0 for strut

float map(vec3 p) {
    float sp = gridSpacing;
    float strutR = nodeSize * 0.25;
    float nodePulse = 1.0 + audioBeat * 0.3 * intensity;
    float nodeR = nodeSize * nodePulse;

    // Domain repetition: snap to nearest grid cell
    vec3 q = p - sp * floor(p / sp + 0.5);

    // Three perpendicular cylinder struts
    float cx = sdCylX(q, strutR);
    float cy = sdCylY(q, strutR);
    float cz = sdCylZ(q, strutR);
    float struts = min(min(cx, cy), cz);

    // Sphere node at grid intersection
    float node = sdSphere(q, nodeR);

    // Bound by distance from origin for finite rendering
    float boundDist = length(p) - sp * 4.5;

    float d;
    if (node < struts) {
        d = node;
        gIsNode = 1.0;
    } else {
        d = struts;
        gIsNode = 0.0;
    }

    // Clip to bounding sphere
    d = max(d, boundDist);

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

// --- Ambient Occlusion ---
float calcAO(vec3 p, vec3 n) {
    float ao = 0.0;
    float scale = 1.0;
    for (int i = 0; i < 5; i++) {
        float fi = float(i);
        float h = 0.02 + 0.15 * fi;
        float d = map(p + n * h);
        ao += (h - d) * scale;
        scale *= 0.6;
    }
    return clamp(1.0 - 2.5 * ao, 0.0, 1.0);
}

// --- Metallic shading ---
vec3 metallicShade(vec3 n, vec3 rd, vec3 lightDir, vec3 baseCol, float roughness) {
    // Diffuse
    float diff = max(dot(n, lightDir), 0.0);

    // Specular (Blinn-Phong)
    vec3 halfDir = normalize(lightDir - rd);
    float specPow = mix(256.0, 16.0, roughness);
    float spec = pow(max(dot(n, halfDir), 0.0), specPow);

    // Fresnel for metallic look
    float fres = 1.0 - max(dot(n, -rd), 0.0);
    fres = fres * fres * fres;
    float metalFres = 0.5 + 0.5 * fres;

    vec3 col = baseCol * (0.15 + diff * 0.6);
    col += vec3(spec * metalFres * 0.8);

    // Rim reflection
    col += baseCol * fres * 0.3;

    return col;
}

void main() {
    vec2 uv = (gl_FragCoord.xy - 0.5 * RENDERSIZE) / RENDERSIZE.y;
    float t = TIME * speed;

    // Camera orbit
    float camAngle = t * 0.3;
    float camH = sin(t * 0.15) * 2.0 + 1.5;
    vec3 ro = vec3(
        cos(camAngle) * camDist,
        camH,
        sin(camAngle) * camDist
    );
    vec3 target = vec3(0.0, 0.0, 0.0);

    vec3 fwd = normalize(target - ro);
    vec3 right = normalize(cross(fwd, vec3(0.0, 1.0, 0.0)));
    vec3 up = cross(right, fwd);
    vec3 rd = normalize(fwd + uv.x * right + uv.y * up);

    // Dark gradient background
    vec3 bgTop = vec3(0.15, 0.18, 0.25);
    vec3 bgBot = vec3(0.05, 0.05, 0.08);
    vec3 bgColor = mix(bgBot, bgTop, uv.y + 0.5);

    vec3 col = bgColor;

    // Ray march
    float dist = 0.0;
    bool hit = false;
    for (int i = 0; i < 80; i++) {
        vec3 p = ro + rd * dist;
        float d = map(p);
        if (d < 0.001) {
            hit = true;
            break;
        }
        if (dist > 35.0) break;
        dist += d;
    }

    if (hit) {
        vec3 p = ro + rd * dist;
        map(p);  // re-eval for gIsNode
        float isNode = gIsNode;

        vec3 n = calcNormal(p);
        float ao = calcAO(p, n);

        // Base metallic silver color
        vec3 baseCol = vec3(0.78, 0.78, 0.82);

        // Slight color variation for nodes
        if (isNode > 0.5) {
            // Nodes get a subtle tint from colorShift
            float cs = cos(colorShift);
            float ss = sin(colorShift);
            baseCol.r = 0.78 * cs - 0.78 * ss * 0.1 + 0.78;
            baseCol.g = 0.78 + 0.1 * ss;
            baseCol = clamp(baseCol, 0.0, 1.0);
        }

        // Two lights for dramatic look
        vec3 light1 = normalize(vec3(3.0, 5.0, 2.0));
        vec3 light2 = normalize(vec3(-2.0, 2.0, -4.0));

        float roughness = isNode > 0.5 ? 0.15 : 0.4;
        vec3 shade1 = metallicShade(n, rd, light1, baseCol, roughness);
        vec3 shade2 = metallicShade(n, rd, light2, baseCol * 0.5, roughness) * 0.3;

        col = (shade1 + shade2) * ao * intensity;

        // Audio-reactive brightness on nodes
        if (isNode > 0.5) {
            col += vec3(0.05, 0.08, 0.12) * audioHigh * intensity;
        }

        // Fog
        float fog = 1.0 - exp(-0.004 * dist * dist);
        col = mix(col, bgColor, fog);
    }

    // Vignette
    float vignette = 1.0 - 0.3 * length(uv);
    col *= vignette;

    col = clamp(col, 0.0, 1.0);
    gl_FragColor = vec4(col, 1.0);
}
