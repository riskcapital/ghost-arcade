/*{
    "DESCRIPTION": "Mosaic tile pattern with rotating and shifting tiles driven by audio",
    "CREDIT": "Shrink Wrap",
    "ISFVSN": "2",
    "CATEGORIES": ["Generator"],
    "INPUTS": [
        {"NAME": "speed", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0.0, "MAX": 2.0},
        {"NAME": "tileCount", "TYPE": "float", "DEFAULT": 8.0, "MIN": 3.0, "MAX": 20.0},
        {"NAME": "gapWidth", "TYPE": "float", "DEFAULT": 0.06, "MIN": 0.01, "MAX": 0.15},
        {"NAME": "rotateAmount", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0.0, "MAX": 1.0},
        {"NAME": "colorVariety", "TYPE": "float", "DEFAULT": 1.0, "MIN": 0.0, "MAX": 3.0}
    ]
}*/

float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

vec2 rotate2D(vec2 p, float a) {
    float c = cos(a);
    float s = sin(a);
    return vec2(p.x * c - p.y * s, p.x * s + p.y * c);
}

vec3 hsv2rgb(vec3 c) {
    vec3 p = abs(fract(c.xxx + vec3(0.0, 2.0 / 3.0, 1.0 / 3.0)) * 6.0 - 3.0);
    return c.z * mix(vec3(1.0), clamp(p - 1.0, 0.0, 1.0), c.y);
}

void main() {
    vec2 uv = gl_FragCoord.xy / RENDERSIZE;
    float aspect = RENDERSIZE.x / RENDERSIZE.y;
    float t = TIME * speed;

    // Audio reactivity
    float bassRotate = audioBass * 0.5;
    float midSize = 1.0 + audioMid * 0.2;
    float beatPop = audioBeat;
    float highSparkle = audioHigh * 0.5;

    // Tile grid
    vec2 tUV = uv * vec2(aspect, 1.0) * tileCount;
    vec2 cellID = floor(tUV);
    vec2 cellUV = fract(tUV) - 0.5;

    // Per-tile rotation
    float tileHash = hash(cellID);
    float angle = tileHash * 6.28 * rotateAmount;
    angle += sin(t + tileHash * 10.0) * rotateAmount * 0.5;
    angle += bassRotate * sin(cellID.x + cellID.y);

    vec2 rotUV = rotate2D(cellUV, angle);

    // Tile shape - rounded square
    vec2 d = abs(rotUV) * midSize;
    float tileMask = smoothstep(0.5, 0.5 - gapWidth, max(d.x, d.y));

    // Inner tile pattern - smaller square for mosaic detail
    float innerTile = smoothstep(0.35, 0.35 - 0.02, max(d.x, d.y));
    float border = tileMask - innerTile;

    // Tile color
    float hue = fract(tileHash * colorVariety + t * 0.05 + (cellID.x + cellID.y) * 0.05);
    float sat = 0.6 + 0.3 * sin(t + tileHash * 5.0);
    float val = 0.5 + 0.4 * tileHash;

    vec3 tileColor = hsv2rgb(vec3(hue, sat, val));

    // Grout color (dark gap between tiles)
    vec3 groutColor = vec3(0.08, 0.07, 0.06);

    // Beat pop - tiles brighten
    tileColor *= 1.0 + beatPop * 0.5 * step(0.7, tileHash);

    // Sparkle on high freq
    float sparkle = step(0.95, hash(cellID + floor(t * 4.0))) * highSparkle;
    tileColor += vec3(sparkle);

    // Compose
    vec3 col = groutColor;
    col = mix(col, tileColor * 0.7, border);
    col = mix(col, tileColor, innerTile * tileMask);

    // Subtle depth shadow at tile edges
    float shadow = smoothstep(0.5, 0.3, max(d.x, d.y));
    col *= 0.8 + 0.2 * shadow;

    gl_FragColor = vec4(col, 1.0);
}
