/*{
    "DESCRIPTION": "Reality-folding mirror dimension where the ray direction inversion (d/=-d at i>35) creates a world that reflects back on itself. Voronoi cells are reality shards floating in a log-polar gravity well. Each shard contains a micro-universe with its own time flow. The boundary between forward and reverse reality creates an event horizon with Hawking radiation-style particle emission.",
    "CREDIT": "Shrink Wrap",
    "ISFVSN": "2",
    "CATEGORIES": ["Generator", "3D", "Abstract"],
    "INPUTS": [
        { "NAME": "horizonRadius", "TYPE": "float", "DEFAULT": 0.65, "MIN": 0.2, "MAX": 1.0, "LABEL": "Horizon Radius" },
        { "NAME": "realityShards", "TYPE": "float", "DEFAULT": 4.0, "MIN": 1.0, "MAX": 8.0, "LABEL": "Reality Shards" },
        { "NAME": "timeDistortion", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0.0, "MAX": 1.5, "LABEL": "Time Distortion" },
        { "NAME": "mirrorDepth", "TYPE": "float", "DEFAULT": 50.0, "MIN": 20.0, "MAX": 80.0, "LABEL": "Mirror Depth" },
        { "NAME": "hawkingRate", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0.0, "MAX": 1.0, "LABEL": "Hawking Radiation" },
        { "NAME": "gravityWell", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0.0, "MAX": 1.0, "LABEL": "Gravity Lensing" },
        { "NAME": "shardExtrude", "TYPE": "float", "DEFAULT": 0.4, "MIN": 0.0, "MAX": 1.0, "LABEL": "Shard Extrusion" },
        { "NAME": "parallelWorlds", "TYPE": "float", "DEFAULT": 0.6, "MIN": 0.0, "MAX": 1.0, "LABEL": "Parallel Worlds" },
        { "NAME": "viewRotate", "TYPE": "float", "DEFAULT": 0.0, "MIN": -3.14, "MAX": 3.14, "LABEL": "View Rotate" },
        { "NAME": "colorRealm", "TYPE": "float", "DEFAULT": 0.1, "MIN": 0.0, "MAX": 1.0, "LABEL": "Realm Color" },
        { "NAME": "entropyRate", "TYPE": "float", "DEFAULT": 0.3, "MIN": 0.0, "MAX": 1.0, "LABEL": "Entropy" },
        { "NAME": "singularityGlow", "TYPE": "float", "DEFAULT": 0.7, "MIN": 0.0, "MAX": 2.0, "LABEL": "Singularity Glow" }
    ]
}*/

precision highp float;

vec3 hsv2rgb(vec3 c) {
    vec3 p = abs(fract(c.xxx + vec3(1.0, 2.0/3.0, 1.0/3.0)) * 6.0 - 3.0);
    return c.z * mix(vec3(1.0), clamp(p - 1.0, 0.0, 1.0), c.y);
}

mat2 rot2(float a) { float c = cos(a), s = sin(a); return mat2(c, -s, s, c); }

vec2 hash2(vec2 p) {
    p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)));
    return fract(sin(p) * 43758.5453);
}

float hash1(vec2 p) {
    return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
}

float noise(vec2 p) {
    vec2 ip = floor(p), fp = fract(p);
    fp = fp * fp * (3.0 - 2.0 * fp);
    float a = hash1(ip), b = hash1(ip + vec2(1, 0));
    float c = hash1(ip + vec2(0, 1)), d = hash1(ip + vec2(1, 1));
    return mix(mix(a, b, fp.x), mix(c, d, fp.x), fp.y);
}

vec3 voronoiShards(vec2 uv, float anim) {
    vec2 ip = floor(uv), fp = fract(uv);
    float d1 = 8.0, d2 = 8.0, id = 0.0;
    for (int j = -1; j <= 1; j++)
    for (int i = -1; i <= 1; i++) {
        vec2 nb = vec2(float(i), float(j));
        vec2 pt = hash2(ip + nb);
        pt = 0.5 + 0.5 * sin(anim + 6.2831 * pt);
        float dist = length(nb + pt - fp);
        if (dist < d1) { d2 = d1; d1 = dist; id = hash1(ip + nb); }
        else if (dist < d2) { d2 = dist; }
    }
    return vec3(d1, d2, id);
}

void main() {
    vec2 uv = (gl_FragCoord.xy - 0.5 * RENDERSIZE) / min(RENDERSIZE.x, RENDERSIZE.y);
    uv += vec2(0.0, 1.0); // offset from original

    float t = TIME * timeDistortion * 0.2;

    // Gravity lensing distortion
    float uvLen = length(uv);
    if (gravityWell > 0.01) {
        float bendAmount = gravityWell * 0.3 / max(uvLen, 0.1);
        uv *= 1.0 + bendAmount;
    }

    // Ray direction
    vec3 d = normalize(vec3(uv, 1.0));
    d.xz *= rot2(viewRotate);

    // Initial position
    vec3 q = vec3(0.0);
    q.yz -= 1.0;

    float R, e = 0.0;
    vec3 p;
    vec3 col = vec3(0.0);

    float horizonStep = mirrorDepth * horizonRadius;
    bool inMirror = false;

    // === THE MIRROR REALM LOOP ===
    // Key reinterpretation: at step > horizonStep, ray INVERTS (d/=-d)
    // This creates a folded universe where you see both forward and backward simultaneously
    for (float i = 0.0; i < 80.0; i++) {
        // Smoothly accumulate atmospheric glow
        e += i / 5000.0;

        // THE MIRROR TRANSITION (from original: i>35? d/=-d : d)
        float mirrorBlend = smoothstep(horizonStep - 5.0, horizonStep + 5.0, i);

        // Instead of hard flip, create a smooth reality inversion
        vec3 effectiveD;
        if (i > horizonStep) {
            // Reversed reality
            effectiveD = -d / max(length(d), 0.001);
            inMirror = true;
        } else {
            effectiveD = d;
        }

        // Step forward (or backward through mirror)
        float stepSize = max(e, 0.01) * 0.18;
        p = q += effectiveD * stepSize * R;

        // Log-polar transform (from original)
        R = length(p);
        float logR = log(max(R, 0.001));

        // Time flows differently per shard (the micro-universe concept)
        float localTime = t + (inMirror ? -t * 0.5 : t) * timeDistortion;

        // Coordinate transform
        vec3 sp = vec3(
            logR - localTime * 0.2,
            -p.z / max(R, 0.001),
            atan(p.y, p.x) - localTime * 0.2
        );

        // Voronoi reality shards
        vec2 shardUV = sp.xz * realityShards;
        vec3 vor = voronoiShards(shardUV, localTime);
        float shardEdge = vor.y - vor.x;
        float shardId = vor.z;

        // Each shard has its own time (micro-universe)
        float shardTime = localTime * (0.5 + shardId * parallelWorlds);

        // Frequency-stacked density (from the original's inner loop)
        float density = sp.y - 1.0; // base from --p.y
        float s = 1.0;
        for (float j = 0.0; j < 9.0; j++) {
            s *= 2.0;
            if (s > 500.0) break;
            density += cos(dot(
                cos(sp * s + shardTime * 0.5),
                sin(sp.zxy * s + shardTime * 0.3)
            )) / s * 0.8;
        }

        e = density;

        // === COLORING ===
        float hue = fract(colorRealm + shardId * 0.3);

        // Mirror realm has inverted/complementary colors
        if (inMirror) {
            hue = fract(hue + 0.5);
        }

        // Shard extrusion shading
        float extrudeShade = 1.0 - shardExtrude * shardId * smoothstep(0.06, 0.0, shardEdge);

        // Atmospheric accumulation (from original's hsv line)
        vec3 atmosCol = hsv2rgb(vec3(hue, e - 0.4, e / 17.0 * extrudeShade));
        col += atmosCol * (1.0 + (inMirror ? 0.3 : 0.0));

        // Event horizon glow (where forward meets reverse)
        float horizonDist = abs(i - horizonStep);
        if (horizonDist < 8.0) {
            float horizonGlow = exp(-horizonDist * 0.5) * singularityGlow;

            // Hawking radiation particles at horizon
            float hawking = 0.0;
            if (hawkingRate > 0.01) {
                float particleNoise = noise(vec2(sp.x * 10.0, sp.z * 10.0) + TIME);
                hawking = smoothstep(0.7, 0.9, particleNoise) * hawkingRate;
            }

            vec3 horizonCol = hsv2rgb(vec3(fract(hue + 0.2), 0.4, horizonGlow));
            col += horizonCol;
            col += vec3(0.8, 0.9, 1.0) * hawking * horizonGlow * 0.5;
        }

        // Reality shard edges (cracks between parallel universes)
        float crackGlow = exp(-shardEdge * 20.0) * 0.3;
        vec3 crackCol = hsv2rgb(vec3(fract(hue + 0.15), 0.5, crackGlow));

        // Entropy: shard edges dissolve
        float entropy = noise(shardUV * 5.0 + TIME * entropyRate) * entropyRate;
        crackGlow *= (1.0 + entropy);

        col += crackCol;
    }

    // Singularity at center
    float singDist = length(uv - vec2(0.0, 1.0));
    float singGlow = exp(-singDist * singDist * 5.0) * singularityGlow * 0.3;
    col += hsv2rgb(vec3(colorRealm, 0.3, singGlow));

    // Gravitational redshift (objects near center shift red)
    if (gravityWell > 0.01) {
        float redshift = exp(-uvLen * 2.0) * gravityWell * 0.2;
        col.r += redshift * length(col);
        col.b -= redshift * length(col) * 0.5;
    }

    // Vignette
    float vig = 1.0 - dot((uv - vec2(0, 1)) * 0.5, (uv - vec2(0, 1)) * 0.5);
    col *= clamp(vig, 0.0, 1.0);

    col = col / (1.0 + col);
    col = pow(col, vec3(0.9));

    gl_FragColor = vec4(col, 1.0);
}
