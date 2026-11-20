/*{
    "CREDIT": "Ghost Arcade",
    "ISFVSN": "2",
    "CATEGORIES": [
        "Visual Voices",
        "Generator"
    ],
    "DESCRIPTION": "Solid glass spheres of different sizes resting on a dark glossy floor under one hard key light and a few studio panels. Each sphere is traced as a real lens: it shows the room and its neighbors upside down and squeezed inside it, splits them into color toward its rim, mirrors the lights on its skin, and throws a bright focused spot with a spectral edge onto the floor inside its own shadow. The sound's motion carries the key light round the group, so every highlight, shadow and focus travels; its level brightens the lights; each hit makes one sphere hop off the floor and flashes a ring of light overhead in the accent color. With no sound the spheres rest under a dim, still light.",
    "PASSES": [
        {}
    ],
    "INPUTS": [
        { "NAME": "vxSource", "LABEL": "Follows", "TYPE": "long", "DEFAULT": 1, "VALUES": [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20], "LABELS": ["Everything", "Kick", "Snare and clap", "Hats", "Toms and crash", "Bass", "Lead", "Chords", "Pads and textures", "Shots and siren", "What you play", "Bowls", "Drone", "XY tone", "Analog synth", "Scan synth", "Echo shots", "Build and drop", "Siren", "Acid line", "Dub bass"] },
        { "NAME": "vxAuto", "LABEL": "Comes and goes with its sound", "TYPE": "bool", "DEFAULT": true },
        { "NAME": "vxClear", "LABEL": "Transparent background", "TYPE": "bool", "DEFAULT": false },
        { "NAME": "spheres", "LABEL": "Spheres", "TYPE": "float", "DEFAULT": 0.75, "MIN": 0, "MAX": 1 },
        { "NAME": "dispersion", "LABEL": "Dispersion", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0, "MAX": 1 },
        { "NAME": "height", "LABEL": "Light height", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0, "MAX": 1 },
        { "NAME": "gloss", "LABEL": "Floor gloss", "TYPE": "float", "DEFAULT": 0.6, "MIN": 0, "MAX": 1 },
        { "NAME": "ink", "LABEL": "Lights", "TYPE": "color", "DEFAULT": [0.86, 0.92, 1.0, 1.0] },
        { "NAME": "accent", "LABEL": "Ring light on a hit", "TYPE": "color", "DEFAULT": [1.0, 0.3, 0.12, 1.0] },
        { "NAME": "vxSwell", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxPulse", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxFlow", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1000 },
        { "NAME": "vxCount", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 64 },
        { "NAME": "vxPresence", "TYPE": "float", "DEFAULT": 1, "MIN": 0, "MAX": 1 }
    ]
}*/

// Spheres on the floor (at most), wavelengths traced through each one, and
// the number of rays tried across a sphere when looking for the light it focuses.
const int NS = 9;
const int NL = 6;
const int NC = 12;
const float FOCAL = 1.9;
// Glass: its index for the middle of the spectrum.
const float IOR = 1.52;

// Where each sphere rests: x, z and radius. The first five are the core group.
const vec3 SPH[9] = vec3[9](
    vec3(-0.55, 0.6, 1.15),
    vec3(1.45, 0.1, 0.72),
    vec3(-2.25, -0.3, 0.62),
    vec3(0.55, -1.25, 0.42),
    vec3(2.75, 1.3, 0.9),
    vec3(-1.35, -1.55, 0.33),
    vec3(2.2, -1.2, 0.3),
    vec3(-3.1, 1.5, 0.5),
    vec3(0.0, -2.1, 0.22)
);

// Set once per pixel in main().
float gCount;
float gHopI;
float gHopY;
float gDisp;
float gLevel;
float gRing;
float gGloss;
vec3 gL;
vec3 gInk;
vec3 gAcc;
vec3 gSpecNorm;

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

// The color of one wavelength: t = 0 at the red end of the spectrum, 1 at the violet end.
vec3 spectrum(float t) {
    float r = (t - 0.08) / 0.44;
    float g = (t - 0.46) / 0.36;
    float b = (t - 0.84) / 0.38;
    float v = (t - 1.02) / 0.22;
    vec3 c = vec3(max(1.0 - r * r, 0.0), max(1.0 - g * g, 0.0), max(1.0 - b * b, 0.0));
    c *= c;
    float vr = max(1.0 - v * v, 0.0);
    c.r += 0.3 * vr * vr;
    return c;
}

// The glass's index for wavelength t.
float iorAt(float t) {
    return IOR + (t - 0.5) * gDisp;
}

// How much light a glass surface mirrors: ci is the cosine of the angle of arrival, n the index.
float fresnel(float ci, float n) {
    float st2 = (1.0 - ci * ci) / (n * n);
    float ct = sqrt(max(1.0 - st2, 0.0));
    float rs = (ci - n * ct) / (ci + n * ct);
    float rp = (ct - n * ci) / (ct + n * ci);
    return 0.5 * (rs * rs + rp * rp);
}

// Snell's law: the ray i bent at a surface whose normal nrm faces it; eta is index before over index after.
vec3 refr(vec3 i, vec3 nrm, float eta) {
    float c = -dot(nrm, i);
    float k = 1.0 - eta * eta * (1.0 - c * c);
    return eta * i + (eta * c - sqrt(max(k, 0.0))) * nrm;
}

// How much of a soft window of half-width e round x lies between a and b: a hard-edged bar, anti-aliased.
float band(float x, float a, float b, float e) {
    return clamp((min(x + e, b) - max(x - e, a)) / (2.0 * e), 0.0, 1.0);
}

// A sphere: its center and radius. The one the latest hit touched is off the floor.
vec4 sphereAt(int i) {
    vec3 s = SPH[i];
    // Small spheres hop higher than big ones.
    float hop = (float(i) == gHopI) ? gHopY / (s.z + 0.45) : 0.0;
    return vec4(s.x, s.z + hop, s.y, s.z);
}

// The lights of the room in direction d: the key light's hard disk, a softbox behind the camera,
// a strip on the right wall, two bars on the back wall, the ring overhead, and the dark between.
// e is the width of the cone of directions this pixel takes in, so squeezed images stay clean.
vec3 env(vec3 d, float e) {
    vec3 c = gInk * 0.01 * (0.25 + 0.75 * smoothstep(-0.2, 0.7, d.y));
    float kr = 0.04;
    float ang = sqrt(max(2.0 - 2.0 * dot(d, gL), 0.0));
    c += gInk * (70.0 * gLevel) * smoothstep(kr + e + 0.003, kr - e - 0.003, ang) * (kr * kr / (kr * kr + e * e));
    if (d.z < -0.05) {
        vec2 q = vec2(d.x, d.y) / -d.z;
        float w = 0.006 + e * (1.0 + dot(q, q));
        float m = band(q.x, -1.95, -0.6, w) * band(q.y, 0.5, 1.45, w);
        // The softbox is four panes behind a cross of dark bars.
        m *= 1.0 - band(q.x, -1.295, -1.255, w);
        m *= 1.0 - band(q.y, 0.96, 0.99, w);
        c += gInk * (2.4 * gLevel) * m;
    }
    if (d.x > 0.05) {
        vec2 q = vec2(d.z, d.y) / d.x;
        float w = 0.005 + e * (1.0 + dot(q, q));
        c += gInk * (3.4 * gLevel) * band(q.x, -0.3, -0.19, w) * band(q.y, 0.1, 1.7, w);
    }
    if (d.z > 0.05) {
        vec2 q = vec2(d.x, d.y) / d.z;
        float w = 0.004 + e * (1.0 + dot(q, q));
        c += gInk * (2.6 * gLevel) * band(abs(q.x), 0.8, 2.7, w) * band(q.y, 0.4, 0.46, w);
        // A bank of seven tall light slats high on the back wall.
        float sx = (q.x + 1.4) / 0.4;
        float sl = band(fract(sx), 0.18, 0.82, w / 0.4) * step(0.0, sx) * step(sx, 7.0);
        c += gInk * (1.5 * gLevel) * sl * band(q.y, 0.9, 1.7, w);
    }
    c += gAcc * gRing * band(d.y, 0.9, 0.93, 0.003 + e);
    return c;
}

// The nearest sphere along a ray, skipping one: (distance, which, how much of the pixel it covers).
// foot is the width of the ray's pixel per unit of distance; with it the outline is soft by one pixel.
vec3 hitSpheres(vec3 ro, vec3 rd, float skip, float foot) {
    float best = 1e9;
    float idx = -1.0;
    float cov = 0.0;
    for (int i = 0; i < NS; i++) {
        float fi = float(i);
        if (fi >= gCount) break;
        if (fi == skip) continue;
        vec4 s = sphereAt(i);
        vec3 oc = ro - s.xyz;
        float b = dot(oc, rd);
        if (b > 0.0) continue;
        float d2 = max(dot(oc, oc) - b * b, 0.0);
        float w = max(foot * -b, 1e-5);
        float rr = s.w + 0.5 * w;
        if (d2 < rr * rr) {
            float h = s.w * s.w - d2;
            float t = -b - sqrt(max(h, 0.0));
            if (t > 1e-3 && t < best) {
                best = t;
                idx = fi;
                cov = clamp((rr - sqrt(d2)) / w, 0.0, 1.0);
            }
        }
    }
    return vec3(idx < 0.0 ? -1.0 : best, idx, cov);
}

// The key light focused by one sphere of index n, at a point behind it: z along the light and rho off its
// axis, both in sphere radii. Every ray that entered at height b leaves along a known line, so the rays that
// land on this point are the roots of one equation in b; each brings light in proportion to how tightly its
// neighbors are gathered there. ly and ry tilt the result onto the floor; eps is the blur of the light's size.
float lensFocus(float rho, float z, float n, float ly, float ry, float eps) {
    float sum = 0.0;
    float bPrev = 0.0;
    float gPrev = 0.0;
    for (int k = 0; k <= NC; k++) {
        float b = mix(-0.97, 0.97, float(k) / float(NC));
        float ci = sqrt(1.0 - b * b);
        float st = b / n;
        float ct = sqrt(1.0 - st * st);
        float sa = b * ct - ci * st;
        float ca = ci * ct + b * st;
        float sd = 2.0 * sa * ca;
        float cd = ca * ca - sa * sa;
        float g = (b - z * sd) / cd - rho;
        if (k > 0 && (g * gPrev < 0.0 || g == 0.0)) {
            // A ray lands here: find its height, then how tightly the rays round it are gathered.
            float br = bPrev + (b - bPrev) * gPrev / (gPrev - g);
            float ci2 = sqrt(1.0 - br * br);
            float st2 = br / n;
            float ct2 = sqrt(1.0 - st2 * st2);
            float sa2 = br * ct2 - ci2 * st2;
            float ca2 = ci2 * ct2 + br * st2;
            float sd2 = 2.0 * sa2 * ca2;
            float cd2 = ca2 * ca2 - sa2 * sa2;
            float dd = 2.0 * (1.0 / ci2 - 1.0 / (n * ct2));
            float drdb = (cd2 + dd * (br * sd2 - z)) / (cd2 * cd2);
            // The ray only exists past the point where it left the glass.
            float ez = ct2 * ca2 + st2 * sa2;
            float past = smoothstep(ez, ez + 0.04, z);
            float tr = 1.0 - fresnel(ci2, n);
            float tilt = max(cd2 * ly + sd2 * ry, 0.0) / cd2;
            sum += abs(br) / (max(rho, eps) * sqrt(drdb * drdb + eps * eps)) * tr * tr * tilt * past;
        }
        bPrev = b;
        gPrev = g;
    }
    return sum;
}

// The key light reaching a floor point: straight from the light where no sphere shadows it, and gathered
// by the spheres inside their shadows. With spectral on, each color is focused on its own. fp is the
// width of floor this pixel covers.
vec3 floorLight(vec3 p, float spectral, float fp) {
    float sh = 1.0;
    vec3 foc = vec3(0.0);
    for (int i = 0; i < NS; i++) {
        float fi = float(i);
        if (fi >= gCount) break;
        vec4 s = sphereAt(i);
        vec3 v = p - s.xyz;
        float z = -dot(v, gL);
        if (z <= 0.0) continue;
        vec3 off = v + gL * z;
        float rho = length(off);
        float zr = z / s.w;
        float rr = rho / s.w;
        float blur = fp / s.w;
        // The shadow's edge softens with distance from the sphere.
        float w = 0.012 + zr * 0.028 + blur;
        sh *= smoothstep(1.0 - w, 1.0 + w, rr);
        if (zr > 0.6 && rr < 2.6) {
            float ry = off.y / max(rho, 1e-4);
            float eps = 0.016 + zr * 0.01 + blur;
            if (spectral > 0.5) {
                for (int l = 0; l < NL; l++) {
                    float tl = (float(l) + 0.5) / float(NL);
                    foc += spectrum(tl) * gSpecNorm * lensFocus(rr, zr, iorAt(tl), gL.y, ry, eps);
                }
            } else {
                foc += vec3(lensFocus(rr, zr, IOR, gL.y, ry, eps));
            }
        }
    }
    return gInk * gLevel * (sh * gL.y + foc);
}

// The floor's own surface at a point: dark stone, lit by the key light, falling away into the dark.
vec3 floorBody(vec3 p, float spectral, float fp) {
    vec3 e = floorLight(p, spectral, fp);
    float far = exp(-dot(p.xz, p.xz) * 0.012);
    return (vec3(0.0016, 0.0018, 0.0022) + 0.055 * e) * far;
}

float floorMirror(float c) {
    float f = 1.0 - clamp(c, 0.0, 1.0);
    float f2 = f * f;
    return (0.04 + 0.96 * f2 * f2 * f) * gGloss;
}

// A downward ray's floor point, with the lights (not the spheres) mirrored in its polish.
vec3 floorLite(vec3 ro, vec3 rd, float e) {
    float t = -ro.y / rd.y;
    vec3 p = ro + rd * t;
    vec3 c = floorBody(p, 0.0, e * t / max(-rd.y, 0.08));
    c += env(vec3(rd.x, -rd.y, rd.z), e) * floorMirror(-rd.y) * exp(-dot(p.xz, p.xz) * 0.006);
    return c;
}

// What a ray sees once it is clear of the spheres: the floor below, or the room.
vec3 beyond(vec3 ro, vec3 rd, float e) {
    if (rd.y < -1e-3) return floorLite(ro, rd, e);
    return env(rd, e);
}

// How fast the mirrored and the bent ray swing as the eye moves across a sphere of radius r: (mirror, through).
// w is the width of the pixel where it meets the sphere.
vec2 spread(float w, float r, float ci, float n) {
    float c = max(ci, 0.03);
    float ct = sqrt(1.0 - (1.0 - c * c) / (n * n));
    return vec2(2.0 / c, 2.0 * (1.0 / c - 1.0 / (n * ct))) * (w / r);
}

// A sphere seen second-hand (in another sphere, or at another's outline): one mirror ray and one ray through.
vec3 sphereLite(vec3 ro, vec3 rd, float t, float idx, float e) {
    vec4 s = sphereAt(int(idx + 0.5));
    vec3 p = ro + rd * t;
    vec3 nrm = normalize(p - s.xyz);
    float ci = clamp(-dot(rd, nrm), 0.0, 1.0);
    float f = fresnel(ci, IOR);
    vec2 sp = e + spread(e * t, s.w, ci, IOR);
    vec3 col = f * beyond(p, reflect(rd, nrm), sp.x);
    vec3 d1 = refr(rd, nrm, 1.0 / IOR);
    float chord = 2.0 * s.w * max(-dot(d1, nrm), 0.0);
    vec3 p2 = p + d1 * chord;
    vec3 n2 = (p2 - s.xyz) / s.w;
    vec3 d2 = refr(d1, -n2, IOR);
    col += (1.0 - f) * (1.0 - f) * beyond(p2, d2, sp.y);
    return col;
}

// Everything a ray leaving a sphere can see: the other spheres, the floor, the room.
vec3 leafScene(vec3 ro, vec3 rd, float skip, float e) {
    vec3 h = hitSpheres(ro, rd, skip, e);
    vec3 col = vec3(0.0);
    if (h.z < 1.0) col += beyond(ro, rd, e) * (1.0 - h.z);
    if (h.z > 0.0) col += sphereLite(ro, rd, h.x, h.y, e) * h.z;
    return col;
}

// A sphere seen directly: the mirror image on its skin, the view through it traced once for each of
// several wavelengths so its rim splits into color, and the lights mirrored off the inside of its far wall.
vec3 sphereFull(vec3 ro, vec3 rd, float t, float idx, float foot) {
    vec4 s = sphereAt(int(idx + 0.5));
    vec3 p = ro + rd * t;
    vec3 nrm = normalize(p - s.xyz);
    float ci = clamp(-dot(rd, nrm), 0.0, 1.0);
    vec2 sp = foot + spread(foot * t, s.w, ci, IOR);
    vec3 col = vec3(0.0);
    for (int l = 0; l <= NL; l++) {
        if (l == NL) {
            // The skin's mirror image.
            col += fresnel(ci, IOR) * leafScene(p, reflect(rd, nrm), idx, sp.x);
        } else {
            float tl = (float(l) + 0.5) / float(NL);
            float n = iorAt(tl);
            vec3 d1 = refr(rd, nrm, 1.0 / n);
            float chord = 2.0 * s.w * max(-dot(d1, nrm), 0.0);
            vec3 p2 = p + d1 * chord;
            vec3 n2 = (p2 - s.xyz) / s.w;
            vec3 d2 = refr(d1, -n2, n);
            float tr = 1.0 - fresnel(ci, n);
            // Thick glass takes a little of the red out of what passes through it.
            vec3 tint = exp(-vec3(0.085, 0.022, 0.04) * chord);
            col += spectrum(tl) * gSpecNorm * tint * (tr * tr) * leafScene(p2, d2, idx, sp.y);
        }
    }
    vec3 e1 = refr(rd, nrm, 1.0 / IOR);
    float chord0 = 2.0 * s.w * max(-dot(e1, nrm), 0.0);
    vec3 q2 = p + e1 * chord0;
    vec3 m2 = (q2 - s.xyz) / s.w;
    vec3 e3 = reflect(e1, m2);
    vec3 q3 = q2 + e3 * chord0;
    vec3 m3 = (q3 - s.xyz) / s.w;
    vec3 e4 = refr(e3, -m3, IOR);
    float f0 = fresnel(ci, IOR);
    col += (1.0 - f0) * (1.0 - f0) * f0 * env(e4, sp.y * 2.0);
    return col;
}

void main() {
    vec2 uv = gl_FragCoord.xy / RENDERSIZE.xy;
    float asp = RENDERSIZE.x / RENDERSIZE.y;
    vec2 pc = vec2((uv.x - 0.5) * asp, uv.y - 0.5);
    float px = 1.0 / RENDERSIZE.y;

    float sw = clamp(vxSwell, 0.0, 1.0);
    float pu = clamp(vxPulse, 0.0, 1.0);
    float nHit = floor(vxCount + 0.5);
    // The light moves with the sound; a trace of drift keeps a silent room from freezing.
    float flow = vxFlow + TIME * 0.015;

    gCount = floor(mix(5.0, float(NS), spheres) + 0.5);
    gDisp = mix(0.0, 0.11, dispersion);
    gLevel = 0.5 + 0.75 * sw;
    gGloss = mix(0.2, 1.0, gloss);
    gInk = ink.rgb;
    gAcc = accent.rgb;
    gRing = pu * 5.0;

    // The latest hit lifts one sphere: it leaves the floor on the hit and is back as the hit dies away.
    gHopI = nHit > 0.5 ? floor(hash11(nHit * 3.71 + 1.3) * gCount) : -1.0;
    gHopY = 0.36 * 4.0 * pu * (1.0 - pu);

    // The key light swings round the back of the group, so the shadows and the focused spots fall toward the camera.
    float az = 1.5708 + 1.2 * sin(flow * 0.33 + 0.6);
    float el = mix(0.76, 1.24, height);
    gL = vec3(cos(el) * cos(az), sin(el), cos(el) * sin(az));

    gSpecNorm = vec3(0.0);
    for (int l = 0; l < NL; l++) gSpecNorm += spectrum((float(l) + 0.5) / float(NL));
    gSpecNorm = 1.0 / gSpecNorm;

    // Camera: in front of the group and well above it, looking down across the floor.
    vec3 ro = vec3(0.0, 3.7, -7.4);
    vec3 ta = vec3(0.1, 0.62, 0.0);
    vec3 fwd = normalize(ta - ro);
    vec3 rgt = normalize(cross(vec3(0.0, 1.0, 0.0), fwd));
    vec3 upv = cross(fwd, rgt);
    vec3 rd = normalize(pc.x * rgt + pc.y * upv + FOCAL * fwd);
    float foot = px / FOCAL;

    vec3 col = vec3(0.0);
    // The one sphere this pixel traces in full: the one it looks at, or the one mirrored in the floor.
    vec3 fullRo = ro;
    vec3 fullRd = rd;
    vec3 fullHit = vec3(-1.0, -1.0, 0.0);
    float fullW = 0.0;

    vec3 h = hitSpheres(ro, rd, -1.0, foot);
    if (h.z > 0.0) {
        fullHit = h;
        fullW = h.z;
    }
    if (h.z < 1.0) {
        // Beside or behind that sphere's outline.
        vec3 bg = vec3(0.0);
        vec3 h2 = vec3(-1.0, -1.0, 0.0);
        if (h.z > 0.0) h2 = hitSpheres(ro, rd, h.y, 0.0);
        if (h2.z > 0.0) {
            bg = sphereLite(ro, rd, h2.x, h2.y, foot);
        } else if (rd.y < -1e-4) {
            float tf = -ro.y / rd.y;
            vec3 p = ro + rd * tf;
            bg = floorBody(p, 1.0, foot * tf / max(-rd.y, 0.08));
            // The floor's polish: the mirrored ray finds a sphere, or the room's lights.
            vec3 rr = vec3(rd.x, -rd.y, rd.z);
            float fm = floorMirror(-rd.y) * exp(-dot(p.xz, p.xz) * 0.006);
            vec3 hr = hitSpheres(p, rr, -1.0, foot);
            bg += env(rr, foot) * fm * (1.0 - hr.z);
            if (hr.z > 0.0) {
                if (h.z > 0.0) {
                    bg += sphereLite(p, rr, hr.x, hr.y, foot) * fm * hr.z;
                } else {
                    fullRo = p;
                    fullRd = rr;
                    fullHit = hr;
                    fullW = fm * hr.z;
                }
            }
        } else {
            bg = env(rd, foot);
        }
        col += bg * (1.0 - h.z);
    }
    if (fullW > 0.0) col += sphereFull(fullRo, fullRd, fullHit.x, fullHit.y, foot) * fullW;

    // The view falls off a little toward its corners.
    vec2 vg = uv - 0.5;
    col *= 1.0 - 0.3 * dot(vg, vg) * 2.0;

    // Tone map on the brightest channel so the split colors keep their hue, then dither against banding.
    float lum = max(max(col.r, col.g), col.b);
    col = col / max(lum, 1e-4) * (1.0 - exp(-lum * 1.6));
    col += (hash21(gl_FragCoord.xy + fract(TIME) * 91.7) - 0.5) / 255.0;
    col = max(col, 0.0);

    vec3 outc = col;
    float outa = 1.0;
    if (vxClear) {
        // Only the light is solid: the dark room lets what is under it show.
        outa = clamp(max(max(col.r, col.g), col.b) * 1.4, 0.0, 1.0);
        outc = min(col, vec3(outa));
    }
    gl_FragColor = vec4(outc, outa) * vxPresence;
}
