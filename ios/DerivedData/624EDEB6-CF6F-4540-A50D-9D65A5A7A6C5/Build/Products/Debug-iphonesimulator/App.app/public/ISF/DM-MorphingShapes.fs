/*{
    "CREDIT": "GhostArcade",
    "DESCRIPTION": "Shapes morphing between forms",
    "ISFVSN": "2.0",
    "CATEGORIES": ["Generator", "Geometric"],
    "INPUTS": [
        {"NAME": "morphSpeed", "TYPE": "float", "MIN": 0.1, "MAX": 2.0, "DEFAULT": 0.5, "LABEL": "Morph Speed"},
        {"NAME": "shapeSize", "TYPE": "float", "MIN": 0.1, "MAX": 0.5, "DEFAULT": 0.3, "LABEL": "Size"},
        {"NAME": "rotateSpeed", "TYPE": "float", "MIN": 0.0, "MAX": 2.0, "DEFAULT": 0.3, "LABEL": "Rotation"},
        {"NAME": "edgeWidth", "TYPE": "float", "MIN": 0.01, "MAX": 0.1, "DEFAULT": 0.03, "LABEL": "Edge Width"},
        {"NAME": "glowAmount", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.5, "LABEL": "Glow"},
        {"NAME": "shapeColor", "TYPE": "color", "DEFAULT": [0.0, 1.0, 0.8, 1.0], "LABEL": "Shape Color"},
        {"NAME": "bgColor", "TYPE": "color", "DEFAULT": [0.05, 0.0, 0.1, 1.0], "LABEL": "Background"}
    ]
}*/

#ifdef GL_ES
precision highp float;
#endif

float sdCircle(vec2 p, float r) { return length(p) - r; }

float sdBox(vec2 p, vec2 b) {
    vec2 d = abs(p) - b;
    return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0);
}

float sdTriangle(vec2 p, float r) {
    float k = sqrt(3.0);
    p.x = abs(p.x) - r;
    p.y = p.y + r / k;
    if (p.x + k * p.y > 0.0) p = vec2(p.x - k * p.y, -k * p.x - p.y) / 2.0;
    p.x -= clamp(p.x, -2.0 * r, 0.0);
    return -length(p) * sign(p.y);
}

float sdStar(vec2 p, float r, int n, float m) {
    float an = 3.14159 / float(n);
    float en = 3.14159 / m;
    vec2 acs = vec2(cos(an), sin(an));
    vec2 ecs = vec2(cos(en), sin(en));
    float bn = mod(atan(p.x, p.y), 2.0 * an) - an;
    p = length(p) * vec2(cos(bn), abs(sin(bn)));
    p -= r * acs;
    p += ecs * clamp(-dot(p, ecs), 0.0, r * acs.y / ecs.y);
    return length(p) * sign(p.x);
}

void main() {
    vec2 uv = gl_FragCoord.xy / RENDERSIZE;
    vec2 p = (uv - 0.5) * 2.0;
    p.x *= RENDERSIZE.x / RENDERSIZE.y;

    float t = TIME * morphSpeed;

    // Rotation
    float angle = TIME * rotateSpeed;
    float c = cos(angle), s = sin(angle);
    p = vec2(p.x * c - p.y * s, p.x * s + p.y * c);

    // Calculate distances to different shapes
    float circle = sdCircle(p, shapeSize);
    float box = sdBox(p, vec2(shapeSize * 0.8));
    float tri = sdTriangle(p, shapeSize);
    float star = sdStar(p, shapeSize, 5, 2.5);

    // Morph between shapes based on time
    float phase = fract(t * 0.25);
    float d;

    if (phase < 0.25) {
        d = mix(circle, box, smoothstep(0.0, 0.25, phase) * 4.0);
    } else if (phase < 0.5) {
        d = mix(box, tri, (phase - 0.25) * 4.0);
    } else if (phase < 0.75) {
        d = mix(tri, star, (phase - 0.5) * 4.0);
    } else {
        d = mix(star, circle, (phase - 0.75) * 4.0);
    }

    vec3 col = bgColor.rgb;

    // Shape edge
    float edge = smoothstep(edgeWidth, 0.0, abs(d));
    col = mix(col, shapeColor.rgb, edge);

    // Glow
    float glow = smoothstep(0.2, 0.0, d) * glowAmount;
    col += shapeColor.rgb * glow * 0.5;

    gl_FragColor = vec4(col, 1.0);
}
