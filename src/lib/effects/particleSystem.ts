import * as THREE from 'three';

export enum PARTICLE_MODES {
  SPHERES = 'SPHERES',
  TENDRILS = 'TENDRILS',
  VOXELS = 'VOXELS',
  POINTCLOUD = 'POINTCLOUD'
}

interface ParticleParams {
  count?: number;
  size?: number;
  speed?: number;
  audioReactivity?: number;
  mouseInfluence?: number;
  colorA?: THREE.Color;
  colorB?: THREE.Color;
  turbulence?: number;
  gravity?: number;
}

// Reserved for future use
interface _ParticleAttributes {
  position: THREE.BufferAttribute;
  velocity: THREE.BufferAttribute;
  color: THREE.BufferAttribute;
  size: THREE.BufferAttribute;
  lifetime: THREE.BufferAttribute;
  phase: THREE.BufferAttribute;
}

export class ParticleSystem {
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private renderTarget: THREE.WebGLRenderTarget;
  private particles: THREE.Points | null = null;
  private geometry: THREE.BufferGeometry | null = null;
  private material: THREE.ShaderMaterial | null = null;

  private mode: PARTICLE_MODES = PARTICLE_MODES.SPHERES;
  private params: Required<ParticleParams>;

  private particleCount: number = 5000;
  private positions: Float32Array;
  private velocities: Float32Array;
  private colors: Float32Array;
  private sizes: Float32Array;
  private lifetimes: Float32Array;
  private phases: Float32Array;

  private mousePos: THREE.Vector2 = new THREE.Vector2(0, 0);
  private mouse3D: THREE.Vector3 = new THREE.Vector3(0, 0, 5);
  private time: number = 0;

  // Tendril-specific
  private tendrilLines: THREE.Line[] = [];
  private tendrilCount: number = 20;
  private pointsPerTendril: number = 50;

  constructor() {
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x000000);
    this.camera = new THREE.PerspectiveCamera(75, 1, 0.1, 1000);
    this.camera.position.z = 15;

    this.renderTarget = new THREE.WebGLRenderTarget(1920, 1080, {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      format: THREE.RGBAFormat,
      type: THREE.FloatType
    });

    this.params = {
      count: 5000,
      size: 2.0,
      speed: 1.0,
      audioReactivity: 0.5,
      mouseInfluence: 1.0,
      colorA: new THREE.Color(0x00ffff),
      colorB: new THREE.Color(0xff00ff),
      turbulence: 0.5,
      gravity: 0.01
    };

    // Initialize arrays
    this.positions = new Float32Array(this.particleCount * 3);
    this.velocities = new Float32Array(this.particleCount * 3);
    this.colors = new Float32Array(this.particleCount * 3);
    this.sizes = new Float32Array(this.particleCount);
    this.lifetimes = new Float32Array(this.particleCount);
    this.phases = new Float32Array(this.particleCount);
  }

  init(renderer: THREE.WebGLRenderer): void {
    const size = new THREE.Vector2();
    renderer.getSize(size);
    this.camera.aspect = size.x / size.y;
    this.camera.updateProjectionMatrix();

    this.renderTarget.setSize(size.x, size.y);

    this.initParticles();
    this.setupMouseListeners();
  }

  private setupMouseListeners(): void {
    if (typeof window !== 'undefined') {
      window.addEventListener('mousemove', (e) => {
        this.mousePos.x = (e.clientX / window.innerWidth) * 2 - 1;
        this.mousePos.y = -(e.clientY / window.innerHeight) * 2 + 1;

        this.mouse3D.x = this.mousePos.x * 20;
        this.mouse3D.y = this.mousePos.y * 20;
      });
    }
  }

  private initParticles(): void {
    this.particleCount = this.params.count;

    // Reinitialize arrays with new count
    this.positions = new Float32Array(this.particleCount * 3);
    this.velocities = new Float32Array(this.particleCount * 3);
    this.colors = new Float32Array(this.particleCount * 3);
    this.sizes = new Float32Array(this.particleCount);
    this.lifetimes = new Float32Array(this.particleCount);
    this.phases = new Float32Array(this.particleCount);

    // Initialize particle data based on mode
    switch (this.mode) {
      case PARTICLE_MODES.SPHERES:
        this.initSpheres();
        break;
      case PARTICLE_MODES.TENDRILS:
        this.initTendrils();
        return; // Tendrils use a different rendering approach
      case PARTICLE_MODES.VOXELS:
        this.initVoxels();
        break;
      case PARTICLE_MODES.POINTCLOUD:
        this.initPointCloud();
        break;
    }

    this.createPointsGeometry();
  }

  private initSpheres(): void {
    for (let i = 0; i < this.particleCount; i++) {
      const i3 = i * 3;

      // Random position in sphere
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      const radius = Math.random() * 10 + 5;

      this.positions[i3] = radius * Math.sin(phi) * Math.cos(theta);
      this.positions[i3 + 1] = radius * Math.sin(phi) * Math.sin(theta);
      this.positions[i3 + 2] = radius * Math.cos(phi);

      // Random velocity
      this.velocities[i3] = (Math.random() - 0.5) * 0.1;
      this.velocities[i3 + 1] = (Math.random() - 0.5) * 0.1;
      this.velocities[i3 + 2] = (Math.random() - 0.5) * 0.1;

      // Color gradient
      const t = i / this.particleCount;
      const color = new THREE.Color().lerpColors(this.params.colorA, this.params.colorB, t);
      this.colors[i3] = color.r;
      this.colors[i3 + 1] = color.g;
      this.colors[i3 + 2] = color.b;

      this.sizes[i] = Math.random() * 3 + 1;
      this.lifetimes[i] = Math.random();
      this.phases[i] = Math.random() * Math.PI * 2;
    }
  }

  private initVoxels(): void {
    const gridSize = Math.cbrt(this.particleCount);
    const spacing = 30 / gridSize;
    const offset = -15;

    let index = 0;
    for (let x = 0; x < gridSize && index < this.particleCount; x++) {
      for (let y = 0; y < gridSize && index < this.particleCount; y++) {
        for (let z = 0; z < gridSize && index < this.particleCount; z++) {
          const i3 = index * 3;

          this.positions[i3] = x * spacing + offset;
          this.positions[i3 + 1] = y * spacing + offset;
          this.positions[i3 + 2] = z * spacing + offset;

          this.velocities[i3] = 0;
          this.velocities[i3 + 1] = 0;
          this.velocities[i3 + 2] = 0;

          const distFromCenter = Math.sqrt(
            Math.pow(this.positions[i3], 2) +
            Math.pow(this.positions[i3 + 1], 2) +
            Math.pow(this.positions[i3 + 2], 2)
          ) / 20;

          const color = new THREE.Color().lerpColors(
            this.params.colorA,
            this.params.colorB,
            distFromCenter
          );
          this.colors[i3] = color.r;
          this.colors[i3 + 1] = color.g;
          this.colors[i3 + 2] = color.b;

          this.sizes[index] = 2.0;
          this.lifetimes[index] = 0;
          this.phases[index] = (x + y + z) * 0.1;

          index++;
        }
      }
    }
  }

  private initPointCloud(): void {
    for (let i = 0; i < this.particleCount; i++) {
      const i3 = i * 3;

      // Random position in 3D space
      this.positions[i3] = (Math.random() - 0.5) * 40;
      this.positions[i3 + 1] = (Math.random() - 0.5) * 40;
      this.positions[i3 + 2] = (Math.random() - 0.5) * 40;

      // Slow drift
      this.velocities[i3] = (Math.random() - 0.5) * 0.05;
      this.velocities[i3 + 1] = (Math.random() - 0.5) * 0.05;
      this.velocities[i3 + 2] = (Math.random() - 0.5) * 0.05;

      const depth = (this.positions[i3 + 2] + 20) / 40;
      const color = new THREE.Color().lerpColors(this.params.colorA, this.params.colorB, depth);
      this.colors[i3] = color.r;
      this.colors[i3 + 1] = color.g;
      this.colors[i3 + 2] = color.b;

      this.sizes[i] = Math.random() * 2 + 0.5;
      this.lifetimes[i] = Math.random();
      this.phases[i] = Math.random() * Math.PI * 2;
    }
  }

  private initTendrils(): void {
    // Clear existing tendrils
    this.tendrilLines.forEach(line => this.scene.remove(line));
    this.tendrilLines = [];

    for (let t = 0; t < this.tendrilCount; t++) {
      const points: THREE.Vector3[] = [];
      const colors: number[] = [];

      // Starting position
      const startAngle = (t / this.tendrilCount) * Math.PI * 2;
      let x = Math.cos(startAngle) * 5;
      let y = Math.sin(startAngle) * 5;
      let z = 0;

      for (let p = 0; p < this.pointsPerTendril; p++) {
        points.push(new THREE.Vector3(x, y, z));

        const colorT = p / this.pointsPerTendril;
        const color = new THREE.Color().lerpColors(this.params.colorA, this.params.colorB, colorT);
        colors.push(color.r, color.g, color.b);

        // Add some movement
        x += (Math.random() - 0.5) * 0.5;
        y += (Math.random() - 0.5) * 0.5;
        z += 0.2;
      }

      const geometry = new THREE.BufferGeometry().setFromPoints(points);
      geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));

      const material = new THREE.LineBasicMaterial({
        vertexColors: true,
        transparent: true,
        opacity: 0.6,
        blending: THREE.AdditiveBlending
      });

      const line = new THREE.Line(geometry, material);
      this.scene.add(line);
      this.tendrilLines.push(line);
    }
  }

  private createPointsGeometry(): void {
    // Clean up existing
    if (this.particles) {
      this.scene.remove(this.particles);
    }
    if (this.geometry) {
      this.geometry.dispose();
    }
    if (this.material) {
      this.material.dispose();
    }

    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute('position', new THREE.Float32BufferAttribute(this.positions, 3));
    this.geometry.setAttribute('velocity', new THREE.Float32BufferAttribute(this.velocities, 3));
    this.geometry.setAttribute('color', new THREE.Float32BufferAttribute(this.colors, 3));
    this.geometry.setAttribute('size', new THREE.Float32BufferAttribute(this.sizes, 1));
    this.geometry.setAttribute('lifetime', new THREE.Float32BufferAttribute(this.lifetimes, 1));
    this.geometry.setAttribute('phase', new THREE.Float32BufferAttribute(this.phases, 1));

    this.material = new THREE.ShaderMaterial({
      uniforms: {
        time: { value: 0 },
        audioLevel: { value: 0 },
        mousePos: { value: new THREE.Vector3() },
        mouseInfluence: { value: this.params.mouseInfluence },
        sizeScale: { value: this.params.size },
        pixelRatio: { value: typeof window !== 'undefined' ? window.devicePixelRatio : 1 }
      },
      vertexShader: this.getVertexShader(),
      fragmentShader: this.getFragmentShader(),
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });

    this.particles = new THREE.Points(this.geometry, this.material);
    this.scene.add(this.particles);
  }

  private getVertexShader(): string {
    return `
      uniform float time;
      uniform float audioLevel;
      uniform vec3 mousePos;
      uniform float mouseInfluence;
      uniform float sizeScale;
      uniform float pixelRatio;

      attribute vec3 velocity;
      attribute vec3 color;
      attribute float size;
      attribute float lifetime;
      attribute float phase;

      varying vec3 vColor;
      varying float vLifetime;

      void main() {
        vColor = color;
        vLifetime = lifetime;

        vec3 pos = position;

        // Audio reactivity
        float audioEffect = audioLevel * 2.0;
        pos += normalize(pos) * audioEffect * sin(time + phase);

        // Mouse interaction
        vec3 toMouse = mousePos - pos;
        float dist = length(toMouse);
        if (dist < 10.0) {
          float force = (10.0 - dist) / 10.0;
          pos -= normalize(toMouse) * force * mouseInfluence * 2.0;
        }

        vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
        gl_Position = projectionMatrix * mvPosition;

        // Size based on distance, sizeScale param, and audio
        float distanceScale = 300.0 / length(mvPosition.xyz);
        gl_PointSize = size * sizeScale * distanceScale * (1.0 + audioLevel * 0.5) * pixelRatio;
      }
    `;
  }

  private getFragmentShader(): string {
    return `
      varying vec3 vColor;
      varying float vLifetime;

      void main() {
        // Circular particle shape
        vec2 center = gl_PointCoord - vec2(0.5);
        float dist = length(center);

        if (dist > 0.5) {
          discard;
        }

        // Soft edges
        float alpha = 1.0 - smoothstep(0.3, 0.5, dist);
        alpha *= 0.8;

        // Pulsing based on lifetime
        alpha *= 0.5 + 0.5 * sin(vLifetime * 3.14159);

        gl_FragColor = vec4(vColor, alpha);
      }
    `;
  }

  update(dt: number, audioLevel: number = 0): void {
    this.time += dt;

    if (this.mode === PARTICLE_MODES.TENDRILS) {
      this.updateTendrils(dt, audioLevel);
      return;
    }

    if (!this.geometry || !this.material) return;

    const positions = this.geometry.attributes.position.array as Float32Array;
    const velocities = this.geometry.attributes.velocity.array as Float32Array;
    const lifetimes = this.geometry.attributes.lifetime.array as Float32Array;

    switch (this.mode) {
      case PARTICLE_MODES.SPHERES:
        this.updateSpheres(positions, velocities, lifetimes, dt, audioLevel);
        break;
      case PARTICLE_MODES.VOXELS:
        this.updateVoxels(positions, velocities, lifetimes, dt, audioLevel);
        break;
      case PARTICLE_MODES.POINTCLOUD:
        this.updatePointCloud(positions, velocities, lifetimes, dt, audioLevel);
        break;
    }

    this.geometry.attributes.position.needsUpdate = true;
    this.geometry.attributes.velocity.needsUpdate = true;
    this.geometry.attributes.lifetime.needsUpdate = true;

    // Update shader uniforms
    this.material.uniforms.time.value = this.time;
    this.material.uniforms.audioLevel.value = audioLevel;
    this.material.uniforms.mousePos.value.copy(this.mouse3D);
  }

  private updateSpheres(
    positions: Float32Array,
    velocities: Float32Array,
    lifetimes: Float32Array,
    dt: number,
    _audioLevel: number
  ): void {
    const speed = this.params.speed;
    const turbulence = this.params.turbulence;
    const gravity = this.params.gravity;

    for (let i = 0; i < this.particleCount; i++) {
      const i3 = i * 3;

      // Apply velocity
      positions[i3] += velocities[i3] * speed;
      positions[i3 + 1] += velocities[i3 + 1] * speed;
      positions[i3 + 2] += velocities[i3 + 2] * speed;

      // Apply gravity
      velocities[i3 + 1] -= gravity;

      // Turbulence
      velocities[i3] += (Math.random() - 0.5) * turbulence * 0.01;
      velocities[i3 + 1] += (Math.random() - 0.5) * turbulence * 0.01;
      velocities[i3 + 2] += (Math.random() - 0.5) * turbulence * 0.01;

      // Mouse repulsion
      const dx = this.mouse3D.x - positions[i3];
      const dy = this.mouse3D.y - positions[i3 + 1];
      const dz = this.mouse3D.z - positions[i3 + 2];
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);

      if (dist < 5) {
        const force = (5 - dist) / 5 * this.params.mouseInfluence * 0.1;
        velocities[i3] -= (dx / dist) * force;
        velocities[i3 + 1] -= (dy / dist) * force;
        velocities[i3 + 2] -= (dz / dist) * force;
      }

      // Damping
      velocities[i3] *= 0.99;
      velocities[i3 + 1] *= 0.99;
      velocities[i3 + 2] *= 0.99;

      // Boundary check - respawn if too far
      const distFromCenter = Math.sqrt(
        positions[i3] * positions[i3] +
        positions[i3 + 1] * positions[i3 + 1] +
        positions[i3 + 2] * positions[i3 + 2]
      );

      if (distFromCenter > 30) {
        const theta = Math.random() * Math.PI * 2;
        const phi = Math.acos(2 * Math.random() - 1);
        const radius = 5;

        positions[i3] = radius * Math.sin(phi) * Math.cos(theta);
        positions[i3 + 1] = radius * Math.sin(phi) * Math.sin(theta);
        positions[i3 + 2] = radius * Math.cos(phi);

        velocities[i3] = (Math.random() - 0.5) * 0.1;
        velocities[i3 + 1] = (Math.random() - 0.5) * 0.1;
        velocities[i3 + 2] = (Math.random() - 0.5) * 0.1;
      }

      // Update lifetime
      lifetimes[i] += dt * 0.5;
      if (lifetimes[i] > 1) lifetimes[i] = 0;
    }
  }

  private updateVoxels(
    _positions: Float32Array,
    _velocities: Float32Array,
    lifetimes: Float32Array,
    _dt: number,
    audioLevel: number
  ): void {
    // Voxels react to audio - the position animation is done in shader
    // but we can update colors based on audio
    for (let i = 0; i < this.particleCount; i++) {
      lifetimes[i] = audioLevel * (1 + Math.sin(this.time + this.phases[i]));
    }
  }

  private updatePointCloud(
    positions: Float32Array,
    velocities: Float32Array,
    lifetimes: Float32Array,
    dt: number,
    audioLevel: number
  ): void {
    for (let i = 0; i < this.particleCount; i++) {
      const i3 = i * 3;

      // Slow drift
      positions[i3] += velocities[i3] * this.params.speed * 0.5;
      positions[i3 + 1] += velocities[i3 + 1] * this.params.speed * 0.5;
      positions[i3 + 2] += velocities[i3 + 2] * this.params.speed * 0.5;

      // Orbital motion
      const radius = Math.sqrt(positions[i3] * positions[i3] + positions[i3 + 2] * positions[i3 + 2]);
      const angle = Math.atan2(positions[i3 + 2], positions[i3]);
      const newAngle = angle + dt * 0.1 * (1 + audioLevel);

      positions[i3] = Math.cos(newAngle) * radius;
      positions[i3 + 2] = Math.sin(newAngle) * radius;

      // Wrap around bounds
      if (Math.abs(positions[i3]) > 20) positions[i3] *= -0.9;
      if (Math.abs(positions[i3 + 1]) > 20) positions[i3 + 1] *= -0.9;
      if (Math.abs(positions[i3 + 2]) > 20) positions[i3 + 2] *= -0.9;

      lifetimes[i] += dt;
      if (lifetimes[i] > 1) lifetimes[i] = 0;
    }
  }

  private updateTendrils(_dt: number, audioLevel: number): void {
    this.tendrilLines.forEach((line, tendrilIndex) => {
      const geometry = line.geometry;
      const positions = geometry.attributes.position.array as Float32Array;

      // Update tendril points with flowing motion
      for (let p = 1; p < this.pointsPerTendril; p++) {
        const i = p * 3;
        const prevI = (p - 1) * 3;

        // Follow previous point with some lag
        positions[i] += (positions[prevI] - positions[i]) * 0.1;
        positions[i + 1] += (positions[prevI + 1] - positions[i + 1]) * 0.1;
        positions[i + 2] += (positions[prevI + 2] - positions[i + 2]) * 0.1;

        // Add noise
        positions[i] += Math.sin(this.time + p * 0.1 + tendrilIndex) * 0.05 * this.params.turbulence;
        positions[i + 1] += Math.cos(this.time + p * 0.1 + tendrilIndex) * 0.05 * this.params.turbulence;

        // Audio reactivity
        const audioEffect = audioLevel * 0.5;
        positions[i] += Math.sin(this.time * 2 + p * 0.2) * audioEffect;
        positions[i + 1] += Math.cos(this.time * 2 + p * 0.2) * audioEffect;
      }

      // Move the head of the tendril
      const headIndex = 0;
      const angle = (tendrilIndex / this.tendrilCount) * Math.PI * 2 + this.time * 0.5;
      const radius = 5 + Math.sin(this.time + tendrilIndex) * 2;

      positions[headIndex] = Math.cos(angle) * radius;
      positions[headIndex + 1] = Math.sin(angle) * radius;
      positions[headIndex + 2] = Math.sin(this.time * 0.5 + tendrilIndex) * 3;

      geometry.attributes.position.needsUpdate = true;
    });
  }

  render(renderer: THREE.WebGLRenderer, target?: THREE.WebGLRenderTarget): void {
    if (target) {
      renderer.setRenderTarget(target);
      renderer.render(this.scene, this.camera);
      renderer.setRenderTarget(null);
    } else {
      renderer.setRenderTarget(this.renderTarget);
      renderer.render(this.scene, this.camera);
      renderer.setRenderTarget(null);
    }
  }

  setMode(mode: PARTICLE_MODES): void {
    if (this.mode === mode) return;

    this.mode = mode;
    this.initParticles();
  }

  setParams(params: Partial<ParticleParams>): void {
    Object.assign(this.params, params);

    // Update particle count if changed
    if (params.count && params.count !== this.particleCount) {
      this.initParticles();
    }

    // Update colors if changed
    if (params.colorA || params.colorB) {
      this.updateColors();
    }

    // Update material uniforms
    if (this.material) {
      if (params.mouseInfluence !== undefined) {
        this.material.uniforms.mouseInfluence.value = params.mouseInfluence;
      }
      if (params.size !== undefined) {
        this.material.uniforms.sizeScale.value = params.size;
      }
    }
  }

  private updateColors(): void {
    if (!this.geometry) return;

    const colors = this.geometry.attributes.color.array as Float32Array;

    for (let i = 0; i < this.particleCount; i++) {
      const i3 = i * 3;
      let t = i / this.particleCount;

      if (this.mode === PARTICLE_MODES.VOXELS) {
        const distFromCenter = Math.sqrt(
          this.positions[i3] * this.positions[i3] +
          this.positions[i3 + 1] * this.positions[i3 + 1] +
          this.positions[i3 + 2] * this.positions[i3 + 2]
        ) / 20;
        t = distFromCenter;
      } else if (this.mode === PARTICLE_MODES.POINTCLOUD) {
        t = (this.positions[i3 + 2] + 20) / 40;
      }

      const color = new THREE.Color().lerpColors(this.params.colorA, this.params.colorB, t);
      colors[i3] = color.r;
      colors[i3 + 1] = color.g;
      colors[i3 + 2] = color.b;
    }

    this.geometry.attributes.color.needsUpdate = true;
  }

  getRenderTarget(): THREE.WebGLRenderTarget {
    return this.renderTarget;
  }

  getTexture(): THREE.Texture {
    return this.renderTarget.texture;
  }

  resize(width: number, height: number): void {
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderTarget.setSize(width, height);
  }

  dispose(): void {
    // Clean up geometry
    if (this.geometry) {
      this.geometry.dispose();
    }

    // Clean up material
    if (this.material) {
      this.material.dispose();
    }

    // Clean up tendrils
    this.tendrilLines.forEach(line => {
      line.geometry.dispose();
      (line.material as THREE.Material).dispose();
      this.scene.remove(line);
    });
    this.tendrilLines = [];

    // Clean up render target
    this.renderTarget.dispose();

    // Remove particles from scene
    if (this.particles) {
      this.scene.remove(this.particles);
    }
  }
}
