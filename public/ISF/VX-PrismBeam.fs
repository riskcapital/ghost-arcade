/*{
    "CREDIT": "Ghost Arcade",
    "ISFVSN": "2",
    "CATEGORIES": [
        "Visual Voices",
        "Generator"
    ],
    "DESCRIPTION": "A physics bench in a dark room: a long three-sided glass bar turning slowly on its axis just above a black optical table, seen from above and to one side. A thin flat beam of white light comes down through the haze, bends into one face by Snell's law, crosses the glass, and leaves the next face as a fan of separated colors that lands on the table as a sharp spectrum and climbs a white screen at the table's end. The bar itself is traced as glass: it shows the table and the beams bent through it, mirrors the room, and catches light along its edges. The sound's motion turns the bar, so the fan sweeps and the spectrum slides, through the angle of least bending and on to where the glass traps the violet end; its level widens and brightens the beam; each hit snaps the bar to a new angle and fires a second beam in the accent color. With no sound the bar rests with a dim spectrum on the table.",
    "PASSES": [
        {}
    ],
    "INPUTS": [
        { "NAME": "vxSource", "LABEL": "Follows", "TYPE": "long", "DEFAULT": 6, "VALUES": [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20], "LABELS": ["Everything", "Kick", "Snare and clap", "Hats", "Toms and crash", "Bass", "Lead", "Chords", "Pads and textures", "Shots and siren", "What you play", "Bowls", "Drone", "XY tone", "Analog synth", "Scan synth", "Echo shots", "Build and drop", "Siren", "Acid line", "Dub bass"] },
        { "NAME": "vxAuto", "LABEL": "Comes and goes with its sound", "TYPE": "bool", "DEFAULT": true },
        { "NAME": "vxClear", "LABEL": "Transparent background", "TYPE": "bool", "DEFAULT": false },
        { "NAME": "beam", "LABEL": "Beam width", "TYPE": "float", "DEFAULT": 0.3, "MIN": 0, "MAX": 1 },
        { "NAME": "dispersion", "LABEL": "Dispersion", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0, "MAX": 1 },
        { "NAME": "haze", "LABEL": "Haze", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0, "MAX": 1 },
        { "NAME": "turn", "LABEL": "Turn", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0, "MAX": 1 },
        { "NAME": "ink", "LABEL": "Beam", "TYPE": "color", "DEFAULT": [0.86, 0.92, 1.0, 1.0] },
        { "NAME": "accent", "LABEL": "Beam on a hit", "TYPE": "color", "DEFAULT": [1.0, 0.3, 0.12, 1.0] },
        { "NAME": "vxSwell", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxPulse", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxFlow", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1000 },
        { "NAME": "vxCount", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 64 },
        { "NAME": "vxPresence", "TYPE": "float", "DEFAULT": 1, "MIN": 0, "MAX": 1 }
    ]
}*/

// Wavelengths traced for the white beam and for the accent beam, the rays that makes in all, and the
// wavelengths the bar itself is looked through with.
const int NW = 9;
const int NA = 3;
const int NR = 12;
const int NV = 3;
const float FOCAL = 1.9;
// Glass: its index for the middle of the spectrum.
const float IOR = 1.62;
// The bar: the length of a side of its triangle, where its axis runs (x, y), and half its length.
const float SIDE = 1.1;
const vec2 AXIS = vec2(0.0, 0.67);
const float HALF_LEN = 2.0;
// The white screen standing across the far end of the table: where (x), its height, and its middle and half-width in z.
const float SCREEN_X = 4.5;
const float SCREEN_H = 2.3;
const float SCREEN_Z = 0.3;
const float SCREEN_HW = 1.6;
// How much the fan of colors is lifted in the haze.
const float FAN_LIFT = 2.2;

// Set once per pixel in main().
// The bar's three long faces seen end-on (outward normals), and all five faces in the room's space.
vec2 gN2[3];
float gRin;
vec4 gPl[5];
// Each ray of light (one wavelength of one beam) after the bar: where it leaves and which way; how far it runs,
// how thick it is, how fast it fans out, and how bright it is. And the stretches it crosses inside the glass.
vec4 gOut[12];
vec4 gOutP[12];
vec4 gSeg0[12];
vec4 gSeg1[12];
vec4 gSeg2[12];
vec3 gRayCol[12];
float gRayBeam[12];
float gRayThick[12];
// Each of the two beams before the bar (start, direction; length, thickness, brightness), the part of it
// mirrored off the face it meets, and where it lies along the bar (middle, half-width).
vec4 gIn[2];
vec4 gInP[2];
vec4 gRf[2];
vec4 gRfP[2];
vec2 gBeamZ[2];
vec3 gBeamCol[2];
float gHaze;
float gDrift;
float gDisp;
float gLevel;
vec3 gInk;

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

float noise1(float x) {
    float i = floor(x);
    float f = fract(x);
    return mix(hash11(i), hash11(i + 1.0), f * f * (3.0 - 2.0 * f));
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

// How much light a glass surface mirrors: ci is the cosine of the angle on the air side, n the index.
float fresnel(float ci, float n) {
    float st2 = (1.0 - ci * ci) / (n * n);
    float ct = sqrt(max(1.0 - st2, 0.0));
    float rs = (ci - n * ct) / (ci + n * ct);
    float rp = (ct - n * ci) / (ct + n * ci);
    return 0.5 * (rs * rs + rp * rp);
}

// How much of a soft window of half-width e round x lies between a and b: a hard-edged bar, anti-aliased.
float band(float x, float a, float b, float e) {
    return clamp((min(x + e, b) - max(x - e, a)) / (2.0 * e), 0.0, 1.0);
}

float erfApprox(float x) {
    float a = abs(x);
    float t = 1.0 / (1.0 + 0.47047 * a);
    float y = 1.0 - t * (0.3480242 + t * (-0.0958798 + t * 0.7478556)) * exp(-a * a);
    return x < 0.0 ? -y : y;
}

// How far a ray leaving the bar runs before it lands: on the table, or on the screen at the table's end.
float landing(vec2 q, vec2 o) {
    float len = 40.0;
    if (o.y < -1e-4) len = min(len, -q.y / o.y);
    if (o.x > 1e-4) {
        float t = (SCREEN_X - q.x) / o.x;
        float y = q.y + o.y * t;
        if (t > 0.0 && y > 0.0 && y < SCREEN_H) len = min(len, t);
    }
    return len;
}

// Follow one wavelength of one beam through the bar, seen end-on: Snell's law in at the face it meets, then
// across the glass to the next face, where it leaves by Snell's law or, past the critical angle, is mirrored
// back in and goes on. What it does is kept for drawing: the stretches inside, and the ray that leaves.
// Returns the point where it entered (z is 0 if it missed the bar); nrmOut is that face's normal.
vec3 traceRay(int k, vec2 o, vec2 d, float n, float thick, float bright, out vec2 nrmOut) {
    gSeg0[k] = vec4(0.0);
    gSeg1[k] = vec4(0.0);
    gSeg2[k] = vec4(0.0);
    gOut[k] = vec4(o, d);
    gOutP[k] = vec4(0.0);
    gRayThick[k] = thick;
    nrmOut = vec2(0.0, 1.0);
    float tn = -1e9;
    float tf = 1e9;
    vec2 ne = vec2(0.0, 1.0);
    for (int e = 0; e < 3; e++) {
        float dn = dot(gN2[e], d);
        float dist = gRin - dot(gN2[e], o - AXIS);
        if (dn < -1e-6) {
            float t = dist / dn;
            if (t > tn) {
                tn = t;
                ne = gN2[e];
            }
        } else if (dn > 1e-6) {
            tf = min(tf, dist / dn);
        } else if (dist < 0.0) {
            tn = 1e9;
        }
    }
    if (tn >= tf || tn < 0.0) return vec3(o, 0.0);
    nrmOut = ne;
    vec2 p = o + d * tn;
    vec2 p0 = p;
    float ci = -dot(d, ne);
    float wgt = bright * (1.0 - fresnel(ci, n));
    float kin = 1.0 - (1.0 - ci * ci) / (n * n);
    float ct = sqrt(max(kin, 0.0));
    vec2 dd = d / n + (ci / n - ct) * ne;
    // A beam is squeezed or widened as it bends.
    float th = thick * ct / max(ci, 0.05);
    gRayThick[k] = th;
    for (int b = 0; b < 3; b++) {
        float tx = 1e9;
        vec2 nf = vec2(0.0, 1.0);
        for (int e = 0; e < 3; e++) {
            float dn = dot(gN2[e], dd);
            if (dn > 1e-5) {
                float t = (gRin - dot(gN2[e], p - AXIS)) / dn;
                if (t < tx) {
                    tx = t;
                    nf = gN2[e];
                }
            }
        }
        vec2 q = p + dd * max(tx, 0.0);
        vec4 seg = vec4(p, q);
        if (b == 0) gSeg0[k] = seg;
        else if (b == 1) gSeg1[k] = seg;
        else gSeg2[k] = seg;
        p = q;
        float co = dot(dd, nf);
        float k2 = 1.0 - n * n * (1.0 - co * co);
        if (k2 > 0.0) {
            float c4 = sqrt(k2);
            vec2 oo = n * dd + (c4 - n * co) * nf;
            wgt *= 1.0 - fresnel(c4, n);
            float tho = max(th * c4 / max(co, 0.05), 0.004);
            gOut[k] = vec4(q, oo);
            gOutP[k] = vec4(landing(q, oo), tho, 0.0, wgt * thick / tho);
            return vec3(p0, 1.0);
        }
        dd = reflect(dd, nf);
    }
    return vec3(p0, 1.0);
}

// How bright one straight beam looks along a stretch of a view ray whose two ends, seen from the bar's end,
// are a and b. The beam starts at o and runs along u for len; it is th thick at the start and fans out by k
// for each unit it travels. This is the beam's cross-section summed along the stretch, exactly.
float stripHaze(vec2 a, vec2 b, vec2 o, vec2 u, float len, float th, float k) {
    vec2 ra = a - o;
    vec2 rb = b - o;
    float da = ra.x * u.y - ra.y * u.x;
    float db = rb.x * u.y - rb.y * u.x;
    float la = dot(ra, u);
    float lb = dot(rb, u);
    float dd = db - da;
    float tau = abs(dd) > 1e-6 ? clamp(-da / dd, 0.0, 1.0) : 0.5;
    float lm = mix(la, lb, tau);
    if (lm < -0.05 || lm > len + 0.05) return 0.0;
    float sig = sqrt(th * th + k * k * lm * lm);
    float xa = da / sig;
    float xb = db / sig;
    float dx = xb - xa;
    float avg = abs(dx) > 1e-3 ? 0.8862 * (erfApprox(xb) - erfApprox(xa)) / dx : exp(-xa * xa);
    // The haze is uneven, and drifts.
    float air = 0.8 + 0.4 * noise1(lm * 1.6 + o.x * 3.0 + gDrift);
    return avg * air * (th / sig) * smoothstep(-0.02, 0.02, lm) * smoothstep(len + 0.02, len - 0.02, lm);
}

// The same beam's light at one point (on the table, the screen, or the bar's skin).
float stripAt(vec2 p, vec2 o, vec2 u, float len, float th, float k) {
    vec2 r = p - o;
    float d = r.x * u.y - r.y * u.x;
    float l = dot(r, u);
    if (l < -0.05 || l > len + 0.25) return 0.0;
    float sig = sqrt(th * th + k * k * l * l);
    return exp(-d * d / (sig * sig)) * (th / sig) * smoothstep(-0.02, 0.02, l);
}

// The stretch of a view ray, between t0 and t1, that lies inside a beam's width along the bar: (start, end),
// with end below start if there is none.
vec2 slabSpan(vec3 ro, vec3 rd, float t0, float t1, vec2 bz) {
    if (abs(rd.z) < 1e-5) return abs(ro.z - bz.x) < bz.y ? vec2(t0, t1) : vec2(1.0, 0.0);
    float ta = (bz.x - bz.y - ro.z) / rd.z;
    float tb = (bz.x + bz.y - ro.z) / rd.z;
    return vec2(max(t0, min(ta, tb)), min(t1, max(ta, tb)));
}

// The haze lit by the beams in the open air, along a view ray from t0 to t1: each beam on its way in, the part
// of it mirrored off the bar, and every wavelength's ray on its way out.
vec3 hazeOut(vec3 ro, vec3 rd, float t0, float t1) {
    vec3 sum = vec3(0.0);
    for (int b = 0; b < 2; b++) {
        if (gInP[b].z <= 0.0) continue;
        vec2 sp = slabSpan(ro, rd, t0, t1, gBeamZ[b]);
        if (sp.y <= sp.x) continue;
        vec2 a = ro.xy + rd.xy * sp.x;
        vec2 c = ro.xy + rd.xy * sp.y;
        float span = sp.y - sp.x;
        vec3 acc = gBeamCol[b] * gInP[b].z * stripHaze(a, c, gIn[b].xy, gIn[b].zw, gInP[b].x, gInP[b].y, 0.0);
        acc += gBeamCol[b] * gRfP[b].z * stripHaze(a, c, gRf[b].xy, gRf[b].zw, gRfP[b].x, gRfP[b].y, 0.0);
        vec3 fan = vec3(0.0);
        for (int k = 0; k < NR; k++) {
            if (gRayBeam[k] != float(b) || gOutP[k].w <= 0.0) continue;
            fan += gRayCol[k] * gOutP[k].w * stripHaze(a, c, gOut[k].xy, gOut[k].zw, gOutP[k].x, gOutP[k].y, gOutP[k].z);
        }
        // The fan is spread thin, so the eye is helped to it a little.
        sum += (acc + fan * (gBeamCol[b] * (gInP[b].z * FAN_LIFT))) * span;
    }
    return sum * gHaze;
}

// The beams where they cross the inside of the glass, along a view ray from t0 to t1 (glass scatters a little too).
vec3 hazeIn(vec3 ro, vec3 rd, float t0, float t1) {
    vec3 sum = vec3(0.0);
    for (int b = 0; b < 2; b++) {
        if (gInP[b].z <= 0.0) continue;
        vec2 sp = slabSpan(ro, rd, t0, t1, gBeamZ[b]);
        if (sp.y <= sp.x) continue;
        vec2 a = ro.xy + rd.xy * sp.x;
        vec2 c = ro.xy + rd.xy * sp.y;
        vec3 acc = vec3(0.0);
        for (int k = 0; k < NR; k++) {
            if (gRayBeam[k] != float(b)) continue;
            float th = gRayThick[k];
            vec3 col = gRayCol[k] * gBeamCol[b] * gInP[b].z;
            for (int s = 0; s < 3; s++) {
                vec4 seg = s == 0 ? gSeg0[k] : (s == 1 ? gSeg1[k] : gSeg2[k]);
                vec2 dv = seg.zw - seg.xy;
                float len = length(dv);
                if (len < 1e-4) continue;
                acc += col * stripHaze(a, c, seg.xy, dv / len, len, th, 0.0);
            }
        }
        sum += acc * (sp.y - sp.x);
    }
    return sum * (gHaze * 0.5 + 3.0);
}

// All the beams' light at a point of a surface: p is the point seen end-on, z where it lies along the bar,
// fp the pixel's width there. tilt.x and tilt.y pick out the part of each ray's direction that faces the surface.
vec3 lightAt(vec2 p, float z, float fp, vec2 tilt) {
    vec3 sum = vec3(0.0);
    for (int b = 0; b < 2; b++) {
        if (gInP[b].z <= 0.0) continue;
        float zm = band(z, gBeamZ[b].x - gBeamZ[b].y, gBeamZ[b].x + gBeamZ[b].y, max(fp, 0.004));
        if (zm <= 0.0) continue;
        vec3 acc = gBeamCol[b] * gInP[b].z * stripAt(p, gIn[b].xy, gIn[b].zw, gInP[b].x, gInP[b].y, 0.0) * max(dot(gIn[b].zw, tilt), 0.0);
        acc += gBeamCol[b] * gRfP[b].z * stripAt(p, gRf[b].xy, gRf[b].zw, gRfP[b].x, gRfP[b].y, 0.0) * max(dot(gRf[b].zw, tilt), 0.0);
        vec3 fan = vec3(0.0);
        for (int k = 0; k < NR; k++) {
            if (gRayBeam[k] != float(b) || gOutP[k].w <= 0.0) continue;
            fan += gRayCol[k] * gOutP[k].w * stripAt(p, gOut[k].xy, gOut[k].zw, gOutP[k].x, gOutP[k].y, gOutP[k].z) * max(dot(gOut[k].zw, tilt), 0.0);
        }
        sum += (acc + fan * (gBeamCol[b] * gInP[b].z)) * zm;
    }
    return sum;
}

// The dim lights of the room, for the bar to mirror: two thin strips overhead, running the way the bar runs,
// and a short strip on the wall behind the camera.
vec3 env(vec3 d) {
    vec3 c = gInk * 0.004;
    if (d.y > 0.05) {
        vec2 q = d.xz / d.y;
        c += gInk * (1.6 * gLevel) * band(q.x, -0.62, -0.5, 0.008) * band(q.y, -2.5, 1.2, 0.012);
        c += gInk * (1.1 * gLevel) * band(q.x, 0.9, 0.98, 0.008) * band(q.y, -2.0, 0.6, 0.012);
    }
    if (d.z < -0.05) {
        vec2 q = d.xy / -d.z;
        c += gInk * (1.2 * gLevel) * band(q.x, -0.2, 1.3, 0.012) * band(q.y, 0.42, 0.5, 0.008);
    }
    return c;
}

// The table at a point: a black optical bench with a grid of small threaded holes, dimly lit from above,
// darker under the bar, and lit by whatever beams land on it.
vec3 tableAt(vec3 p, float fp) {
    vec2 g = (fract(p.xz / 0.5 + 0.5) - 0.5) * 0.5;
    float r = length(g);
    float w = max(fp, 0.002);
    float seen = 0.05 / (0.05 + fp);
    float hole = smoothstep(0.05 + w, 0.05 - w, r) * seen;
    float rim = smoothstep(2.0 * w + 0.01, 0.0, abs(r - 0.062)) * seen;
    float alb = 0.07 * (1.0 - 0.8 * hole) + 0.05 * rim;
    // The room's dim light, and the bar's own shadow under it.
    float under = exp(-pow(max(abs(p.x - AXIS.x) - 0.2, 0.0) / 0.45, 2.0)) * band(p.z, -HALF_LEN, HALF_LEN, 0.25);
    float amb = 0.16 * (1.0 - 0.8 * under) * exp(-dot(p.xz, p.xz) * 0.012);
    vec3 lit = gInk * (amb * gLevel) + lightAt(vec2(p.x, 0.0), p.z, fp, vec2(0.0, -1.0)) * 70.0;
    return lit * alb;
}

// What a ray sees once it is clear of the bar: the table, the screen, or the room, through the lit haze.
vec3 beyond(vec3 ro, vec3 rd, float foot) {
    float t = 60.0;
    vec3 col = env(rd);
    if (rd.y < -1e-4) {
        t = -ro.y / rd.y;
        vec3 p = ro + rd * t;
        col = tableAt(p, foot * t / max(-rd.y, 0.08));
    }
    if (rd.x > 1e-4) {
        float tc = (SCREEN_X - ro.x) / rd.x;
        vec3 pc = ro + rd * tc;
        float w = max(foot * tc, 0.002);
        float cov = band(pc.y, -1.0, SCREEN_H, w) * band(pc.z, SCREEN_Z - SCREEN_HW, SCREEN_Z + SCREEN_HW, w);
        if (tc > 0.0 && tc < t && cov > 0.0) {
            // The screen: matte white card, lit only by the beams and a trace of the room.
            vec3 card = (gInk * (0.03 * gLevel) + lightAt(vec2(SCREEN_X, pc.y), pc.z, w, vec2(1.0, 0.0)) * 8.0) * 0.8;
            col = mix(col, card, cov);
            t = mix(t, tc, cov);
        }
    }
    return col + hazeOut(ro, rd, 0.0, t);
}

// Where a ray from outside meets the bar: the distance (or -1) and the face's normal.
float barEnter(vec3 ro, vec3 rd, out vec3 nrm) {
    float tn = -1e9;
    float tf = 1e9;
    nrm = vec3(0.0, 1.0, 0.0);
    for (int k = 0; k < 5; k++) {
        vec4 pl = gPl[k];
        float dn = dot(pl.xyz, rd);
        float dist = pl.w - dot(pl.xyz, ro);
        if (dn < -1e-6) {
            float t = dist / dn;
            if (t > tn) {
                tn = t;
                nrm = pl.xyz;
            }
        } else if (dn > 1e-6) {
            tf = min(tf, dist / dn);
        } else if (dist < 0.0) {
            tn = 1e9;
        }
    }
    return (tn < tf && tn > 0.0) ? tn : -1.0;
}

// How far inside a face a point on its plane lies: the distance to the face's nearest edge.
float faceMargin(vec3 q, vec3 nrm) {
    float e = 1e9;
    for (int k = 0; k < 5; k++) {
        vec4 pl = gPl[k];
        float c = dot(pl.xyz, nrm);
        if (c < 0.9999) e = min(e, (pl.w - dot(pl.xyz, q)) / sqrt(1.0 - c * c));
    }
    return e;
}

// The bar as a view ray sees it: the room mirrored on the face it meets, and the view through the glass,
// traced for NV wavelengths: bent in, carried across (mirrored inside where the glass traps it), bent out.
// The beams crossing the glass show faintly inside it, and bright where they pierce its skin.
vec3 barLook(vec3 ro, vec3 rd, float t, vec3 nrm, float foot) {
    vec3 p = ro + rd * t;
    float ci = clamp(-dot(rd, nrm), 0.0, 1.0);
    vec3 col = fresnel(ci, IOR) * beyond(p, reflect(rd, nrm), foot);
    vec3 norm = vec3(0.0);
    for (int v = 0; v < NV; v++) norm += spectrum((float(v) + 0.5) / float(NV));
    norm = 1.0 / norm;
    for (int v = 0; v < NV; v++) {
        float tl = (float(v) + 0.5) / float(NV);
        float n = iorAt(tl);
        float wgt = 1.0 - fresnel(ci, n);
        float kin = 1.0 - (1.0 - ci * ci) / (n * n);
        vec3 d = rd / n + (ci / n - sqrt(max(kin, 0.0))) * nrm;
        vec3 q = p;
        vec3 through = vec3(0.0);
        vec3 inside = vec3(0.0);
        float len = 0.0;
        for (int b = 0; b < 4; b++) {
            float tf = 1e9;
            vec3 nf = vec3(0.0, 1.0, 0.0);
            for (int k = 0; k < 5; k++) {
                vec4 pl = gPl[k];
                float dn = dot(pl.xyz, d);
                if (dn > 1e-5) {
                    float tt = (pl.w - dot(pl.xyz, q)) / dn;
                    if (tt < tf) {
                        tf = tt;
                        nf = pl.xyz;
                    }
                }
            }
            tf = max(tf, 0.0);
            if (v == 1) inside += hazeIn(q, d, 0.0, tf);
            q += d * tf;
            len += tf;
            float co = dot(d, nf);
            float k2 = 1.0 - n * n * (1.0 - co * co);
            if (k2 > 0.0) {
                float c4 = sqrt(k2);
                vec3 o = n * d + (c4 - n * co) * nf;
                through = (1.0 - fresnel(c4, n)) * beyond(q, o, foot);
                break;
            }
            d = reflect(d, nf);
        }
        // A long path through the glass loses a little red.
        vec3 tint = exp(-vec3(0.05, 0.012, 0.022) * len);
        col += spectrum(tl) * norm * tint * wgt * through + inside * wgt;
    }
    // The edges catch the room's light as hairlines, and a beam shows where it pierces the skin.
    float ed = faceMargin(p, nrm) / max(foot * t, 1e-5);
    col += gInk * (0.2 * gLevel) * smoothstep(1.6, 0.3, ed);
    if (abs(nrm.z) < 0.5) col += lightAt(p.xy, p.z, foot * t, -nrm.xy) * 2.5;
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
    // The bar turns with the sound; a trace of drift keeps a silent room from freezing.
    float flow = vxFlow + TIME * 0.012;

    gDisp = mix(0.0, 0.1, dispersion);
    gLevel = 0.5 + 0.75 * sw;
    gHaze = mix(3.0, 24.0, haze);
    gDrift = flow * 0.6;
    gInk = ink.rgb;

    // The bar rocks about the angle of least bending; each hit snaps it to a new angle, and it swings there
    // from the last one as the hit dies away.
    float prev = mod(nHit + 63.0, 64.0);
    float ease = smoothstep(0.3, 1.0, pu);
    float snap = mix(hash11(nHit * 3.17 + 2.3), hash11(prev * 3.17 + 2.3), ease) - 0.5;
    float psi = -0.03 + 0.27 * sin(flow * mix(0.08, 0.7, turn) + 0.4) * mix(0.4, 1.0, turn) + 0.16 * snap;
    // The white beam comes down from the left at 60 degrees; at rest the bar sits so it passes with least bending.
    float slope = 1.047;
    vec2 d0 = vec2(cos(slope), -sin(slope));
    float half0 = asin(clamp(IOR * 0.5, 0.0, 1.0)) - 0.5236;
    float mid = -slope + half0;
    float apex = mid - 1.5708 + psi;
    gRin = SIDE * 0.288675;
    for (int e = 0; e < 3; e++) {
        float a = apex + 1.0472 + 2.0944 * float(e);
        gN2[e] = vec2(cos(a), sin(a));
        gPl[e] = vec4(gN2[e], 0.0, gRin + dot(gN2[e], AXIS));
    }
    gPl[3] = vec4(0.0, 0.0, 1.0, HALF_LEN);
    gPl[4] = vec4(0.0, 0.0, -1.0, HALF_LEN);

    // The white beam is aimed at the middle of the face it meets at rest; the accent beam comes in steeper,
    // further along the bar, and only while a hit lasts.
    float apex0 = mid - 1.5708;
    vec2 aim = AXIS + 0.1443 * SIDE * vec2(cos(apex0), sin(apex0)) - 0.25 * SIDE * vec2(cos(mid), sin(mid));
    float thick = 0.022;
    float wide = mix(0.03, 0.34, beam) * (0.65 + 0.7 * sw);
    vec2 d1 = vec2(cos(1.31), -sin(1.31));
    gBeamZ[0] = vec2(0.5, wide);
    gBeamZ[1] = vec2(-0.6, wide * 0.6);
    gBeamCol[0] = gInk;
    gBeamCol[1] = accent.rgb;
    float bright0 = 0.45 + 0.9 * sw;
    float bright1 = nHit > 0.5 ? 1.6 * pu : 0.0;

    vec3 normW = vec3(0.0);
    for (int l = 0; l < NW; l++) normW += spectrum((float(l) + 0.5) / float(NW));
    normW = 1.0 / normW;

    for (int b = 0; b < 2; b++) {
        vec2 dir = b == 0 ? d0 : d1;
        vec2 org = aim - dir * 14.0;
        float bright = b == 0 ? bright0 : bright1;
        int first = b == 0 ? 0 : NW;
        int count = b == 0 ? NW : NA;
        vec2 ne = vec2(0.0, 1.0);
        vec3 entry = vec3(org, 0.0);
        for (int l = 0; l < NW; l++) {
            if (l >= count) break;
            int k = first + l;
            float tl = (float(l) + 0.5) / float(count);
            // The accent beam is one color, so its wavelengths lie close together.
            float n = b == 0 ? iorAt(tl) : iorAt(0.12 + 0.2 * tl);
            vec2 nk;
            vec3 en = traceRay(k, org, dir, n, thick, 1.0, nk);
            gRayBeam[k] = float(b);
            gRayCol[k] = b == 0 ? spectrum(tl) * normW : vec3(1.0 / float(NA));
            if (l == count / 2) {
                entry = en;
                ne = nk;
            }
        }
        // Each ray fans out to meet its neighbors in the spectrum, so the colors run together with no gaps.
        for (int l = 0; l < NW; l++) {
            if (l >= count) break;
            int k = first + l;
            float spread = 0.0;
            float cnt = 0.0;
            if (l > 0) {
                vec2 u0 = gOut[k - 1].zw;
                vec2 u1 = gOut[k].zw;
                float s = abs(u0.x * u1.y - u0.y * u1.x);
                if (gOutP[k - 1].w > 0.0 && s < 0.2) {
                    spread += s;
                    cnt += 1.0;
                }
            }
            if (l < count - 1) {
                vec2 u0 = gOut[k + 1].zw;
                vec2 u1 = gOut[k].zw;
                float s = abs(u0.x * u1.y - u0.y * u1.x);
                if (gOutP[k + 1].w > 0.0 && s < 0.2) {
                    spread += s;
                    cnt += 1.0;
                }
            }
            gOutP[k].z = cnt > 0.0 ? 0.95 * spread / cnt : 0.0;
        }
        // The beam on its way in, and the faint part of it the face mirrors away.
        float hit = entry.z;
        float lenIn = hit > 0.5 ? length(entry.xy - org) : 40.0;
        gIn[b] = vec4(org, dir);
        gInP[b] = vec4(lenIn, thick, bright, 0.0);
        vec2 rdir = reflect(dir, ne);
        float ci = clamp(-dot(dir, ne), 0.0, 1.0);
        gRf[b] = vec4(entry.xy, rdir);
        gRfP[b] = vec4(landing(entry.xy, rdir), thick, hit > 0.5 ? bright * fresnel(ci, IOR) : 0.0, 0.0);
    }

    // Camera: above the near side of the table, looking down and a little along the beam.
    vec3 ro = vec3(-1.8, 4.3, -7.0);
    vec3 ta = vec3(1.5, 0.25, 0.1);
    vec3 fwd = normalize(ta - ro);
    vec3 rgt = normalize(cross(vec3(0.0, 1.0, 0.0), fwd));
    vec3 upv = cross(fwd, rgt);
    vec3 rd = normalize(pc.x * rgt + pc.y * upv + FOCAL * fwd);
    float foot = px / FOCAL;

    // The bar's outline is anti-aliased with four sub-pixel rays.
    float cov = 0.0;
    float tBar = -1.0;
    vec3 nBar = vec3(0.0, 1.0, 0.0);
    vec3 rdBar = rd;
    for (int s = 0; s < 4; s++) {
        float fs = float(s);
        vec2 o = (vec2(mod(fs, 2.0), floor(fs / 2.0)) - 0.5) * 0.5;
        vec3 rk = normalize((pc.x + o.x * px) * rgt + (pc.y + o.y * px) * upv + FOCAL * fwd);
        vec3 nk;
        float tk = barEnter(ro, rk, nk);
        if (tk > 0.0) {
            cov += 0.25;
            if (tBar < 0.0) {
                tBar = tk;
                nBar = nk;
                rdBar = rk;
            }
        }
    }
    vec3 nc;
    float tc = barEnter(ro, rd, nc);
    if (tc > 0.0) {
        tBar = tc;
        nBar = nc;
        rdBar = rd;
    }

    vec3 col = vec3(0.0);
    // The one view of the bar this pixel traces: the bar itself, or its image in the table's polish.
    vec3 lookRo = ro;
    vec3 lookRd = rdBar;
    float lookT = tBar;
    vec3 lookN = nBar;
    float lookW = cov;
    if (cov < 1.0) {
        vec3 bg = beyond(ro, rd, foot);
        if (rd.y < -1e-4) {
            float tf = -ro.y / rd.y;
            vec3 p = ro + rd * tf;
            if (p.x < SCREEN_X) {
                // The table's polish: the beams, the screen and the bar mirrored in it.
                vec3 rr = vec3(rd.x, -rd.y, rd.z);
                float f1 = 1.0 - clamp(-rd.y, 0.0, 1.0);
                float fm = (0.04 + 0.96 * f1 * f1 * f1 * f1 * f1) * 0.8 * exp(-dot(p.xz, p.xz) * 0.006);
                vec3 nm;
                float tm = barEnter(p, rr, nm);
                if (tm > 0.0 && cov <= 0.0) {
                    lookRo = p;
                    lookRd = rr;
                    lookT = tm;
                    lookN = nm;
                    lookW = fm;
                } else {
                    bg += beyond(p, rr, foot) * fm;
                }
            }
        }
        col += bg * (1.0 - cov);
    }
    if (lookW > 0.0) col += barLook(lookRo, lookRd, lookT, lookN, foot) * lookW;

    // The view falls off a little toward its corners.
    vec2 vg = uv - 0.5;
    col *= 1.0 - 0.3 * dot(vg, vg) * 2.0;

    // Tone map on the brightest channel so the spectrum keeps its colors, then dither against banding.
    float lum = max(max(col.r, col.g), col.b);
    col = col / max(lum, 1e-4) * (1.0 - exp(-lum * 1.6));
    col += (hash21(gl_FragCoord.xy + fract(TIME) * 91.7) - 0.5) / 255.0;
    col = max(col, 0.0);

    vec3 outc = col;
    float outa = 1.0;
    if (vxClear) {
        // The bar is solid; the table, the haze and the room are only as solid as they are bright.
        float lt = clamp(max(max(col.r, col.g), col.b) * 1.4, 0.0, 1.0);
        outa = cov + (1.0 - cov) * lt;
        outc = min(col, vec3(outa));
    }
    gl_FragColor = vec4(outc, outa) * vxPresence;
}
