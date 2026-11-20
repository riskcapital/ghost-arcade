/*{
    "CREDIT": "Ghost Arcade",
    "ISFVSN": "2",
    "CATEGORIES": [
        "Visual Voices",
        "Generator"
    ],
    "DESCRIPTION": "One large cut-glass gem turning above a dark glossy floor, under a pin spot and a studio of hard-edged light strips. Every ray is bent into the gem at the facet it meets, followed across the inside (bouncing where the glass traps it) and bent out again, once for each of a dozen wavelengths, so each facet holds a crisp, shifted piece of the lights and their edges split into spectra. The outer facets mirror the room, the gem throws a shadow, and the spot's light comes out of it as sharp colored shards on the floor that sweep as it turns. The sound's motion turns the gem and slides the strips; its level brightens the lights; each hit snaps the gem to a new angle and flashes one strip in the accent color. With no sound the gem hangs still in a dim light.",
    "PASSES": [
        {}
    ],
    "INPUTS": [
        { "NAME": "vxSource", "LABEL": "Follows", "TYPE": "long", "DEFAULT": 7, "VALUES": [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20], "LABELS": ["Everything", "Kick", "Snare and clap", "Hats", "Toms and crash", "Bass", "Lead", "Chords", "Pads and textures", "Shots and siren", "What you play", "Bowls", "Drone", "XY tone", "Analog synth", "Scan synth", "Echo shots", "Build and drop", "Siren", "Acid line", "Dub bass"] },
        { "NAME": "vxAuto", "LABEL": "Comes and goes with its sound", "TYPE": "bool", "DEFAULT": true },
        { "NAME": "vxClear", "LABEL": "Transparent background", "TYPE": "bool", "DEFAULT": false },
        { "NAME": "facets", "LABEL": "Facets", "TYPE": "float", "DEFAULT": 0.35, "MIN": 0, "MAX": 1 },
        { "NAME": "dispersion", "LABEL": "Dispersion", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0, "MAX": 1 },
        { "NAME": "turn", "LABEL": "Turn", "TYPE": "float", "DEFAULT": 0.4, "MIN": 0, "MAX": 1 },
        { "NAME": "gloss", "LABEL": "Floor gloss", "TYPE": "float", "DEFAULT": 0.6, "MIN": 0, "MAX": 1 },
        { "NAME": "ink", "LABEL": "Lights", "TYPE": "color", "DEFAULT": [0.86, 0.92, 1.0, 1.0] },
        { "NAME": "accent", "LABEL": "Strip the hit lights", "TYPE": "color", "DEFAULT": [1.0, 0.3, 0.12, 1.0] },
        { "NAME": "vxSwell", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxPulse", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxFlow", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1000 },
        { "NAME": "vxCount", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 64 },
        { "NAME": "vxPresence", "TYPE": "float", "DEFAULT": 1, "MIN": 0, "MAX": 1 }
    ]
}*/

// Facet planes of the gem (at most): a table, a culet, and up to eight facets in each of four rings.
const int NPL = 34;
// Rays per pixel on the gem and wavelengths per ray (twenty-four wavelengths a pixel in all), wavelengths for
// the floor, and how many times a ray may cross the inside of the gem before it is given up.
const int NAA = 4;
const int NLV = 6;
const int NLC = 6;
const int NBOUNCE = 5;
const float FOCAL = 1.6;
// Glass: its index for the middle of the spectrum.
const float IOR = 1.75;
// Where the gem hangs, and a sphere that holds all of it.
const vec3 GEM_AT = vec3(-1.0, 1.7, 0.6);
const float GEM_R = 1.62;
// The gem's size: the radius of its girdle.
const float GEM_S = 1.25;
// The studio: side walls at x = -ROOM.x and ROOM.x, ceiling at ROOM.y, the wall behind the camera at -ROOM.z,
// and the far wall at ROOM_BACK.
const vec3 ROOM = vec3(5.5, 5.5, 8.0);
const float ROOM_BACK = 7.0;

// Set once per pixel in main(). Each plane is its outward normal and its distance, in the room's space.
vec4 gPl[34];
float gNP;
float gDisp;
float gLevel;
float gGloss;
vec3 gL;
vec3 gInk;
vec3 gAcc;
// Where the sliding strips are, and how far the latest hit has lit each of the four in the accent color.
vec4 gSlide;
vec4 gFlash;

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

// How much light a glass surface mirrors: ci is the cosine of the angle on the air side, n the index.
float fresnel(float ci, float n) {
    float st2 = (1.0 - ci * ci) / (n * n);
    float ct = sqrt(max(1.0 - st2, 0.0));
    float rs = (ci - n * ct) / (ci + n * ct);
    float rp = (ct - n * ci) / (ct + n * ci);
    return 0.5 * (rs * rs + rp * rp);
}

// Snell's law going into the glass: the ray i bent at a facet whose outward normal is nrm.
vec3 refrIn(vec3 i, vec3 nrm, float n) {
    float c = -dot(nrm, i);
    float k = 1.0 - (1.0 - c * c) / (n * n);
    return i / n + (c / n - sqrt(max(k, 0.0))) * nrm;
}

// How much of a soft window of half-width e round x lies between a and b: a hard-edged bar, anti-aliased.
float band(float x, float a, float b, float e) {
    return clamp((min(x + e, b) - max(x - e, a)) / (2.0 * e), 0.0, 1.0);
}

mat3 rotY(float a) {
    float c = cos(a);
    float s = sin(a);
    return mat3(c, 0.0, -s, 0.0, 1.0, 0.0, s, 0.0, c);
}

mat3 rotX(float a) {
    float c = cos(a);
    float s = sin(a);
    return mat3(1.0, 0.0, 0.0, 0.0, c, s, 0.0, -s, c);
}

// One facet: its normal leans by ang from the gem's axis (up for the crown, down for the pavilion) toward azimuth
// az, and its plane passes through the point at radius rad and height hgt on that azimuth.
vec4 facet(mat3 rot, float az, float ang, float rad, float hgt, float side) {
    vec3 n = vec3(sin(ang) * cos(az), side * cos(ang), sin(ang) * sin(az));
    return vec4(rot * n, GEM_S * (sin(ang) * rad + side * cos(ang) * hgt));
}

// Cut the gem: a flat table on top; a ring of star facets and a ring of main facets round the crown; a ring of
// girdle facets and a ring of main facets down the pavilion, to a small flat culet. No two facets are quite
// alike, as on a stone cut by hand.
void buildGem(float sides, mat3 rot) {
    vec3 up = rot * vec3(0.0, 1.0, 0.0);
    gPl[0] = vec4(up, GEM_S * 0.42);
    gPl[1] = vec4(-up, GEM_S * 0.9);
    float stp = 6.2832 / sides;
    for (int k = 0; k < 8; k++) {
        float fk = float(k);
        int a = 2 + 4 * k;
        if (fk < sides) {
            float j1 = hash11(fk * 7.13 + 3.1) - 0.5;
            float j2 = hash11(fk * 5.71 + 9.4) - 0.5;
            float j3 = hash11(fk * 3.37 + 6.2) - 0.5;
            float az = stp * fk;
            gPl[a] = facet(rot, az + 0.16 * stp * j1, 0.66 + 0.08 * j2, 1.0 + 0.05 * j3, 0.0, 1.0);
            gPl[a + 1] = facet(rot, az + stp * (0.5 + 0.14 * j2), 0.4 + 0.06 * j3, 0.4 + 0.04 * j1, 0.42, 1.0);
            gPl[a + 2] = facet(rot, az + stp * (0.5 + 0.16 * j3), 0.8 + 0.07 * j1, 1.0 + 0.05 * j2, 0.0, -1.0);
            gPl[a + 3] = facet(rot, az + 0.14 * stp * j2, 1.08 + 0.06 * j1, 0.97 + 0.04 * j3, -0.06, -1.0);
        } else {
            gPl[a] = vec4(0.0, 1.0, 0.0, 1e3);
            gPl[a + 1] = vec4(0.0, 1.0, 0.0, 1e3);
            gPl[a + 2] = vec4(0.0, 1.0, 0.0, 1e3);
            gPl[a + 3] = vec4(0.0, 1.0, 0.0, 1e3);
        }
    }
    gNP = 2.0 + 4.0 * sides;
    for (int k = 0; k < NPL; k++) {
        gPl[k].w += dot(gPl[k].xyz, GEM_AT);
    }
}

// Where a ray from outside meets the gem: the distance (or -1), the facet's normal, and the length of glass ahead.
float gemEnter(vec3 ro, vec3 rd, out vec3 nrm, out float span) {
    float tn = -1e9;
    float tf = 1e9;
    nrm = vec3(0.0, 1.0, 0.0);
    for (int k = 0; k < NPL; k++) {
        if (float(k) >= gNP) break;
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
    span = tf - tn;
    return (tn < tf && tn > 0.0) ? tn : -1.0;
}

// How far inside a facet a point on its plane lies: the distance to the facet's nearest edge, negative outside it.
float facetMargin(vec3 q, vec3 nrm) {
    float e = 1e9;
    for (int k = 0; k < NPL; k++) {
        if (float(k) >= gNP) break;
        vec4 pl = gPl[k];
        float c = dot(pl.xyz, nrm);
        if (c < 0.9999) e = min(e, (pl.w - dot(pl.xyz, q)) / sqrt(1.0 - c * c));
    }
    return e;
}

// A row of bars: how lit the point x is, for bars of the given width repeating every pitch; w is the pixel's width there.
float bars(float x, float pitch, float width, float w) {
    float f = fract(x / pitch) * pitch;
    return band(f, 0.5 * (pitch - width), 0.5 * (pitch + width), w);
}

// The studio as a ray from ro along d sees it. Its lights are all in the half of the room in front of the gem,
// where the floor cannot mirror them toward the camera: a ladder of long bars on the ceiling, tall slats on the
// right wall, level bars on the left wall, a softbox of square panes on the wall behind the camera; and far off
// behind the gem, the pin spot's lamp. e is the width of the cone of directions the pixel takes in.
vec3 room(vec3 ro, vec3 d, float e) {
    vec3 c = gInk * 0.006 * (0.3 + 0.7 * smoothstep(-0.3, 0.6, d.y));
    // The lamp is small and very bright: in a facet it is a point of light, split into a short spectrum.
    float kr = 0.0045;
    float ang = sqrt(max(2.0 - 2.0 * dot(d, gL), 0.0));
    c += gInk * (2500.0 * gLevel) * smoothstep(kr + e + 0.0015, kr - e - 0.0015, ang) * (kr * kr / (kr * kr + e * e));
    float tx = abs(d.x) > 1e-5 ? ((d.x > 0.0 ? ROOM.x : -ROOM.x) - ro.x) / d.x : 1e9;
    float ty = d.y > 1e-5 ? (ROOM.y - ro.y) / d.y : 1e9;
    float tz = abs(d.z) > 1e-5 ? ((d.z > 0.0 ? ROOM_BACK : -ROOM.z) - ro.z) / d.z : 1e9;
    float t = min(tx, min(ty, tz));
    vec3 p = ro + d * t;
    float w = 0.012 + 1.5 * e * t;
    if (t == ty) {
        vec3 sc = mix(gInk, gAcc, gFlash.x) * (3.4 * gLevel * (1.0 + 2.0 * gFlash.x));
        c += sc * bars(p.z + gSlide.x, 0.85, 0.2, w) * band(p.x, -4.6, 4.6, w) * band(p.z, -7.2, 2.9, w);
    } else if (t == tz) {
        if (d.z < 0.0) {
            vec3 sc = mix(gInk, gAcc, gFlash.w) * (1.8 * gLevel * (1.0 + 2.0 * gFlash.w));
            float panes = bars(p.x + gSlide.w, 1.0, 0.84, w) * bars(p.y, 1.0, 0.84, w);
            c += sc * panes * band(p.x, -4.2, 4.2, w) * band(p.y, 1.0, 5.0, w);
        }
    } else if (d.x > 0.0) {
        vec3 sc = mix(gInk, gAcc, gFlash.y) * (3.6 * gLevel * (1.0 + 2.0 * gFlash.y));
        c += sc * bars(p.z + gSlide.y, 0.75, 0.15, w) * band(p.y, 0.5, 4.9, w) * band(p.z, -7.6, -2.6, w);
    } else {
        vec3 sc = mix(gInk, gAcc, gFlash.z) * (3.0 * gLevel * (1.0 + 2.0 * gFlash.z));
        c += sc * bars(p.y + gSlide.z, 0.62, 0.13, w) * band(p.y, 0.45, 4.9, w) * band(p.z, -7.4, -2.6, w);
    }
    return c;
}

// Two lamps shine from the same place: a dim wash over the whole floor, which gives the gem its shadow, and a
// pin spot trained on the gem alone, which is the light the gem throws about. WASH is the wash's share.
const float WASH = 0.05;
const float FLOOR_LIT = 1.2;

// The wash falls away into the dark well before the walls.
float washReach(vec3 p) {
    vec2 d = p.xz - vec2(-0.2, -0.3);
    return exp(-dot(d, d) * 0.09);
}

// A downward ray's floor point, seen second-hand (in a facet): the wash and a round stand-in for the shadow.
vec3 floorLite(vec3 ro, vec3 rd) {
    float t = -ro.y / rd.y;
    vec3 p = ro + rd * t;
    vec3 v = p - GEM_AT;
    float z = -dot(v, gL);
    float rho = length(v + gL * z);
    float lit = WASH * gL.y * smoothstep(1.0, 1.25, rho) * washReach(p);
    return vec3(0.0015, 0.0017, 0.002) + gInk * (FLOOR_LIT * gLevel * lit);
}

// What a ray sees once it is clear of the gem: the floor below, or the room.
vec3 beyond(vec3 ro, vec3 rd, float e) {
    if (rd.y < -1e-3) {
        vec3 p = ro + rd * (-ro.y / rd.y);
        if (abs(p.x) < ROOM.x && p.z < ROOM_BACK && p.z > -ROOM.z) return floorLite(ro, rd);
    }
    return room(ro, rd, e);
}

// One wavelength's path across the inside of the gem, from the point p where the view ray rd met a facet.
// At each far facet the ray leaves by Snell's law, or, past the critical angle, is mirrored back in and goes on.
// Returns the direction it leaves in; q is where, wgt how much light the two crossings let through, len the glass crossed.
vec3 gemPath(vec3 p, vec3 rd, vec3 nrm, float n, out vec3 q, out float wgt, out float len) {
    float ci = clamp(-dot(rd, nrm), 0.0, 1.0);
    wgt = 1.0 - fresnel(ci, n);
    vec3 d = refrIn(rd, nrm, n);
    q = p;
    len = 0.0;
    for (int b = 0; b < NBOUNCE; b++) {
        float tf = 1e9;
        vec3 nf = vec3(0.0, 1.0, 0.0);
        for (int k = 0; k < NPL; k++) {
            if (float(k) >= gNP) break;
            vec4 pl = gPl[k];
            float dn = dot(pl.xyz, d);
            if (dn > 1e-5) {
                float t = (pl.w - dot(pl.xyz, q)) / dn;
                if (t < tf) {
                    tf = t;
                    nf = pl.xyz;
                }
            }
        }
        tf = max(tf, 0.0);
        q += d * tf;
        len += tf;
        float co = dot(d, nf);
        float k2 = 1.0 - n * n * (1.0 - co * co);
        if (k2 > 0.0) {
            float c4 = sqrt(k2);
            wgt *= 1.0 - fresnel(c4, n);
            return n * d + (c4 - n * co) * nf;
        }
        d = reflect(d, nf);
    }
    // Still trapped after the last crossing: what is left leaves dimmed.
    wgt *= 0.4;
    return d;
}

// One ray at the gem: the mirror image on the facet it meets, and the view through the glass at NLV wavelengths
// spread across the spectrum (jit shifts them, so neighboring rays fill in the wavelengths between).
// hit comes back 0 if the ray misses.
vec3 gemRay(vec3 ro, vec3 rd, float jit, vec3 norm, float foot, out float hit) {
    vec3 nrm;
    float span;
    float t = gemEnter(ro, rd, nrm, span);
    hit = 0.0;
    if (t < 0.0) return vec3(0.0);
    hit = 1.0;
    vec3 p = ro + rd * t;
    float ci = clamp(-dot(rd, nrm), 0.0, 1.0);
    vec3 col = fresnel(ci, IOR) * beyond(p, reflect(rd, nrm), foot);
    for (int l = 0; l < NLV; l++) {
        float tl = (float(l) + jit) / float(NLV);
        vec3 q;
        float wgt;
        float len;
        vec3 o = gemPath(p, rd, nrm, iorAt(tl), q, wgt, len);
        // A long path through the glass loses a little red.
        vec3 tint = exp(-vec3(0.06, 0.016, 0.028) * len);
        col += spectrum(tl) * norm * tint * wgt * beyond(q, o, foot);
    }
    // The edges between facets catch the light as hairlines.
    float ed = facetMargin(p, nrm) / max(foot * t, 1e-5);
    col += gInk * (0.22 * gLevel) * smoothstep(1.5, 0.3, ed);
    return col;
}

// One shard of a pin spot's light on the floor, at the point p. A parallel beam through flat facets is still a
// parallel beam, so the light that enters the gem by facet pi and leaves it by facet pj (after being mirrored
// inside off facet pk, when via is 1) lands as one flat-sided patch; each wavelength lands as its own patch, a
// little displaced. For each wavelength the point is taken back along the beam to the facet it left by, and
// back across the glass to the facet it entered by: it is lit if it stays inside every facet on the way.
// ld is the light's direction, w the width of floor the pixel covers.
vec3 shardOf(vec3 p, float w, vec3 ld, vec4 pi, vec4 pk, float via, vec4 pj, vec3 norm) {
    float ci = -dot(ld, pi.xyz);
    // With the middle of the spectrum, drop the shards that land nowhere near this point.
    vec3 m0 = refrIn(ld, pi.xyz, IOR);
    if (via > 0.5) m0 = reflect(m0, pk.xyz);
    float co0 = dot(m0, pj.xyz);
    float k0 = 1.0 - IOR * IOR * (1.0 - co0 * co0);
    if (k0 > 0.02) {
        float c0 = sqrt(k0);
        vec3 o0 = IOR * m0 + (c0 - IOR * co0) * pj.xyz;
        if (o0.y > -0.01) return vec3(0.0);
        float t0 = (dot(pj.xyz, p) - pj.w) / c0;
        if (t0 < 0.0) return vec3(0.0);
        vec3 q0 = p - o0 * t0;
        vec3 qc0 = q0 - GEM_AT;
        float slack = w + 0.75 * t0 * gDisp / max(c0, 0.15);
        float rr = GEM_R + slack;
        if (dot(qc0, qc0) > rr * rr) return vec3(0.0);
        if (facetMargin(q0, pj.xyz) < -slack) return vec3(0.0);
    }
    // Each wavelength's shard: how far inside it this point lies, and how bright it is there.
    float mg[6];
    float wt[6];
    for (int l = 0; l < NLC; l++) {
        float tl = (float(l) + 0.5) / float(NLC);
        float n = iorAt(tl);
        mg[l] = -1e3;
        wt[l] = 0.0;
        vec3 m = refrIn(ld, pi.xyz, n);
        float cm = -dot(m, pi.xyz);
        vec3 m1 = m;
        float refl = 1.0;
        if (via > 0.5) {
            // Past the critical angle the inner face is a perfect mirror; short of it, a faint one.
            float ck = dot(m, pk.xyz);
            float kk = 1.0 - n * n * (1.0 - ck * ck);
            if (kk > 0.0) refl = fresnel(sqrt(kk), n);
            m1 = reflect(m, pk.xyz);
        }
        float co = dot(m1, pj.xyz);
        float k2 = 1.0 - n * n * (1.0 - co * co);
        if (co <= 0.0 || k2 <= 0.0) continue;
        float c4 = sqrt(k2);
        vec3 o = n * m1 + (c4 - n * co) * pj.xyz;
        if (o.y > -0.01) continue;
        float t = (dot(pj.xyz, p) - pj.w) / c4;
        if (t < 0.0) continue;
        vec3 q = p - o * t;
        vec3 qc = q - GEM_AT;
        if (dot(qc, qc) > GEM_R * GEM_R) continue;
        float mm = facetMargin(q, pj.xyz);
        vec3 qb = q;
        if (via > 0.5) {
            qb = q + m1 * ((pk.w - dot(pk.xyz, q)) / dot(pk.xyz, m1));
            mm = min(mm, facetMargin(qb, pk.xyz));
        }
        vec3 qi = qb + m * ((pi.w - dot(pi.xyz, qb)) / -cm);
        mg[l] = min(mm, facetMargin(qi, pi.xyz));
        // The beam is squeezed or widened at each facet it crosses, and loses a little to each one's mirror.
        float conc = ci * co / (cm * max(c4, 0.06));
        float tr = (1.0 - fresnel(ci, n)) * (1.0 - fresnel(c4, n));
        wt[l] = conc * tr * refl * -o.y;
    }
    // The wavelengths between the ones traced lie between their shards: each shard's edge is spread over the
    // gap to its neighbors, so the colors run together into a spectrum with no steps, while the edges that
    // run along the spread stay sharp.
    vec3 sum = vec3(0.0);
    for (int l = 0; l < NLC; l++) {
        if (wt[l] <= 0.0) continue;
        float gap = 0.0;
        if (l > 0) {
            if (wt[l - 1] > 0.0) gap = max(gap, abs(mg[l] - mg[l - 1]));
        }
        if (l < NLC - 1) {
            if (wt[l + 1] > 0.0) gap = max(gap, abs(mg[l + 1] - mg[l]));
        }
        float ws = max(w, 0.5 * gap);
        float cover = clamp(0.5 + 0.5 * mg[l] / ws, 0.0, 1.0);
        sum += spectrum((float(l) + 0.5) / float(NLC)) * norm * (wt[l] * cover);
    }
    return sum;
}

// All the light a pin spot shining along ld sends to the floor point p by way of the gem: the shards that pass
// straight through two facets, the shards mirrored once inside, and the faint white shards mirrored off the
// outside of the lit facets. fp is the width of floor the pixel covers.
vec3 shards(vec3 p, float fp, vec3 ld) {
    vec3 sum = vec3(0.0);
    float w = max(fp, 0.004);
    vec3 norm = vec3(0.0);
    for (int l = 0; l < NLC; l++) norm += spectrum((float(l) + 0.5) / float(NLC));
    norm = 1.0 / norm;
    float nRed = IOR - 0.5 * gDisp;
    float crit2 = 1.0 - 1.0 / (nRed * nRed) - 0.01;
    for (int i = 0; i < NPL; i++) {
        if (float(i) >= gNP) break;
        vec4 pi = gPl[i];
        float ci = -dot(ld, pi.xyz);
        if (ci < 0.03) continue;
        // Mirrored off the outside of this facet.
        vec3 r = ld + 2.0 * ci * pi.xyz;
        if (r.y < -0.03) {
            float t = (dot(pi.xyz, p) - pi.w) / ci;
            vec3 q = p - r * t;
            vec3 qc = q - GEM_AT;
            if (t > 0.0 && dot(qc, qc) < GEM_R * GEM_R) {
                sum += vec3(fresnel(ci, IOR) * -r.y * smoothstep(-w, w, facetMargin(q, pi.xyz)));
            }
        }
        // Into the glass by this facet, and on to each facet the beam heads for.
        vec3 m0 = refrIn(ld, pi.xyz, IOR);
        for (int k = 0; k < NPL; k++) {
            if (float(k) >= gNP) break;
            vec4 pk = gPl[k];
            float co0 = dot(m0, pk.xyz);
            if (co0 < 0.03) continue;
            float k0 = 1.0 - IOR * IOR * (1.0 - co0 * co0);
            // Met squarely enough, the beam leaves there.
            if (k0 > -0.06) sum += shardOf(p, w, ld, pi, pk, 0.0, pk, norm);
            // Met obliquely, it is mirrored back in, and leaves by whichever facet it then meets squarely.
            if (k0 < 0.05) {
                vec3 m1 = reflect(m0, pk.xyz);
                for (int j = 0; j < NPL; j++) {
                    if (float(j) >= gNP) break;
                    vec4 pj = gPl[j];
                    float co1 = dot(m1, pj.xyz);
                    if (co1 > 0.0 && co1 * co1 > crit2) sum += shardOf(p, w, ld, pi, pk, 1.0, pj, norm);
                }
            }
        }
    }
    return sum;
}

void main() {
    vec2 uv = gl_FragCoord.xy / RENDERSIZE.xy;
    float asp = RENDERSIZE.x / RENDERSIZE.y;
    vec2 pc = vec2((uv.x - 0.5) * asp, uv.y - 0.5);
    float px = 1.0 / RENDERSIZE.y;

    float sw = clamp(vxSwell, 0.0, 1.0);
    float pu = clamp(vxPulse, 0.0, 1.0);
    float nHit = floor(vxCount + 0.5);
    // The gem turns with the sound; a trace of drift keeps a silent room from freezing.
    float flow = vxFlow + TIME * 0.012;

    gDisp = mix(0.0, 0.07, dispersion);
    gLevel = 0.5 + 0.75 * sw;
    gGloss = mix(0.3, 2.0, gloss);
    gInk = ink.rgb;
    gAcc = accent.rgb;
    gL = normalize(vec3(-0.386, 0.819, 0.424));

    // The strips slide slowly; the latest hit lights one of the four in the accent color.
    gSlide = vec4(flow * 0.11, flow * 0.083, flow * 0.061, 0.5 * sin(flow * 0.09));
    float which = floor(hash11(nHit * 5.37 + 0.7) * 4.0);
    float lit = nHit > 0.5 ? pu : 0.0;
    gFlash = vec4(which == 0.0 ? lit : 0.0, which == 1.0 ? lit : 0.0, which == 2.0 ? lit : 0.0, which == 3.0 ? lit : 0.0);

    // Each hit snaps the gem to a new angle: it swings there from the last one as the hit dies away.
    float prev = mod(nHit + 63.0, 64.0);
    float ease = smoothstep(0.3, 1.0, pu);
    float spinHit = mix(hash11(nHit * 2.39 + 4.1), hash11(prev * 2.39 + 4.1), ease) * 6.2832;
    float tiltHit = mix(hash11(nHit * 6.17 + 1.9), hash11(prev * 6.17 + 1.9), ease);
    float leanHit = mix(hash11(nHit * 4.43 + 8.3), hash11(prev * 4.43 + 8.3), ease);
    float speed = mix(0.04, 0.7, turn);
    // The table stays turned toward the camera, more or less, so the view is always into the crown.
    mat3 rot = rotY(0.45 * sin(flow * speed * 0.37) + 1.1 * (leanHit - 0.5)) * rotX(-0.62 + 0.45 * (tiltHit - 0.5) + 0.1 * sin(flow * speed * 0.6)) * rotY(flow * speed + spinHit);
    float sides = floor(mix(5.0, 8.0, facets) + 0.5);
    buildGem(sides, rot);

    // Camera: in front of the gem and above it, looking down across the floor.
    vec3 ro = vec3(0.3, 3.3, -5.6);
    vec3 ta = vec3(0.0, 1.04, 0.0);
    vec3 fwd = normalize(ta - ro);
    vec3 rgt = normalize(cross(vec3(0.0, 1.0, 0.0), fwd));
    vec3 upv = cross(fwd, rgt);
    vec3 rd = normalize(pc.x * rgt + pc.y * upv + FOCAL * fwd);
    float foot = px / FOCAL;

    // The wavelengths of all the rays of a pixel add up to white.
    vec3 normAll = vec3(0.0);
    vec3 normOne = vec3(0.0);
    for (int s = 0; s < NAA; s++) {
        for (int l = 0; l < NLV; l++) {
            normAll += spectrum((float(l) + (float(s) + 0.5) / float(NAA)) / float(NLV));
        }
    }
    for (int l = 0; l < NLV; l++) normOne += spectrum((float(l) + 0.5) / float(NLV));
    normAll = float(NAA) / normAll;
    normOne = 1.0 / normOne;

    // The gem: four rays a pixel, where the pixel is anywhere near it.
    vec3 col = vec3(0.0);
    float cov = 0.0;
    vec3 oc = ro - GEM_AT;
    float bq = dot(oc, rd);
    if (dot(oc, oc) - bq * bq < GEM_R * GEM_R) {
        for (int s = 0; s < NAA; s++) {
            float fs = float(s);
            vec2 o = (vec2(mod(fs, 2.0), floor(fs / 2.0)) - 0.5) * 0.5 + (vec2(floor(fs / 2.0), 1.0 - mod(fs, 2.0)) - 0.5) * 0.25;
            vec3 rk = normalize((pc.x + o.x * px) * rgt + (pc.y + o.y * px) * upv + FOCAL * fwd);
            float hit;
            vec3 g = gemRay(ro, rk, (fs + 0.5) / float(NAA), normAll, foot, hit);
            col += g / float(NAA);
            cov += hit / float(NAA);
        }
    }

    if (cov < 1.0) {
        vec3 bg = room(ro, rd, foot);
        float tf = rd.y < -1e-4 ? -ro.y / rd.y : 1e9;
        vec3 p = ro + rd * min(tf, 1e3);
        if (abs(p.x) < ROOM.x && p.z < ROOM_BACK && tf < 1e3) {
            float fp = foot * tf / max(-rd.y, 0.08);
            // The floor: the spot's pool with the gem's shadow cut out of it, and the shards the gem throws.
            vec3 sn;
            float span;
            float ts = gemEnter(p, gL, sn, span);
            float shadow = ts > 0.0 ? 1.0 - smoothstep(0.0, 0.05 + 2.0 * fp, span) : 1.0;
            vec3 pv = p - GEM_AT;
            float pz = -dot(pv, gL);
            float prho = length(pv + gL * pz);
            vec3 light = vec3(WASH * gL.y * shadow * washReach(p));
            if (prho < 6.5) light += shards(p, fp, -gL) * smoothstep(6.5, 5.5, prho);
            bg = vec3(0.0015, 0.0017, 0.002) + gInk * (FLOOR_LIT * gLevel) * light;
            // The floor's polish: the mirrored ray finds the gem, or the room's lights.
            vec3 rr = vec3(rd.x, -rd.y, rd.z);
            float f1 = 1.0 - clamp(-rd.y, 0.0, 1.0);
            float fm = (0.04 + 0.96 * f1 * f1 * f1 * f1 * f1) * gGloss * exp(-dot(p.xz, p.xz) * 0.006);
            float hit;
            vec3 g = gemRay(p, rr, 0.5, normOne, foot, hit);
            bg += mix(room(p, rr, foot), g, hit) * fm;
        }
        col += bg * (1.0 - cov);
    }

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
        // The gem is solid; the floor and the room are only as solid as they are bright.
        float lt = clamp(max(max(col.r, col.g), col.b) * 1.4, 0.0, 1.0);
        outa = cov + (1.0 - cov) * lt;
        outc = min(col, vec3(outa));
    }
    gl_FragColor = vec4(outc, outa) * vxPresence;
}
