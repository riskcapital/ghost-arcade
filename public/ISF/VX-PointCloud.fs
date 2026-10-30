/*{
    "CREDIT": "Ghost Arcade",
    "ISFVSN": "2",
    "CATEGORIES": [
        "Visual Voices",
        "Generator"
    ],
    "DESCRIPTION": "A slowly turning cloud of a few thousand points sampled on a torus, a sphere or a knot, drawn as fine dots that grow and brighten toward the camera. Every note of the sound it follows sends a ripple across the surface from its own point of impact, finer for higher notes, which then relaxes; the sound's level swells the cloud a little. The few points nearest the camera carry the accent.",
    "PASSES": [
        {
            "TARGET": "noteAge",
            "PERSISTENT": true,
            "FLOAT": true,
            "WIDTH": 1,
            "HEIGHT": 1
        },
        {
            "TARGET": "notePitch",
            "PERSISTENT": true,
            "FLOAT": true,
            "WIDTH": 1,
            "HEIGHT": 1
        },
        {
            "TARGET": "lastNote",
            "PERSISTENT": true,
            "FLOAT": true,
            "WIDTH": 1,
            "HEIGHT": 1
        },
        {
            "TARGET": "bins",
            "FLOAT": true,
            "WIDTH": "$WIDTH/4",
            "HEIGHT": "$HEIGHT/4"
        },
        {}
    ],
    "INPUTS": [
        { "NAME": "vxSource", "LABEL": "Follows", "TYPE": "long", "DEFAULT": 6, "VALUES": [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10], "LABELS": ["Everything", "Kick", "Snare and clap", "Hats", "Toms and crash", "Bass", "Lead", "Chords", "Pads and textures", "Shots and siren", "What you play"] },
        { "NAME": "vxAuto", "LABEL": "Comes and goes with its sound", "TYPE": "bool", "DEFAULT": true },
        { "NAME": "shape", "LABEL": "Shape", "TYPE": "long", "DEFAULT": 0, "VALUES": [0, 1, 2], "LABELS": ["Torus", "Sphere", "Knot"] },
        { "NAME": "pointCount", "LABEL": "Points", "TYPE": "float", "DEFAULT": 4000, "MIN": 2000, "MAX": 6000 },
        { "NAME": "pointSize", "LABEL": "Point size", "TYPE": "float", "DEFAULT": 0.4, "MIN": 0, "MAX": 1 },
        { "NAME": "rotation", "LABEL": "Rotation", "TYPE": "float", "DEFAULT": 0.4, "MIN": 0, "MAX": 1 },
        { "NAME": "deform", "LABEL": "Deform", "TYPE": "float", "DEFAULT": 0.55, "MIN": 0, "MAX": 1 },
        { "NAME": "depthFade", "LABEL": "Depth fade", "TYPE": "float", "DEFAULT": 0.6, "MIN": 0, "MAX": 1 },
        { "NAME": "spread", "LABEL": "Spread", "TYPE": "float", "DEFAULT": 0.15, "MIN": 0, "MAX": 1 },
        { "NAME": "tilt", "LABEL": "Tilt", "TYPE": "float", "DEFAULT": 0.45, "MIN": 0, "MAX": 1 },
        { "NAME": "ink", "LABEL": "Points", "TYPE": "color", "DEFAULT": [0.94, 0.95, 0.97, 1.0] },
        { "NAME": "accent", "LABEL": "Nearest points", "TYPE": "color", "DEFAULT": [1.0, 0.16, 0.1, 1.0] },
        { "NAME": "vxEnv", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxPitch", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxPhase", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1000 },
        { "NAME": "vxCount", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 64 },
        { "NAME": "vxPresence", "TYPE": "float", "DEFAULT": 1, "MIN": 0, "MAX": 1 }
    ]
}*/

// Camera distance and focal length; the cloud is about 1 unit in radius.
const float CAM = 3.4;
const float FOCAL = 3.1;
const float TAU = 6.2831853;

float hash11(float x) {
    float p = fract(x * 0.1031);
    p *= p + 33.33;
    p *= p + p;
    return fract(p);
}

float hash21(vec2 q) {
    vec3 p3 = fract(vec3(q.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
}

vec3 knotCurve(float t) {
    float r = 0.62 + 0.26 * cos(3.0 * t);
    return vec3(r * cos(2.0 * t), 0.26 * sin(3.0 * t), r * sin(2.0 * t));
}

// Point k on the chosen shape, before motion.
vec3 basePoint(float k, float total) {
    float a = fract(k * 0.7548776662 + 0.13);
    float b = fract(k * 0.5698402910 + 0.37);
    vec3 p;
    if (shape == 1) {
        float z = 1.0 - 2.0 * (k + 0.5) / total;
        float r = sqrt(max(1.0 - z * z, 0.0));
        float ph = k * 2.3999632;
        p = vec3(r * cos(ph), z, r * sin(ph)) * 0.82;
    } else if (shape == 2) {
        float t = a * TAU;
        vec3 c = knotCurve(t);
        vec3 tg = normalize(knotCurve(t + 0.01) - c);
        vec3 n1 = normalize(cross(tg, vec3(0.0, 1.0, 0.0)));
        vec3 n2 = cross(tg, n1);
        float v = b * TAU;
        p = (c + 0.11 * (cos(v) * n1 + sin(v) * n2)) * 1.12;
    } else {
        float u = a * TAU;
        float v = b * TAU;
        float rr = 0.68 + 0.3 * cos(v);
        p = vec3(rr * cos(u), 0.3 * sin(v), rr * sin(u));
    }
    // Spread: a little scatter off the surface, like scanned data.
    vec3 j = vec3(hash11(k * 1.13 + 0.5), hash11(k * 2.71 + 1.5), hash11(k * 3.97 + 2.5)) - 0.5;
    return p + j * spread * 0.18;
}

// Position after the ripples, the swell and the turn; xy on screen (uv), z depth.
vec4 placePoint(float k, float total, vec4 ages, vec4 pitches, vec3 rot, float swell, float aspect) {
    vec3 p = basePoint(k, total);
    vec3 dir = normalize(p + vec3(1e-4));
    float disp = 0.0;
    for (int i = 0; i < 4; i++) {
        float stored = ages[i];
        if (stored > 0.5) {
            float age = stored - 1.0;
            float pn = pitches[i];
            // Each note strikes the cloud from its own direction.
            float hz = pn * 127.0;
            vec3 hitDir = normalize(vec3(hash11(hz * 1.7 + 0.3) - 0.5, hash11(hz * 2.9 + 1.1) - 0.5, -0.6));
            float ang = acos(clamp(dot(dir, hitDir), -1.0, 1.0));
            float freq = mix(3.0, 16.0, clamp((pn * 127.0 - 36.0) / 60.0, 0.0, 1.0));
            float env = exp(-age / 0.9) * (1.0 - exp(-age / 0.03));
            float front = ang - age * 2.6;
            disp += env * sin(freq * ang - age * 9.0) * exp(-max(front, 0.0) * 2.5);
        }
    }
    p += dir * disp * deform * 0.14;
    p *= swell;
    // Turn about the vertical, then tilt toward the camera.
    float ca = cos(rot.x);
    float sa = sin(rot.x);
    p = vec3(ca * p.x + sa * p.z, p.y, -sa * p.x + ca * p.z);
    float cb = cos(rot.y);
    float sb = sin(rot.y);
    p = vec3(p.x, cb * p.y + sb * p.z, -sb * p.y + cb * p.z);
    float z = p.z + CAM;
    vec2 s = p.xy * FOCAL / z;
    return vec4(0.5 + 0.5 * s.x / aspect, 0.5 + 0.5 * s.y, z, disp);
}

void main() {
    float n = floor(vxCount + 0.5);
    float dt = clamp(TIMEDELTA, 0.0, 0.1);
    float last = IMG_NORM_PIXEL(lastNote, vec2(0.5)).r;
    bool fresh = FRAMEINDEX >= 2 && abs(n - last) > 0.5;

    // Last four notes: 1 + seconds since each, and its pitch (one slot per channel).
    if (PASSINDEX == 0) {
        vec4 v = IMG_NORM_PIXEL(noteAge, vec2(0.5));
        if (FRAMEINDEX < 2) v = vec4(0.0);
        vec4 alive = step(0.5, v);
        v = (v + dt) * alive;
        v *= 1.0 - step(12.0, v);
        if (fresh) {
            vec4 pick = 1.0 - step(0.5, abs(vec4(0.0, 1.0, 2.0, 3.0) - mod(n, 4.0)));
            v = mix(v, vec4(1.0), pick);
        }
        gl_FragColor = v;
        return;
    }
    if (PASSINDEX == 1) {
        vec4 v = IMG_NORM_PIXEL(notePitch, vec2(0.5));
        if (FRAMEINDEX < 2) v = vec4(0.0);
        if (fresh) {
            vec4 pick = 1.0 - step(0.5, abs(vec4(0.0, 1.0, 2.0, 3.0) - mod(n, 4.0)));
            v = mix(v, vec4(clamp(vxPitch, 0.0, 1.0)), pick);
        }
        gl_FragColor = v;
        return;
    }
    if (PASSINDEX == 2) {
        gl_FragColor = vec4(n, 0.0, 0.0, 1.0);
        return;
    }

    float total = floor(clamp(pointCount, 2000.0, 6000.0) / 4.0) * 4.0;
    vec4 ages = IMG_NORM_PIXEL(noteAge, vec2(0.5));
    vec4 pitches = IMG_NORM_PIXEL(notePitch, vec2(0.5));
    vec3 rot = vec3(vxPhase * mix(0.0, 0.5, rotation) + 0.6, mix(0.0, 1.1, tilt) + 0.12 * sin(vxPhase * 0.13), 0.0);
    float swell = 1.0 + 0.07 * clamp(vxEnv, 0.0, 1.0);

    if (PASSINDEX == 3) {
        // Bins: the screen in tiles of 2x2 texels here (8x8 output pixels). Texel s of
        // a tile lists, as k/4, up to four of the points k = 4q + s that land in it.
        float aspect = RENDERSIZE.x / RENDERSIZE.y;
        vec2 fwB = max(fwidth(gl_FragCoord.xy), vec2(1e-4));
        vec2 physB = floor(RENDERSIZE / fwB + 0.5);
        vec2 t = floor(gl_FragCoord.xy / fwB);
        vec2 tile = floor(t * 0.5);
        vec2 sub = t - tile * 2.0;
        float s = sub.x + 2.0 * sub.y;
        vec2 tiles = floor(physB * 0.5);
        vec4 found = vec4(-1.0);
        float got = 0.0;
        if (tile.x < tiles.x && tile.y < tiles.y) {
            float per = total / 4.0;
            for (int q = 0; q < 1500; q++) {
                float fq = float(q);
                if (fq >= per || got > 3.5) break;
                vec4 pp = placePoint(fq * 4.0 + s, total, ages, pitches, rot, swell, aspect);
                vec2 pt = floor(pp.xy * physB * 0.5);
                if (pt.x == tile.x && pt.y == tile.y && pp.z > 0.5) {
                    if (got < 0.5) found.x = fq;
                    else if (got < 1.5) found.y = fq;
                    else if (got < 2.5) found.z = fq;
                    else found.w = fq;
                    got += 1.0;
                }
            }
        }
        gl_FragColor = found;
        return;
    }

    // Draw: gather the points listed in the 2x2 tiles nearest this pixel.
    vec2 uv = gl_FragCoord.xy / RENDERSIZE;
    float aspect = RENDERSIZE.x / RENDERSIZE.y;
    vec2 fw = max(fwidth(gl_FragCoord.xy), vec2(1e-4));
    vec2 physB = floor(IMG_SIZE(bins) / fw + 0.5);
    vec2 tiles = floor(physB * 0.5);
    vec2 ft = uv * physB * 0.5;
    vec2 t0 = floor(ft - 0.5);
    // Dots stay under half a tile so the four nearest tiles hold every dot touching
    // this pixel.
    float tilePx = 2.0 * RENDERSIZE.y / physB.y;
    float aaPx = max(fw.x, fw.y);
    float rBase = mix(0.55, 1.6, pointSize) * aaPx;
    float frontZ = CAM - (shape == 1 ? 0.8 : (shape == 2 ? 1.02 : 0.9)) * swell;
    float light = 0.0;
    float red = 0.0;
    for (int ty = 0; ty < 2; ty++) {
        for (int tx = 0; tx < 2; tx++) {
            vec2 tile = t0 + vec2(float(tx), float(ty));
            if (tile.x >= 0.0 && tile.y >= 0.0 && tile.x < tiles.x && tile.y < tiles.y) {
                for (int s = 0; s < 4; s++) {
                    vec2 sub = vec2(mod(float(s), 2.0), floor(float(s) / 2.0));
                    vec4 ids = IMG_NORM_PIXEL(bins, (tile * 2.0 + sub + 0.5) / physB);
                    for (int c = 0; c < 4; c++) {
                        float q = ids[c];
                        if (q > -0.5) {
                            float k = floor(q + 0.5) * 4.0 + float(s);
                            vec4 pp = placePoint(k, total, ages, pitches, rot, swell, aspect);
                            vec2 d = (uv - pp.xy) * RENDERSIZE;
                            float dist = length(d);
                            // Nearer points are larger and brighter.
                            float near = clamp((CAM + 1.0 - pp.z) / 2.0, 0.0, 1.0);
                            float rad = min(rBase * mix(0.7, 1.5, near * near), tilePx * 0.5);
                            float cov = clamp(rad - dist + 0.5 * aaPx, 0.0, aaPx) / aaPx;
                            float b = mix(1.0 - 0.85 * depthFade, 1.0, near) * (0.85 + 1.2 * abs(pp.w) * deform);
                            light += cov * b * 0.85;
                            float front = 1.0 - smoothstep(0.0, 0.03, pp.z - frontZ);
                            red = max(red, cov * front);
                        }
                    }
                }
            }
        }
    }
    // A touch dimmer at rest; the sound brings it up to full.
    light = min(light * (0.75 + 0.25 * min(vxEnv * 2.0, 1.0)), 1.0);
    float ac = clamp(red, 0.0, 1.0);
    vec3 col = ink.rgb * light * (1.0 - ac) + accent.rgb * ac * max(light, 0.6);
    col *= vxPresence;
    gl_FragColor = vec4(max(col, 0.0), 1.0);
}
