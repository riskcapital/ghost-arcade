/*{
    "DESCRIPTION": "Voronoi-based stained glass pattern with shifting colors and audio-reactive light",
    "CREDIT": "Shrink Wrap",
    "ISFVSN": "2",
    "CATEGORIES": ["Generator"],
    "INPUTS": [
        {"NAME": "speed", "TYPE": "float", "DEFAULT": 0.3, "MIN": 0.0, "MAX": 1.5},
        {"NAME": "cellCount", "TYPE": "float", "DEFAULT": 8.0, "MIN": 3.0, "MAX": 20.0},
        {"NAME": "edgeWidth", "TYPE": "float", "DEFAULT": 0.05, "MIN": 0.01, "MAX": 0.15},
        {"NAME": "saturation", "TYPE": "float", "DEFAULT": 0.8, "MIN": 0.0, "MAX": 1.0},
        {"NAME": "lightAngle", "TYPE": "float", "DEFAULT": 0.0, "MIN": 0.0, "MAX": 6.28}
    ]
}*/

vec2 hash2(vec2 p) {
    p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)));
    return fract(sin(p) * 43758.5453);
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
    float bassLight = 1.0 + audioBass * 0.8;
    float midShift = audioMid * 0.3;
    float beatFlash = audioBeat * 0.5;
    float highShimmer = audioHigh * 0.2;

    // Scale UV for voronoi
    vec2 st = uv * vec2(aspect, 1.0) * cellCount;

    // Voronoi calculation
    float minDist = 10.0;
    float secondDist = 10.0;
    vec2 closestID = vec2(0.0);

    for (float y = -1.0; y <= 1.0; y += 1.0) {
        for (float x = -1.0; x <= 1.0; x += 1.0) {
            vec2 neighbor = vec2(x, y);
            vec2 cell = floor(st) + neighbor;
            vec2 point = hash2(cell);

            // Animate points slowly
            point = 0.5 + 0.4 * sin(t * 0.5 + point * 6.28);
            point += neighbor;

            float d = length(fract(st) - point);

            if (d < minDist) {
                secondDist = minDist;
                minDist = d;
                closestID = cell;
            } else if (d < secondDist) {
                secondDist = d;
            }
        }
    }

    // Edge detection (lead lines)
    float edge = smoothstep(edgeWidth, edgeWidth + 0.02, secondDist - minDist);

    // Glass color per cell
    float hue = fract(hash2(closestID).x + t * 0.05 + midShift);
    float sat = saturation;
    float val = 0.6 + 0.3 * bassLight;

    vec3 glassColor = hsv2rgb(vec3(hue, sat, val));

    // Light direction effect
    vec2 lightDir = vec2(cos(lightAngle + t * 0.2), sin(lightAngle + t * 0.2));
    float lightFactor = dot(normalize(uv - 0.5), lightDir) * 0.3 + 0.7;
    lightFactor *= bassLight;

    // Shimmer on high frequencies
    float shimmer = 1.0 + highShimmer * sin(closestID.x * 10.0 + closestID.y * 7.0 + t * 5.0);

    // Compose
    vec3 col = glassColor * edge * lightFactor * shimmer;

    // Lead lines (dark edges)
    col = mix(vec3(0.05), col, edge);

    // Beat flash - brightens everything
    col += vec3(beatFlash * 0.15);

    gl_FragColor = vec4(col, 1.0);
}
