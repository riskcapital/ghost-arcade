// ============================================================================
// Shader 19: Chromatic Wavelet Decomposition
// Waveform decomposed into wavelet scales on-screen. Each scale rendered
// as a separate translucent layer with distinct hue. Layers drift and
// overlap based on energy per scale. Visual wavelet spectrogram.
// Target: D3D11 PS 5.0 | Fullscreen quad | Ping-pong RT required
// ============================================================================

#include "AudioShaderCommon.hlsli"

Texture2D<float4> gFeedback : register(t3);

cbuffer ShaderParams : register(b1)
{
    float gScaleCount;       // number of wavelet scales, default 8
    float gLayerSpread;      // vertical spread between layers, default 0.08
    float gWaveAmplitude;    // waveform rendering amplitude, default 0.15
    float gDriftSpeed;       // layer drift speed, default 0.3
    float gLayerOpacity;     // per-layer opacity, default 0.7
    float gGlowWidth;        // line glow width, default 0.003
    float gTrailDecay;       // feedback persistence, default 0.96
    float gDepthSeparation;  // parallax depth between layers, default 0.5
};

// Approximate wavelet decomposition: bandpass filter at different scales
// Uses difference of smoothed waveforms as poor-man's wavelet
float WaveletScale(float u, int scale)
{
    float kernelWidth = pow(2.0, (float)scale) / 512.0;
    float sum1 = 0.0;
    float sum2 = 0.0;
    int taps = min(4 + scale * 2, 16);

    [loop]
    for (int i = -taps; i <= taps; i++)
    {
        float offset = (float)i * kernelWidth;
        float w1 = exp(-offset * offset / (kernelWidth * kernelWidth * 2.0));
        float w2 = exp(-offset * offset / (kernelWidth * kernelWidth * 8.0));
        float sample_val = SampleWaveform(frac(u + offset));
        sum1 += sample_val * w1;
        sum2 += sample_val * w2;
    }

    float invTaps = 1.0 / (float)(taps * 2 + 1);
    return (sum1 - sum2) * invTaps * 4.0;
}

// Energy in a wavelet scale (RMS of filtered signal)
float ScaleEnergy(int scale)
{
    float energy = 0.0;
    const int SAMPLES = 32;
    [loop]
    for (int i = 0; i < SAMPLES; i++)
    {
        float u = (float)i / (float)SAMPLES;
        float w = WaveletScale(u, scale);
        energy += w * w;
    }
    return sqrt(energy / (float)SAMPLES);
}

float4 PS_WaveletDecomp(VS_OUTPUT input) : SV_Target
{
    float2 uv = input.TexCoord;
    float t = gTime;

    float aspect = gResolution.x / gResolution.y;

    // Feedback
    float3 trail = gFeedback.SampleLevel(samLinearClamp, uv, 0).rgb * gTrailDecay;

    // Background
    float3 bg = lerp(float3(0.005, 0.003, 0.01), float3(0.01, 0.005, 0.02), uv.y);

    float3 color = bg;
    int scales = (int)gScaleCount;

    // Render each wavelet scale as a layer (back to front)
    [loop]
    for (int s = scales - 1; s >= 0; s--)
    {
        float fi = (float)s / (float)scales;

        // Layer vertical position: spread around center
        float layerY = 0.5 + (fi - 0.5) * gLayerSpread * (float)scales;

        // Audio-driven drift
        float energy = ScaleEnergy(s);
        float drift = sin(t * gDriftSpeed * (1.0 + fi) + fi * 5.0) * energy * 0.03;
        layerY += drift;

        // Parallax: offset X based on depth
        float depthOffset = (fi - 0.5) * gDepthSeparation * 0.02;
        float sampleX = uv.x + depthOffset + t * 0.01 * (1.0 - fi * 0.5);

        // Sample wavelet at this scale
        float wavelet = WaveletScale(frac(sampleX), s);

        // Scale amplitude by layer and energy
        wavelet *= gWaveAmplitude * (0.5 + energy * 2.0);

        // Distance from pixel to wavelet curve
        float curveY = layerY + wavelet;
        float dist = abs(uv.y - curveY);

        // Line rendering: sharp core + glow
        float core = exp(-dist * dist / (gGlowWidth * gGlowWidth));
        float glow = exp(-dist * dist / (gGlowWidth * gGlowWidth * 16.0));
        float fill = smoothstep(gGlowWidth * 4.0, 0.0, dist); // filled area under curve

        // Layer color: each scale gets a unique spectral color
        float hue = fi + gSpectralCentroid * 0.3 + t * 0.008;
        float3 layerColor = SpectralColor(hue);

        // Brightness modulated by energy
        float brightness = 0.3 + energy * 2.0;

        // Compose: filled translucent region + bright line + glow
        float3 layerContrib = 0.0;

        // Filled region (semi-transparent)
        float fillSide = (uv.y < curveY) ? 1.0 : 0.0; // fill below curve
        float fillAmount = fill * fillSide * 0.15 * gLayerOpacity;
        layerContrib += layerColor * fillAmount * brightness;

        // Sharp line
        layerContrib += layerColor * core * brightness * gLayerOpacity;

        // Soft glow
        float3 glowColor = SpectralColor(hue + 0.2);
        layerContrib += glowColor * glow * 0.3 * energy;

        // FFT modulation: brightness pulses with the corresponding band
        float fftEnergy = SampleFFT(fi);
        layerContrib *= (0.6 + fftEnergy * 0.8);

        // Additive blend
        color += layerContrib;
    }

    // --- Aggregate waveform overlay (very subtle, behind everything) ---
    float rawWave = SampleWaveform(uv.x) * 0.08;
    float rawDist = abs(uv.y - 0.5 - rawWave);
    float rawLine = exp(-rawDist * rawDist * 20000.0) * 0.15;
    color += float3(0.5, 0.5, 0.6) * rawLine;

    // --- Scale energy bars on the right edge ---
    float barX = smoothstep(0.97, 0.98, uv.x);
    if (barX > 0.0)
    {
        [loop]
        for (int b = 0; b < scales; b++)
        {
            float bfi = (float)b / (float)scales;
            float barY = bfi;
            float barHeight = 1.0 / (float)scales;
            float inBar = smoothstep(barY, barY + 0.005, uv.y) *
                          smoothstep(barY + barHeight, barY + barHeight - 0.005, uv.y);

            float bEnergy = ScaleEnergy(b);
            float barFill = smoothstep(0.98, 0.98 + 0.015 * bEnergy, uv.x);

            float3 barColor = SpectralColor((float)b / (float)scales + gSpectralCentroid);
            color += barColor * inBar * barFill * barX * 0.5;
        }
    }

    // Trail blend
    color += trail * 0.3;

    // Horizontal scan line (subtle oscilloscope feel)
    float scanline = sin(uv.y * gResolution.y * 0.5) * 0.015;
    color += scanline * 0.5;

    // Vignette
    float vig = 1.0 - dot(uv - 0.5, uv - 0.5) * 1.5;
    color *= smoothstep(0.0, 0.5, vig);

    return float4(ACESFilm(color), 1.0);
}
