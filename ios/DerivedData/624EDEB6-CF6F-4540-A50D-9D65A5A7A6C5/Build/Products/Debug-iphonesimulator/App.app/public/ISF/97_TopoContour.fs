/*{
    "DESCRIPTION": "Topographic map contour lines with elevation coloring and audio-reactive terrain",
    "CREDIT": "Shrink Wrap",
    "ISFVSN": "2",
    "CATEGORIES": ["Generator"],
    "INPUTS": [
        {"NAME": "speed", "TYPE": "float", "DEFAULT": 0.3, "MIN": 0.0, "MAX": 1.5},
        {"NAME": "contourCount", "TYPE": "float", "DEFAULT": 15.0, "MIN": 5.0, "MAX": 30.0},
        {"NAME": "terrainScale", "TYPE": "float", "DEFAULT": 3.0, "MIN": 1.0, "MAX": 8.0},
        {"NAME": "lineSharp", "TYPE": "float", "DEFAULT": 1.0, "MIN": 0.3, "MAX": 3.0},
        {"NAME": "colorMode", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0.0, "MAX": 1.0}
    ]
}*/

float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float a = hash(i);
    float b = hash(i + vec2(1.0, 0.0));
    float c = hash(i + vec2(0.0, 1.0));
    float d = hash(i + vec2(1.0, 1.0));
    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

float fbm(vec2 p) {
    float v = 0.0;
    float a = 0.5;
    for (float i = 0.0; i < 6.0; i++) {
        v += a * noise(p);
        p *= 2.0;
        a *= 0.5;
    }
    return v;
}

void main() {
    vec2 uv = gl_FragCoord.xy / RENDERSIZE;
    float aspect = RENDERSIZE.x / RENDERSIZE.y;
    float t = TIME * speed;

    // Audio reactivity
    float bassElevation = audioBass * 0.3;
    float midContour = 1.0 + audioMid * 0.5;
    float beatHighlight = audioBeat * 0.4;
    float highDetail = 1.0 + audioHigh * 0.3;

    // Terrain height field
    vec2 terrainUV = uv * vec2(aspect, 1.0) * terrainScale;
    terrainUV += vec2(t * 0.3, t * 0.1);

    float height = fbm(terrainUV * highDetail);
    height += fbm(terrainUV * 2.0 + 5.0) * 0.3;
    height += bassElevation;

    // Contour lines
    float contourVal = height * contourCount * midContour;
    float contourLine = abs(fract(contourVal) - 0.5) * 2.0;
    contourLine = smoothstep(0.0, 0.1 * lineSharp, contourLine);

    // Major contour lines (every 5th)
    float majorContour = abs(fract(contourVal / 5.0) - 0.5) * 2.0;
    float majorLine = 1.0 - smoothstep(0.0, 0.05 * lineSharp, majorContour);

    // Elevation color gradient
    vec3 lowColor = mix(vec3(0.2, 0.5, 0.3), vec3(0.1, 0.2, 0.6), colorMode);
    vec3 midColor = mix(vec3(0.7, 0.6, 0.3), vec3(0.3, 0.6, 0.5), colorMode);
    vec3 highColor = mix(vec3(0.9, 0.85, 0.8), vec3(0.8, 0.3, 0.2), colorMode);

    vec3 elevColor;
    if (height < 0.4) {
        elevColor = mix(lowColor, midColor, height / 0.4);
    } else {
        elevColor = mix(midColor, highColor, (height - 0.4) / 0.6);
    }

    // Contour line color (darker version of elevation)
    vec3 lineColor = elevColor * 0.3;
    vec3 majorLineColor = vec3(0.1);

    // Compose
    vec3 col = elevColor;
    col = mix(lineColor, col, contourLine);
    col = mix(majorLineColor, col, 1.0 - majorLine * 0.8);

    // Beat pulse - flash contour lines
    col += vec3(beatHighlight) * (1.0 - contourLine) * 0.5;

    // Map border grid (subtle lat/long lines)
    float gridX = smoothstep(0.01, 0.0, abs(fract(uv.x * 10.0) - 0.5) - 0.49);
    float gridY = smoothstep(0.01, 0.0, abs(fract(uv.y * 10.0) - 0.5) - 0.49);
    col = mix(col, vec3(0.4), (gridX + gridY) * 0.15);

    gl_FragColor = vec4(col, 1.0);
}
