/*{
    "CREDIT": "Ghost Arcade",
    "ISFVSN": "2",
    "CATEGORIES": [
        "Visual Voices",
        "Generator"
    ],
    "DESCRIPTION": "A wide pool of liquid chrome seen from low down, its surface a mirror for a soft studio of light boxes and a glowing horizon. The sound's level raises a slow swell in the middle of the pool, wider for low notes and taller for high ones. Each hit drops a ring ripple from the center that runs out across the metal and fades, bending the reflections as it passes. With no sound the pool lies almost still and dim, breathing with a faint drift.",
    "PASSES": [
        {
            "TARGET": "rings",
            "PERSISTENT": true,
            "FLOAT": true,
            "WIDTH": 32,
            "HEIGHT": 1
        },
        {}
    ],
    "INPUTS": [
        { "NAME": "vxSource", "LABEL": "Follows", "TYPE": "long", "DEFAULT": 5, "VALUES": [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20], "LABELS": ["Everything", "Kick", "Snare and clap", "Hats", "Toms and crash", "Bass", "Lead", "Chords", "Pads and textures", "Shots and siren", "What you play", "Bowls", "Drone", "XY tone", "Analog synth", "Scan synth", "Echo shots", "Build and drop", "Siren", "Acid line", "Dub bass"] },
        { "NAME": "vxAuto", "LABEL": "Comes and goes with its sound", "TYPE": "bool", "DEFAULT": true },
        { "NAME": "vxClear", "LABEL": "Transparent background", "TYPE": "bool", "DEFAULT": false },
        { "NAME": "swellAmt", "LABEL": "Swell", "TYPE": "float", "DEFAULT": 0.6, "MIN": 0, "MAX": 1 },
        { "NAME": "ripples", "LABEL": "Ripples", "TYPE": "float", "DEFAULT": 0.6, "MIN": 0, "MAX": 1 },
        { "NAME": "camHeight", "LABEL": "Camera height", "TYPE": "float", "DEFAULT": 0.3, "MIN": 0, "MAX": 1 },
        { "NAME": "drift", "LABEL": "Drift", "TYPE": "float", "DEFAULT": 0.4, "MIN": 0, "MAX": 1 },
        { "NAME": "ink", "LABEL": "Chrome", "TYPE": "color", "DEFAULT": [0.78, 0.86, 1.0, 1.0] },
        { "NAME": "accent", "LABEL": "Side lights", "TYPE": "color", "DEFAULT": [0.16, 0.34, 1.0, 1.0] },
        { "NAME": "palLight", "LABEL": "Key light", "TYPE": "color", "DEFAULT": [1.0, 0.95, 0.88, 1.0] },
        { "NAME": "palGround", "LABEL": "Horizon", "TYPE": "color", "DEFAULT": [0.2, 0.3, 0.85, 1.0] },
        { "NAME": "vxSwell", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxHit", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxPulse", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxVel", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxGlide", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxFlow", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1000 },
        { "NAME": "vxCount", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 63 },
        { "NAME": "vxPresence", "TYPE": "float", "DEFAULT": 1, "MIN": 0, "MAX": 1 }
    ]
}*/

// The pool: radius, and the height of its flat top above the floor.
const float POOL_R = 1.4;
const float POOL_T = 0.07;
// How fast a ring runs outward (units per second) and how long it lives.
const float RING_SPEED = 1.05;
const float RING_LIFE = 2.2;
const float PI = 3.14159265;

float hash21(vec2 q) {
    vec3 p3 = fract(vec3(q.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
}

// Ring ages and strengths, read once per pixel in main and kept here.
float gAge0;
float gAge1;
float gAge2;
float gAge3;
float gAmp0;
float gAmp1;
float gAmp2;
float gAmp3;
float gSwell;
float gDomeW;
float gFlow;
float gPress;

float ringWave(float r, float age, float amp) {
    if (amp < 0.001 || age > RING_LIFE) return 0.0;
    float front = age * RING_SPEED;
    float x = r - front;
    // A short wave packet that widens and fades as it travels.
    float w = 0.16 + 0.22 * age;
    float env = exp(-x * x / (w * w)) * exp(-age * 1.5) * smoothstep(0.0, 0.08, age);
    // Spreading in a circle thins the ring.
    env *= 1.0 / sqrt(1.0 + 2.5 * front);
    return amp * env * sin(x * 15.0 - age * 3.0);
}

// The moving part of the liquid's height (everything but the pool's own profile).
float waves(vec2 c) {
    float r = length(c);
    float h = 0.0;
    // At rest: a faint slow drift of long low waves.
    h += 0.0045 * sin(dot(c, vec2(3.1, 1.7)) + gFlow * 0.9);
    h += 0.0035 * sin(dot(c, vec2(-2.3, 3.6)) - gFlow * 0.7 + 1.3);
    h += 0.0022 * sin(dot(c, vec2(5.3, -4.1)) + gFlow * 1.3 + 4.0);
    // The swell: a broad mound in the middle, with a slow ring of motion round it.
    float dome = exp(-r * r / (gDomeW * gDomeW));
    h += gSwell * (0.30 * dome + 0.012 * sin(r * 5.0 - gFlow * 1.6) * (1.0 - dome));
    // The hit itself presses a dimple into the center before the ring leaves it.
    h -= gPress * exp(-r * r / 0.06);
    // Ring ripples from each hit.
    h += ringWave(r, gAge0, gAmp0);
    h += ringWave(r, gAge1, gAmp1);
    h += ringWave(r, gAge2, gAmp2);
    h += ringWave(r, gAge3, gAmp3);
    // Waves calm toward the rim so the edge stays a clean rounded lip.
    return h * (1.0 - smoothstep(POOL_R - 0.45, POOL_R - 0.06, r));
}

// The pool's resting profile: a flat top falling to a rounded lip at the rim.
float profile(float r) {
    float u = r / POOL_R;
    float g = 1.0 - u * u * u * u * u * u * u * u * u * u;
    if (g <= 0.0) return -(r - POOL_R) * 4.0;
    return POOL_T * sqrt(g);
}

float profileSlope(float r) {
    float u = r / POOL_R;
    float u9 = u * u * u * u * u * u * u * u * u;
    float g = max(1.0 - u9 * u, 2e-5);
    if (r >= POOL_R) return -4.0;
    return POOL_T * 0.5 / sqrt(g) * (-10.0 * u9 / POOL_R);
}

float heightAt(vec2 c) {
    return profile(length(c)) + waves(c);
}

vec3 surfNormal(vec2 c) {
    float r = max(length(c), 1e-4);
    vec2 g = profileSlope(r) * c / r;
    float e = 0.004;
    float h0 = waves(c);
    g.x += (waves(c + vec2(e, 0.0)) - h0) / e;
    g.y += (waves(c + vec2(0.0, e)) - h0) / e;
    return normalize(vec3(-g.x, 1.0, -g.y));
}

float softBox(float a, float b, vec2 ctr, vec2 hs, float soft) {
    float x = smoothstep(hs.x + soft, hs.x - soft, abs(a - ctr.x));
    float y = smoothstep(hs.y + soft, hs.y - soft, abs(b - ctr.y));
    return x * y;
}

// The studio: a glowing horizon, a long key box behind the pool, colored boxes either side
// and a dim panel overhead. camAz turns it with the camera so the key always sits behind.
vec3 studio(vec3 d, float camAz, float lights) {
    float el = asin(clamp(d.y, -1.0, 1.0));
    float az = atan(d.x, d.z) - camAz - PI;
    az = az - 2.0 * PI * floor((az + PI) / (2.0 * PI));
    vec3 col = vec3(0.0);
    // Horizon glow and a very dark floor below it.
    float above = smoothstep(-0.02, 0.03, el);
    col += palGround.rgb * (0.03 + 0.6 * exp(-max(el, 0.0) * 4.5)) * above;
    col += palGround.rgb * 0.012 * (1.0 - above);
    // A faint warm wash high up so the dark parts of the mirror are not dead.
    col += palLight.rgb * 0.025 * smoothstep(0.2, 0.9, el);
    // Key box: a long low strip behind the pool, brighter in its middle.
    float key = softBox(az, el, vec2(0.0, 0.215), vec2(0.32, 0.03), 0.022);
    col += palLight.rgb * key * (2.2 + 1.2 * cos(az * 2.2)) * lights;
    // A big soft umbrella above the key, dimmer, so the near pool is not dead.
    float umb = softBox(az, el, vec2(0.0, 0.43), vec2(0.85, 0.09), 0.09);
    col += mix(palLight.rgb, palGround.rgb, 0.45) * umb * 0.55 * lights;
    // Side boxes: tall panels in the side light color.
    float sl = softBox(az, el, vec2(-0.66, 0.27), vec2(0.17, 0.1), 0.05);
    float sr = softBox(az, el, vec2(0.7, 0.25), vec2(0.13, 0.08), 0.05);
    col += accent.rgb * (sl * 2.6 + sr * 1.8) * lights;
    // Overhead panel.
    float top = smoothstep(0.95, 1.15, el);
    col += mix(palLight.rgb, accent.rgb, 0.3) * top * 0.55 * lights;
    return col;
}

vec2 boxHit(vec3 ro, vec3 rd, vec3 bmin, vec3 bmax) {
    vec3 inv = 1.0 / rd;
    vec3 t0 = (bmin - ro) * inv;
    vec3 t1 = (bmax - ro) * inv;
    vec3 tn = min(t0, t1);
    vec3 tf = max(t0, t1);
    return vec2(max(max(tn.x, tn.y), max(tn.z, 0.0)), min(min(tf.x, tf.y), tf.z));
}

void main() {
    if (PASSINDEX == 0) {
        // Four slots (eight texels each), one per recent hit: x = when it fell, y = its strength,
        // z = which hit it was. Hit n goes to slot n mod 4, so a new ring never cuts off the last.
        float i = clamp(floor(gl_FragCoord.x / 8.0), 0.0, 3.0);
        vec4 prev = IMG_NORM_PIXEL(rings, vec2((i + 0.5) / 4.0, 0.5));
        float cnt = floor(vxCount + 0.5);
        float mine = cnt - 4.0 * floor(cnt / 4.0);
        float strength = 0.35 + 0.65 * clamp(vxVel, 0.0, 1.0);
        vec4 st = prev;
        if (abs(mine - i) < 0.5 && abs(prev.z - cnt) > 0.5) st = vec4(TIME, strength, cnt, 1.0);
        if (FRAMEINDEX < 2 || prev.a < 0.5) {
            // Cold start: if a hit is under way, place its ring where the surge says it has got to.
            st = vec4(-100.0, 0.0, -1.0, 1.0);
            if (abs(mine - i) < 0.5 && vxPulse > 0.05) {
                st = vec4(TIME - (0.06 + 0.5 * (1.0 - clamp(vxPulse, 0.0, 1.0))), strength, cnt, 1.0);
            } else if (abs(mine - i) < 0.5) {
                st.z = cnt;
            }
        }
        gl_FragColor = st;
        return;
    }

    vec2 uv = gl_FragCoord.xy / RENDERSIZE.xy;
    vec2 p = (gl_FragCoord.xy - 0.5 * RENDERSIZE.xy) / RENDERSIZE.y;

    // Signals into the height field.
    float rip = 0.025 + 0.05 * clamp(ripples, 0.0, 1.0);
    vec4 r0 = IMG_NORM_PIXEL(rings, vec2(0.125, 0.5));
    vec4 r1 = IMG_NORM_PIXEL(rings, vec2(0.375, 0.5));
    vec4 r2 = IMG_NORM_PIXEL(rings, vec2(0.625, 0.5));
    vec4 r3 = IMG_NORM_PIXEL(rings, vec2(0.875, 0.5));
    gAge0 = TIME - r0.x; gAmp0 = r0.y * rip;
    gAge1 = TIME - r1.x; gAmp1 = r1.y * rip;
    gAge2 = TIME - r2.x; gAmp2 = r2.y * rip;
    gAge3 = TIME - r3.x; gAmp3 = r3.y * rip;
    float sw = clamp(vxSwell, 0.0, 1.0);
    gSwell = sw * (0.15 + 0.85 * clamp(swellAmt, 0.0, 1.0));
    // Low notes swell wide and flat, high notes narrow and tall.
    float pitchK = clamp((vxGlide - 0.2) / 0.4, 0.0, 1.0);
    gDomeW = mix(0.85, 0.42, pitchK);
    gSwell *= mix(0.75, 1.25, pitchK);
    gFlow = vxFlow;
    gPress = clamp(vxPulse, 0.0, 1.0) * rip * 1.2;

    // Camera: low over the pool, turning very slowly round it.
    float camAz = 0.5 + TIME * (0.005 + 0.05 * drift);
    float camY = mix(0.55, 2.3, clamp(camHeight, 0.0, 1.0));
    float camD = 3.95 + 0.7 * clamp(camHeight, 0.0, 1.0);
    vec3 ro = vec3(sin(camAz) * camD, camY, cos(camAz) * camD);
    vec3 ta = vec3(0.0, 0.12, 0.0);
    vec3 fw = normalize(ta - ro);
    vec3 rt = normalize(cross(fw, vec3(0.0, 1.0, 0.0)));
    vec3 up = cross(rt, fw);
    float focal = 2.1;
    vec3 rd = normalize(fw * focal + rt * p.x + up * p.y);
    float pixW = 1.0 / (RENDERSIZE.y * focal);

    float lights = 0.42 + 0.58 * sw;

    // March the height field inside its bounding box, then refine the crossing.
    float hTop = POOL_T + 0.42;
    vec2 tb = boxHit(ro, rd, vec3(-POOL_R - 0.05, -0.02, -POOL_R - 0.05), vec3(POOL_R + 0.05, hTop, POOL_R + 0.05));
    float hit = 0.0;
    float tHit = 0.0;
    float bestM = 1e9;
    float tBest = 0.0;
    if (tb.x < tb.y) {
        const int N = 44;
        float dt = (tb.y - tb.x) / float(N);
        float tPrev = tb.x;
        float fPrev = ro.y + rd.y * tb.x - heightAt(ro.xz + rd.xz * tb.x);
        for (int k = 1; k <= N; k++) {
            float t = tb.x + dt * float(k);
            vec3 q = ro + rd * t;
            float f = q.y - heightAt(q.xz);
            // Keep the nearest miss (in pixels) for an anti-aliased silhouette.
            float m = f / (pixW * t);
            if (m < bestM) { bestM = m; tBest = t; }
            if (f < 0.0 && hit < 0.5) {
                float a = tPrev;
                float b = t;
                for (int j = 0; j < 6; j++) {
                    float mid = 0.5 * (a + b);
                    vec3 qm = ro + rd * mid;
                    if (qm.y - heightAt(qm.xz) < 0.0) b = mid; else a = mid;
                }
                tHit = 0.5 * (a + b);
                hit = 1.0;
                break;
            }
            tPrev = t;
            fPrev = f;
        }
    }
    float cover = hit > 0.5 ? 1.0 : clamp(1.0 - bestM, 0.0, 1.0);
    float tS = hit > 0.5 ? tHit : tBest;
    vec3 pos = ro + rd * tS;
    // Only the pool itself counts, not the floor round it.
    if (hit < 0.5 && length(pos.xz) > POOL_R + 0.01) cover = 0.0;

    vec3 col = vec3(0.0);
    if (cover > 0.0) {
        vec3 n = surfNormal(pos.xz);
        vec3 rf = reflect(rd, n);
        // A reflection that heads down meets the dark floor.
        vec3 env = studio(rf, camAz, lights);
        env *= mix(0.35, 1.0, smoothstep(-0.05, 0.05, rf.y));
        float cosv = clamp(dot(-rd, n), 0.0, 1.0);
        vec3 tint = mix(vec3(1.0), ink.rgb / max(max(ink.r, ink.g), max(ink.b, 1e-3)), 0.55);
        vec3 f0 = tint * 0.78;
        vec3 fres = f0 + (vec3(1.0) - f0) * pow(1.0 - cosv, 5.0);
        vec3 metal = env * fres;
        // A little dark at the very foot of the lip, where it meets the floor.
        metal *= mix(0.55, 1.0, smoothstep(0.0, 0.025, pos.y));
        col = metal * cover;
    }

    // The floor round the pool: almost black, a faint glossy echo of the studio near the pool,
    // and a contact shadow right at the lip.
    vec3 bg = vec3(0.0);
    if (!vxClear && rd.y < 0.0) {
        float tf = -ro.y / rd.y;
        vec2 fp = ro.xz + rd.xz * tf;
        float fr = length(fp);
        vec3 fenv = studio(reflect(rd, vec3(0.0, 1.0, 0.0)), camAz, lights);
        float near = exp(-max(fr - POOL_R, 0.0) * 1.6);
        float contact = smoothstep(POOL_R, POOL_R + 0.25, fr);
        bg = fenv * 0.025 * near * contact;
    }
    col += bg * (1.0 - cover);

    // Tone map on luminance so bright reflections keep their hue, then dither.
    float lum = max(max(col.r, col.g), col.b);
    col = col / max(lum, 1e-4) * (1.0 - exp(-lum * 1.35));
    col += (hash21(gl_FragCoord.xy + fract(TIME) * 91.7) - 0.5) / 255.0;
    col = max(col, 0.0);

    vec3 outc = col;
    float outa = 1.0;
    if (vxClear) {
        // The pool is a solid object; nothing round it is drawn.
        outa = cover;
        outc = min(col, vec3(outa));
    }
    gl_FragColor = vec4(outc, outa) * vxPresence;
}
