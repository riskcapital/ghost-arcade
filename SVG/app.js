import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { Line2 } from 'three/addons/lines/Line2.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { LineGeometry } from 'three/addons/lines/LineGeometry.js';

// Default polygon data - will be replaced when SVG is uploaded
let svgPolygons = [
    { points: "97.28 62.81 93.45 1417.94 88.09 1430.81 948.26 1430.81 939.06 62.81 97.28 62.81", fill: false, id: 0 },
    { points: "129.45 734.55 123.32 722.45 375.94 429.7 526.98 582.13 472.36 650.47 406.45 688.12 129.45 734.55", fill: true, id: 1 },
    { points: "97.28 538.47 97.28 637.28 193.02 515.49 415.15 265.79 442.72 216.77 412.85 231.32 253.53 395.23 147.83 493.28 97.28 538.47", fill: false, id: 2 },
    { points: "97.28 366.13 261.96 277.28 369.19 222.89 459.57 177.7 586.72 114.13 687.83 67.4 677.11 97.28 612 122.55 568.34 140.17 565.28 154.72 376.85 245.87 229.02 319.4 194.55 327.83 97.28 382.21 97.28 366.13", fill: false, id: 3 },
    { points: "709.28 67.4 413.62 394.47 413.62 555.32 623.49 389.87 746.04 285.7 834.89 211.4 890.81 127.15 939.06 62.81 704.68 62.81 709.28 67.4", fill: false, id: 4 },
    { points: "159.32 677.87 176.17 647.23 245.87 546.13 317.11 431.23 374.55 333.96 405.04 277.15 415.15 265.79 442.72 216.77 488.51 191.86 382.98 367.66 274.98 540 199.91 664.85 179.23 699.32 179.23 704.68 175.4 699.32 175.4 693.19 159.32 677.87", fill: false, id: 5 },
    { points: "330.7 242.41 504.77 409.79 664.09 560.68 687.83 549.96 515.49 401.55 442.72 331.66 344.74 235.29 334.05 240.72 330.7 242.41", fill: false, id: 6 },
    { points: "855.57 427.02 859.4 422.81 866.3 438.89 821.11 625.79 790.47 748.34 753.7 899.23 729.96 912.26 754.47 811.91 790.47 667.53 825.7 540.77 855.57 427.02", fill: false, id: 7 },
    { points: "124.85 1430.81 88.09 1430.81 157.02 1265.36 203.74 1163.49 239.74 1063.91 274.21 978.13 330.89 854.04 339.32 831.06 362.3 820.34 346.98 862.47 317.11 944.43 288 1032.51 235.15 1166.55 203.74 1240.09 173.87 1305.19 147.06 1369.53 124.85 1430.81", fill: false, id: 8 },
    { points: "222.13 963.57 438.13 1227.83 515.49 1323.57 592.85 1430.81 754.47 1430.81 760.6 1411.66 719.23 1365.7 660.26 1302.89 592.09 1231.66 555.32 1197.19 477.96 1129.79 396 1056.26 396 1036.34 383.74 1028.68 222.13 963.57", fill: false, id: 9 },
    { points: "362.3 1260 373.02 1270.72 459.57 1215.57 562.21 1145.11 693.19 1060.85 798.13 992.68 850.21 956.68 914.55 919.15 886.98 912.26 798.13 917.62 798.13 924.51 631.91 1046.3 510.13 1142.04 405.19 1228.6 362.3 1260", fill: false, id: 10 },
    { points: "358.47 1267.66 676.34 1291.4 742.21 1233.96 775.91 1201.79 866.3 1132.09 907.66 1095.32 948.26 1063.15 948.26 1017.19 850.21 956.68 395.12 1256.65 362.3 1266.13 358.47 1267.66", fill: false, id: 11 },
    { points: "252 723.83 350.04 887.74 419.74 1008 491.36 1133.62 523.15 1136.68 491.36 1087.66 402.89 947.49 327.06 820.34 270 733.02 252 723.83", fill: false, id: 12 },
    { points: "129.45 734.55 247.4 820.34 407.49 936.77 504.77 1004.94 645.56 1091.49 798.13 992.68 739.91 948.26 623.49 846.38 543.06 777.45 431.23 686.3 129.45 734.55", fill: false, id: 13 },
    { points: "948.26 1136.68 849.45 1040.94 798.13 992.68 607.03 832.27 435.12 689.47 450.38 680.94 580.98 783.57 749.87 908.81 753.7 899.23 798.13 924.51 855.12 959.71 948.26 1017.19 948.26 1136.68", fill: false, id: 14 },
    { points: "93.45 896.17 171.57 848.68 274.21 790.47 362.3 735.32 476.43 667.53 589.02 598.98 658.42 555.32 651.46 548.73 428.17 675.57 319.4 738.38 244.34 779.74 167.74 820.34 101.11 853.28 121.79 864.77 97.28 882.38 93.45 896.17", fill: false, id: 15 },
    { points: "237.45 700.09 252 723.83 263.58 729.74 291.06 693.19 316.34 670.98 484.09 539.23 611.23 435.06 710.81 353.87 775.91 297.96 746.04 285.7 595.86 411.66 538.56 456.83 342.97 613.49 315.06 636.39 237.45 700.09", fill: false, id: 16 },
    { points: "362.3 555.32 476.09 382.21 488.51 394.16 342.97 613.49 308.48 641.79 362.3 555.32", fill: false, id: 17 },
    { points: "270 733.02 549.96 582.13 638.43 536.38 651.46 548.73 285.66 756.98 270 733.02", fill: false, id: 18 },
    { points: "93.45 981.96 243.57 888.89 474.89 756.98 785.11 582.13 413.62 739.91 237.45 820.34 93.45 896.17 93.45 981.96", fill: false, id: 19 },
    { points: "97.28 888.89 260.43 963.57 549.59 1111.02 668.96 1172.1 629.62 1257.7 526.98 1197.19 362.3 1111.02 202.21 1034.04 93.45 981.96 97.28 888.89", fill: false, id: 20 },
    { points: "446.55 997.28 454.21 981.96 376.85 1001.11 785.11 1240.09 720 1144.34 497.11 1021.79 446.55 997.28", fill: false, id: 21 }
];

let SVG_WIDTH = 1046.3;
let SVG_HEIGHT = 1490.55;
const SCALE = 0.55;

// Color palettes for different shapes
const shapeColors = [
    { h: 0, s: 0.8, l: 0.5 },    // red
    { h: 20, s: 0.9, l: 0.5 },   // orange
    { h: 280, s: 0.7, l: 0.5 },  // purple
    { h: 200, s: 0.8, l: 0.5 },  // blue
    { h: 340, s: 0.85, l: 0.5 }, // pink
    { h: 40, s: 0.9, l: 0.55 },  // gold
    { h: 180, s: 0.7, l: 0.45 }, // teal
    { h: 320, s: 0.75, l: 0.5 }, // magenta
];

function hslToColor(h, s, l) {
    return new THREE.Color().setHSL(h / 360, s, l);
}

function parsePolygonPoints(pointsStr, width, height) {
    const coords = pointsStr.trim().split(/\s+/).map(Number);
    const points = [];
    for (let i = 0; i < coords.length; i += 2) {
        points.push(new THREE.Vector3(
            (coords[i] - width / 2) * SCALE,
            -(coords[i + 1] - height / 2) * SCALE,
            0
        ));
    }
    return points;
}

function getCentroid(points) {
    const c = new THREE.Vector3();
    points.forEach(p => c.add(p));
    return c.divideScalar(points.length);
}

function getBounds(points) {
    const min = new THREE.Vector3(Infinity, Infinity, 0);
    const max = new THREE.Vector3(-Infinity, -Infinity, 0);
    points.forEach(p => {
        min.x = Math.min(min.x, p.x);
        min.y = Math.min(min.y, p.y);
        max.x = Math.max(max.x, p.x);
        max.y = Math.max(max.y, p.y);
    });
    return { min, max, width: max.x - min.x, height: max.y - min.y };
}

function getPerimeter(points) {
    let len = 0;
    for (let i = 0; i < points.length; i++) {
        len += points[i].distanceTo(points[(i + 1) % points.length]);
    }
    return len;
}

const FinalPassShader = {
    uniforms: {
        tDiffuse: { value: null },
        uTime: { value: 0 },
        uChromatic: { value: 0.002 },
        uVignette: { value: 0.3 }
    },
    vertexShader: `
        varying vec2 vUv;
        void main() {
            vUv = uv;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
    `,
    fragmentShader: `
        uniform sampler2D tDiffuse;
        uniform float uTime;
        uniform float uChromatic;
        uniform float uVignette;
        varying vec2 vUv;

        void main() {
            vec2 center = vUv - 0.5;
            float dist = length(center);
            vec2 offset = center * dist * uChromatic;
            float r = texture2D(tDiffuse, vUv + offset).r;
            float g = texture2D(tDiffuse, vUv).g;
            float b = texture2D(tDiffuse, vUv - offset).b;
            vec3 color = vec3(r, g, b);
            float vign = 1.0 - dist * uVignette * 1.5;
            color *= vign;
            gl_FragColor = vec4(color, 1.0);
        }
    `
};

class LiquidFlowApp {
    constructor() {
        this.container = document.getElementById('canvas-container');
        this.clock = new THREE.Clock();

        this.polygons = [];
        this.allEdges = [];
        this.sharedVertices = [];
        this.allVertices = [];

        this.outlines = [];
        this.liquidFills = [];
        this.glowNodes = [];
        this.energyPulses = [];
        this.connectionLines = [];
        this.ripples = [];
        this.lightningBolts = [];
        this.edgeFlowLines = [];
        this.innerGlows = [];
        this.nebulaPlanes = [];
        this.plasmaTendrils = [];
        this.particleLinks = [];
        this.echoLayers = [];
        this.arcBridges = [];

        this.params = {
            // Fill modes: 'liquid', 'solid', 'gradient', 'shimmer', 'pulse', 'noise', 'particles'
            fillMode: 'liquid',

            // Fill mode specific parameters
            // Gradient
            gradientAngle: 90, // 0=horizontal, 90=vertical
            gradientSpread: 0.3, // How much hue changes across gradient

            // Shimmer
            shimmerSpeed: 5.0,
            shimmerScale: 0.1,
            shimmerIntensity: 0.8,

            // Pulse
            pulseSpeed: 3.0,
            pulseRingScale: 10.0,
            pulseRingSpeed: 5.0,

            // Noise
            noiseScale: 0.02,
            noiseSpeed: 0.5,
            noiseContrast: 0.5,

            // Particle Fill
            particleFillDensity: 200,
            particleFillSize: 3,
            particleFillSpeed: 1.0,

            // Color modes: 'perShape', 'rainbow', 'monochrome', 'gradient', 'complementary', 'analogous'
            colorMode: 'perShape',
            monochromeHue: 0,
            gradientStart: new THREE.Color(0xff0000),
            gradientEnd: new THREE.Color(0x0000ff),

            liquidEnabled: true,
            liquidSpeed: 0.4,
            liquidWaveAmp: 0.08,
            liquidColor1: new THREE.Color(0xee3425),
            liquidColor2: new THREE.Color(0xff6b35),

            particlesEnabled: true,
            particleCount: 3000,
            particleSpeed: 80,
            particleSize: 2.5,
            particleColor: new THREE.Color(0xffffff),

            connectionsEnabled: true,
            connectionPulseSpeed: 2.0,
            connectionColor: new THREE.Color(0xff4444),
            connectionThickness: 2,

            energyEnabled: true,
            energySpeed: 150,
            energyColor: new THREE.Color(0xffaa00),

            glowEnabled: true,
            glowPulseSpeed: 2.0,
            glowColor: new THREE.Color(0xee3425),

            ripplesEnabled: true,
            rippleSpeed: 1.0,
            rippleColor: new THREE.Color(0xff6644),

            lightningEnabled: true,
            lightningFrequency: 1.5,
            lightningColor: new THREE.Color(0x88ccff),
            lightningBolts: 20,
            lightningThickness: 3,
            lightningBranches: 3,
            lightningDuration: 0.12,

            edgeFlowEnabled: true,
            edgeFlowSpeed: 1.5,
            edgeFlowColor: new THREE.Color(0xff8844),
            edgeFlowThickness: 2,

            innerGlowEnabled: true,
            innerGlowIntensity: 0.5,
            innerGlowColor: new THREE.Color(0xee3425),

            nebulaEnabled: true,
            nebulaIntensity: 0.3,
            nebulaSpeed: 0.2,

            heartbeatEnabled: true,
            heartbeatSpeed: 1.0,
            heartbeatIntensity: 0.3,

            plasmaEnabled: true,
            plasmaIntensity: 0.8,
            plasmaSpeed: 2.0,
            plasmaColor: new THREE.Color(0xff00ff),
            plasmaThickness: 3,
            plasmaCount: 5,
            plasmaOpacity: 0.6,

            echoEnabled: true,
            echoLayers: 4,
            echoSpacing: 8,
            echoColor: new THREE.Color(0x4444ff),
            echoOpacity: 0.3,
            echoThickness: 2,

            arcBridgesEnabled: true,
            arcBridgeColor: new THREE.Color(0xffff00),
            arcBridgeThickness: 3,
            arcBridgeOpacity: 0.4,
            arcBridgeHeight: 15,

            outlineThickness: 3,
            outlineColor: new THREE.Color(0xee3425),

            colorCycleEnabled: true,
            colorCycleSpeed: 0.3,
            colorCycleSaturation: 0.8,
            colorCycleLightness: 0.55,

            perShapeColors: true,

            particleLinksEnabled: true,
            particleLinkDistance: 60,
            particleLinkColor: new THREE.Color(0xff8866),
            particleLinkThickness: 1,
            particleLinkOpacity: 0.3,
            particleLinkMaxLinks: 500,

            bloomStrength: 1.8,
            bloomThreshold: 0.15,
            chromatic: 0.002,
            vignette: 0.3
        };

        this.heartbeatPhase = 0;
        this.colorCycleOffset = 0;

        // For GPU optimization - use frame skipping for expensive operations
        this.frameCount = 0;
        this.particleLinkUpdateFrequency = 3; // Update every N frames

        // Use accumulated time for smooth color cycling (no resets)
        this.accumulatedColorTime = 0;

        // Pre-allocated vectors to avoid GC pressure
        this._tempVec3 = new THREE.Vector3();
        this._tempColor = new THREE.Color();

        // Use performance.now() for smoother timing
        this._lastTime = 0;
        this._animationTime = 0;
        this._whiteMode = false;

        this.init();
        this.parsePolygons();
        this.createScene();
        this.setupPostProcessing();
        this.setupControls();
        this.setupSVGUpload();
        this.animate();
    }

    init() {
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0x020204);

        this.camera = new THREE.OrthographicCamera(
            -window.innerWidth / 2, window.innerWidth / 2,
            window.innerHeight / 2, -window.innerHeight / 2,
            1, 1000
        );
        this.camera.position.z = 500;

        this.renderer = new THREE.WebGLRenderer({
            antialias: true,
            powerPreference: 'high-performance'
        });
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        this.container.appendChild(this.renderer.domElement);

        window.addEventListener('resize', () => this.onResize());
    }

    parsePolygons() {
        this.polygons = [];
        this.allEdges = [];
        this.sharedVertices = [];
        this.allVertices = [];

        svgPolygons.forEach((poly, idx) => {
            const points = parsePolygonPoints(poly.points, SVG_WIDTH, SVG_HEIGHT);
            const centroid = getCentroid(points);
            const bounds = getBounds(points);
            const perimeter = getPerimeter(points);

            const edges = [];
            for (let i = 0; i < points.length; i++) {
                const p1 = points[i];
                const p2 = points[(i + 1) % points.length];
                edges.push({ start: p1.clone(), end: p2.clone(), polyId: idx });
                this.allEdges.push({ start: p1.clone(), end: p2.clone(), polyId: idx, edgeId: this.allEdges.length });
            }

            points.forEach(p => this.allVertices.push(p.clone()));

            // Assign unique color to each shape
            const colorIdx = idx % shapeColors.length;
            const baseColor = shapeColors[colorIdx];

            this.polygons.push({
                id: idx,
                points,
                centroid,
                bounds,
                edges,
                perimeter,
                fillPhase: Math.random() * Math.PI * 2,
                breathPhase: Math.random() * Math.PI * 2,
                colorHue: baseColor.h,
                colorSat: baseColor.s,
                colorLight: baseColor.l
            });
        });

        const threshold = 5;
        const vertexMap = new Map();

        this.polygons.forEach(poly => {
            poly.points.forEach(p => {
                const key = `${Math.round(p.x / threshold)},${Math.round(p.y / threshold)}`;
                if (!vertexMap.has(key)) {
                    vertexMap.set(key, { pos: p.clone(), polygons: new Set() });
                }
                vertexMap.get(key).polygons.add(poly.id);
            });
        });

        vertexMap.forEach((data) => {
            if (data.polygons.size >= 2) {
                this.sharedVertices.push({
                    pos: data.pos,
                    polygons: Array.from(data.polygons)
                });
            }
        });

        // Pre-compute edge connectivity for fast particle transitions
        this.edgeConnections = new Map();
        for (let i = 0; i < this.allEdges.length; i++) {
            const edge = this.allEdges[i];
            const connected = [];
            for (let j = 0; j < this.allEdges.length; j++) {
                if (i !== j && this.allEdges[j].start.distanceTo(edge.end) < 5) {
                    connected.push(j);
                }
            }
            this.edgeConnections.set(i, connected);
        }
    }

    clearScene() {
        // Remove all objects from mainGroup
        if (this.mainGroup) {
            while (this.mainGroup.children.length > 0) {
                const obj = this.mainGroup.children[0];
                if (obj.geometry) obj.geometry.dispose();
                if (obj.material) {
                    if (Array.isArray(obj.material)) {
                        obj.material.forEach(m => m.dispose());
                    } else {
                        obj.material.dispose();
                    }
                }
                this.mainGroup.remove(obj);
            }
        }

        // Clear arrays
        this.outlines = [];
        this.liquidFills = [];
        this.glowNodes = [];
        this.energyPulses = [];
        this.connectionLines = [];
        this.ripples = [];
        this.lightningBolts = [];
        this.edgeFlowLines = [];
        this.innerGlows = [];
        this.nebulaPlanes = [];
        this.plasmaTendrils = [];
        this.echoLayers = [];
        this.arcBridges = [];
        this.particles = null;
        this.particleLinksMesh = null;
    }

    rebuildScene() {
        this.clearScene();
        this.parsePolygons();
        this.createScene();
    }

    createScene() {
        if (!this.mainGroup) {
            this.mainGroup = new THREE.Group();
            this.scene.add(this.mainGroup);
        }

        this.createNebulaBackground();
        this.createEchoLayers();
        this.createInnerGlows();
        this.createPolygonFills();
        this.createRipples();
        this.createConnections();
        this.createArcBridges();
        this.createEdgeFlow();
        this.createPolygonOutlines();
        this.createEdgeParticleSystem();
        this.createParticleLinks();
        this.createEnergyPulses();
        this.createGlowNodes();
        this.createLightning();
        this.createPlasmaTendrils();
    }

    createNebulaBackground() {
        const geometry = new THREE.PlaneGeometry(window.innerWidth * 1.5, window.innerHeight * 1.5);
        const material = new THREE.ShaderMaterial({
            uniforms: {
                uTime: { value: 0 },
                uIntensity: { value: this.params.nebulaIntensity },
                uSpeed: { value: this.params.nebulaSpeed }
            },
            vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
            fragmentShader: `
                uniform float uTime, uIntensity, uSpeed;
                varying vec2 vUv;
                vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
                vec4 mod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
                vec4 permute(vec4 x) { return mod289(((x*34.0)+1.0)*x); }
                vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }
                float snoise(vec3 v) {
                    const vec2 C = vec2(1.0/6.0, 1.0/3.0);
                    const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
                    vec3 i = floor(v + dot(v, C.yyy));
                    vec3 x0 = v - i + dot(i, C.xxx);
                    vec3 g = step(x0.yzx, x0.xyz);
                    vec3 l = 1.0 - g;
                    vec3 i1 = min(g.xyz, l.zxy);
                    vec3 i2 = max(g.xyz, l.zxy);
                    vec3 x1 = x0 - i1 + C.xxx;
                    vec3 x2 = x0 - i2 + C.yyy;
                    vec3 x3 = x0 - D.yyy;
                    i = mod289(i);
                    vec4 p = permute(permute(permute(i.z + vec4(0.0, i1.z, i2.z, 1.0)) + i.y + vec4(0.0, i1.y, i2.y, 1.0)) + i.x + vec4(0.0, i1.x, i2.x, 1.0));
                    float n_ = 0.142857142857;
                    vec3 ns = n_ * D.wyz - D.xzx;
                    vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
                    vec4 x_ = floor(j * ns.z);
                    vec4 y_ = floor(j - 7.0 * x_);
                    vec4 x = x_ *ns.x + ns.yyyy;
                    vec4 y = y_ *ns.x + ns.yyyy;
                    vec4 h = 1.0 - abs(x) - abs(y);
                    vec4 b0 = vec4(x.xy, y.xy);
                    vec4 b1 = vec4(x.zw, y.zw);
                    vec4 s0 = floor(b0)*2.0 + 1.0;
                    vec4 s1 = floor(b1)*2.0 + 1.0;
                    vec4 sh = -step(h, vec4(0.0));
                    vec4 a0 = b0.xzyw + s0.xzyw*sh.xxyy;
                    vec4 a1 = b1.xzyw + s1.xzyw*sh.zzww;
                    vec3 p0 = vec3(a0.xy, h.x);
                    vec3 p1 = vec3(a0.zw, h.y);
                    vec3 p2 = vec3(a1.xy, h.z);
                    vec3 p3 = vec3(a1.zw, h.w);
                    vec4 norm = taylorInvSqrt(vec4(dot(p0,p0), dot(p1,p1), dot(p2,p2), dot(p3,p3)));
                    p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
                    vec4 m = max(0.6 - vec4(dot(x0,x0), dot(x1,x1), dot(x2,x2), dot(x3,x3)), 0.0);
                    m = m * m;
                    return 42.0 * dot(m*m, vec4(dot(p0,x0), dot(p1,x1), dot(p2,x2), dot(p3,x3)));
                }
                void main() {
                    float t = uTime * uSpeed;
                    float n1 = snoise(vec3(vUv * 2.0, t * 0.5)) * 0.5 + 0.5;
                    float n2 = snoise(vec3(vUv * 4.0 + 100.0, t * 0.3)) * 0.5 + 0.5;
                    float n3 = snoise(vec3(vUv * 8.0 + 200.0, t * 0.7)) * 0.5 + 0.5;
                    float noise = n1 * 0.5 + n2 * 0.3 + n3 * 0.2;
                    vec3 col1 = vec3(0.13, 0.03, 0.03);
                    vec3 col2 = vec3(0.03, 0.07, 0.13);
                    vec3 col3 = vec3(0.1, 0.02, 0.12);
                    vec3 color = mix(mix(col1, col2, noise), col3, sin(t * 0.2) * 0.5 + 0.5);
                    color *= uIntensity;
                    float stars = pow(snoise(vec3(vUv * 50.0, 0.0)) * 0.5 + 0.5, 20.0);
                    color += stars * 0.3;
                    gl_FragColor = vec4(color, 1.0);
                }
            `,
            transparent: false,
            depthWrite: false
        });
        const plane = new THREE.Mesh(geometry, material);
        plane.position.z = -50;
        this.mainGroup.add(plane);
        this.nebulaPlanes.push(plane);
    }

    createLine2(points, color, thickness, opacity = 1.0) {
        const positions = [];
        points.forEach(p => positions.push(p.x, p.y, p.z || 0));

        const geometry = new LineGeometry();
        geometry.setPositions(positions);

        const material = new LineMaterial({
            color: color,
            linewidth: thickness,
            transparent: true,
            opacity: opacity,
            resolution: new THREE.Vector2(window.innerWidth, window.innerHeight),
            dashed: false
        });

        return new Line2(geometry, material);
    }

    createEchoLayers() {
        this.polygons.forEach((poly, idx) => {
            if (idx === 0) return;

            for (let layer = 1; layer <= this.params.echoLayers; layer++) {
                const scaledPoints = poly.points.map(p => {
                    const dir = p.clone().sub(poly.centroid).normalize();
                    return p.clone().sub(dir.multiplyScalar(layer * this.params.echoSpacing));
                });

                const points = [...scaledPoints, scaledPoints[0]];
                const baseOpacity = this.params.echoOpacity / layer;

                const line = this.createLine2(points, this.params.echoColor, this.params.echoThickness, baseOpacity);
                line.position.z = -4 - layer * 0.5;
                line.userData = { layer, polyId: idx, baseOpacity, baseHue: poly.colorHue / 360 };

                this.mainGroup.add(line);
                this.echoLayers.push(line);
            }
        });
    }

    createInnerGlows() {
        this.polygons.forEach((poly, idx) => {
            if (idx === 0) return;

            const shape = new THREE.Shape();
            shape.moveTo(poly.points[0].x, poly.points[0].y);
            for (let i = 1; i < poly.points.length; i++) {
                shape.lineTo(poly.points[i].x, poly.points[i].y);
            }
            shape.closePath();

            const geometry = new THREE.ShapeGeometry(shape);
            const material = new THREE.ShaderMaterial({
                uniforms: {
                    uTime: { value: 0 },
                    uColor: { value: hslToColor(poly.colorHue, poly.colorSat, poly.colorLight) },
                    uIntensity: { value: this.params.innerGlowIntensity },
                    uCentroid: { value: new THREE.Vector2(poly.centroid.x, poly.centroid.y) },
                    uBreathPhase: { value: poly.breathPhase },
                    uColorOffset: { value: 0 }
                },
                vertexShader: `varying vec2 vPosition; void main() { vPosition = position.xy; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
                fragmentShader: `
                    uniform float uTime, uIntensity, uBreathPhase, uColorOffset;
                    uniform vec3 uColor;
                    uniform vec2 uCentroid;
                    varying vec2 vPosition;
                    vec3 hsl2rgb(float h, float s, float l) {
                        vec3 rgb = clamp(abs(mod(h*6.0+vec3(0.0,4.0,2.0),6.0)-3.0)-1.0, 0.0, 1.0);
                        return l + s * (rgb - 0.5) * (1.0 - abs(2.0 * l - 1.0));
                    }
                    void main() {
                        float dist = distance(vPosition, uCentroid);
                        float maxDist = 150.0;
                        float glow = 1.0 - smoothstep(0.0, maxDist, dist);
                        glow = pow(glow, 2.0);
                        float breath = sin(uTime * 2.0 + uBreathPhase) * 0.3 + 0.7;
                        glow *= breath;
                        vec3 color = uColor;
                        if (uColorOffset > 0.0) {
                            float hue = mod(uColorOffset + dist * 0.002, 1.0);
                            color = hsl2rgb(hue, 0.8, 0.5);
                        }
                        color *= glow * uIntensity;
                        gl_FragColor = vec4(color, glow * 0.4);
                    }
                `,
                transparent: true,
                depthWrite: false,
                blending: THREE.AdditiveBlending
            });

            const mesh = new THREE.Mesh(geometry, material);
            mesh.position.z = -5;
            mesh.userData = { polyId: poly.id, breathPhase: poly.breathPhase };
            this.mainGroup.add(mesh);
            this.innerGlows.push(mesh);
        });
    }

    createPolygonFills() {
        // Enhanced fill shader supporting multiple modes with customizable parameters
        const fillVertexShader = `varying vec2 vPosition; void main() { vPosition = position.xy; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
        const fillFragmentShader = `
            uniform float uTime, uFillLevel, uWaveAmp, uMinY, uMaxY, uMinX, uMaxX, uPulse, uHeartbeat, uHue;
            uniform int uFillMode;
            uniform vec3 uColor1, uColor2;
            // Customizable parameters
            uniform float uGradientAngle, uGradientSpread;
            uniform float uShimmerSpeed, uShimmerScale, uShimmerIntensity;
            uniform float uPulseSpeed, uPulseRingScale, uPulseRingSpeed;
            uniform float uNoiseScale, uNoiseSpeed, uNoiseContrast;
            uniform float uParticleDensity, uParticleSize, uParticleSpeed;
            varying vec2 vPosition;

            vec3 hsl2rgb(float h, float s, float l) {
                vec3 rgb = clamp(abs(mod(h*6.0+vec3(0.0,4.0,2.0),6.0)-3.0)-1.0, 0.0, 1.0);
                return l + s * (rgb - 0.5) * (1.0 - abs(2.0 * l - 1.0));
            }

            float hash(vec2 p) {
                return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
            }

            float noise(vec2 p) {
                vec2 i = floor(p);
                vec2 f = fract(p);
                f = f * f * (3.0 - 2.0 * f);
                return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x),
                           mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
            }

            float fbm(vec2 p) {
                float v = 0.0;
                float a = 0.5;
                for (int i = 0; i < 4; i++) {
                    v += a * noise(p);
                    p *= 2.0;
                    a *= 0.5;
                }
                return v;
            }

            void main() {
                float normalizedY = (vPosition.y - uMinY) / (uMaxY - uMinY);
                float normalizedX = (vPosition.x - uMinX) / (uMaxX - uMinX);
                vec3 baseColor;
                float alpha = 0.75;

                // Fill mode 0: Liquid
                if (uFillMode == 0) {
                    float wave = sin(vPosition.x * 0.03 + uTime * 3.0) * uWaveAmp;
                    wave += sin(vPosition.x * 0.07 + uTime * 2.0) * uWaveAmp * 0.5;
                    float fillLine = uFillLevel + wave;
                    float fill = smoothstep(fillLine - 0.03, fillLine + 0.01, normalizedY);
                    if (fill < 0.01) discard;
                    baseColor = mix(uColor2, uColor1, normalizedY);
                    if (uHue >= 0.0) {
                        float h = mod(uHue + normalizedY * 0.1, 1.0);
                        baseColor = hsl2rgb(h, 0.85, 0.5);
                    }
                    float caustic = sin(vPosition.x * 0.08 + uTime * 4.0) * sin(vPosition.y * 0.08 + uTime * 3.0) * 0.15 + 0.85;
                    baseColor *= caustic;
                    float surfaceHighlight = 1.0 - smoothstep(0.0, 0.08, abs(normalizedY - fillLine));
                    baseColor += vec3(1.0) * surfaceHighlight * 0.6;
                    float bubble = pow(max(sin(vPosition.x * 0.5 + uTime * 8.0) * sin(vPosition.y * 0.5 - uTime * 12.0), 0.0), 10.0);
                    baseColor += bubble * 0.4;
                    alpha = fill * 0.75;
                }
                // Fill mode 1: Solid
                else if (uFillMode == 1) {
                    baseColor = uColor1;
                    if (uHue >= 0.0) {
                        baseColor = hsl2rgb(uHue, 0.85, 0.5);
                    }
                    alpha = 0.6;
                }
                // Fill mode 2: Gradient (customizable angle and spread)
                else if (uFillMode == 2) {
                    float angle = uGradientAngle * 3.14159 / 180.0;
                    float gradientPos = normalizedX * cos(angle) + normalizedY * sin(angle);
                    gradientPos = clamp(gradientPos, 0.0, 1.0);
                    baseColor = mix(uColor2, uColor1, gradientPos);
                    if (uHue >= 0.0) {
                        float h1 = uHue;
                        float h2 = mod(uHue + uGradientSpread, 1.0);
                        baseColor = mix(hsl2rgb(h2, 0.85, 0.4), hsl2rgb(h1, 0.85, 0.6), gradientPos);
                    }
                    alpha = 0.65;
                }
                // Fill mode 3: Shimmer (customizable speed, scale, intensity)
                else if (uFillMode == 3) {
                    baseColor = uColor1;
                    if (uHue >= 0.0) {
                        baseColor = hsl2rgb(uHue, 0.85, 0.5);
                    }
                    float shimmer = sin(vPosition.x * uShimmerScale + uTime * uShimmerSpeed) *
                                   sin(vPosition.y * uShimmerScale + uTime * uShimmerSpeed * 0.8);
                    shimmer = shimmer * 0.5 + 0.5;
                    baseColor *= (1.0 - uShimmerIntensity * 0.5) + shimmer * uShimmerIntensity;
                    baseColor += vec3(1.0) * pow(shimmer, 4.0) * uShimmerIntensity * 0.6;
                    alpha = 0.7;
                }
                // Fill mode 4: Pulse (customizable speed, ring scale/speed)
                else if (uFillMode == 4) {
                    baseColor = uColor1;
                    if (uHue >= 0.0) {
                        baseColor = hsl2rgb(uHue, 0.85, 0.5);
                    }
                    float pulse = sin(uTime * uPulseSpeed) * 0.5 + 0.5;
                    float dist = length(vPosition) * 0.01;
                    float ring = sin(dist * uPulseRingScale - uTime * uPulseRingSpeed) * 0.5 + 0.5;
                    baseColor *= 0.5 + pulse * 0.5 + ring * 0.3;
                    alpha = 0.65;
                }
                // Fill mode 5: Noise (customizable scale, speed, contrast)
                else if (uFillMode == 5) {
                    float n = fbm(vPosition * uNoiseScale + uTime * uNoiseSpeed);
                    // Apply contrast
                    n = (n - 0.5) * (1.0 + uNoiseContrast * 2.0) + 0.5;
                    n = clamp(n, 0.0, 1.0);
                    baseColor = mix(uColor2, uColor1, n);
                    if (uHue >= 0.0) {
                        float h = mod(uHue + n * 0.3, 1.0);
                        baseColor = hsl2rgb(h, 0.85, 0.25 + n * 0.5);
                    }
                    alpha = 0.6;
                }
                // Fill mode 6: Particles
                else if (uFillMode == 6) {
                    // Animated particle/dot pattern
                    vec2 uv = vPosition * uParticleDensity * 0.01;
                    uv += uTime * uParticleSpeed * 0.1;

                    vec2 gv = fract(uv) - 0.5;
                    vec2 id = floor(uv);

                    float d = length(gv);
                    float r = uParticleSize * 0.02 * (0.3 + hash(id) * 0.7);

                    // Animate individual particles
                    float anim = sin(uTime * 3.0 + hash(id) * 6.28) * 0.5 + 0.5;
                    r *= 0.5 + anim * 0.5;

                    float particle = 1.0 - smoothstep(r * 0.5, r, d);

                    if (particle < 0.1) discard;

                    baseColor = uColor1;
                    if (uHue >= 0.0) {
                        float h = mod(uHue + hash(id) * 0.2, 1.0);
                        baseColor = hsl2rgb(h, 0.9, 0.55);
                    }
                    baseColor *= 0.8 + anim * 0.4;
                    alpha = particle * 0.8;
                }

                baseColor *= 0.7 + uPulse * 0.3 + uHeartbeat * 0.2;
                gl_FragColor = vec4(baseColor, alpha);
            }
        `;

        this.polygons.forEach((poly, idx) => {
            if (idx === 0) return;

            const shape = new THREE.Shape();
            shape.moveTo(poly.points[0].x, poly.points[0].y);
            for (let i = 1; i < poly.points.length; i++) {
                shape.lineTo(poly.points[i].x, poly.points[i].y);
            }
            shape.closePath();

            const geometry = new THREE.ShapeGeometry(shape);
            const material = new THREE.ShaderMaterial({
                uniforms: {
                    uTime: { value: 0 },
                    uFillLevel: { value: 0 },
                    uWaveAmp: { value: this.params.liquidWaveAmp },
                    uFillMode: { value: 0 },
                    uColor1: { value: hslToColor(poly.colorHue, poly.colorSat, poly.colorLight) },
                    uColor2: { value: hslToColor(poly.colorHue, poly.colorSat, poly.colorLight * 0.7) },
                    uMinY: { value: poly.bounds.min.y },
                    uMaxY: { value: poly.bounds.max.y },
                    uMinX: { value: poly.bounds.min.x },
                    uMaxX: { value: poly.bounds.max.x },
                    uPulse: { value: 0 },
                    uHeartbeat: { value: 0 },
                    uHue: { value: -1 },
                    // Gradient params
                    uGradientAngle: { value: this.params.gradientAngle },
                    uGradientSpread: { value: this.params.gradientSpread },
                    // Shimmer params
                    uShimmerSpeed: { value: this.params.shimmerSpeed },
                    uShimmerScale: { value: this.params.shimmerScale },
                    uShimmerIntensity: { value: this.params.shimmerIntensity },
                    // Pulse params
                    uPulseSpeed: { value: this.params.pulseSpeed },
                    uPulseRingScale: { value: this.params.pulseRingScale },
                    uPulseRingSpeed: { value: this.params.pulseRingSpeed },
                    // Noise params
                    uNoiseScale: { value: this.params.noiseScale },
                    uNoiseSpeed: { value: this.params.noiseSpeed },
                    uNoiseContrast: { value: this.params.noiseContrast },
                    // Particle fill params
                    uParticleDensity: { value: this.params.particleFillDensity },
                    uParticleSize: { value: this.params.particleFillSize },
                    uParticleSpeed: { value: this.params.particleFillSpeed }
                },
                vertexShader: fillVertexShader,
                fragmentShader: fillFragmentShader,
                transparent: true,
                side: THREE.DoubleSide,
                depthWrite: false
            });

            const mesh = new THREE.Mesh(geometry, material);
            mesh.position.z = -3;
            mesh.userData = { polyId: poly.id, fillPhase: poly.fillPhase, baseHue: poly.colorHue / 360 };
            this.mainGroup.add(mesh);
            this.liquidFills.push(mesh);
        });
    }

    createRipples() {
        const ringGeometry = new THREE.RingGeometry(1, 3, 32);
        this.sharedVertices.forEach((sv, idx) => {
            for (let i = 0; i < 3; i++) {
                const material = new THREE.MeshBasicMaterial({
                    color: this.params.rippleColor,
                    transparent: true,
                    opacity: 0,
                    side: THREE.DoubleSide
                });
                const ring = new THREE.Mesh(ringGeometry, material);
                ring.position.copy(sv.pos);
                ring.position.z = -2;
                ring.userData = { phase: idx * 0.7 + i * 2.0, ringIndex: i, maxRadius: 40 + i * 20 };
                this.mainGroup.add(ring);
                this.ripples.push(ring);
            }
        });
    }

    createConnections() {
        const centroidConnections = [];
        this.sharedVertices.forEach(sv => {
            for (let i = 0; i < sv.polygons.length; i++) {
                for (let j = i + 1; j < sv.polygons.length; j++) {
                    const p1 = this.polygons[sv.polygons[i]];
                    const p2 = this.polygons[sv.polygons[j]];
                    if (!p1 || !p2) continue;
                    const key = `${Math.min(p1.id, p2.id)}-${Math.max(p1.id, p2.id)}`;
                    if (!centroidConnections.includes(key)) {
                        centroidConnections.push(key);
                        const curve = new THREE.QuadraticBezierCurve3(p1.centroid, sv.pos, p2.centroid);
                        const points = curve.getPoints(30);

                        const line = this.createLine2(points, this.params.connectionColor, this.params.connectionThickness, 0.5);
                        line.position.z = -1;
                        line.userData = { phase: Math.random() * Math.PI * 2 };
                        this.mainGroup.add(line);
                        this.connectionLines.push(line);
                    }
                }
            }
        });
    }

    createArcBridges() {
        for (let i = 1; i < this.polygons.length; i++) {
            for (let j = i + 1; j < this.polygons.length; j++) {
                const p1 = this.polygons[i];
                const p2 = this.polygons[j];

                let minDist = Infinity;
                let closestPair = null;

                for (const e1 of p1.edges) {
                    const mid1 = new THREE.Vector3().lerpVectors(e1.start, e1.end, 0.5);
                    for (const e2 of p2.edges) {
                        const mid2 = new THREE.Vector3().lerpVectors(e2.start, e2.end, 0.5);
                        const dist = mid1.distanceTo(mid2);
                        if (dist < minDist && dist < 150 && dist > 20) {
                            minDist = dist;
                            closestPair = { mid1: mid1.clone(), mid2: mid2.clone() };
                        }
                    }
                }

                if (closestPair) {
                    const arcMid = new THREE.Vector3().lerpVectors(closestPair.mid1, closestPair.mid2, 0.5);
                    arcMid.z = this.params.arcBridgeHeight + Math.random() * 10;

                    const curve = new THREE.QuadraticBezierCurve3(closestPair.mid1, arcMid, closestPair.mid2);
                    const points = curve.getPoints(20);

                    const line = this.createLine2(points, this.params.arcBridgeColor, this.params.arcBridgeThickness, this.params.arcBridgeOpacity);
                    line.userData = { phase: Math.random() * Math.PI * 2, curve, baseOpacity: this.params.arcBridgeOpacity };
                    this.mainGroup.add(line);
                    this.arcBridges.push(line);
                }
            }
        }
    }

    createEdgeFlow() {
        this.polygons.forEach((poly, polyIdx) => {
            if (polyIdx === 0) return;
            poly.edges.forEach((edge, edgeIdx) => {
                const points = [edge.start, edge.end];

                const line = this.createLine2(points, hslToColor(poly.colorHue, poly.colorSat * 0.8, poly.colorLight), this.params.edgeFlowThickness, 0.6);
                line.position.z = 0.5;
                line.userData = { phase: polyIdx + edgeIdx * 0.3 };
                this.mainGroup.add(line);
                this.edgeFlowLines.push(line);
            });
        });
    }

    createPolygonOutlines() {
        this.polygons.forEach((poly, idx) => {
            const color = idx === 0 ? 0xee3425 : hslToColor(poly.colorHue, poly.colorSat, poly.colorLight);
            const points = [...poly.points, poly.points[0]];

            const line = this.createLine2(points, color, this.params.outlineThickness, 0.95);
            line.position.z = 1;
            line.userData = { polyId: poly.id, baseOpacity: 0.95, baseHue: poly.colorHue / 360 };
            this.mainGroup.add(line);
            this.outlines.push(line);
        });
    }

    createEdgeParticleSystem() {
        const count = this.params.particleCount;
        const positions = new Float32Array(count * 3);
        const colors = new Float32Array(count * 3);
        const sizes = new Float32Array(count);
        const edgeData = new Float32Array(count * 4);

        for (let i = 0; i < count; i++) {
            const edgeIdx = Math.floor(Math.random() * this.allEdges.length);
            const edge = this.allEdges[edgeIdx];
            const progress = Math.random();
            const pos = new THREE.Vector3().lerpVectors(edge.start, edge.end, progress);
            positions[i * 3] = pos.x;
            positions[i * 3 + 1] = pos.y;
            positions[i * 3 + 2] = 2;

            const poly = this.polygons[edge.polyId];
            const hue = poly ? poly.colorHue / 360 : 0;
            const color = new THREE.Color().setHSL(hue, 0.9, 0.7);
            colors[i * 3] = color.r;
            colors[i * 3 + 1] = color.g;
            colors[i * 3 + 2] = color.b;

            sizes[i] = this.params.particleSize * (0.5 + Math.random() * 0.5);
            edgeData[i * 4] = edgeIdx;
            edgeData[i * 4 + 1] = progress;
            edgeData[i * 4 + 2] = 0.5 + Math.random() * 1.5;
            edgeData[i * 4 + 3] = 0.6 + Math.random() * 0.4;
        }

        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
        geometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1));

        const material = new THREE.PointsMaterial({
            size: this.params.particleSize,
            vertexColors: true,
            transparent: true,
            opacity: 0.9,
            blending: THREE.AdditiveBlending,
            sizeAttenuation: false
        });

        this.particles = new THREE.Points(geometry, material);
        this.particles.userData = { edgeData };
        this.mainGroup.add(this.particles);
    }

    createParticleLinks() {
        const maxLinks = this.params.particleLinkMaxLinks;
        const positions = new Float32Array(maxLinks * 6); // 2 points per line * 3 coords

        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geometry.setDrawRange(0, 0);

        const material = new THREE.LineBasicMaterial({
            color: this.params.particleLinkColor,
            transparent: true,
            opacity: this.params.particleLinkOpacity,
            blending: THREE.AdditiveBlending
        });

        this.particleLinksMesh = new THREE.LineSegments(geometry, material);
        this.particleLinksMesh.position.z = 2.5;
        this.particleLinksMesh.frustumCulled = false;
        this.mainGroup.add(this.particleLinksMesh);
    }

    createEnergyPulses() {
        const pulseGeometry = new THREE.CircleGeometry(5, 16);
        for (let i = 0; i < 50; i++) {
            const edgeIdx = Math.floor(Math.random() * this.allEdges.length);
            const edge = this.allEdges[edgeIdx];
            const poly = this.polygons[edge.polyId];
            const color = poly ? hslToColor(poly.colorHue, poly.colorSat, poly.colorLight + 0.2) : this.params.energyColor;

            const material = new THREE.MeshBasicMaterial({
                color: color,
                transparent: true,
                opacity: 0.9
            });
            const pulse = new THREE.Mesh(pulseGeometry, material);
            pulse.position.copy(edge.start);
            pulse.position.z = 3;
            pulse.userData = {
                edgeIndex: edgeIdx,
                progress: Math.random(),
                speed: 0.3 + Math.random() * 0.5,
                size: 0.8 + Math.random() * 0.4
            };
            this.mainGroup.add(pulse);
            this.energyPulses.push(pulse);
        }
    }

    createGlowNodes() {
        const nodeGeometry = new THREE.CircleGeometry(5, 20);

        this.sharedVertices.forEach((sv, idx) => {
            const material = new THREE.MeshBasicMaterial({
                color: this.params.glowColor,
                transparent: true,
                opacity: 0.9
            });
            const node = new THREE.Mesh(nodeGeometry, material);
            node.position.copy(sv.pos);
            node.position.z = 4;
            node.scale.setScalar(1.8);
            node.userData = { phase: idx * 0.4, isShared: true, baseScale: 1.8 };
            this.mainGroup.add(node);
            this.glowNodes.push(node);
        });

        this.polygons.forEach((poly, polyIdx) => {
            if (polyIdx === 0) return;
            const color = hslToColor(poly.colorHue, poly.colorSat, poly.colorLight);
            poly.points.forEach((p, idx) => {
                const isShared = this.sharedVertices.some(sv => sv.pos.distanceTo(p) < 5);
                if (!isShared) {
                    const material = new THREE.MeshBasicMaterial({
                        color: color,
                        transparent: true,
                        opacity: 0.7
                    });
                    const node = new THREE.Mesh(nodeGeometry, material);
                    node.position.copy(p);
                    node.position.z = 4;
                    node.scale.setScalar(0.7);
                    node.userData = { phase: polyIdx * 0.5 + idx * 0.2, isShared: false, baseScale: 0.7, baseHue: poly.colorHue / 360 };
                    this.mainGroup.add(node);
                    this.glowNodes.push(node);
                }
            });
        });
    }

    createLightning() {
        for (let i = 0; i < this.params.lightningBolts; i++) {
            const points = [new THREE.Vector3(0, 0, 0), new THREE.Vector3(1, 1, 0)];
            const line = this.createLine2(points, this.params.lightningColor, this.params.lightningThickness, 0);
            line.position.z = 5;
            line.userData = { active: false, timer: 0, duration: this.params.lightningDuration };
            line.visible = false;
            this.mainGroup.add(line);
            this.lightningBolts.push(line);
        }
    }

    createPlasmaTendrils() {
        const PLASMA_SEGMENTS = 16; // Number of points in each tendril

        this.polygons.forEach((poly, idx) => {
            if (idx === 0) return;

            for (let t = 0; t < this.params.plasmaCount; t++) {
                const edgeIdx = Math.floor(Math.random() * poly.edges.length);
                const edge = poly.edges[edgeIdx];
                const targetPoint = new THREE.Vector3().lerpVectors(edge.start, edge.end, Math.random());

                // Create initial points array with all segments (not just 2 points)
                const start = poly.centroid;
                const end = targetPoint;
                const points = [];
                for (let i = 0; i < PLASMA_SEGMENTS; i++) {
                    const prog = i / (PLASMA_SEGMENTS - 1);
                    points.push(new THREE.Vector3(
                        start.x + (end.x - start.x) * prog,
                        start.y + (end.y - start.y) * prog,
                        2
                    ));
                }

                const line = this.createLine2(points, this.params.plasmaColor, this.params.plasmaThickness, this.params.plasmaOpacity);
                line.position.z = 2;
                line.userData = {
                    polyId: idx,
                    centroid: poly.centroid.clone(),
                    target: targetPoint,
                    phase: Math.random() * Math.PI * 2,
                    active: true,
                    baseHue: poly.colorHue / 360,
                    segments: PLASMA_SEGMENTS
                };

                this.mainGroup.add(line);
                this.plasmaTendrils.push(line);
            }
        });
    }

    generateLightningPath(start, end, addBranches = true) {
        const points = [start.clone()];
        const segments = 12;
        const displacement = start.distanceTo(end) * 0.25;
        const branchPoints = [];

        for (let i = 1; i < segments; i++) {
            const t = i / segments;
            const point = new THREE.Vector3().lerpVectors(start, end, t);
            const perpX = -(end.y - start.y);
            const perpY = end.x - start.x;
            const len = Math.sqrt(perpX * perpX + perpY * perpY);
            if (len > 0) {
                point.x += (perpX / len) * (Math.random() - 0.5) * displacement;
                point.y += (perpY / len) * (Math.random() - 0.5) * displacement;
            }
            points.push(point);

            if (addBranches && i > 2 && i < segments - 2 && Math.random() < 0.4) {
                branchPoints.push({ point: point.clone(), perpX, perpY, len });
            }
        }
        points.push(end.clone());

        return points;
    }

    triggerLightning() {
        if (!this.params.lightningEnabled) return;
        const bolt = this.lightningBolts.find(b => !b.userData.active);
        if (!bolt) return;

        const type = Math.random();
        let start, end;

        if (type < 0.4 && this.sharedVertices.length >= 2) {
            const idx1 = Math.floor(Math.random() * this.sharedVertices.length);
            let idx2 = Math.floor(Math.random() * this.sharedVertices.length);
            while (idx2 === idx1) idx2 = Math.floor(Math.random() * this.sharedVertices.length);
            start = this.sharedVertices[idx1].pos;
            end = this.sharedVertices[idx2].pos;
        } else if (type < 0.7 && this.polygons.length > 2) {
            const p1 = 1 + Math.floor(Math.random() * (this.polygons.length - 1));
            let p2 = 1 + Math.floor(Math.random() * (this.polygons.length - 1));
            while (p2 === p1) p2 = 1 + Math.floor(Math.random() * (this.polygons.length - 1));
            start = this.polygons[p1].centroid;
            end = this.polygons[p2].centroid;
        } else {
            const idx1 = Math.floor(Math.random() * this.allVertices.length);
            let idx2 = Math.floor(Math.random() * this.allVertices.length);
            while (idx2 === idx1) idx2 = Math.floor(Math.random() * this.allVertices.length);
            start = this.allVertices[idx1];
            end = this.allVertices[idx2];
        }

        if (!start || !end || start.distanceTo(end) > 400) return;

        const path = this.generateLightningPath(start, end);

        // Update Line2 geometry
        const positions = [];
        path.forEach(p => positions.push(p.x, p.y, p.z || 0));
        bolt.geometry.setPositions(positions);

        bolt.userData.active = true;
        bolt.userData.timer = 0;
        bolt.visible = true;
        bolt.material.opacity = 1.0;

        const hue = Math.random();
        bolt.material.color.setHSL(hue, 0.5, 0.8);
    }

    setupPostProcessing() {
        this.composer = new EffectComposer(this.renderer);
        this.composer.addPass(new RenderPass(this.scene, this.camera));

        this.bloomPass = new UnrealBloomPass(
            new THREE.Vector2(window.innerWidth, window.innerHeight),
            this.params.bloomStrength,
            0.4,
            this.params.bloomThreshold
        );
        this.composer.addPass(this.bloomPass);

        this.finalPass = new ShaderPass(FinalPassShader);
        this.finalPass.uniforms.uChromatic.value = this.params.chromatic;
        this.finalPass.uniforms.uVignette.value = this.params.vignette;
        this.composer.addPass(this.finalPass);
    }

    setupSVGUpload() {
        const uploadBtn = document.getElementById('svg-upload-btn');
        const fileInput = document.getElementById('svg-file-input');

        if (uploadBtn && fileInput) {
            uploadBtn.addEventListener('click', () => fileInput.click());
            fileInput.addEventListener('change', (e) => this.handleSVGUpload(e));
        }
    }

    handleSVGUpload(event) {
        const file = event.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (e) => {
            const svgText = e.target.result;
            this.parseSVG(svgText);
        };
        reader.readAsText(file);
    }

    parseSVG(svgText) {
        const parser = new DOMParser();
        const svgDoc = parser.parseFromString(svgText, 'image/svg+xml');
        const svgElement = svgDoc.querySelector('svg');

        if (!svgElement) {
            console.error('No SVG element found');
            return;
        }

        // Get viewBox or width/height
        const viewBox = svgElement.getAttribute('viewBox');
        if (viewBox) {
            const parts = viewBox.split(/\s+/).map(Number);
            SVG_WIDTH = parts[2] || 1000;
            SVG_HEIGHT = parts[3] || 1000;
        } else {
            SVG_WIDTH = parseFloat(svgElement.getAttribute('width')) || 1000;
            SVG_HEIGHT = parseFloat(svgElement.getAttribute('height')) || 1000;
        }

        // Extract polygons
        const newPolygons = [];
        const polygons = svgDoc.querySelectorAll('polygon');
        const polylines = svgDoc.querySelectorAll('polyline');
        const paths = svgDoc.querySelectorAll('path');

        let id = 0;

        polygons.forEach(poly => {
            const points = poly.getAttribute('points');
            if (points) {
                const fill = poly.getAttribute('fill');
                const hasFill = fill && fill !== 'none' && fill !== 'transparent';
                newPolygons.push({ points, fill: hasFill, id: id++ });
            }
        });

        polylines.forEach(poly => {
            const points = poly.getAttribute('points');
            if (points) {
                newPolygons.push({ points, fill: false, id: id++ });
            }
        });

        // Parse paths (basic support for M, L, Z commands)
        paths.forEach(path => {
            const d = path.getAttribute('d');
            if (d) {
                const points = this.parsePathToPoints(d);
                if (points) {
                    const fill = path.getAttribute('fill');
                    const hasFill = fill && fill !== 'none' && fill !== 'transparent';
                    newPolygons.push({ points, fill: hasFill, id: id++ });
                }
            }
        });

        if (newPolygons.length > 0) {
            svgPolygons = newPolygons;
            this.rebuildScene();
            document.getElementById('svg-status').textContent = `Loaded: ${newPolygons.length} shapes`;
        } else {
            document.getElementById('svg-status').textContent = 'No shapes found in SVG';
        }
    }

    parsePathToPoints(d) {
        // Basic path parser for M, L, H, V, Z commands
        const points = [];
        let currentX = 0, currentY = 0;

        // Normalize path data
        const normalized = d.replace(/([MLHVCSQTAZ])/gi, ' $1 ')
                           .replace(/,/g, ' ')
                           .replace(/-/g, ' -')
                           .trim()
                           .split(/\s+/)
                           .filter(s => s.length > 0);

        let i = 0;
        let command = '';

        while (i < normalized.length) {
            const token = normalized[i];

            if (/[MLHVCSQTAZ]/i.test(token)) {
                command = token;
                i++;
                continue;
            }

            const num = parseFloat(token);
            if (isNaN(num)) {
                i++;
                continue;
            }

            switch (command.toUpperCase()) {
                case 'M':
                case 'L':
                    const x = command === command.toUpperCase() ? num : currentX + num;
                    i++;
                    if (i < normalized.length) {
                        const y = command === command.toUpperCase() ? parseFloat(normalized[i]) : currentY + parseFloat(normalized[i]);
                        points.push(x, y);
                        currentX = x;
                        currentY = y;
                        i++;
                    }
                    if (command.toUpperCase() === 'M') command = command === 'M' ? 'L' : 'l';
                    break;
                case 'H':
                    currentX = command === 'H' ? num : currentX + num;
                    points.push(currentX, currentY);
                    i++;
                    break;
                case 'V':
                    currentY = command === 'V' ? num : currentY + num;
                    points.push(currentX, currentY);
                    i++;
                    break;
                case 'Z':
                    i++;
                    break;
                default:
                    i++;
            }
        }

        if (points.length >= 6) {
            return points.join(' ');
        }
        return null;
    }

    getColorForShape(shapeIndex, time) {
        const mode = this.params.colorMode;
        const totalShapes = this.polygons.length;

        switch (mode) {
            case 'white':
                return new THREE.Color(0xffffff);
            case 'rainbow':
                return new THREE.Color().setHSL(
                    (shapeIndex / totalShapes + time * this.params.colorCycleSpeed) % 1,
                    this.params.colorCycleSaturation,
                    this.params.colorCycleLightness
                );
            case 'monochrome':
                const lightness = 0.3 + (shapeIndex / totalShapes) * 0.4;
                return new THREE.Color().setHSL(
                    this.params.monochromeHue / 360,
                    0.8,
                    lightness
                );
            case 'gradient':
                const t = shapeIndex / totalShapes;
                return this.params.gradientStart.clone().lerp(this.params.gradientEnd, t);
            case 'complementary':
                const baseHue = (time * this.params.colorCycleSpeed) % 1;
                const compHue = (baseHue + 0.5) % 1;
                return new THREE.Color().setHSL(
                    shapeIndex % 2 === 0 ? baseHue : compHue,
                    this.params.colorCycleSaturation,
                    this.params.colorCycleLightness
                );
            case 'analogous':
                const aBaseHue = (time * this.params.colorCycleSpeed) % 1;
                const offset = (shapeIndex % 3 - 1) * 0.08;
                return new THREE.Color().setHSL(
                    (aBaseHue + offset + 1) % 1,
                    this.params.colorCycleSaturation,
                    this.params.colorCycleLightness
                );
            case 'perShape':
            default:
                const poly = this.polygons[shapeIndex];
                if (poly) {
                    return hslToColor(poly.colorHue, poly.colorSat, poly.colorLight);
                }
                return new THREE.Color(0xffffff);
        }
    }

    isWhiteMode() {
        return this._whiteMode;
    }

    getFillModeIndex() {
        const modes = ['liquid', 'solid', 'gradient', 'shimmer', 'pulse', 'noise', 'particles'];
        return modes.indexOf(this.params.fillMode);
    }

    setupControls() {
        const bindings = {
            liquidEnabled: v => { this.params.liquidEnabled = v; this.liquidFills.forEach(f => f.visible = v); },
            liquidSpeed: v => this.params.liquidSpeed = v,
            liquidWaveAmp: v => { this.params.liquidWaveAmp = v; this.liquidFills.forEach(f => f.material.uniforms.uWaveAmp.value = v); },

            fillMode: v => { this.params.fillMode = v; },
            colorMode: v => { this.params.colorMode = v; },
            monochromeHue: v => this.params.monochromeHue = v,

            // Gradient fill params
            gradientAngle: v => this.params.gradientAngle = v,
            gradientSpread: v => this.params.gradientSpread = v,

            // Shimmer fill params
            shimmerSpeed: v => this.params.shimmerSpeed = v,
            shimmerScale: v => this.params.shimmerScale = v,
            shimmerIntensity: v => this.params.shimmerIntensity = v,

            // Pulse fill params
            pulseSpeed: v => this.params.pulseSpeed = v,
            pulseRingScale: v => this.params.pulseRingScale = v,
            pulseRingSpeed: v => this.params.pulseRingSpeed = v,

            // Noise fill params
            noiseScale: v => this.params.noiseScale = v,
            noiseSpeed: v => this.params.noiseSpeed = v,
            noiseContrast: v => this.params.noiseContrast = v,

            // Particle fill params
            particleFillDensity: v => this.params.particleFillDensity = v,
            particleFillSize: v => this.params.particleFillSize = v,
            particleFillSpeed: v => this.params.particleFillSpeed = v,

            particlesEnabled: v => { this.params.particlesEnabled = v; if (this.particles) this.particles.visible = v; },
            particleSpeed: v => this.params.particleSpeed = v,
            particleSize: v => { this.params.particleSize = v; if (this.particles) this.particles.material.size = v; },

            connectionsEnabled: v => { this.params.connectionsEnabled = v; this.connectionLines.forEach(c => c.visible = v); },
            connectionPulseSpeed: v => this.params.connectionPulseSpeed = v,
            connectionThickness: v => {
                this.params.connectionThickness = v;
                this.connectionLines.forEach(c => { if (c.material.linewidth !== undefined) c.material.linewidth = v; });
            },

            energyEnabled: v => { this.params.energyEnabled = v; this.energyPulses.forEach(p => p.visible = v); },
            energySpeed: v => this.params.energySpeed = v,

            glowEnabled: v => { this.params.glowEnabled = v; this.glowNodes.forEach(n => n.visible = v); },
            glowPulseSpeed: v => this.params.glowPulseSpeed = v,

            ripplesEnabled: v => { this.params.ripplesEnabled = v; this.ripples.forEach(r => r.visible = v); },
            rippleSpeed: v => this.params.rippleSpeed = v,

            lightningEnabled: v => this.params.lightningEnabled = v,
            lightningFrequency: v => this.params.lightningFrequency = v,
            lightningThickness: v => {
                this.params.lightningThickness = v;
                this.lightningBolts.forEach(b => { if (b.material.linewidth !== undefined) b.material.linewidth = v; });
            },
            lightningBranches: v => this.params.lightningBranches = Math.floor(v),
            lightningDuration: v => this.params.lightningDuration = v,

            edgeFlowEnabled: v => { this.params.edgeFlowEnabled = v; this.edgeFlowLines.forEach(l => l.visible = v); },
            edgeFlowSpeed: v => this.params.edgeFlowSpeed = v,
            edgeFlowThickness: v => {
                this.params.edgeFlowThickness = v;
                this.edgeFlowLines.forEach(l => { if (l.material.linewidth !== undefined) l.material.linewidth = v; });
            },

            innerGlowEnabled: v => { this.params.innerGlowEnabled = v; this.innerGlows.forEach(g => g.visible = v); },
            innerGlowIntensity: v => { this.params.innerGlowIntensity = v; this.innerGlows.forEach(g => g.material.uniforms.uIntensity.value = v); },

            nebulaEnabled: v => { this.params.nebulaEnabled = v; this.nebulaPlanes.forEach(p => p.visible = v); },
            nebulaIntensity: v => { this.params.nebulaIntensity = v; this.nebulaPlanes.forEach(p => p.material.uniforms.uIntensity.value = v); },
            nebulaSpeed: v => { this.params.nebulaSpeed = v; this.nebulaPlanes.forEach(p => p.material.uniforms.uSpeed.value = v); },

            heartbeatEnabled: v => this.params.heartbeatEnabled = v,
            heartbeatSpeed: v => this.params.heartbeatSpeed = v,
            heartbeatIntensity: v => this.params.heartbeatIntensity = v,

            plasmaEnabled: v => { this.params.plasmaEnabled = v; this.plasmaTendrils.forEach(t => t.visible = v); },
            plasmaIntensity: v => this.params.plasmaIntensity = v,
            plasmaSpeed: v => this.params.plasmaSpeed = v,
            plasmaThickness: v => {
                this.params.plasmaThickness = v;
                this.plasmaTendrils.forEach(t => { if (t.material.linewidth !== undefined) t.material.linewidth = v; });
            },
            plasmaOpacity: v => { this.params.plasmaOpacity = v; this.plasmaTendrils.forEach(t => t.material.opacity = v); },

            echoEnabled: v => { this.params.echoEnabled = v; this.echoLayers.forEach(e => e.visible = v); },
            echoLayers: v => this.params.echoLayers = Math.floor(v),
            echoSpacing: v => this.params.echoSpacing = v,
            echoOpacity: v => {
                this.params.echoOpacity = v;
                this.echoLayers.forEach(e => {
                    e.material.opacity = v / e.userData.layer;
                    e.userData.baseOpacity = v / e.userData.layer;
                });
            },
            echoThickness: v => {
                this.params.echoThickness = v;
                this.echoLayers.forEach(e => { if (e.material.linewidth !== undefined) e.material.linewidth = v; });
            },

            arcBridgesEnabled: v => { this.params.arcBridgesEnabled = v; this.arcBridges.forEach(a => a.visible = v); },
            arcBridgeThickness: v => {
                this.params.arcBridgeThickness = v;
                this.arcBridges.forEach(a => { if (a.material.linewidth !== undefined) a.material.linewidth = v; });
            },
            arcBridgeOpacity: v => { this.params.arcBridgeOpacity = v; this.arcBridges.forEach(a => { a.material.opacity = v; a.userData.baseOpacity = v; }); },
            arcBridgeHeight: v => this.params.arcBridgeHeight = v,

            outlineThickness: v => {
                this.params.outlineThickness = v;
                this.outlines.forEach(o => { if (o.material.linewidth !== undefined) o.material.linewidth = v; });
            },

            colorCycleEnabled: v => this.params.colorCycleEnabled = v,
            colorCycleSpeed: v => this.params.colorCycleSpeed = v,
            colorCycleSaturation: v => this.params.colorCycleSaturation = v,
            colorCycleLightness: v => this.params.colorCycleLightness = v,

            perShapeColors: v => this.params.perShapeColors = v,

            particleLinksEnabled: v => { this.params.particleLinksEnabled = v; if (this.particleLinksMesh) this.particleLinksMesh.visible = v; },
            particleLinkDistance: v => this.params.particleLinkDistance = v,
            particleLinkThickness: v => { this.params.particleLinkThickness = v; },
            particleLinkOpacity: v => { this.params.particleLinkOpacity = v; if (this.particleLinksMesh) this.particleLinksMesh.material.opacity = v; },

            bloomStrength: v => { this.params.bloomStrength = v; this.bloomPass.strength = v; },
            bloomThreshold: v => { this.params.bloomThreshold = v; this.bloomPass.threshold = v; },
            chromatic: v => { this.params.chromatic = v; this.finalPass.uniforms.uChromatic.value = v; },
            vignette: v => { this.params.vignette = v; this.finalPass.uniforms.uVignette.value = v; }
        };

        Object.keys(bindings).forEach(id => {
            const input = document.getElementById(id);
            if (!input) return;
            const valDisplay = document.getElementById(id + 'Val');
            const update = () => {
                let value;
                if (input.type === 'checkbox') {
                    value = input.checked;
                } else if (input.type === 'color') {
                    value = input.value;
                } else if (input.tagName === 'SELECT') {
                    value = input.value;
                } else {
                    value = parseFloat(input.value);
                }
                bindings[id](value);
                if (valDisplay && typeof value === 'number') valDisplay.textContent = value.toFixed(3).replace(/\.?0+$/, '');
            };
            input.addEventListener('input', update);
            input.addEventListener('change', update);
        });

        // Presets
        const presets = {
            default: { liquidEnabled: true, liquidSpeed: 0.4, particlesEnabled: true, particleSpeed: 80, particleLinksEnabled: true, lightningEnabled: true, lightningFrequency: 1.5, plasmaEnabled: true, echoEnabled: true, arcBridgesEnabled: true, colorCycleEnabled: true, perShapeColors: true, bloomStrength: 1.8, fillMode: 'liquid', colorMode: 'perShape' },
            electric: { liquidEnabled: false, particlesEnabled: true, particleSpeed: 200, particleLinksEnabled: true, particleLinkDistance: 80, lightningEnabled: true, lightningFrequency: 3, plasmaEnabled: true, echoEnabled: true, arcBridgesEnabled: true, colorCycleEnabled: true, colorCycleSpeed: 0.8, bloomStrength: 2.5, fillMode: 'pulse', colorMode: 'rainbow' },
            organic: { liquidEnabled: true, liquidSpeed: 0.2, particlesEnabled: true, particleSpeed: 40, particleLinksEnabled: false, lightningEnabled: false, plasmaEnabled: true, plasmaIntensity: 0.5, echoEnabled: true, arcBridgesEnabled: false, colorCycleEnabled: true, colorCycleSpeed: 0.15, heartbeatEnabled: true, heartbeatIntensity: 0.5, bloomStrength: 1.5, fillMode: 'liquid', colorMode: 'analogous' },
            neon: { liquidEnabled: true, particlesEnabled: true, particleLinksEnabled: true, lightningEnabled: true, lightningFrequency: 2, plasmaEnabled: true, echoEnabled: true, arcBridgesEnabled: true, colorCycleEnabled: true, colorCycleSpeed: 0.5, bloomStrength: 2.2, fillMode: 'shimmer', colorMode: 'rainbow' },
            minimal: { liquidEnabled: true, liquidSpeed: 0.15, particlesEnabled: true, particleSpeed: 30, particleLinksEnabled: false, lightningEnabled: false, plasmaEnabled: false, echoEnabled: false, arcBridgesEnabled: false, colorCycleEnabled: false, perShapeColors: true, bloomStrength: 1, fillMode: 'solid', colorMode: 'monochrome' },
            chaos: { liquidEnabled: true, liquidSpeed: 0.8, particlesEnabled: true, particleSpeed: 250, particleLinksEnabled: true, particleLinkDistance: 100, lightningEnabled: true, lightningFrequency: 4, plasmaEnabled: true, plasmaIntensity: 1, echoEnabled: true, arcBridgesEnabled: true, colorCycleEnabled: true, colorCycleSpeed: 1, bloomStrength: 3, fillMode: 'noise', colorMode: 'rainbow' }
        };

        document.querySelectorAll('.preset').forEach(btn => {
            btn.addEventListener('click', () => {
                const preset = presets[btn.dataset.preset];
                if (!preset) return;
                Object.keys(preset).forEach(key => {
                    const input = document.getElementById(key);
                    if (!input) return;
                    if (input.type === 'checkbox') input.checked = preset[key];
                    else input.value = preset[key];
                    input.dispatchEvent(new Event('input'));
                });
            });
        });

        document.getElementById('toggle-controls').addEventListener('click', () => {
            document.getElementById('controls').classList.toggle('hidden');
        });
    }

    onResize() {
        const w = window.innerWidth;
        const h = window.innerHeight;
        this.camera.left = -w / 2;
        this.camera.right = w / 2;
        this.camera.top = h / 2;
        this.camera.bottom = -h / 2;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(w, h);
        this.composer.setSize(w, h);

        // Update Line2 materials resolution
        const resolution = new THREE.Vector2(w, h);
        [...this.outlines, ...this.lightningBolts, ...this.echoLayers,
         ...this.connectionLines, ...this.arcBridges, ...this.edgeFlowLines, ...this.plasmaTendrils].forEach(line => {
            if (line.material && line.material.resolution) {
                line.material.resolution.copy(resolution);
            }
        });
    }

    animate() {
        requestAnimationFrame(() => this.animate());

        // Use performance.now() for smoother, more reliable timing
        const now = performance.now();
        if (this._lastTime === 0) this._lastTime = now;
        const delta = Math.min((now - this._lastTime) / 1000, 0.1); // Cap at 100ms
        this._lastTime = now;
        this._animationTime += delta;
        const time = this._animationTime;
        this.frameCount++;

        // Cache white mode check once per frame
        this._whiteMode = this.params.colorMode === 'white';

        // Accumulate color time smoothly (never resets, just keeps growing)
        if (this.params.colorCycleEnabled) {
            this.accumulatedColorTime += delta * this.params.colorCycleSpeed;
        }
        // Use fract for smooth continuous cycling - this never "jumps"
        this.colorCycleOffset = this.accumulatedColorTime % 1.0;

        // Heartbeat - use smooth sine-based pulse instead of sharp exponential
        if (this.params.heartbeatEnabled) {
            const heartTime = time * this.params.heartbeatSpeed * Math.PI * 2;
            // Smooth double-beat pattern
            const beat = Math.pow(Math.sin(heartTime) * 0.5 + 0.5, 3) * 0.7 +
                        Math.pow(Math.sin(heartTime * 2 + 0.5) * 0.5 + 0.5, 4) * 0.3;
            this.heartbeatPhase = beat * this.params.heartbeatIntensity;
        } else {
            this.heartbeatPhase = 0;
        }

        // Nebula
        if (this.params.nebulaEnabled) {
            this.nebulaPlanes.forEach(p => p.material.uniforms.uTime.value = time);
        }

        // Echo layers
        if (this.params.echoEnabled) {
            const whiteMode = this._whiteMode;
            const colorMode = this.params.colorMode;
            for (let i = 0; i < this.echoLayers.length; i++) {
                const echo = this.echoLayers[i];
                const pulse = Math.sin(time * 2 + echo.userData.layer * 0.5) * 0.3 + 0.7;
                echo.material.opacity = echo.userData.baseOpacity * pulse;

                if (whiteMode) {
                    echo.material.color.setHex(0xffffff);
                } else if (colorMode === 'rainbow') {
                    const hue = (this.colorCycleOffset + echo.userData.layer * 0.1) % 1;
                    echo.material.color.setHSL(hue, 0.8, 0.5);
                } else if (colorMode === 'monochrome') {
                    echo.material.color.setHSL(this.params.monochromeHue / 360, 0.7, 0.4 + echo.userData.layer * 0.05);
                } else {
                    // perShape or other - restore original color
                    echo.material.color.setHSL(echo.userData.baseHue, 0.7, 0.5);
                }
            }
        }

        // Inner glows with color cycling
        if (this.params.innerGlowEnabled) {
            const whiteMode = this._whiteMode;
            const colorMode = this.params.colorMode;
            for (let i = 0; i < this.innerGlows.length; i++) {
                const glow = this.innerGlows[i];
                glow.material.uniforms.uTime.value = time;

                if (whiteMode) {
                    glow.material.uniforms.uColor.value.setHex(0xffffff);
                    glow.material.uniforms.uColorOffset.value = 0;
                } else if (colorMode === 'rainbow') {
                    glow.material.uniforms.uColorOffset.value = this.colorCycleOffset;
                } else if (colorMode === 'monochrome') {
                    glow.material.uniforms.uColor.value.setHSL(this.params.monochromeHue / 360, 0.8, 0.5);
                    glow.material.uniforms.uColorOffset.value = 0;
                } else {
                    // perShape - restore original
                    const poly = this.polygons[glow.userData.polyId];
                    if (poly) glow.material.uniforms.uColor.value.setHSL(poly.colorHue / 360, poly.colorSat, poly.colorLight);
                    glow.material.uniforms.uColorOffset.value = 0;
                }
            }
        }

        // Liquid fills with fill mode support
        if (this.params.liquidEnabled) {
            const fillModeIndex = this.getFillModeIndex();
            const whiteMode = this._whiteMode;
            const colorMode = this.params.colorMode;
            for (let i = 0; i < this.liquidFills.length; i++) {
                const fill = this.liquidFills[i];
                const uniforms = fill.material.uniforms;
                uniforms.uTime.value = time;
                uniforms.uFillMode.value = fillModeIndex;
                const phase = fill.userData.fillPhase;
                uniforms.uFillLevel.value = (Math.sin(time * this.params.liquidSpeed + phase) + 1) / 2;
                uniforms.uPulse.value = Math.sin(time * 3 + phase) * 0.5 + 0.5;
                uniforms.uHeartbeat.value = this.heartbeatPhase;

                // Update fill mode specific parameters
                uniforms.uGradientAngle.value = this.params.gradientAngle;
                uniforms.uGradientSpread.value = this.params.gradientSpread;
                uniforms.uShimmerSpeed.value = this.params.shimmerSpeed;
                uniforms.uShimmerScale.value = this.params.shimmerScale;
                uniforms.uShimmerIntensity.value = this.params.shimmerIntensity;
                uniforms.uPulseSpeed.value = this.params.pulseSpeed;
                uniforms.uPulseRingScale.value = this.params.pulseRingScale;
                uniforms.uPulseRingSpeed.value = this.params.pulseRingSpeed;
                uniforms.uNoiseScale.value = this.params.noiseScale;
                uniforms.uNoiseSpeed.value = this.params.noiseSpeed;
                uniforms.uNoiseContrast.value = this.params.noiseContrast;
                uniforms.uParticleDensity.value = this.params.particleFillDensity;
                uniforms.uParticleSize.value = this.params.particleFillSize;
                uniforms.uParticleSpeed.value = this.params.particleFillSpeed;

                if (whiteMode) {
                    uniforms.uColor1.value.setHex(0xffffff);
                    uniforms.uColor2.value.setHex(0xcccccc);
                    uniforms.uHue.value = -1;
                } else if (colorMode === 'rainbow') {
                    uniforms.uHue.value = (this.colorCycleOffset + fill.userData.baseHue) % 1;
                } else if (colorMode === 'monochrome') {
                    uniforms.uHue.value = this.params.monochromeHue / 360;
                } else {
                    // perShape - use base hue
                    uniforms.uHue.value = fill.userData.baseHue;
                }
            }
        }

        // Ripples
        if (this.params.ripplesEnabled) {
            const whiteMode = this._whiteMode;
            const colorMode = this.params.colorMode;
            for (let i = 0; i < this.ripples.length; i++) {
                const ripple = this.ripples[i];
                const t = ((time * this.params.rippleSpeed + ripple.userData.phase) % 3.0) / 3.0;
                ripple.scale.setScalar(t * ripple.userData.maxRadius / 3);
                ripple.material.opacity = (1 - t) * 0.5;

                if (whiteMode) {
                    ripple.material.color.setHex(0xffffff);
                } else if (colorMode === 'rainbow') {
                    ripple.material.color.setHSL((this.colorCycleOffset + t) % 1, 0.8, 0.55);
                } else if (colorMode === 'monochrome') {
                    ripple.material.color.setHSL(this.params.monochromeHue / 360, 0.8, 0.55);
                } else {
                    ripple.material.color.setHSL(0.05, 0.9, 0.55); // default reddish
                }
            }
        }

        // Arc bridges
        if (this.params.arcBridgesEnabled) {
            const whiteMode = this._whiteMode;
            const colorMode = this.params.colorMode;
            for (let i = 0; i < this.arcBridges.length; i++) {
                const arc = this.arcBridges[i];
                const phase = arc.userData.phase;
                arc.material.opacity = 0.2 + Math.sin(time * 2 + phase) * 0.2 + this.heartbeatPhase * 0.3;

                if (whiteMode) {
                    arc.material.color.setHex(0xffffff);
                } else if (colorMode === 'rainbow') {
                    arc.material.color.setHSL((this.colorCycleOffset + phase * 0.318) % 1, 0.8, 0.55);
                } else if (colorMode === 'monochrome') {
                    arc.material.color.setHSL(this.params.monochromeHue / 360, 0.8, 0.55);
                } else {
                    arc.material.color.setHSL(0.12, 0.9, 0.55); // default yellow
                }
            }
        }

        // Edge flow
        if (this.params.edgeFlowEnabled) {
            const whiteMode = this._whiteMode;
            const colorMode = this.params.colorMode;
            for (let i = 0; i < this.edgeFlowLines.length; i++) {
                const line = this.edgeFlowLines[i];
                const phase = line.userData.phase;
                line.material.opacity = 0.4 + Math.sin(time * this.params.edgeFlowSpeed + phase) * 0.3;

                if (whiteMode) {
                    line.material.color.setHex(0xffffff);
                } else if (colorMode === 'rainbow') {
                    line.material.color.setHSL((this.colorCycleOffset + phase * 0.05) % 1, 0.8, 0.55);
                } else if (colorMode === 'monochrome') {
                    line.material.color.setHSL(this.params.monochromeHue / 360, 0.8, 0.55);
                } else if (line.userData.baseHue !== undefined) {
                    line.material.color.setHSL(line.userData.baseHue, 0.8, 0.55);
                }
            }
        }

        // Outlines
        const whiteMode = this._whiteMode;
        const colorMode = this.params.colorMode;
        for (let idx = 0; idx < this.outlines.length; idx++) {
            const outline = this.outlines[idx];
            const pulse = Math.sin(time * 2 + idx * 0.3) * 0.15 + 0.85;
            outline.material.opacity = outline.userData.baseOpacity * pulse * (1 + this.heartbeatPhase * 0.3);

            if (whiteMode) {
                outline.material.color.setHex(0xffffff);
            } else if (colorMode === 'rainbow') {
                const hue = (this.colorCycleOffset + (outline.userData.baseHue || 0)) % 1;
                outline.material.color.setHSL(hue, 0.9, 0.55);
            } else if (colorMode === 'monochrome') {
                outline.material.color.setHSL(this.params.monochromeHue / 360, 0.9, 0.55);
            } else if (outline.userData.baseHue !== undefined) {
                outline.material.color.setHSL(outline.userData.baseHue, 0.9, 0.55);
            }
        }

        // Edge particles - optimized with pre-computed connections
        if (this.params.particlesEnabled && this.particles) {
            const positions = this.particles.geometry.attributes.position.array;
            const colors = this.particles.geometry.attributes.color.array;
            const edgeData = this.particles.userData.edgeData;
            const particleCount = edgeData.length / 4;
            const speedFactor = (this.params.particleSpeed / 1000) * delta;

            for (let i = 0; i < particleCount; i++) {
                const i4 = i * 4;
                let edgeIdx = edgeData[i4];
                let progress = edgeData[i4 + 1] + speedFactor * edgeData[i4 + 2];

                if (progress >= 1) {
                    // Use pre-computed connections instead of filtering every frame
                    const connected = this.edgeConnections.get(edgeIdx);
                    if (connected && connected.length > 0) {
                        edgeIdx = connected[Math.floor(Math.random() * connected.length)];
                    } else {
                        edgeIdx = Math.floor(Math.random() * this.allEdges.length);
                    }
                    progress = progress - 1; // Carry over excess for smoother movement
                }

                edgeData[i4] = edgeIdx;
                edgeData[i4 + 1] = progress;

                const edge = this.allEdges[edgeIdx];
                if (edge) {
                    const i3 = i * 3;
                    // Inline lerp for performance
                    positions[i3] = edge.start.x + (edge.end.x - edge.start.x) * progress;
                    positions[i3 + 1] = edge.start.y + (edge.end.y - edge.start.y) * progress;
                    positions[i3 + 2] = 2;
                }
            }

            this.particles.geometry.attributes.position.needsUpdate = true;

            // Update colors less frequently for performance
            if (this.frameCount % 3 === 0) {
                const pWhiteMode = this._whiteMode;
                const pColorMode = this.params.colorMode;

                if (pWhiteMode) {
                    for (let i = 0; i < particleCount; i++) {
                        const i3 = i * 3;
                        colors[i3] = 1;
                        colors[i3 + 1] = 1;
                        colors[i3 + 2] = 1;
                    }
                    this.particles.geometry.attributes.color.needsUpdate = true;
                } else if (pColorMode === 'rainbow') {
                    for (let i = 0; i < particleCount; i++) {
                        const hue = (this.colorCycleOffset + i * 0.0001) % 1;
                        const i3 = i * 3;
                        const h6 = hue * 6;
                        const x = 1 - Math.abs(h6 % 2 - 1);
                        let r, g, b;
                        if (h6 < 1) { r = 1; g = x; b = 0; }
                        else if (h6 < 2) { r = x; g = 1; b = 0; }
                        else if (h6 < 3) { r = 0; g = 1; b = x; }
                        else if (h6 < 4) { r = 0; g = x; b = 1; }
                        else if (h6 < 5) { r = x; g = 0; b = 1; }
                        else { r = 1; g = 0; b = x; }
                        colors[i3] = r * 0.7 + 0.3;
                        colors[i3 + 1] = g * 0.7 + 0.3;
                        colors[i3 + 2] = b * 0.7 + 0.3;
                    }
                    this.particles.geometry.attributes.color.needsUpdate = true;
                } else if (pColorMode === 'monochrome') {
                    const hue = this.params.monochromeHue / 360;
                    const h6 = hue * 6;
                    const x = 1 - Math.abs(h6 % 2 - 1);
                    let r, g, b;
                    if (h6 < 1) { r = 1; g = x; b = 0; }
                    else if (h6 < 2) { r = x; g = 1; b = 0; }
                    else if (h6 < 3) { r = 0; g = 1; b = x; }
                    else if (h6 < 4) { r = 0; g = x; b = 1; }
                    else if (h6 < 5) { r = x; g = 0; b = 1; }
                    else { r = 1; g = 0; b = x; }
                    for (let i = 0; i < particleCount; i++) {
                        const i3 = i * 3;
                        colors[i3] = r * 0.7 + 0.3;
                        colors[i3 + 1] = g * 0.7 + 0.3;
                        colors[i3 + 2] = b * 0.7 + 0.3;
                    }
                    this.particles.geometry.attributes.color.needsUpdate = true;
                }
                // perShape keeps original colors assigned at creation
            }
        }

        // Particle links - update less frequently for performance
        if (this.params.particleLinksEnabled && this.params.particlesEnabled && this.particleLinksMesh &&
            this.frameCount % this.particleLinkUpdateFrequency === 0) {
            const positions = this.particles.geometry.attributes.position.array;
            const linkPositions = this.particleLinksMesh.geometry.attributes.position.array;

            let linkCount = 0;
            const maxLinks = this.params.particleLinkMaxLinks;
            const distThreshold = this.params.particleLinkDistance;
            const distThresholdSq = distThreshold * distThreshold;

            const sampleSize = Math.min(150, positions.length / 3);
            const step = Math.floor(positions.length / 3 / sampleSize);

            for (let i = 0; i < sampleSize && linkCount < maxLinks; i++) {
                const idx1 = i * step;
                const x1 = positions[idx1 * 3];
                const y1 = positions[idx1 * 3 + 1];

                for (let j = i + 1; j < sampleSize && linkCount < maxLinks; j++) {
                    const idx2 = j * step;
                    const x2 = positions[idx2 * 3];
                    const y2 = positions[idx2 * 3 + 1];

                    const dx = x2 - x1;
                    const dy = y2 - y1;
                    const distSq = dx * dx + dy * dy;

                    if (distSq < distThresholdSq && distSq > 25) {
                        const i6 = linkCount * 6;
                        linkPositions[i6] = x1;
                        linkPositions[i6 + 1] = y1;
                        linkPositions[i6 + 2] = 2.5;
                        linkPositions[i6 + 3] = x2;
                        linkPositions[i6 + 4] = y2;
                        linkPositions[i6 + 5] = 2.5;
                        linkCount++;
                    }
                }
            }

            // Update draw range and mark for update
            this.particleLinksMesh.geometry.setDrawRange(0, linkCount * 2);
            this.particleLinksMesh.geometry.attributes.position.needsUpdate = true;

            // Update color and opacity
            const linkColorMode = this.params.colorMode;
            this.particleLinksMesh.material.opacity = this.params.particleLinkOpacity;

            if (this._whiteMode) {
                this.particleLinksMesh.material.color.setHex(0xffffff);
            } else if (linkColorMode === 'rainbow') {
                this.particleLinksMesh.material.color.setHSL(this.colorCycleOffset, 0.8, 0.55);
            } else if (linkColorMode === 'monochrome') {
                this.particleLinksMesh.material.color.setHSL(this.params.monochromeHue / 360, 0.8, 0.55);
            } else {
                this.particleLinksMesh.material.color.setHSL(0.05, 0.9, 0.55); // default reddish
            }
        }

        // Connections
        if (this.params.connectionsEnabled) {
            const connWhiteMode = this._whiteMode;
            const connColorMode = this.params.colorMode;
            for (let i = 0; i < this.connectionLines.length; i++) {
                const conn = this.connectionLines[i];
                const phase = conn.userData.phase;
                conn.material.opacity = 0.25 + Math.sin(time * this.params.connectionPulseSpeed + phase) * 0.25 + this.heartbeatPhase * 0.2;

                if (connWhiteMode) {
                    conn.material.color.setHex(0xffffff);
                } else if (connColorMode === 'rainbow') {
                    conn.material.color.setHSL((this.colorCycleOffset + phase * 0.318) % 1, 0.8, 0.55);
                } else if (connColorMode === 'monochrome') {
                    conn.material.color.setHSL(this.params.monochromeHue / 360, 0.8, 0.55);
                } else {
                    conn.material.color.setHSL(0.0, 0.9, 0.55); // default red
                }
            }
        }

        // Glow nodes
        if (this.params.glowEnabled) {
            const glowWhiteMode = this._whiteMode;
            const glowColorMode = this.params.colorMode;
            for (let i = 0; i < this.glowNodes.length; i++) {
                const node = this.glowNodes[i];
                const pulse = Math.sin(time * this.params.glowPulseSpeed + node.userData.phase) * 0.5 + 0.5;
                const heartScale = 1 + this.heartbeatPhase * 0.5;
                node.scale.setScalar(node.userData.baseScale * (0.7 + pulse * 0.5) * heartScale);
                node.material.opacity = 0.4 + pulse * 0.5 + this.heartbeatPhase * 0.3;

                if (glowWhiteMode) {
                    node.material.color.setHex(0xffffff);
                } else if (glowColorMode === 'rainbow') {
                    node.material.color.setHSL((this.colorCycleOffset + (node.userData.baseHue || 0)) % 1, 0.8, 0.55);
                } else if (glowColorMode === 'monochrome') {
                    node.material.color.setHSL(this.params.monochromeHue / 360, 0.8, 0.55);
                } else if (node.userData.baseHue !== undefined) {
                    node.material.color.setHSL(node.userData.baseHue, 0.8, 0.55);
                }
            }
        }

        // Energy pulses - optimized with pre-computed connections
        if (this.params.energyEnabled) {
            const energySpeedFactor = (this.params.energySpeed / 1000) * delta;
            const energyWhiteMode = this._whiteMode;
            const energyColorMode = this.params.colorMode;
            const scalePulse = 0.8 + Math.sin(time * 12) * 0.2;

            for (let i = 0; i < this.energyPulses.length; i++) {
                const pulse = this.energyPulses[i];
                let progress = pulse.userData.progress + energySpeedFactor * pulse.userData.speed;
                let edgeIdx = pulse.userData.edgeIndex;

                if (progress >= 1) {
                    const connected = this.edgeConnections.get(edgeIdx);
                    if (connected && connected.length > 0) {
                        edgeIdx = connected[Math.floor(Math.random() * connected.length)];
                    } else {
                        edgeIdx = Math.floor(Math.random() * this.allEdges.length);
                    }
                    pulse.userData.edgeIndex = edgeIdx;
                    progress = progress - 1;
                }
                pulse.userData.progress = progress;

                const edge = this.allEdges[edgeIdx];
                if (edge) {
                    pulse.position.x = edge.start.x + (edge.end.x - edge.start.x) * progress;
                    pulse.position.y = edge.start.y + (edge.end.y - edge.start.y) * progress;
                    pulse.position.z = 3;
                }
                pulse.scale.setScalar(pulse.userData.size * scalePulse);

                if (energyWhiteMode) {
                    pulse.material.color.setHex(0xffffff);
                } else if (energyColorMode === 'rainbow') {
                    pulse.material.color.setHSL((this.colorCycleOffset + i * 0.05) % 1, 0.9, 0.6);
                } else if (energyColorMode === 'monochrome') {
                    pulse.material.color.setHSL(this.params.monochromeHue / 360, 0.9, 0.6);
                } else {
                    pulse.material.color.setHSL(0.08, 0.9, 0.55); // default orange
                }
            }
        }

        // Lightning
        if (this.params.lightningEnabled) {
            if (Math.random() < this.params.lightningFrequency * delta) {
                this.triggerLightning();
            }
            this.lightningBolts.forEach(bolt => {
                if (bolt.userData.active) {
                    bolt.userData.timer += delta;
                    if (bolt.userData.timer >= bolt.userData.duration) {
                        bolt.userData.active = false;
                        bolt.visible = false;
                        bolt.material.opacity = 0;
                    } else {
                        bolt.material.opacity = 0.5 + Math.random() * 0.5;
                    }
                }
            });
        }

        // Plasma tendrils - optimized to update attributes directly instead of setPositions()
        if (this.params.plasmaEnabled) {
            const whiteMode = this._whiteMode;
            const plasmaColorMode = this.params.colorMode;
            const intensity = this.params.plasmaIntensity;
            const plasmaTime5 = time * 5;
            const plasmaTime3 = time * 3;

            for (let ti = 0; ti < this.plasmaTendrils.length; ti++) {
                const tendril = this.plasmaTendrils[ti];
                const phase = tendril.userData.phase;
                const start = tendril.userData.centroid;
                const end = tendril.userData.target;
                const segments = tendril.userData.segments || 16;

                // Pre-calculate perpendicular direction
                const perpX = -(end.y - start.y);
                const perpY = end.x - start.x;
                const len = Math.sqrt(perpX * perpX + perpY * perpY);
                const invLen = len > 0 ? 1 / len : 0;
                const normPerpX = perpX * invLen;
                const normPerpY = perpY * invLen;

                // Access the internal instanceStart attribute directly (Line2/LineGeometry)
                const posAttr = tendril.geometry.getAttribute('instanceStart');
                const endAttr = tendril.geometry.getAttribute('instanceEnd');

                if (posAttr && endAttr) {
                    for (let i = 0; i < segments - 1; i++) {
                        const t1 = i / (segments - 1);
                        const t2 = (i + 1) / (segments - 1);
                        const wobble1 = Math.sin(plasmaTime5 + phase + t1 * 10) * 10 * intensity * (1 - Math.abs(t1 - 0.5) * 2);
                        const wobble2 = Math.sin(plasmaTime5 + phase + t2 * 10) * 10 * intensity * (1 - Math.abs(t2 - 0.5) * 2);

                        // Start of segment
                        posAttr.setXYZ(i,
                            start.x + (end.x - start.x) * t1 + normPerpX * wobble1,
                            start.y + (end.y - start.y) * t1 + normPerpY * wobble1,
                            2
                        );
                        // End of segment
                        endAttr.setXYZ(i,
                            start.x + (end.x - start.x) * t2 + normPerpX * wobble2,
                            start.y + (end.y - start.y) * t2 + normPerpY * wobble2,
                            2
                        );
                    }
                    posAttr.needsUpdate = true;
                    endAttr.needsUpdate = true;
                }

                tendril.material.opacity = 0.3 + Math.sin(plasmaTime3 + phase) * 0.2 * intensity;

                // Proper color mode handling
                if (whiteMode) {
                    tendril.material.color.setHex(0xffffff);
                } else if (plasmaColorMode === 'rainbow') {
                    const hue = (this.colorCycleOffset + phase * 0.318) % 1;
                    tendril.material.color.setHSL(hue, 0.9, 0.6);
                } else if (plasmaColorMode === 'monochrome') {
                    tendril.material.color.setHSL(this.params.monochromeHue / 360, 0.9, 0.6);
                } else {
                    // perShape - restore original color
                    tendril.material.color.setHSL(tendril.userData.baseHue, 0.9, 0.6);
                }
            }
        }

        this.finalPass.uniforms.uTime.value = time;
        document.getElementById('fps').textContent = `FPS: ${Math.round(1 / delta)}`;
        this.composer.render();
    }
}

window.addEventListener('DOMContentLoaded', () => new LiquidFlowApp());
