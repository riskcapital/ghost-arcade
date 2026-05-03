// ============================================================================
// Shader 13: Spectral Cymatic Patterns
// Chladni plate simulation where the vibration frequency follows the
// dominant frequency in the audio. Sand particles settle into real nodal
// patterns that shift in real-time. Multi-mode superposition.
// Target: D3D11 PS 5.0 | Fullscreen quad
// ============================================================================

#include "AudioShaderCommon.hlsli"

Texture2D<float4> gFeedback : register(t3);

cbuffer ShaderParams : register(b1)
{
    float gModeCount;        // number of superimposed modes, default 6
    float gPlateSize;        // plate dimension scale, default 1.0
    float gSandSharpness;    // nodal line sharpness, default 8.0
    float gColorVibrancy;    // pattern coloring intensity, default 2.0
    float gTransitionSpeed;  // mode morphing speed, default 0.5
    float gTrailDecay;       // feedback for sand settling, default 0.92
    float gParticleLayer;    // sand grain overlay intensity, default 0.4
    float gGlowOnNodes;      // glow along nodal lines, default 1.5
};

// Chladni pattern for rectangular plate: cos(n*pi*x/L)*cos(m*pi*y/L) +/- cos(m*pi*x/L)*cos(n*pi*y/L)
// Nodal lines are where the function = 0
float ChladniMode(float2 uv, float n, float m, float sign)
{
    float2 p = (uv - 0.5) * 2.0 * gPlateSize;
    float val = cos(n * PI * p.x) * cos(m * PI * p.y)
              + sign * cos(m * PI * p.x) * cos(n * PI * p.y);
    return val;
}

// Circular Chladni mode (Bessel function approximation)
float CircularChladni(float2 uv, float n, float m)
{
    float2 centered = (uv - 0.5) * 2.0 * gPlateSize;
    float r = length(centered);
    float theta = atan2(centered.y, centered.x);

    // Approximate Bessel function J_n(k*r) * cos(n*theta)
    // Using polynomial approximation for visual fidelity
    float kr = m * PI * r;
    float bessel = cos(kr - n * HALF_PI * 0.5 - PI * 0.25) / max(sqrt(kr + 0.1), 0.3);
    float angular = cos(n * theta);

    return bessel * angular;
}

float4 PS_SpectralCymatics(VS_OUTPUT input) : SV_Target
{
    float2 uv = input.TexCoord;
    float t = gTime;

    float aspect = gResolution.x / gResolution.y;
    float2 auv = float2((uv.x - 0.5) * aspect + 0.5, uv.y);

    // Feedback
    float3 trail = gFeedback.SampleLevel(samLinearClamp, uv, 0).rgb * gTrailDecay;

    // Audio analysis
    float bass = BassBand();
    float mid  = MidBand();
    float high = HighBand();

    // --- Superimpose multiple Chladni modes ---
    // Mode indices are driven by FFT: dominant frequencies select mode numbers

    float totalPattern = 0.0;
    float totalWeight = 0.0;
    float3 patternColor = 0.0;

    int modes = (int)gModeCount;

    [loop]
    for (int i = 0; i < modes; i++)
    {
        float fi = (float)i / (float)modes;

        // FFT energy selects this mode's contribution
        float energy = SampleFFT(fi);

        // Mode numbers derived from frequency position
        // Lower FFT = lower mode numbers, higher FFT = higher modes
        float n = 1.0 + fi * 5.0;
        float m = 1.0 + frac(fi * PHI) * 4.0; // golden ratio spacing

        // Slowly morph mode numbers with audio
        n += sin(t * gTransitionSpeed + fi * 3.0) * 0.5 * mid;
        m += cos(t * gTransitionSpeed * 0.7 + fi * 5.0) * 0.5 * high;

        // Mix rectangular and circular modes
        float sign = (i % 2 == 0) ? 1.0 : -1.0;
        float rectMode = ChladniMode(auv, n, m, sign);
        float circMode = CircularChladni(auv, floor(n), m);

        // Blend based on spectral centroid
        float pattern = lerp(rectMode, circMode, gSpectralCentroid);

        // Weight by FFT energy
        float weight = energy * energy; // square for sharper response
        totalPattern += pattern * weight;
        totalWeight += weight;

        // Per-mode color contribution
        float hue = fi + gSpectralCentroid * 0.3 + t * 0.01;
        patternColor += SpectralColor(hue) * abs(pattern) * weight;
    }

    if (totalWeight > 0.001)
        totalPattern /= totalWeight;

    // --- Nodal line visualization (where pattern ≈ 0) ---
    float absPattern = abs(totalPattern);

    // Sand settles at nodal lines (near zero)
    float nodalLine = exp(-absPattern * absPattern * gSandSharpness * gSandSharpness);

    // Anti-nodal regions (maxima)
    float antiNodal = smoothstep(0.3, 0.8, absPattern);

    // --- Sand grain texture ---
    float grain = ValueNoise(auv * 400.0 + t * 0.1);
    float grainPattern = pow(grain, 3.0) * gParticleLayer;

    // Sand accumulates at nodal lines
    float sandDensity = nodalLine * (0.5 + grainPattern);

    // --- Coloring ---

    // Nodal lines: bright glowing lines
    float3 nodalColor = SpectralColor(gSpectralCentroid + t * 0.015) * nodalLine * gGlowOnNodes;

    // Anti-nodal regions: colored by pattern sign and FFT
    float patternSign = (totalPattern > 0.0) ? 1.0 : 0.0;
    float3 posColor = Palette(patternSign + gSpectralCentroid * 0.5,
        float3(0.5, 0.5, 0.5), float3(0.5, 0.5, 0.3),
        float3(1.0, 0.7, 0.4), float3(0.0, 0.10, 0.20));
    float3 negColor = Palette(1.0 - patternSign + gSpectralCentroid * 0.5 + 0.3,
        float3(0.5, 0.5, 0.5), float3(0.5, 0.5, 0.3),
        float3(0.8, 1.0, 0.5), float3(0.2, 0.25, 0.15));

    float3 regionColor = lerp(negColor, posColor, patternSign) * antiNodal;
    regionColor *= gColorVibrancy * (0.3 + gAudioRMS);

    // Sand grains: golden/white particles
    float3 sandColor = lerp(float3(0.8, 0.7, 0.5), float3(1.0, 0.95, 0.85), grain);
    sandColor *= sandDensity * 0.6;

    // --- Plate border ---
    float2 plateUV = abs(auv - 0.5) * 2.0;
    float plateEdge = max(plateUV.x, plateUV.y);
    float border = smoothstep(0.92, 0.95, plateEdge) * 0.3;
    float3 borderColor = float3(0.15, 0.12, 0.1) * border;

    // Circular plate edge (alternative)
    float circEdge = length(auv - 0.5) * 2.0;
    float circBorder = exp(-pow(circEdge - 0.9, 2.0) * 1000.0) * 0.2;
    borderColor += float3(0.2, 0.15, 0.1) * circBorder;

    // --- Vibration visualization ---
    // Show the plate vibrating: subtle displacement effect
    float vibration = totalPattern * gAudioRMS * 0.003;
    float2 vibUV = uv + float2(vibration, vibration * 0.7);
    float3 vibTrail = gFeedback.SampleLevel(samLinearClamp, vibUV, 0).rgb * 0.1;

    // --- Combine ---
    float3 color = trail * 0.3;
    color += regionColor;
    color += nodalColor;
    color += sandColor;
    color += borderColor;
    color += vibTrail;

    // Subtle inner glow
    float centerGlow = exp(-dot(auv - 0.5, auv - 0.5) * 8.0) * gAudioRMS * 0.15;
    color += SpectralColor(gSpectralCentroid) * centerGlow;

    // Mask outside plate
    float plateMask = smoothstep(0.98, 0.9, circEdge);
    color *= plateMask;

    // Background outside plate
    float3 bg = float3(0.01, 0.008, 0.005) * (1.0 - plateMask);
    color += bg;

    return float4(ACESFilm(color), 1.0);
}
