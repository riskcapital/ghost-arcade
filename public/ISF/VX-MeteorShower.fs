/*{
    "CREDIT": "Ghost Arcade",
    "ISFVSN": "2",
    "CATEGORIES": [
        "Visual Voices",
        "Generator"
    ],
    "DESCRIPTION": "A meteor shower: white-hot streaks with glowing trails burn across the sky, all fanning out from one point beyond the corner of the frame. The louder the sound, the thicker the shower; every hit makes every meteor flare and launches a big fireball that tears across the sky over the beat. With a transparent background only the streaks remain, raking across whatever is underneath.",
    "INPUTS": [
        { "NAME": "vxSource", "LABEL": "Follows", "TYPE": "long", "DEFAULT": 3, "VALUES": [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20], "LABELS": ["Everything", "Kick", "Snare and clap", "Hats", "Toms and crash", "Bass", "Lead", "Chords", "Pads and textures", "Shots and siren", "What you play", "Bowls", "Drone", "XY tone", "Analog synth", "Scan synth", "Echo shots", "Build and drop", "Siren", "Acid line", "Dub bass"] },
        { "NAME": "vxAuto", "LABEL": "Comes and goes with its sound", "TYPE": "bool", "DEFAULT": true },
        { "NAME": "vxClear", "LABEL": "Transparent background", "TYPE": "bool", "DEFAULT": false },
        { "NAME": "amount", "LABEL": "Amount", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0, "MAX": 1 },
        { "NAME": "fireball", "LABEL": "Fireball", "TYPE": "float", "DEFAULT": 0.8, "MIN": 0, "MAX": 1 },
        { "NAME": "trail", "LABEL": "Trail", "TYPE": "float", "DEFAULT": 0.55, "MIN": 0, "MAX": 1 },
        { "NAME": "speed", "LABEL": "Speed", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0, "MAX": 1 },
        { "NAME": "radiant", "LABEL": "Comes from", "TYPE": "long", "DEFAULT": 0, "VALUES": [0, 1, 2], "LABELS": ["Top right", "Top left", "Overhead"] },
        { "NAME": "thickness", "LABEL": "Thickness", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0, "MAX": 1 },
        { "NAME": "ink", "LABEL": "Trails", "TYPE": "color", "DEFAULT": [0.35, 0.7, 1.0, 1.0] },
        { "NAME": "accent", "LABEL": "Fireball", "TYPE": "color", "DEFAULT": [0.55, 1.0, 0.6, 1.0] },
        { "NAME": "vxEnv", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxHit", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxVel", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxPhase", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1000 },
        { "NAME": "vxCount", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 64 },
        { "NAME": "vxPresence", "TYPE": "float", "DEFAULT": 1, "MIN": 0, "MAX": 1 },
        { "NAME": "vxBeat", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxEnergy", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 }
    ]
}*/

const float TAU = 6.2831853;
const float PI = 3.14159265;
const int LAYERS = 3;

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

float stars(vec2 p, float cells) {
    vec2 g = p * cells;
    vec2 id = floor(g);
    vec2 f = fract(g) - 0.5;
    float h = hash21(id);
    vec2 o = vec2(hash21(id + 7.1), hash21(id + 3.7)) - 0.5;
    float d = length(f - o * 0.7);
    return step(0.86, h) * smoothstep(0.09, 0.0, d) * (0.3 + 0.7 * hash21(id + 1.3));
}

// One streak in radiant polar space. s = distance behind the head (negative = ahead),
// dp = distance across the path. Returns vec2(head light, trail light).
vec2 streak(float s, float dp, float w, float len) {
    float across = dp * dp / (w * w);
    float head = exp(-(across + s * s / (w * w * 2.0))) ;
    float halo = exp(-(dp * dp + s * s) / (w * w * 10.0)) * 0.3;
    float tailMask = step(0.0, s) * smoothstep(len, 0.0, s);
    float widen = 1.0 + s / max(len, 1e-3) * 1.5;
    float tail = exp(-across / (widen * widen)) * tailMask * tailMask / widen;
    return vec2(head + halo, tail);
}

void main() {
    vec2 res = RENDERSIZE;
    float aspect = res.x / res.y;
    vec2 p = (gl_FragCoord.xy - 0.5 * res) / res.y;
    float t = vxPhase * 0.02 * (0.5 + speed) + TIME * 0.05 * (0.5 + speed);

    vec2 rad = vec2(0.5 * aspect + 0.25, 0.72);
    if (radiant == 1) {
        rad = vec2(-0.5 * aspect - 0.25, 0.72);
    } else if (radiant == 2) {
        rad = vec2(0.05, 1.05);
    }
    vec2 v = p - rad;
    float r = length(v);
    float a = atan(v.y, v.x);

    float hitK = vxHit * (0.55 + 0.45 * vxVel);
    float swell = vxEnv * 0.75 + vxEnergy * 0.25;
    float w0 = mix(0.0018, 0.005, thickness);

    vec3 headC = mix(vec3(1.0), accent.rgb, 0.3);
    vec3 tailC = ink.rgb;

    vec3 col = vec3(0.0);
    float cover = 0.0;

    for (int li = 0; li < LAYERS; li++) {
        float fl = float(li);
        // Nearer layers: wider lanes, thicker and brighter streaks.
        float dA = mix(0.022, 0.009, fl / 2.0);
        float depth = mix(1.0, 0.45, fl / 2.0);
        float lane = floor(a / dA);
        float h = hash11(lane * 1.37 + fl * 71.3);
        float h2 = hash11(lane * 2.11 + fl * 13.7 + 5.0);
        float h3 = hash11(lane * 0.73 + fl * 29.1 + 9.0);
        float period = mix(2.2, 5.5, h3);
        float tt = t * (0.7 + 0.6 * h2) / period + h;
        float cyc = floor(tt);
        float f = fract(tt);
        // Whether this lane fires on this cycle.
        float chance = 0.18 + 0.5 * amount + 0.32 * swell;
        float on = step(hash11(cyc * 3.1 + lane * 0.37 + fl * 17.0), chance);
        float duty = mix(0.22, 0.35, h2);
        float life = f / duty;
        if (on > 0.0 && life < 1.0) {
            float laneC = (lane + 0.2 + 0.6 * hash11(cyc + lane * 4.7)) * dA;
            float startR = mix(0.25, 1.9, hash11(cyc * 1.7 + lane));
            if (radiant == 2) {
                startR = mix(0.05, 1.2, hash11(cyc * 1.7 + lane));
            }
            float travel = mix(0.35, 0.95, h3) * depth;
            float headR = startR + life * travel;
            float w = w0 * depth * (0.7 + 0.6 * h);
            float len = mix(0.08, 0.5, trail) * depth * (0.6 + 0.8 * h2) * smoothstep(0.0, 0.35, life);
            float dp = (a - laneC) * r;
            float s = headR - r;
            vec2 st = streak(s, dp, w, len);
            float env = sin(PI * life);
            env *= env;
            float b = env * depth * (1.0 + hitK * 2.5 + swell * 0.6);
            col += headC * st.x * b * 1.6 + tailC * st.y * b * 0.9;
            cover += (st.x * 1.6 + st.y * 1.4) * b;
        }
    }

    // The fireball: launched by each hit, crosses during the beat.
    float fbOn = fireball * clamp(max(vxEnv, vxEnergy * 0.7) * 1.4, 0.0, 1.0);
    if (fbOn > 0.001) {
        float sd = floor(vxCount + 0.5);
        float fa = mix(-0.2, 0.2, hash11(sd * 3.7 + 1.0));
        // Aim the fireball across the middle of the frame.
        vec2 dir0 = normalize(-rad);
        float ca = cos(fa);
        float sa = sin(fa);
        vec2 dirF = vec2(ca * dir0.x - sa * dir0.y, sa * dir0.x + ca * dir0.y);
        float dist0 = length(rad);
        float startR = dist0 - 0.9;
        float prog = clamp(vxBeat, 0.0, 1.0);
        float headR = startR + prog * 1.5;
        vec2 hp = rad + dirF * headR;
        vec2 rel = p - hp;
        float s = -dot(rel, dirF);
        float dp = dot(rel, vec2(-dirF.y, dirF.x));
        // A slight wobble in the trail, as the rock fragments.
        dp += (noise1(s * 18.0 + sd) - 0.5) * 0.006 * smoothstep(0.0, 0.3, s);
        float w = w0 * 3.2 * (1.0 + hitK);
        float len = mix(0.35, 1.1, trail) * smoothstep(0.0, 0.25, prog + 0.1);
        vec2 st = streak(s, dp, w, len);
        float fade = (1.0 - smoothstep(0.75, 1.0, prog)) * fbOn;
        // Fragments shed along the trail.
        float frag = 0.0;
        for (int k = 0; k < 5; k++) {
            float fk = float(k);
            float fs = 0.06 + fk * 0.07 + 0.03 * hash11(sd + fk);
            float fo = (hash11(sd * 2.3 + fk) - 0.5) * 0.02 * (1.0 + fs * 4.0);
            vec2 fr = vec2(s - fs, dp - fo);
            frag += exp(-dot(fr, fr) / (w * w * 0.6)) * (0.8 - fk * 0.12);
        }
        float flash = exp(-dot(rel, rel) / (0.004 + 0.01 * hitK)) * (0.25 + hitK * 0.9);
        vec3 fbHead = mix(vec3(1.0), accent.rgb, 0.45);
        vec3 fbTail = mix(accent.rgb, ink.rgb, 0.35);
        col += (fbHead * (st.x * 2.4 + frag * 1.5) + fbTail * st.y * 1.6 + accent.rgb * flash * 0.5) * fade;
        cover += (st.x * 2.0 + frag + st.y * 1.6 + flash * 0.5) * fade;
    }

    col = 1.0 - exp(-col * 1.6);
    float alpha = clamp(1.0 - exp(-cover * 3.5), 0.0, 1.0);

    vec3 outc;
    float outa;
    if (vxClear) {
        outa = alpha;
        outc = min(col, vec3(outa));
    } else {
        // Night sky: deep gradient, stars, and a faint glow along the horizon.
        float yN = p.y + 0.5;
        vec3 bg = mix(ink.rgb * 0.06 + vec3(0.01, 0.012, 0.02), vec3(0.003, 0.004, 0.01), smoothstep(0.0, 0.9, yN));
        bg += (stars(p + 1.0, 70.0) + 0.6 * stars(p * 1.6 + 7.0, 70.0)) * vec3(0.85, 0.9, 1.0) * 0.65 * smoothstep(0.02, 0.25, yN);
        // A low ridge on the horizon.
        float ridge = 0.06 + 0.035 * noise1(p.x * 4.0 + 3.0) + 0.015 * noise1(p.x * 17.0);
        float land = smoothstep(ridge + 0.002, ridge - 0.002, yN);
        bg = mix(bg, vec3(0.002), land);
        outc = col * (1.0 - land) + bg * (1.0 - alpha * (1.0 - land));
        outa = 1.0;
    }
    gl_FragColor = vec4(outc, outa) * vxPresence;
}
