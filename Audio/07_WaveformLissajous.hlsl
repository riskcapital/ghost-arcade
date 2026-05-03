// ============================================================================
// Shader 07: Waveform Lissajous Traces
// Left/right channel waveforms mapped to X/Y coordinates creating
// oscilloscope-style Lissajous figures with persistence trails and
// color mapped to instantaneous phase difference.
// Target: D3D11 PS 5.0 | Fullscreen quad | Ping-pong RT required
// ============================================================================

#include "AudioShaderCommon.hlsli"

// t3 = feedback for persistence trails
// t4 = right channel waveform (t1 is left by convention)
Texture2D<float4>  gFeedback     : register(t3);
Texture1D<float>   gWaveformR    : register(t4);

cbuffer ShaderParams : register(b1)
{
    float gTrailDecay;       // persistence decay, default 0.96
    float gLineThickness;    // trace line width, default 0.003
    float gGlowRadius;       // soft glow around trace, default 0.015
    float gIntensity;        // overall brightness, default 3.0
    float gPhaseColorSpeed;  // phase-to-color mapping rate, default 1.0
    float gZoom;             // trace zoom / scale, default 0.8
    float gRotationSpeed;    // slow rotation of figure, default 0.05
    float gSampleDensity;    // waveform samples to evaluate, default 512.0
};

// Sample stereo waveform as X/Y pair
float2 StereoSample(float u)
{
    float l = gWaveformTexture.SampleLevel(samLinearClamp, u, 0);
    float r = gWaveformR.SampleLevel(samLinearClamp, u, 0);
    return float2(l, r);
}

// Approximate instantaneous phase difference between L and R
float PhaseDiff(float u, float eps)
{
    float2 s0 = StereoSample(u);
    float2 s1 = StereoSample(u + eps);

    float phaseL = atan2(s1.x - s0.x, eps);
    float phaseR = atan2(s1.y - s0.y, eps);

    return (phaseL - phaseR) / PI; // normalised [-1, 1]
}

// Distance from point to line segment
float SegmentDist(float2 p, float2 a, float2 b)
{
    float2 pa = p - a;
    float2 ba = b - a;
    float h = clamp(dot(pa, ba) / (dot(ba, ba) + 0.0001), 0.0, 1.0);
    return length(pa - ba * h);
}

float4 PS_Lissajous(VS_OUTPUT input) : SV_Target
{
    float2 uv = input.TexCoord;
    float t = gTime;

    // Aspect-corrected centered coords
    float aspect = gResolution.x / gResolution.y;
    float2 p = (uv - 0.5) * 2.0;
    p.x *= aspect;

    // Slow rotation of the entire figure
    float rotAngle = t * gRotationSpeed + gSpectralCentroid * 0.5;
    float cr = cos(rotAngle), sr = sin(rotAngle);
    p = float2(p.x * cr - p.y * sr, p.x * sr + p.y * cr);

    // Scale
    p /= gZoom;

    // Trail from previous frame
    float3 trail = gFeedback.SampleLevel(samLinearClamp, uv, 0).rgb * gTrailDecay;

    // Darken trail slightly toward blue/purple for depth
    trail.r *= 0.995;
    trail.g *= 0.990;

    // Evaluate distance to Lissajous trace
    float3 traceColor = 0.0;
    int samples = (int)gSampleDensity;
    float minDist = 1e6;
    float closestPhase = 0.0;
    float closestU = 0.0;

    float2 prevPoint = StereoSample(0.0) * gZoom;

    [loop]
    for (int i = 1; i < samples; i++)
    {
        float u = (float)i / (float)samples;
        float2 curPoint = StereoSample(u);

        // FFT energy modulates trace amplitude at this position
        float energy = SampleFFT(u * 0.5); // map to lower FFT half
        curPoint *= (0.5 + energy * 0.8);

        float dist = SegmentDist(p, prevPoint, curPoint);

        if (dist < minDist)
        {
            minDist = dist;
            closestU = u;
        }

        // Accumulate trace as soft glow (cheaper than finding exact minimum)
        float segGlow = exp(-dist * dist / (gGlowRadius * gGlowRadius));

        // Phase-based color
        float phase = PhaseDiff(u, 1.0 / (float)samples);
        float hue = phase * 0.5 + 0.5 + t * gPhaseColorSpeed * 0.05;
        float3 segColor = SpectralColor(hue);

        // Brightness varies with velocity (distance between consecutive samples)
        float velocity = length(curPoint - prevPoint) * (float)samples;
        float velocityBright = 1.0 / (1.0 + velocity * 2.0); // brighter when slow (more overlap)

        traceColor += segColor * segGlow * velocityBright * 0.02;

        prevPoint = curPoint;
    }

    // Sharp core line at minimum distance
    float coreLine = exp(-minDist * minDist / (gLineThickness * gLineThickness));
    float phase = PhaseDiff(closestU, 1.0 / (float)samples);
    float3 coreColor = SpectralColor(phase * 0.5 + 0.5 + t * gPhaseColorSpeed * 0.05);
    traceColor += coreColor * coreLine * 2.0;

    // White-hot center of line
    float whiteCore = exp(-minDist * minDist / (gLineThickness * gLineThickness * 0.1));
    traceColor += float3(1.0, 0.98, 0.95) * whiteCore;

    traceColor *= gIntensity;

    // --- Decorative elements ---

    // Axis crosshairs (very subtle)
    float xAxis = exp(-p.y * p.y * 2000.0) * 0.02;
    float yAxis = exp(-p.x * p.x * 2000.0) * 0.02;
    float3 axisColor = float3(0.1, 0.15, 0.2) * (xAxis + yAxis);

    // Circular graticule rings
    float pLen = length(p);
    float ring1 = exp(-pow(pLen - 0.5, 2.0) * 5000.0) * 0.03;
    float ring2 = exp(-pow(pLen - 1.0, 2.0) * 5000.0) * 0.02;
    float3 gratColor = float3(0.05, 0.08, 0.12) * (ring1 + ring2);

    // --- Combine ---
    float3 color = trail + traceColor + axisColor + gratColor;

    // Audio-reactive background warmth
    float bgWarmth = gAudioRMS * 0.03;
    color += float3(bgWarmth * 0.5, bgWarmth * 0.2, bgWarmth * 0.8);

    // Vignette
    float vig = 1.0 - dot(uv - 0.5, uv - 0.5) * 2.5;
    color *= smoothstep(0.0, 0.4, vig);

    return float4(ACESFilm(color), 1.0);
}
