// ============================================================================
// Shader 18: Waveform Möbius Strip
// Raw waveform rendered as a twisting Möbius surface. Twist rate modulated
// by spectral centroid. Surface color driven by spectral flux.
// Raymarched parametric SDF.
// Target: D3D11 PS 5.0 | Fullscreen quad
// ============================================================================

#include "AudioShaderCommon.hlsli"

Texture2D<float4> gFeedback : register(t3);

cbuffer ShaderParams : register(b1)
{
    float gStripWidth;       // ribbon width, default 0.3
    float gStripRadius;      // loop radius, default 1.2
    float gTwistCount;       // number of half-twists, default 1.0
    float gWaveformScale;    // waveform displacement, default 0.25
    float gCameraOrbit;      // camera orbit speed, default 0.1
    float gEmission;         // surface glow, default 2.0
    float gTrailDecay;       // feedback decay, default 0.94
    float gThickness;        // strip thickness, default 0.02
};

// Möbius strip parametric point
// u: angle around loop [0, 2*PI]
// v: position across width [-1, 1]
float3 MobiusPoint(float u, float v, float t)
{
    // Twist rate modulated by spectral centroid
    float twists = gTwistCount + gSpectralCentroid * 0.5;
    float halfTwist = twists * u * 0.5;

    // Waveform displacement along the strip
    float waveU = frac(u / TWO_PI);
    float wave = SampleWaveform(waveU) * gWaveformScale;

    // FFT modulates strip width locally
    float fftVal = SampleFFT(waveU);
    float localWidth = gStripWidth * (0.5 + fftVal * 0.8);

    // Parametric Möbius coordinates
    float R = gStripRadius + wave;
    float cosU = cos(u);
    float sinU = sin(u);
    float cosH = cos(halfTwist);
    float sinH = sin(halfTwist);

    float x = (R + v * localWidth * cosH) * cosU;
    float y = (R + v * localWidth * cosH) * sinU;
    float z = v * localWidth * sinH + wave * 0.5;

    return float3(x, z, y); // swap Y/Z for better camera angle
}

// Distance from point to Möbius surface
float MobiusSDF(float3 p, float t)
{
    float minDist = 1e6;

    // Sample the parametric surface
    const int U_SAMPLES = 64;
    const int V_SAMPLES = 4;

    [loop]
    for (int i = 0; i < U_SAMPLES; i++)
    {
        float u = ((float)i / (float)U_SAMPLES) * TWO_PI;

        [unroll]
        for (int j = 0; j < V_SAMPLES; j++)
        {
            float v = ((float)j / (float)(V_SAMPLES - 1)) * 2.0 - 1.0;

            float3 surfPt = MobiusPoint(u, v, t);
            float d = length(p - surfPt) - gThickness;
            minDist = min(minDist, d);
        }
    }

    return minDist;
}

// Faster approximate: distance to the spine curve + width check
float MobiusSDFFast(float3 p, float t, out float paramU, out float paramV)
{
    float minDist = 1e6;
    paramU = 0.0;
    paramV = 0.0;

    const int SAMPLES = 80;

    [loop]
    for (int i = 0; i < SAMPLES; i++)
    {
        float u = ((float)i / (float)SAMPLES) * TWO_PI;

        // Spine point (v=0)
        float3 spine = MobiusPoint(u, 0.0, t);

        // Edge points for width
        float3 edge1 = MobiusPoint(u, 1.0, t);
        float3 edge2 = MobiusPoint(u, -1.0, t);

        // Local frame
        float3 widthDir = normalize(edge1 - edge2);
        float halfWidth = length(edge1 - edge2) * 0.5;

        // Next spine point for tangent
        float uNext = ((float)(i + 1) / (float)SAMPLES) * TWO_PI;
        float3 spineNext = MobiusPoint(uNext, 0.0, t);
        float3 tangent = normalize(spineNext - spine);

        // Project query point onto local frame
        float3 delta = p - spine;
        float alongWidth = dot(delta, widthDir);
        float alongTangent = dot(delta, tangent);
        float3 normalDir = cross(tangent, widthDir);
        float alongNormal = dot(delta, normalDir);

        // Distance to strip cross-section
        float dWidth = max(abs(alongWidth) - halfWidth, 0.0);
        float dNormal = abs(alongNormal) - gThickness;

        float d = length(float2(max(dWidth, 0.0), max(dNormal, 0.0)));
        if (dWidth <= 0.0 && dNormal <= 0.0)
            d = max(dWidth, dNormal); // inside

        if (d < minDist)
        {
            minDist = d;
            paramU = u;
            paramV = clamp(alongWidth / halfWidth, -1.0, 1.0);
        }
    }

    return minDist;
}

float4 PS_MobiusStrip(VS_OUTPUT input) : SV_Target
{
    float2 uv = input.TexCoord;
    float2 ndc = (uv - 0.5) * 2.0;
    ndc.x *= gResolution.x / gResolution.y;
    float t = gTime;

    // Camera
    float camAngle = t * gCameraOrbit;
    float camPitch = sin(t * 0.07) * 0.4;
    float camDist = 3.5;

    float3 ro = float3(
        cos(camAngle) * cos(camPitch) * camDist,
        sin(camPitch) * camDist + 0.3,
        sin(camAngle) * cos(camPitch) * camDist
    );

    float3 fwd = normalize(-ro);
    float3 right = normalize(cross(float3(0, 1, 0), fwd));
    float3 up = cross(fwd, right);
    float3 rd = normalize(fwd * 1.8 + right * ndc.x + up * ndc.y);

    // Feedback
    float3 trail = gFeedback.SampleLevel(samLinearClamp, uv, 0).rgb * gTrailDecay;

    // Raymarch
    float3 color = 0.0;
    float totalT = 0.0;
    bool hitSurface = false;
    float hitU = 0.0, hitV = 0.0;

    [loop]
    for (int i = 0; i < 64; i++)
    {
        float3 p = ro + rd * totalT;
        float paramU, paramV;
        float d = MobiusSDFFast(p, t, paramU, paramV);

        // Volumetric glow
        if (d < 0.3)
        {
            float energy = SampleFFT(frac(paramU / TWO_PI));
            float glow = exp(-d * d * 80.0) * energy;
            float3 glowCol = SpectralColor(paramU / TWO_PI + gSpectralCentroid);
            color += glowCol * glow * 0.02;
        }

        if (d < 0.003)
        {
            hitSurface = true;
            hitU = paramU;
            hitV = paramV;
            break;
        }

        totalT += max(d * 0.5, 0.008);
        if (totalT > 8.0) break;
    }

    if (hitSurface)
    {
        float3 pos = ro + rd * totalT;

        // Normal via finite differences
        float eps = 0.005;
        float pu, pv;
        float d0 = MobiusSDFFast(pos, t, pu, pv);
        float dx = MobiusSDFFast(pos + float3(eps,0,0), t, pu, pv);
        float dy = MobiusSDFFast(pos + float3(0,eps,0), t, pu, pv);
        float dz = MobiusSDFFast(pos + float3(0,0,eps), t, pu, pv);
        float3 nor = normalize(float3(dx - d0, dy - d0, dz - d0));

        // Parametric position for coloring
        float uNorm = hitU / TWO_PI;
        float vNorm = hitV * 0.5 + 0.5;

        // FFT and waveform at this strip position
        float fftVal = SampleFFT(uNorm);
        float waveVal = abs(SampleWaveform(uNorm));

        // Color: position along loop + spectral flux modulation
        float hue = uNorm + gSpectralFlux * 2.0 + t * 0.015;
        float3 stripColor = SpectralColor(hue);

        // Width-based color variation
        float3 edgeColor = SpectralColor(hue + 0.4);
        stripColor = lerp(stripColor, edgeColor, abs(hitV));

        // Lighting
        float3 lightDir = normalize(float3(0.5, 0.7, 0.3));
        float diff = max(dot(nor, lightDir), 0.0);
        float spec = pow(max(dot(reflect(-lightDir, nor), -rd), 0.0), 24.0);
        float fresnel = pow(1.0 - max(dot(nor, -rd), 0.0), 3.0);

        float3 surface = stripColor * (0.08 + diff * 0.5);
        surface += float3(1, 0.95, 0.9) * spec * 0.5;
        surface += SpectralColor(hue + 0.5) * fresnel * 0.4;

        // Audio emission
        surface += stripColor * fftVal * gEmission * 0.4;

        // Waveform ridge highlighting
        float ridgeGlow = exp(-waveVal * 50.0) * 0.3;
        surface += SpectralColor(gSpectralCentroid) * ridgeGlow;

        // Edge highlight along strip borders
        float edgeHighlight = exp(-pow(abs(hitV) - 1.0, 2.0) * 50.0);
        surface += SpectralColor(hue + 0.2) * edgeHighlight * 0.5 * fftVal;

        float fog = exp(-totalT * 0.1);
        color += surface * fog;
    }

    // Background
    float bgR = length(ndc);
    float3 bg = lerp(float3(0.006, 0.004, 0.012), float3(0.002, 0.001, 0.005), bgR);
    color += bg * (1.0 - saturate(dot(color, float3(0.33, 0.33, 0.33)) * 3.0));
    color += trail * 0.2;

    // Bloom
    float lum = dot(color, float3(0.2126, 0.7152, 0.0722));
    color += color * smoothstep(0.4, 1.0, lum) * 0.35;

    // Vignette
    float vig = 1.0 - dot(uv - 0.5, uv - 0.5) * 2.0;
    color *= smoothstep(0.0, 0.5, vig);

    return float4(ACESFilm(color), 1.0);
}
