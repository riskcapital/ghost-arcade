// ============================================================================
// Shader 08: Spectral Aurora Curtain
// Vertical curtain of light where horizontal displacement follows the
// waveform, vertical color banding maps to FFT, fold intensity driven
// by mid-range energy. Multi-layer aurora with depth parallax.
// Target: D3D11 PS 5.0 | Fullscreen quad
// ============================================================================

#include "AudioShaderCommon.hlsli"

Texture2D<float4> gFeedback : register(t3);

cbuffer ShaderParams : register(b1)
{
    float gCurtainLayers;    // number of aurora layers, default 5.0
    float gWaveDisplace;     // waveform displacement strength, default 0.15
    float gFoldIntensity;    // curtain fold complexity, default 3.0
    float gVerticalSpeed;    // vertical drift speed, default 0.1
    float gColorSaturation;  // aurora color richness, default 1.5
    float gGlowFalloff;      // edge glow softness, default 2.0
    float gTrailDecay;       // feedback persistence, default 0.93
    float gParallaxDepth;    // layer separation depth, default 0.3
};

// Single aurora curtain layer
float3 AuroraLayer(float2 uv, float t, int layer, float totalLayers)
{
    float layerF = (float)layer / totalLayers;
    float depth = 1.0 - layerF * gParallaxDepth; // farther layers move less

    // Vertical position with parallax drift
    float vertOffset = t * gVerticalSpeed * depth + layerF * 1.7;

    // Waveform drives horizontal displacement
    // Sample at multiple vertical positions for continuous curtain
    float waveU = frac(uv.y * 2.0 + vertOffset);
    float wave = SampleWaveform(waveU) * gWaveDisplace * depth;

    // Additional noise-based displacement for organic folds
    float mid = MidBand();
    float foldNoise = GradNoise(float2(uv.y * gFoldIntensity * (1.0 + mid * 2.0) + vertOffset,
                                        t * 0.05 + layerF * 3.0));
    float fold = (foldNoise - 0.5) * 0.1 * (1.0 + mid * 3.0) * depth;

    // Curtain x-position
    float curtainX = 0.5 + wave + fold + sin(uv.y * 8.0 + t * 0.3 + layerF * PI) * 0.02;

    // Distance from curtain line
    float dist = abs(uv.x - curtainX);

    // Curtain thickness varies with height and audio
    float bass = BassBand();
    float thickness = 0.01 + bass * 0.03 + sin(uv.y * 12.0 + t) * 0.005;

    // Gaussian curtain profile
    float curtain = exp(-dist * dist / (thickness * thickness));

    // Softer outer glow
    float glow = exp(-dist / (thickness * gGlowFalloff));

    // --- Coloring ---

    // Vertical FFT color banding: map Y position to frequency
    float freqU = frac(uv.y + vertOffset * 0.5);
    float fftEnergy = SampleFFT(freqU);

    // Base hue from layer + spectral centroid
    float hue = layerF * 0.3 + gSpectralCentroid * 0.4 + t * 0.01 + fftEnergy * 0.2;

    // Aurora colors: greens, teals, purples, pinks
    float3 auroraColor = Palette(hue,
        float3(0.5, 0.5, 0.5),
        float3(0.5, 0.5, 0.3),
        float3(1.0, 1.0, 0.5),
        float3(0.3, 0.2, 0.2));

    auroraColor = lerp(float3(1, 1, 1), auroraColor, gColorSaturation);

    // Intensity modulated by FFT at this vertical position
    float intensity = (0.3 + fftEnergy * 1.5) * depth;

    // Core + glow contribution
    float3 color = auroraColor * (curtain * intensity * 2.0 + glow * intensity * 0.3);

    // Shimmer: high-frequency sparkle along curtain
    float high = HighBand();
    float shimmer = pow(ValueNoise(float2(uv.x * 200.0, uv.y * 100.0 + t * 5.0)), 8.0);
    color += float3(1, 0.95, 0.9) * shimmer * curtain * high * 0.5;

    return color;
}

// Star field background
float3 StarField(float2 uv, float t)
{
    float3 stars = 0.0;

    [unroll]
    for (int i = 0; i < 3; i++)
    {
        float scale = 80.0 + (float)i * 60.0;
        float fi = (float)i;
        float2 starUV = uv * scale + float2(t * 0.002 * (fi + 1.0), fi * 50.0);
        float star = pow(ValueNoise(starUV), 20.0 - fi * 3.0);

        // Twinkle
        float twinkle = sin(Hash21(floor(starUV)) * 100.0 + t * 3.0) * 0.5 + 0.5;
        star *= twinkle;

        float3 starColor = lerp(float3(0.8, 0.9, 1.0), float3(1.0, 0.8, 0.6),
                                Hash21(floor(starUV) + 10.0));
        stars += starColor * star * 0.3;
    }

    return stars;
}

// Vertical light pillars (secondary aurora effect)
float3 LightPillars(float2 uv, float t)
{
    float3 pillars = 0.0;

    [unroll]
    for (int i = 0; i < 8; i++)
    {
        float fi = (float)i / 8.0;
        float energy = SampleFFT(fi);

        // Pillar x-position
        float px = fi + sin(t * 0.1 + fi * 5.0) * 0.05;
        float dist = abs(uv.x - px);

        // Vertical beam
        float pillar = exp(-dist * dist * 3000.0) * energy;

        // Fade toward top
        float fade = uv.y * uv.y;

        float3 col = SpectralColor(fi + gSpectralCentroid) * pillar * fade * 0.3;
        pillars += col;
    }

    return pillars;
}

float4 PS_SpectralAurora(VS_OUTPUT input) : SV_Target
{
    float2 uv = input.TexCoord;
    float t = gTime;

    // Feedback trail
    float3 trail = gFeedback.SampleLevel(samLinearClamp, uv, 0).rgb * gTrailDecay;

    // Background: dark sky gradient
    float3 sky = lerp(float3(0.0, 0.002, 0.008), float3(0.005, 0.01, 0.03), uv.y);

    // Star field
    float3 stars = StarField(uv, t);

    // Accumulate aurora layers (back to front)
    float3 aurora = 0.0;
    int layers = (int)gCurtainLayers;

    [loop]
    for (int i = 0; i < layers; i++)
    {
        aurora += AuroraLayer(uv, t, i, (float)layers);
    }

    // Light pillars
    float3 pillars = LightPillars(uv, t);

    // Ground reflection (bottom portion)
    float3 reflection = 0.0;
    if (uv.y < 0.15)
    {
        float2 reflUV = float2(uv.x, 0.3 - uv.y); // mirror Y
        float reflFade = smoothstep(0.0, 0.15, uv.y);

        [loop]
        for (int j = 0; j < layers; j++)
        {
            reflection += AuroraLayer(reflUV, t, j, (float)layers) * 0.3;
        }
        reflection *= reflFade;

        // Water ripple distortion
        float ripple = sin(uv.x * 80.0 + t * 2.0) * 0.002 * (1.0 - reflFade);
        reflection += ripple;
    }

    // Combine all layers
    float3 color = sky + stars * 0.5;
    color += trail * 0.4;
    color += aurora;
    color += pillars;
    color += reflection;

    // Atmospheric haze: slight blue tint in bright areas
    float lum = dot(color, float3(0.2126, 0.7152, 0.0722));
    color = lerp(color, color + float3(0.0, 0.02, 0.05) * lum, 0.3);

    // Subtle film grain
    float grain = (Hash21(uv * gResolution + t * 100.0) - 0.5) * 0.02;
    color += grain;

    return float4(ACESFilm(color), 1.0);
}
