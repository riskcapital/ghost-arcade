// ============================================================================
// Shader 03: Centrifugal Frequency Rings
// Concentric rings emit particle waves outward. Each ring is mapped to a
// frequency band. Particle color shifts through spectrum based on amplitude.
// Target: D3D11 PS 5.0 | Fullscreen quad
// ============================================================================

#include "AudioShaderCommon.hlsli"

Texture2D<float4> gFeedback : register(t3); // previous frame for trails

cbuffer ShaderParams : register(b1)
{
    float gRingCount;        // number of frequency rings, default 12
    float gExpansionRate;    // outward particle speed, default 1.5
    float gTrailDecay;       // feedback trail decay, default 0.94
    float gParticleDensity;  // particles per ring arc, default 60.0
    float gColorShiftRate;   // spectral color cycle speed, default 0.1
    float gRingThickness;    // ring line thickness, default 0.004
    float gGlowRadius;       // soft glow falloff, default 0.02
    float gCenterPulse;      // center emission strength, default 1.0
};

// Polar coordinate helpers
float2 ToPolar(float2 uv)
{
    float2 centered = uv - 0.5;
    float r = length(centered);
    float theta = atan2(centered.y, centered.x);
    return float2(r, theta);
}

// Particle ring evaluation
float3 EvalRing(float2 uv, int ringIdx, float t)
{
    int rings = (int)gRingCount;
    float fi = (float)ringIdx / (float)rings;

    // This ring's frequency band
    float energy = SampleFFT(fi);
    float energySq = energy * energy; // sharper response

    // Ring base radius expands over time, wraps
    float baseRadius = frac(fi * 0.7 + t * gExpansionRate * (0.02 + fi * 0.03));
    float ringRadius = baseRadius * 0.5; // map to [0, 0.5]

    float2 centered = uv - 0.5;
    float r = length(centered);
    float theta = atan2(centered.y, centered.x);

    // Ring shape: gaussian around ringRadius
    float ringDist = abs(r - ringRadius);
    float ringLine = exp(-ringDist * ringDist / (gRingThickness * gRingThickness * (1.0 + energy)));

    // Particle distribution along the ring arc
    float particleCount = gParticleDensity * (0.5 + energy);
    float particleAngle = theta * particleCount / TWO_PI;
    float particleFrac = frac(particleAngle + t * (0.5 + fi) + fi * 7.13);
    float particle = exp(-particleFrac * particleFrac * 40.0);

    // Combine: ring * particle modulation
    float intensity = ringLine * lerp(0.3, 1.0, particle) * energySq;

    // Soft glow halo
    float glow = exp(-ringDist / (gGlowRadius * (1.0 + energy * 2.0)));
    intensity += glow * energy * 0.15;

    // Color: spectral position based on frequency band + shift
    float hue = fi + t * gColorShiftRate + energy * 0.3;
    float3 col = SpectralColor(hue);

    // Brightness modulation by amplitude
    col *= intensity * (1.0 + energy * 2.0);

    // Radial fade at edges
    float edgeFade = smoothstep(0.5, 0.35, r);
    col *= edgeFade;

    return col;
}

// Center emission core
float3 CenterCore(float2 uv, float t)
{
    float2 centered = uv - 0.5;
    float r = length(centered);

    float rms = gAudioRMS;
    float coreSize = 0.02 + rms * 0.03;

    // Pulsing core
    float core = exp(-r * r / (coreSize * coreSize));

    // Waveform distortion on core edge
    float theta = atan2(centered.y, centered.x);
    float waveIdx = frac(theta / TWO_PI);
    float wave = SampleWaveform(waveIdx);
    float coreEdge = exp(-(r - coreSize - wave * 0.01) * (r - coreSize - wave * 0.01) * 5000.0);

    float3 coreColor = SpectralColor(gSpectralCentroid + t * 0.05);
    return coreColor * (core * 2.0 + coreEdge * 0.5) * gCenterPulse;
}

// Waveform ring: raw waveform drawn as a ring modulating radius
float3 WaveformRing(float2 uv, float t)
{
    float2 centered = uv - 0.5;
    float r = length(centered);
    float theta = atan2(centered.y, centered.x);

    // Sample waveform at angle position
    float waveU = frac(theta / TWO_PI + 0.5);
    float wave = SampleWaveform(waveU);

    // Waveform modulates a ring at radius ~0.25
    float waveRadius = 0.25 + wave * 0.06;
    float dist = abs(r - waveRadius);
    float line = exp(-dist * dist / 0.00003);

    float3 col = SpectralColor(waveU + gSpectralCentroid) * line * 0.8;
    return col;
}

float4 PS_CentrifugalRings(VS_OUTPUT input) : SV_Target
{
    float2 uv = input.TexCoord;

    // Correct aspect ratio to keep rings circular
    float aspect = gResolution.x / gResolution.y;
    float2 corrected = uv;
    corrected.x = (corrected.x - 0.5) * aspect + 0.5;

    float t = gTime;

    // Feedback trail
    float3 trail = gFeedback.SampleLevel(samLinearClamp, uv, 0).rgb * gTrailDecay;

    // Accumulate all rings
    float3 rings = 0.0;
    int ringCount = (int)gRingCount;

    [loop]
    for (int i = 0; i < ringCount; i++)
    {
        rings += EvalRing(corrected, i, t);
    }

    // Center emission
    float3 core = CenterCore(corrected, t);

    // Waveform ring overlay
    float3 waveRing = WaveformRing(corrected, t);

    // Combine layers
    float3 color = trail + rings + core + waveRing;

    // Radial chromatic aberration
    float2 dir = (uv - 0.5) * 0.003 * gAudioRMS;
    float rShift = gFeedback.SampleLevel(samLinearClamp, uv + dir, 0).r * gTrailDecay * 0.3;
    float bShift = gFeedback.SampleLevel(samLinearClamp, uv - dir, 0).b * gTrailDecay * 0.3;
    color.r += rShift;
    color.b += bShift;

    // Vignette
    float vig = 1.0 - dot(uv - 0.5, uv - 0.5) * 2.0;
    color *= smoothstep(0.0, 0.5, vig);

    return float4(ACESFilm(color), 1.0);
}
