/*{
    "DESCRIPTION": "LED pixel matrix display with scrolling patterns and audio-reactive color modes",
    "CREDIT": "Shrink Wrap",
    "ISFVSN": "2",
    "CATEGORIES": ["Generator"],
    "INPUTS": [
        {"NAME": "speed", "TYPE": "float", "DEFAULT": 1.0, "MIN": 0.0, "MAX": 3.0},
        {"NAME": "pixelCount", "TYPE": "float", "DEFAULT": 24.0, "MIN": 8.0, "MAX": 64.0},
        {"NAME": "pixelGap", "TYPE": "float", "DEFAULT": 0.2, "MIN": 0.05, "MAX": 0.5},
        {"NAME": "patternMode", "TYPE": "float", "DEFAULT": 0.0, "MIN": 0.0, "MAX": 3.0},
        {"NAME": "colorSat", "TYPE": "float", "DEFAULT": 1.0, "MIN": 0.0, "MAX": 1.5}
    ]
}*/

float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
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
    float bassGlow = 1.0 + audioBass * 1.0;
    float midPattern = audioMid;
    float beatFlash = audioBeat;
    float levelBright = 0.5 + audioLevel * 1.0;

    // LED grid
    vec2 ledUV = uv * vec2(pixelCount * aspect, pixelCount);
    vec2 cellID = floor(ledUV);
    vec2 cellUV = fract(ledUV);

    // LED pixel shape (rounded square with gap)
    float gapHalf = pixelGap * 0.5;
    float ledMask = smoothstep(gapHalf, gapHalf + 0.05, cellUV.x)
                  * smoothstep(gapHalf, gapHalf + 0.05, cellUV.y)
                  * smoothstep(gapHalf, gapHalf + 0.05, 1.0 - cellUV.x)
                  * smoothstep(gapHalf, gapHalf + 0.05, 1.0 - cellUV.y);

    // Rounded corners
    vec2 cornerDist = abs(cellUV - 0.5) - (0.5 - gapHalf - 0.05);
    float cornerMask = 1.0 - smoothstep(0.0, 0.05, length(max(cornerDist, 0.0)));
    ledMask *= cornerMask;

    // Normalize cell position
    vec2 normCell = cellID / vec2(pixelCount * aspect, pixelCount);

    // LED color based on pattern mode
    float mode = floor(patternMode);
    vec3 ledColor = vec3(0.0);

    // Mode 0: Scrolling rainbow wave
    float hue0 = fract(normCell.x + normCell.y * 0.5 + t * 0.2);
    float bright0 = 0.5 + 0.5 * sin(normCell.x * 10.0 - t * 3.0 + audioBass * 5.0);
    vec3 mode0 = hsv2rgb(vec3(hue0, colorSat, bright0 * levelBright));

    // Mode 1: VU meter bars (vertical)
    float barHeight = (sin(normCell.x * 6.28 * 3.0 + t) * 0.3 + 0.5) * bassGlow;
    barHeight = barHeight * levelBright;
    float barOn = step(normCell.y, barHeight);
    float barHue = mix(0.33, 0.0, normCell.y); // green to red
    vec3 mode1 = hsv2rgb(vec3(barHue, colorSat, barOn * 0.9));

    // Mode 2: Expanding rings
    vec2 center = vec2(0.5);
    float ringDist = length(normCell - center) * 4.0;
    float ring = sin(ringDist * 6.28 - t * 4.0) * 0.5 + 0.5;
    ring *= levelBright;
    float ringHue = fract(ringDist * 0.3 + t * 0.1);
    vec3 mode2 = hsv2rgb(vec3(ringHue, colorSat, ring));

    // Mode 3: Random sparkle matrix
    float sparkle = step(0.85, hash(cellID + floor(t * 5.0)));
    float sparkleHue = hash(cellID + floor(t * 2.0));
    vec3 mode3 = hsv2rgb(vec3(sparkleHue, colorSat, sparkle * levelBright));

    // Select mode with smooth-ish transition
    if (mode < 1.0) {
        ledColor = mode0;
    } else if (mode < 2.0) {
        ledColor = mode1;
    } else if (mode < 3.0) {
        ledColor = mode2;
    } else {
        ledColor = mode3;
    }

    // Beat flash white
    ledColor += vec3(beatFlash * 0.3) * ledMask;

    // LED sub-pixel structure (RGB stripes for realism)
    float subpixel = cellUV.x * 3.0;
    float rSub = smoothstep(0.0, 0.3, fract(subpixel)) * smoothstep(1.0, 0.7, fract(subpixel));
    float gSub = smoothstep(0.0, 0.3, fract(subpixel - 1.0)) * smoothstep(1.0, 0.7, fract(subpixel - 1.0));
    float bSub = smoothstep(0.0, 0.3, fract(subpixel - 2.0)) * smoothstep(1.0, 0.7, fract(subpixel - 2.0));
    vec3 subpixelMask = vec3(rSub, gSub, bSub) * 0.5 + 0.5;

    // Compose
    vec3 col = vec3(0.02); // dark LED background
    col += ledColor * ledMask * subpixelMask;

    // Subtle bloom/glow around bright LEDs
    float brightness = dot(ledColor, vec3(0.299, 0.587, 0.114));
    col += ledColor * 0.1 * brightness * (1.0 - ledMask);

    gl_FragColor = vec4(col, 1.0);
}
