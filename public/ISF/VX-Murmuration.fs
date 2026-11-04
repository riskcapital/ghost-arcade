/*{
    "CREDIT": "Ghost Arcade",
    "ISFVSN": "2",
    "CATEGORIES": [
        "Visual Voices",
        "Generator"
    ],
    "DESCRIPTION": "A murmuration: thousands of starlings wheel as one cloud across a dusk sky, dark waves rippling through the flock as it folds and turns. Every hit makes the flock flinch, twist and tear into two clouds that drift apart and then pour back together; louder sound swells the cloud and speeds its wheeling. Look picks dark birds against a sunset, birds lit gold by the low sun, or glowing birds at night.",
    "PASSES": [
        {
            "TARGET": "clock",
            "PERSISTENT": true,
            "FLOAT": true,
            "WIDTH": 1,
            "HEIGHT": 1
        },
        {}
    ],
    "INPUTS": [
        { "NAME": "vxSource", "LABEL": "Follows", "TYPE": "long", "DEFAULT": 0, "VALUES": [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20], "LABELS": ["Everything", "Kick", "Snare and clap", "Hats", "Toms and crash", "Bass", "Lead", "Chords", "Pads and textures", "Shots and siren", "What you play", "Bowls", "Drone", "XY tone", "Analog synth", "Scan synth", "Echo shots", "Build and drop", "Siren", "Acid line", "Dub bass"] },
        { "NAME": "vxAuto", "LABEL": "Comes and goes with its sound", "TYPE": "bool", "DEFAULT": true },
        { "NAME": "vxClear", "LABEL": "Transparent background", "TYPE": "bool", "DEFAULT": false },
        { "NAME": "split", "LABEL": "Split", "TYPE": "float", "DEFAULT": 0.6, "MIN": 0, "MAX": 1 },
        { "NAME": "twist", "LABEL": "Twist", "TYPE": "float", "DEFAULT": 0.55, "MIN": 0, "MAX": 1 },
        { "NAME": "flockSize", "LABEL": "Flock size", "TYPE": "float", "DEFAULT": 0.55, "MIN": 0, "MAX": 1 },
        { "NAME": "waves", "LABEL": "Waves", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0, "MAX": 1 },
        { "NAME": "birdSize", "LABEL": "Bird size", "TYPE": "float", "DEFAULT": 0.4, "MIN": 0, "MAX": 1 },
        { "NAME": "look", "LABEL": "Look", "TYPE": "long", "DEFAULT": 1, "VALUES": [0, 1, 2], "LABELS": ["Dusk silhouette", "Golden light", "Night glow"] },
        { "NAME": "ink", "LABEL": "Birds", "TYPE": "color", "DEFAULT": [0.55, 0.62, 0.95, 1.0] },
        { "NAME": "accent", "LABEL": "Sunset", "TYPE": "color", "DEFAULT": [1.0, 0.55, 0.25, 1.0] },
        { "NAME": "vxEnv", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxHit", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxVel", "TYPE": "float", "DEFAULT": 0.7, "MIN": 0, "MAX": 1 },
        { "NAME": "vxPhase", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1000 },
        { "NAME": "vxCount", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 64 },
        { "NAME": "vxEnergy", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxPresence", "TYPE": "float", "DEFAULT": 1, "MIN": 0, "MAX": 1 }
    ]
}*/

// clock (1x1): last hit count, seconds since that hit plus one (zero = fresh), the flock's
// accumulated turn (radians), and how hard that hit was.

const float TAU = 6.2831853;

float hash21(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
}

vec3 hash32(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
    p3 += dot(p3, p3.yxz + 33.33);
    return fract((p3.xxy + p3.yzz) * p3.zyx);
}

float vnoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    float a = hash21(i);
    float b = hash21(i + vec2(1.0, 0.0));
    float c = hash21(i + vec2(0.0, 1.0));
    float d = hash21(i + vec2(1.0, 1.0));
    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y) * 2.0 - 1.0;
}

float fbm3(vec2 p) {
    float s = 0.5 * vnoise(p);
    p = mat2(0.8, 0.6, -0.6, 0.8) * p * 2.02 + vec2(1.7, 9.2);
    s += 0.25 * vnoise(p);
    p = mat2(0.8, 0.6, -0.6, 0.8) * p * 2.03 + vec2(8.3, 2.8);
    s += 0.125 * vnoise(p);
    return s;
}

mat2 rot(float a) {
    float c = cos(a);
    float s = sin(a);
    return mat2(c, s, -s, c);
}

// One layer of birds on a jittered grid laid over the flock's own frame.
// Returns how much of the pixel the birds cover, and which bird it is.
vec2 birdLayer(vec2 q, float density, float cellPx, float pxPerUnit, float t, float flinch, float seed) {
    float cpu = pxPerUnit / cellPx;
    vec2 g = q * cpu + vec2(seed * 17.0, seed * 5.0);
    vec2 id0 = floor(g);
    float cover = 0.0;
    float who = 0.0;
    float rBody = 0.34 + 0.22 * birdSize;
    for (int j = -1; j <= 1; j++) {
        for (int i = -1; i <= 1; i++) {
            vec2 id = id0 + vec2(float(i), float(j));
            vec3 h = hash32(id + seed * 31.0);
            if (h.x > density) continue;
            float ph = t * (1.3 + h.z) + h.y * TAU;
            // Each bird jinks about its place; a hit makes them all flinch.
            vec2 wob = vec2(sin(ph * 1.7 + h.z * 9.0), cos(ph * 1.3 + h.y * 7.0)) * (0.18 + 0.35 * flinch);
            vec2 c = id + 0.5 + (h.yz - 0.5) * 0.55 + wob;
            vec2 d = g - c;
            // Wings beat: the bird is a short dash across its flight that thins
            // and widens, so the flock shimmers.
            float flap = 0.5 + 0.5 * sin(t * (9.0 + 6.0 * h.y) + h.z * TAU);
            vec2 e = d / vec2(rBody * (0.75 + 0.6 * flap), rBody * (0.5 - 0.22 * flap));
            float r = length(e);
            float cv = clamp(1.0 - (r - 1.0) * rBody * cellPx * 0.6, 0.0, 1.0);
            if (cv > cover) {
                cover = cv;
                who = fract(h.y * 7.31 + h.z * 3.17);
            }
        }
    }
    return vec2(cover, who);
}

void main() {
    float dt = clamp(TIMEDELTA, 0.0, 0.1);
    float n = floor(vxCount + 0.5);

    if (PASSINDEX == 0) {
        vec4 c = IMG_NORM_PIXEL(clock, vec2(0.5));
        // An all-zero texel means a fresh buffer (the voice was just added):
        // start as if the last hit was long ago. The age is stored plus one,
        // so a live clock never reads zero there.
        if (FRAMEINDEX < 2 || c.g < 0.5) c = vec4(n, 31.0, 0.0, 0.7);
        bool newHit = abs(n - c.r) > 0.5;
        float age = newHit ? 0.0 : min(c.g - 1.0 + dt, 30.0);
        float vel = newHit ? clamp(vxVel, 0.2, 1.0) : c.a;
        // The flock wheels slowly on its own and swings round after each hit,
        // one way then the other.
        float dir = mod(n, 2.0) < 0.5 ? 1.0 : -1.0;
        float spin = 0.06 + 0.25 * vxEnv + dir * twist * vel * 2.6 * exp(-age * 2.2);
        float turn = mod(c.b + spin * dt, TAU * 8.0);
        gl_FragColor = vec4(n, age + 1.0, turn, vel);
        return;
    }

    vec4 clk = IMG_NORM_PIXEL(clock, vec2(0.5));
    bool fresh = clk.g < 0.5;
    float age = fresh ? 30.0 : clk.g - 1.0;
    if (vxHit > 0.01) age = min(age, (1.0 - clamp(vxHit, 0.0, 1.0)) * 0.1);
    float vel = fresh ? 0.7 : clk.a;
    float turn = clk.b;

    vec2 res = RENDERSIZE;
    float pxPerUnit = res.y;
    vec2 p = (gl_FragCoord.xy - 0.5 * res) / res.y;
    float t = vxPhase * 0.35 + TIME * 0.05;

    // Split: the cloud tears into two lobes that drift apart and pour back.
    float sp = split * (0.35 + 0.65 * vel) * smoothstep(0.0, 0.35, age) * exp(-age * 0.9) * 1.8;
    float flinch = exp(-age * 4.0) * (0.4 + 0.6 * vel);

    // The cloud's own frame: it wanders, wheels and leans as a whole.
    vec2 centre = vec2(0.2 * sin(t * 0.071 + 1.0), 0.08 * sin(t * 0.093) + 0.05);
    float grow = 0.8 + 0.6 * flockSize + 0.18 * vxEnv + 0.08 * vxEnergy;
    vec2 q = (p - centre) / grow;
    float r0 = length(q);
    // Twisting: the core turns further than the rim, so the flock folds.
    float swirl = turn + (0.6 + 1.2 * twist) * exp(-r0 * r0 * 9.0) * sin(t * 0.13 + 0.7)
                + 0.35 * sin(t * 0.05);
    q = rot(swirl) * q;
    // A slow flowing warp: the shape breathes and its edges stream out.
    vec2 w = vec2(fbm3(q * 2.1 + vec2(0.0, t * 0.11)), fbm3(q * 2.1 + vec2(5.2, -t * 0.09)));
    q += w * 0.13;

    // The tear: the cloud parts across its length, the halves sliding
    // apart and away from each other, then flowing back together.
    float cut = 0.36 * (hash21(vec2(n, 3.0)) - 0.5);
    float gap = sp * 0.16;
    float side = sign(q.x - cut + 1e-4);
    float lean = hash21(vec2(n, 7.0)) < 0.5 ? 1.0 : -1.0;
    q -= side * vec2(gap, gap * 0.45 * lean);
    float tear = smoothstep(gap * 0.5, gap * 1.0 + 0.002, abs(q.x - cut + side * gap));
    // A long, curving cloud: a bent ellipse thinning toward its tips.
    float bend = 0.9 * sin(t * 0.06 + 2.0);
    vec2 qe = vec2(q.x, q.y - bend * q.x * q.x);
    float tip = 1.0 - 0.45 * smoothstep(0.1, 0.5, abs(qe.x));
    float d = length(qe / vec2(0.62, 0.15 * tip + 0.03));
    d += 0.35 * fbm3(q * 3.3 + vec2(t * 0.07, 3.0));
    float body = smoothstep(1.15, 0.35, d);
    // Ragged streamers peel off the rim.
    float streak = smoothstep(1.6, 0.9, d) * smoothstep(0.15, 0.55, fbm3(vec2(q.x * 2.0, q.y * 9.0) + vec2(-t * 0.15, 7.0)));
    float density = max(body, streak * 0.45) * mix(1.0, tear, step(0.002, gap));

    // Waves of turning birds ripple through the flock as dark bands, and
    // each hit sends a ring out from the middle.
    vec2 wd = normalize(vec2(1.0, 0.35 * sin(t * 0.04)));
    float band = sin(dot(q, wd) * 15.0 - t * 1.8 + 4.0 * w.x);
    float waveL = waves * (0.5 + 0.5 * band) * (0.5 + 0.5 * band);
    float ring = exp(-pow((length(q / vec2(1.0, 0.45)) - age * 0.55) * 9.0, 2.0)) * exp(-age * 1.2);
    float thick = density * (0.55 + 0.75 * waveL + 0.9 * ring);

    // Two depths of birds: small far ones and bigger near ones.
    float s1080 = res.y / 1080.0;
    float cellNear = (4.2 + 4.0 * birdSize) * s1080;
    float cellFar = cellNear * 0.62;
    vec2 nearB = birdLayer(q, clamp(thick * 0.85, 0.0, 0.95), cellNear, pxPerUnit, t * 3.0, flinch, 1.0);
    vec2 farB = birdLayer(q * 1.03 + vec2(0.02, 0.0), clamp(thick * 1.1 - 0.15, 0.0, 0.95), cellFar, pxPerUnit, t * 3.0 + 7.0, flinch, 2.0);
    // Where the flock is thickest the birds merge into a solid mass.
    float mass = smoothstep(0.7, 1.5, thick);
    // Too many birds to see one by one: a speckled dark mass, still grainy.
    float speck = vnoise(q * res.y / (2.2 * s1080)) * 0.5 + 0.5;
    mass *= smoothstep(0.15, 0.75, speck + mass * 0.35);
    float birds = 1.0 - (1.0 - nearB.x) * (1.0 - farB.x * 0.8) * (1.0 - mass * 0.92);
    // Which bird the pixel shows; the speckled mass counts as no single bird.
    float who = nearB.x >= farB.x ? nearB.y : farB.y;
    float single = max(nearB.x, farB.x * 0.8);
    single = single / max(birds, 1e-3);

    // Sky.
    vec2 uv = gl_FragCoord.xy / res;
    vec2 sunP = vec2(0.5 + 0.18 * sin(t * 0.01), -0.08);
    float sunD = length((uv - sunP) * vec2(res.x / res.y, 1.0));
    vec3 inkC = ink.rgb;
    vec3 acc = accent.rgb;
    vec3 sky;
    vec3 birdCol;
    float h = uv.y;
    if (look == 0) {
        sky = mix(acc * 1.05, mix(acc, inkC, 0.5) * 0.55, smoothstep(0.0, 0.55, h));
        sky = mix(sky, inkC * 0.18 + vec3(0.02, 0.02, 0.05), smoothstep(0.45, 1.0, h));
        sky += acc * 0.6 * exp(-sunD * 4.0) + vec3(1.0, 0.95, 0.85) * 0.35 * exp(-sunD * 18.0);
        birdCol = inkC * 0.06 + vec3(0.012);
    } else if (look == 1) {
        sky = mix(acc * 0.55, inkC * 0.32, smoothstep(0.0, 0.6, h));
        sky = mix(sky, inkC * 0.08 + vec3(0.01, 0.01, 0.03), smoothstep(0.5, 1.0, h));
        sky += acc * 0.35 * exp(-sunD * 3.5);
        // Birds facing the sun catch it; the rest stay in shadow.
        // Bands of the flock bank toward the sun and some birds flash gold;
        // the thick core shades itself.
        float lit = 0.5 + 0.5 * sin(dot(q, vec2(9.0, 4.0)) + t * 0.6 + w.y * 5.0);
        float share = clamp(0.06 + 0.6 * lit * lit * lit + 0.6 * flinch + 0.5 * ring, 0.0, 1.0) * (1.0 - 0.75 * mass);
        float gold = step(who, share) * single;
        birdCol = mix(inkC * 0.1 + vec3(0.015), acc * 1.15 + vec3(0.1), gold);
    } else {
        sky = mix(inkC * 0.07, vec3(0.005, 0.006, 0.015), smoothstep(0.0, 0.8, h));
        sky += acc * 0.08 * exp(-sunD * 2.5);
        birdCol = mix(inkC * 1.1, acc * 1.2 + 0.15, step(who, clamp(waveL * 0.6 + ring * 0.8 + flinch * 0.3, 0.0, 1.0)));
        birdCol *= 0.65 + 0.35 * single;
    }
    // A hit flashes the flock's turning birds.

    float cover = birds;
    vec3 col = mix(sky, birdCol, cover);
    float outA = 1.0;
    vec3 outC = col;
    if (vxClear) {
        outA = cover;
        outC = birdCol * cover;
    }
    outC *= vxPresence;
    outA *= vxPresence;
    outC = clamp(outC, 0.0, 1.0);
    outC = min(outC, vec3(outA));
    gl_FragColor = vec4(outC, outA);
}
