// ============================================================================
// Shader 05: Harmonic Voronoi Fracture
// Voronoi cells where each seed point orbits based on a different harmonic
// frequency. Cell borders glow with amplitude. Cells shatter and reform
// with transients (spectral flux).
// Target: D3D11 PS 5.0 | Fullscreen quad
// ============================================================================

#include "AudioShaderCommon.hlsli"

Texture2D<float4> gFeedback : register(t3);

cbuffer ShaderParams : register(b1)
{
    float gCellScale;        // voronoi cell density, default 4.0
    float gOrbitRadius;      // seed orbit radius, default 0.3
    float gBorderWidth;      // cell border glow width, default 0.06
    float gShatterForce;     // transient shatter displacement, default 2.0
    float gColorDepth;       // interior color saturation, default 1.0
    float gTrailDecay;       // feedback decay, default 0.92
    float gBorderEmission;   // border glow brightness, default 4.0
    float gReformSpeed;      // cell reform speed after shatter, default 2.0
};

// Audio-driven Voronoi with harmonic seed motion
// Returns: float4(cell_distance, border_distance, cell_id, second_closest)
float4 AudioVoronoi(float2 uv, float t)
{
    float2 p = uv * gCellScale;
    float2 ip = floor(p);
    float2 fp = frac(p);

    float minDist = 1e6;
    float secondDist = 1e6;
    float cellID = 0.0;
    float2 closestSeed = 0.0;

    // Spectral flux drives shatter
    float shatter = gSpectralFlux * gShatterForce;

    [unroll]
    for (int y = -2; y <= 2; y++)
    {
        [unroll]
        for (int x = -2; x <= 2; x++)
        {
            float2 neighbor = float2(x, y);
            float2 cell = ip + neighbor;

            // Base seed position from hash
            float2 seed = Hash22(cell);
            float id = Hash21(cell);

            // Harmonic frequency for this cell's orbit
            float harmonic = floor(id * 8.0) + 1.0; // harmonics 1-8
            float freq = harmonic * 0.5;

            // FFT energy at this cell's harmonic
            float energy = SampleFFT(id);

            // Seed orbits based on its harmonic
            float angle = t * freq * 0.3 + id * TWO_PI;
            float orbitR = gOrbitRadius * energy;
            float2 orbit = float2(cos(angle), sin(angle)) * orbitR;

            // Shatter: displace seeds outward on transients
            float2 shatterDir = normalize(seed - 0.5 + 0.001);
            float2 shatterOffset = shatterDir * shatter * energy;

            // Final seed position
            float2 seedPos = seed + orbit + shatterOffset;

            float2 diff = neighbor + seedPos - fp;
            float dist = length(diff);

            if (dist < minDist)
            {
                secondDist = minDist;
                minDist = dist;
                cellID = id;
                closestSeed = cell;
            }
            else if (dist < secondDist)
            {
                secondDist = dist;
            }
        }
    }

    float border = secondDist - minDist;
    return float4(minDist, border, cellID, secondDist);
}

// Cell interior shading
float3 CellInterior(float cellID, float dist, float t)
{
    // FFT energy for this cell's associated band
    float band = frac(cellID * 7.31);
    float energy = SampleFFT(band);

    // Base color from cell ID
    float hue = cellID + t * 0.02 + energy * 0.2;
    float3 baseColor = SpectralColor(hue);

    // Interior gradient: darker toward edges
    float interior = smoothstep(0.4, 0.0, dist);

    // Waveform modulation: sample waveform at cell-specific position
    float waveU = frac(cellID * 3.17 + t * 0.05);
    float wave = SampleWaveform(waveU) * 0.5 + 0.5;

    // Color depth modulation
    float3 color = baseColor * interior * (0.1 + energy * gColorDepth);

    // Inner glow pulse with waveform
    float pulse = smoothstep(0.3, 0.0, dist) * wave * energy;
    color += SpectralColor(hue + 0.3) * pulse * 0.5;

    return color;
}

// Border glow shading
float3 BorderGlow(float border, float2 uv, float t)
{
    // Sharp border line
    float line = exp(-border * border / (gBorderWidth * gBorderWidth * 0.001));

    // Softer glow around border
    float glow = exp(-border / (gBorderWidth * 0.5));

    // Color shifts along border based on position
    float hue = GradNoise(uv * 3.0 + t * 0.1) + gSpectralCentroid;
    float3 borderColor = SpectralColor(hue);

    // Energy-modulated brightness
    float energy = gAudioRMS;
    float3 color = borderColor * (line * gBorderEmission + glow * energy * 1.5);

    // Add white-hot core on the edge line
    color += float3(1.0, 0.95, 0.9) * line * energy * 2.0;

    return color;
}

// Fracture crack lines (appear during shatter)
float3 FractureCracks(float2 uv, float t, float shatterAmount)
{
    if (shatterAmount < 0.1) return 0.0;

    float3 cracks = 0.0;

    // Multiple layers of crack-like voronoi
    [unroll]
    for (int layer = 0; layer < 3; layer++)
    {
        float scale = gCellScale * (2.0 + layer * 3.0);
        float2 p = uv * scale;
        float2 ip = floor(p);
        float2 fp = frac(p);

        float md = 1e6;
        float md2 = 1e6;

        [unroll]
        for (int y = -1; y <= 1; y++)
        {
            [unroll]
            for (int x = -1; x <= 1; x++)
            {
                float2 cell = ip + float2(x, y);
                float2 seed = Hash22(cell + layer * 100.0);

                // Cracks jitter with transients
                seed += Hash22(cell * 3.0) * shatterAmount * 0.3;

                float2 diff = float2(x, y) + seed - fp;
                float d = length(diff);

                if (d < md)  { md2 = md; md = d; }
                else if (d < md2) { md2 = d; }
            }
        }

        float edge = md2 - md;
        float crack = exp(-edge * edge * 2000.0) * shatterAmount;

        float hue = (float)layer * 0.33 + t * 0.1;
        cracks += SpectralColor(hue + 0.7) * crack * 0.5;
    }

    return cracks;
}

float4 PS_HarmonicVoronoi(VS_OUTPUT input) : SV_Target
{
    float2 uv = input.TexCoord;
    float t = gTime;

    // Aspect correction
    float aspect = gResolution.x / gResolution.y;
    float2 auv = float2((uv.x - 0.5) * aspect + 0.5, uv.y);

    // Feedback trail
    float3 trail = gFeedback.SampleLevel(samLinearClamp, uv, 0).rgb * gTrailDecay;

    // Audio-driven rotation of the entire voronoi field
    float fieldAngle = t * 0.05 + gAudioRMS * 0.2;
    float2 centered = auv - 0.5;
    float ca = cos(fieldAngle), sa = sin(fieldAngle);
    float2 rotated = float2(centered.x * ca - centered.y * sa,
                            centered.x * sa + centered.y * ca) + 0.5;

    // Waveform-driven UV distortion
    float wave = SampleWaveform(frac(uv.y * 2.0 + t * 0.05));
    float2 distortedUV = rotated + float2(wave * 0.01, 0.0);

    // Compute voronoi
    float4 vor = AudioVoronoi(distortedUV, t);
    float cellDist = vor.x;
    float border = vor.y;
    float cellID = vor.z;

    // Cell interior
    float3 interior = CellInterior(cellID, cellDist, t);

    // Border glow
    float3 borderGlow = BorderGlow(border, distortedUV, t);

    // Fracture cracks on transients
    float shatterAmount = saturate(gSpectralFlux * gShatterForce);
    float3 cracks = FractureCracks(distortedUV, t, shatterAmount);

    // Combine
    float3 color = trail * 0.3 + interior + borderGlow + cracks;

    // Global energy glow: everything gets brighter with RMS
    color *= 0.7 + gAudioRMS * 0.6;

    // Depth effect: cells further from center are darker
    float centerDist = length(uv - 0.5);
    float depth = smoothstep(0.7, 0.2, centerDist);
    color *= 0.3 + depth * 0.7;

    // Subtle chromatic aberration on shatter
    if (shatterAmount > 0.1)
    {
        float2 aberr = (uv - 0.5) * 0.005 * shatterAmount;
        float r = gFeedback.SampleLevel(samLinearClamp, uv + aberr, 0).r;
        float b = gFeedback.SampleLevel(samLinearClamp, uv - aberr, 0).b;
        color.r = lerp(color.r, r + color.r, 0.3);
        color.b = lerp(color.b, b + color.b, 0.3);
    }

    // Vignette
    float vig = 1.0 - centerDist * centerDist * 1.5;
    color *= smoothstep(0.0, 0.4, vig);

    return float4(ACESFilm(color), 1.0);
}
