/*{
  "CREDIT": "by Justin Robie Wood",
  "CATEGORIES": [
    "generator"
  ],
  "DESCRIPTION": "Animated Mapper - Wild Motion Effects with Composition Alignment",
  "INPUTS": [
    {
      "NAME": "inputImage",
      "TYPE": "image"
    },
    {
      "NAME": "offsetX",
      "TYPE": "float",
      "DEFAULT": 0.0,
      "MIN": -1.0,
      "MAX": 1.0
    },
    {
      "NAME": "offsetY",
      "TYPE": "float",
      "DEFAULT": 0.0,
      "MIN": -1.0,
      "MAX": 1.0
    },
    {
      "NAME": "scale",
      "TYPE": "float",
      "DEFAULT": 1.0,
      "MIN": 0.1,
      "MAX": 3.0
    },
    {
      "NAME": "rotation",
      "TYPE": "float",
      "DEFAULT": 0.0,
      "MIN": -180.0,
      "MAX": 180.0
    },
    {
      "NAME": "waveSpeed",
      "TYPE": "float",
      "DEFAULT": 0.5,
      "MIN": 0.0,
      "MAX": 5.0
    },
    {
      "NAME": "waveAmplitude",
      "TYPE": "float",
      "DEFAULT": 0.0,
      "MIN": 0.0,
      "MAX": 0.3
    },
    {
      "NAME": "waveFrequency",
      "TYPE": "float",
      "DEFAULT": 5.0,
      "MIN": 1.0,
      "MAX": 20.0
    },
    {
      "NAME": "rippleSpeed",
      "TYPE": "float",
      "DEFAULT": 0.3,
      "MIN": 0.0,
      "MAX": 3.0
    },
    {
      "NAME": "rippleAmount",
      "TYPE": "float",
      "DEFAULT": 0.0,
      "MIN": 0.0,
      "MAX": 0.5
    },
    {
      "NAME": "rippleFrequency",
      "TYPE": "float",
      "DEFAULT": 10.0,
      "MIN": 1.0,
      "MAX": 30.0
    },
    {
      "NAME": "rotationPulse",
      "TYPE": "float",
      "DEFAULT": 0.0,
      "MIN": 0.0,
      "MAX": 45.0
    },
    {
      "NAME": "rotationPulseSpeed",
      "TYPE": "float",
      "DEFAULT": 1.0,
      "MIN": 0.0,
      "MAX": 5.0
    },
    {
      "NAME": "zoomPulse",
      "TYPE": "float",
      "DEFAULT": 0.0,
      "MIN": 0.0,
      "MAX": 1.0
    },
    {
      "NAME": "zoomPulseSpeed",
      "TYPE": "float",
      "DEFAULT": 1.0,
      "MIN": 0.0,
      "MAX": 5.0
    },
    {
      "NAME": "glitchAmount",
      "TYPE": "float",
      "DEFAULT": 0.0,
      "MIN": 0.0,
      "MAX": 1.0
    },
    {
      "NAME": "glitchSpeed",
      "TYPE": "float",
      "DEFAULT": 5.0,
      "MIN": 0.1,
      "MAX": 20.0
    },
    {
      "NAME": "chromaShift",
      "TYPE": "float",
      "DEFAULT": 0.0,
      "MIN": 0.0,
      "MAX": 0.1
    },
    {
      "NAME": "chromaAngle",
      "TYPE": "float",
      "DEFAULT": 0.0,
      "MIN": 0.0,
      "MAX": 360.0
    },
    {
      "NAME": "kaleidoscope",
      "TYPE": "float",
      "DEFAULT": 0.0,
      "MIN": 0.0,
      "MAX": 12.0
    },
    {
      "NAME": "kaleidoscopeRotate",
      "TYPE": "float",
      "DEFAULT": 0.0,
      "MIN": 0.0,
      "MAX": 1.0
    },
    {
      "NAME": "pixelate",
      "TYPE": "float",
      "DEFAULT": 0.0,
      "MIN": 0.0,
      "MAX": 100.0
    },
    {
      "NAME": "twistAmount",
      "TYPE": "float",
      "DEFAULT": 0.0,
      "MIN": -3.0,
      "MAX": 3.0
    },
    {
      "NAME": "twistSpeed",
      "TYPE": "float",
      "DEFAULT": 0.5,
      "MIN": 0.0,
      "MAX": 3.0
    },
    {
      "NAME": "colorCycleSpeed",
      "TYPE": "float",
      "DEFAULT": 0.0,
      "MIN": 0.0,
      "MAX": 2.0
    },
    {
      "NAME": "colorCycleAmount",
      "TYPE": "float",
      "DEFAULT": 0.0,
      "MIN": 0.0,
      "MAX": 1.0
    },
    {
      "NAME": "strobeSpeed",
      "TYPE": "float",
      "DEFAULT": 0.0,
      "MIN": 0.0,
      "MAX": 20.0
    },
    {
      "NAME": "strobeAmount",
      "TYPE": "float",
      "DEFAULT": 0.0,
      "MIN": 0.0,
      "MAX": 1.0
    },
    {
      "NAME": "mirrorX",
      "TYPE": "float",
      "DEFAULT": 0.0,
      "MIN": 0.0,
      "MAX": 1.0
    },
    {
      "NAME": "mirrorY",
      "TYPE": "float",
      "DEFAULT": 0.0,
      "MIN": 0.0,
      "MAX": 1.0
    },
    {
      "NAME": "feedback",
      "TYPE": "float",
      "DEFAULT": 0.0,
      "MIN": 0.0,
      "MAX": 0.95
    },
    {
      "NAME": "brightness",
      "TYPE": "float",
      "DEFAULT": 1.0,
      "MIN": 0.0,
      "MAX": 3.0
    },
    {
      "NAME": "contrast",
      "TYPE": "float",
      "DEFAULT": 1.0,
      "MIN": 0.0,
      "MAX": 3.0
    }
  ]
}*/

// ============================================================================
// Animated Mapper - Wild Motion Effects
// By Justin Robie Wood
// ============================================================================

#define PI 3.14159265359

// Hash function for random values
float hash(float n) {
    return fract(sin(n) * 43758.5453123);
}

float hash2(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}

// RGB to HSV
vec3 rgb2hsv(vec3 c) {
    vec4 K = vec4(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0);
    vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));
    vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));
    float d = q.x - min(q.w, q.y);
    float e = 1.0e-10;
    return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + e)), d / (q.x + e), q.x);
}

// HSV to RGB
vec3 hsv2rgb(vec3 c) {
    vec4 K = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
    vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
    return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
}

// Rotation matrix
mat2 rot2D(float angle) {
    float s = sin(angle);
    float c = cos(angle);
    return mat2(c, -s, s, c);
}

void main() {
    vec2 uv = gl_FragCoord.xy / RENDERSIZE;
    vec2 originalUV = uv;
    float time = TIME;

    // Glitch displacement
    if (glitchAmount > 0.0) {
        float glitchTime = floor(time * glitchSpeed);
        float glitchRow = floor(uv.y * 20.0);

        if (hash(glitchTime) > 0.9) {
            float rowDisplace = (hash(glitchRow + glitchTime) - 0.5) * glitchAmount * 0.2;
            uv.x += rowDisplace;
        }

        if (hash(glitchTime * 1.3) > 0.95) {
            uv.y += (hash(glitchTime * 2.1) - 0.5) * glitchAmount * 0.1;
        }
    }

    // Kaleidoscope effect
    if (kaleidoscope > 0.0) {
        vec2 centered = uv - 0.5;
        float radius = length(centered);
        float angle = atan(centered.y, centered.x);

        if (kaleidoscopeRotate > 0.0) {
            angle += time * kaleidoscopeRotate;
        }

        float segments = max(kaleidoscope, 1.0);
        float segmentAngle = PI * 2.0 / segments;
        angle = mod(angle, segmentAngle);
        if (mod(floor(atan(centered.y, centered.x) / segmentAngle), 2.0) > 0.5) {
            angle = segmentAngle - angle;
        }

        uv = vec2(cos(angle), sin(angle)) * radius + 0.5;
    }

    // Mirror effects
    if (mirrorX > 0.0) {
        float threshold = mix(0.5, abs(sin(time * 2.0)) * 0.5 + 0.25, mirrorX);
        if (uv.x > threshold) {
            uv.x = threshold - (uv.x - threshold);
        }
    }

    if (mirrorY > 0.0) {
        float threshold = mix(0.5, abs(cos(time * 2.3)) * 0.5 + 0.25, mirrorY);
        if (uv.y > threshold) {
            uv.y = threshold - (uv.y - threshold);
        }
    }

    // Twist distortion
    if (twistAmount != 0.0) {
        vec2 centered = uv - 0.5;
        float radius = length(centered);
        float angle = atan(centered.y, centered.x);

        angle += radius * twistAmount * PI + time * twistSpeed;

        uv = vec2(cos(angle), sin(angle)) * radius + 0.5;
    }

    // Wave distortion
    if (waveAmplitude > 0.0) {
        uv.x += sin(uv.y * waveFrequency * PI * 2.0 + time * waveSpeed) * waveAmplitude;
        uv.y += cos(uv.x * waveFrequency * PI * 2.0 + time * waveSpeed * 1.3) * waveAmplitude;
    }

    // Radial ripple
    if (rippleAmount > 0.0) {
        vec2 centered = uv - 0.5;
        float dist = length(centered);
        float ripple = sin(dist * rippleFrequency * PI * 2.0 - time * rippleSpeed * 5.0) * rippleAmount;
        uv += normalize(centered) * ripple;
    }

    // Rotation pulse
    if (rotationPulse > 0.0) {
        float pulseRot = sin(time * rotationPulseSpeed * PI) * rotationPulse * PI / 180.0;
        vec2 centered = uv - 0.5;
        centered = rot2D(pulseRot) * centered;
        uv = centered + 0.5;
    }

    // Zoom pulse
    float zoomMult = 1.0;
    if (zoomPulse > 0.0) {
        zoomMult = 1.0 + sin(time * zoomPulseSpeed * PI) * zoomPulse;
    }

    // Apply global rotation
    if (rotation != 0.0) {
        vec2 centered = uv - 0.5;
        centered = rot2D(rotation * PI / 180.0) * centered;
        uv = centered + 0.5;
    }

    // Apply scale and zoom pulse
    uv = (uv - 0.5) / (scale * zoomMult) + 0.5;

    // Apply offset
    uv += vec2(offsetX, offsetY);

    // Pixelation
    if (pixelate > 0.0) {
        float pixels = pixelate;
        uv = floor(uv * pixels) / pixels;
    }

    // Sample image with chromatic aberration
    vec3 color;

    if (chromaShift > 0.0) {
        vec2 chromaDir = vec2(cos(chromaAngle * PI / 180.0), sin(chromaAngle * PI / 180.0));
        vec2 offset = chromaDir * chromaShift;

        float r = IMG_NORM_PIXEL(inputImage, uv + offset).r;
        float g = IMG_NORM_PIXEL(inputImage, uv).g;
        float b = IMG_NORM_PIXEL(inputImage, uv - offset).b;

        color = vec3(r, g, b);
    } else {
        color = IMG_NORM_PIXEL(inputImage, uv).rgb;
    }

    // Color cycling
    if (colorCycleAmount > 0.0) {
        vec3 hsv = rgb2hsv(color);
        hsv.x = fract(hsv.x + time * colorCycleSpeed * 0.1);
        hsv.y = mix(hsv.y, hsv.y * (1.0 + sin(time * colorCycleSpeed) * 0.5), colorCycleAmount);
        color = hsv2rgb(hsv);
    }

    // Contrast and brightness
    color = (color - 0.5) * contrast + 0.5;
    color *= brightness;

    // Strobe effect
    if (strobeAmount > 0.0 && strobeSpeed > 0.0) {
        float strobe = step(0.5, fract(time * strobeSpeed));
        color = mix(color, color * strobe, strobeAmount);
    }

    // Feedback echo effect
    if (feedback > 0.0) {
        vec2 echoUV = originalUV * (1.0 + feedback * 0.05) - feedback * 0.025;
        vec3 echoColor = IMG_NORM_PIXEL(inputImage, echoUV).rgb;
        color = mix(color, echoColor * 0.8, feedback * 0.3);
    }

    // Fade to black if outside bounds
    if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) {
        color *= 0.0;
    }

    gl_FragColor = vec4(color, 1.0);
}
