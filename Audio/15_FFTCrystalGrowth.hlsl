// ============================================================================
// Shader 15: FFT Crystal Growth
// Diffusion-limited aggregation where growth direction and branching
// probability per arm is controlled by frequency bands. Crystalline
// structure evolves with the music over time.
// Target: D3D11 PS 5.0 | Fullscreen quad | Ping-pong RT required
// ============================================================================

#include "AudioShaderCommon.hlsli"

Texture2D<float4> gFeedback : register(t3);

cbuffer ShaderParams : register(b1)
{
    float gBranchCount;      // crystal arm count, default 6
    float gGrowthSpeed;      // growth rate, default 0.5
    float gBranchProb;       // branching probability base, default 0.4
    float gCrystalSharp;     // crystal edge sharpness, default 12.0
    float gTrailDecay;       // feedback decay, default 0.985
    float gEmissionPower;    // crystal glow power, default 3.0
    float gFractalDepth;     // recursion-like depth, default 4.0
    float gMeltRate;         // crystal dissolution with silence, default 0.02
};

// Rotational symmetry fold
float2 FoldRotational(float2 p, float arms)
{
    float angle = atan2(p.y, p.x);
    float sector = TWO_PI / arms;
    angle = abs(fmod(angle + sector * 0.5, sector) - sector * 0.5);
    float r = length(p);
    return float2(cos(angle), sin(angle)) * r;
}

// Single crystal branch SDF (2D)
float CrystalBranch(float2 p, float t, float depth, float bass, float mid, float high)
{
    float d = 1e6;

    // Main trunk
    float trunkLength = 0.3 + bass * 0.2 + sin(t * 0.2) * 0.02;
    float trunkWidth = 0.008 + mid * 0.004;

    // Trunk: line segment along +X
    float2 trunkEnd = float2(trunkLength, 0);
    float2 pa = p;
    float2 ba = trunkEnd;
    float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
    float trunkDist = length(pa - ba * h) - trunkWidth * (1.0 - h * 0.5);
    d = min(d, trunkDist);

    // Sub-branches at intervals along trunk
    int branches = (int)gFractalDepth;
    [loop]
    for (int i = 1; i <= branches; i++)
    {
        float fi = (float)i / (float)branches;
        float branchPos = fi * trunkLength * 0.9;

        // FFT energy determines if this branch exists
        float energy = SampleFFT(fi * 0.5);
        float branchProb = gBranchProb + energy * 0.4 + high * 0.2;
        if (Hash11(fi * 100.0 + floor(t * gGrowthSpeed)) > branchProb) continue;

        // Branch angle: 60° typical for crystals, modulated by audio
        float branchAngle = PI / 3.0 + (energy - 0.5) * 0.3;

        // Branch length decreases with depth, increases with FFT
        float branchLen = trunkLength * (0.6 - fi * 0.3) * (0.5 + energy);
        float branchWid = trunkWidth * (0.7 - fi * 0.2);

        // Upper branch
        float2 bStart = float2(branchPos, 0);
        float2 bDir = float2(cos(branchAngle), sin(branchAngle));
        float2 bEnd = bStart + bDir * branchLen;

        float2 bpa = p - bStart;
        float2 bba = bEnd - bStart;
        float bh = clamp(dot(bpa, bba) / dot(bba, bba), 0.0, 1.0);
        float bDist = length(bpa - bba * bh) - branchWid * (1.0 - bh * 0.6);
        d = min(d, bDist);

        // Lower branch (mirror)
        float2 bDir2 = float2(cos(-branchAngle), sin(-branchAngle));
        float2 bEnd2 = bStart + bDir2 * branchLen;
        float2 bpa2 = p - bStart;
        float2 bba2 = bEnd2 - bStart;
        float bh2 = clamp(dot(bpa2, bba2) / dot(bba2, bba2), 0.0, 1.0);
        float bDist2 = length(bpa2 - bba2 * bh2) - branchWid * (1.0 - bh2 * 0.6);
        d = min(d, bDist2);

        // Sub-sub-branches (tertiary)
        if (energy > 0.5 && i <= 2)
        {
            float subLen = branchLen * 0.4 * energy;
            float subAngle = branchAngle * 0.8;

            float2 subStart = bStart + bDir * branchLen * 0.6;
            float2 subEnd = subStart + float2(cos(branchAngle + subAngle), sin(branchAngle + subAngle)) * subLen;
            float2 spa = p - subStart;
            float2 sba = subEnd - subStart;
            float sh = clamp(dot(spa, sba) / dot(sba, sba), 0.0, 1.0);
            float sDist = length(spa - sba * sh) - branchWid * 0.5;
            d = min(d, sDist);
        }
    }

    return d;
}

float4 PS_CrystalGrowth(VS_OUTPUT input) : SV_Target
{
    float2 uv = input.TexCoord;
    float t = gTime;

    float aspect = gResolution.x / gResolution.y;
    float2 p = (uv - 0.5) * 2.0;
    p.x *= aspect;

    float bass = BassBand();
    float mid  = MidBand();
    float high = HighBand();

    // Feedback trail with slow decay (crystal persistence)
    float3 trail = gFeedback.SampleLevel(samLinearClamp, uv, 0).rgb;

    // Melt when quiet
    float melt = max(0.0, gMeltRate - gAudioRMS * gMeltRate * 2.0);
    trail *= (gTrailDecay - melt);

    // --- Crystal evaluation ---

    // Fold for rotational symmetry
    int arms = (int)gBranchCount;
    float2 folded = FoldRotational(p, (float)arms);

    // Crystal distance
    float crystalDist = CrystalBranch(folded, t, gFractalDepth, bass, mid, high);

    // --- Rendering ---

    // Sharp crystal body
    float crystalBody = smoothstep(0.005, 0.0, crystalDist);

    // Crystal edge glow
    float edgeGlow = exp(-max(crystalDist, 0.0) * gCrystalSharp);

    // Soft outer glow
    float outerGlow = exp(-max(crystalDist, 0.0) * gCrystalSharp * 0.2);

    // --- Coloring ---

    // Crystal body: ice blue to white based on energy
    float3 bodyColor = lerp(
        float3(0.1, 0.3, 0.5),
        float3(0.8, 0.9, 1.0),
        gAudioRMS
    );

    // FFT-based color variation along crystal arms
    float armPos = length(folded) / 0.5; // normalised position along arm
    float fftAtPos = SampleFFT(armPos * 0.5);
    float3 fftColor = SpectralColor(armPos + gSpectralCentroid + t * 0.01);

    bodyColor = lerp(bodyColor, fftColor, fftAtPos * 0.7);

    // Edge color: bright spectral
    float3 edgeColor = SpectralColor(gSpectralCentroid + t * 0.02 + armPos * 0.3);

    // Growth tips glow (at branch endpoints)
    float tipGlow = 0.0;
    float tipDist = abs(armPos - (0.3 + bass * 0.2));
    tipGlow += exp(-tipDist * tipDist * 100.0) * bass;

    float3 tipColor = SpectralColor(gSpectralCentroid + 0.15) * tipGlow * 2.0;

    // Compose crystal
    float3 crystal = 0.0;
    crystal += bodyColor * crystalBody * (0.5 + gAudioRMS);
    crystal += edgeColor * edgeGlow * gEmissionPower;
    crystal += edgeColor * outerGlow * 0.3;
    crystal += tipColor;

    // Internal refraction pattern (fake caustics)
    if (crystalBody > 0.1)
    {
        float caustic = pow(ValueNoise(p * 30.0 + t * 0.3), 3.0) * crystalBody;
        crystal += float3(0.5, 0.7, 1.0) * caustic * 0.4;
    }

    // --- Background ---
    float bgR = length(p);
    float3 bg = lerp(float3(0.005, 0.008, 0.015), float3(0.001, 0.002, 0.005), bgR);

    // Ambient particles (floating dust)
    float dust = pow(ValueNoise(uv * 150.0 + t * float2(0.02, 0.03)), 10.0);
    bg += float3(0.3, 0.5, 0.8) * dust * 0.15;

    // Radial light from center
    float centerLight = exp(-bgR * bgR * 3.0) * gAudioRMS * 0.1;
    bg += SpectralColor(gSpectralCentroid) * centerLight;

    // --- Combine ---
    float3 color = trail * 0.5 + crystal + bg;

    // Bloom
    float lum = dot(color, float3(0.2126, 0.7152, 0.0722));
    color += color * smoothstep(0.4, 1.0, lum) * 0.4;

    // Vignette
    float vig = 1.0 - dot(uv - 0.5, uv - 0.5) * 2.0;
    color *= smoothstep(0.0, 0.5, vig);

    return float4(ACESFilm(color), 1.0);
}
