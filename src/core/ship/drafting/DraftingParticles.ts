import * as THREE from 'three';

type Draftable = { root: THREE.Group; state: { speedKmh: number } };

type DraftingOptions = {
    scaleMultiplier?: number;
    opacity?: number;
    toneMapped?: boolean;
    depthTest?: boolean;
};

type Particle = {
    s: number; // 0..1 along path
    speed: number; // progression per second
    lateral: number; // sideways offset along path
    scale: number;
    hue: number;
};

export class DraftingParticles {
    public root = new THREE.Group();
    private ship: Draftable;
    private imesh: THREE.InstancedMesh;
    private tmpObj = new THREE.Object3D();
    private colors: THREE.Color[] = [];
    private particles: Particle[] = [];
    private maxParticles = 140;
    private spawnAccumulator = 0;
    private scaleMultiplier = 1.0;

    constructor(ship: Draftable, opts?: DraftingOptions) {
        this.ship = ship;
        if (opts?.scaleMultiplier !== undefined) this.scaleMultiplier = opts.scaleMultiplier;

        // Small glowing spheres as retro particle dots
        const geo = new THREE.SphereGeometry(0.035, 6, 6);
        const mat = new THREE.MeshBasicMaterial({
            color: 0x53d7ff,
            transparent: true,
            opacity: opts?.opacity ?? 1,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            depthTest: opts?.depthTest ?? false,
            toneMapped: opts?.toneMapped ?? false
        });
        this.imesh = new THREE.InstancedMesh(geo, mat, this.maxParticles);
        this.imesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(this.maxParticles * 3), 3);
        this.imesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
        this.imesh.frustumCulled = false;
        this.root.add(this.imesh);

        for (let i = 0; i < this.maxParticles; i++) this.colors[i] = new THREE.Color();
        this.root.visible = false;
    }

    private spawn(count: number) {
        for (let i = 0; i < count; i++) {
            if (this.particles.length >= this.maxParticles) break;
            const p: Particle = {
                s: Math.random() * 0.15, // start near the nose
                speed: 0.8 + Math.random() * 0.8, // path speed
                lateral: (Math.random() - 0.5) * 0.6, // +/- sideways
                scale: 0.7 + Math.random() * 0.6,
                hue: 0.52 + Math.random() * 0.06
            };
            this.particles.push(p);
        }
    }

    setVisible(v: boolean) {
        this.root.visible = v;
        this.imesh.visible = v;
    }

    update(dt: number) {
        if (!this.root.visible) {
            // Still tick down instanced count
            this.imesh.count = 0;
            this.imesh.instanceMatrix.needsUpdate = true;
            this.imesh.instanceColor!.needsUpdate = true;
            return;
        }

        // Spawn rate scales with speed
        const mps = this.ship.state.speedKmh / 3.6;
        const rate = THREE.MathUtils.clamp(mps * 3.0, 20, 120); // dots/sec
        this.spawnAccumulator += rate * dt;
        const toSpawn = Math.floor(this.spawnAccumulator);
        if (toSpawn > 0) {
            this.spawnAccumulator -= toSpawn;
            this.spawn(toSpawn);
        }

        const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(this.ship.root.quaternion);
        const right = new THREE.Vector3(1, 0, 0).applyQuaternion(this.ship.root.quaternion);
        const up = new THREE.Vector3(0, 1, 0).applyQuaternion(this.ship.root.quaternion);
        const origin = this.ship.root.position;

        // Path: arc over the ship then peel back toward the tail (camera-facing)
        // worldPos = origin + forward*(z) + up*(h(s)) + right*(lateral*falloff)
        // Move in the negative-forward direction so it renders behind the nose in chase view
        const lengthMeters = 3.2;
        const heightMeters = 0.6;
        const startForwardOffset = 0.2; // small forward offset from nose

        for (let i = this.particles.length - 1; i >= 0; i--) {
            const p = this.particles[i];
            p.s += p.speed * dt * 0.45; // advance along path
            if (p.s >= 1) {
                this.particles.splice(i, 1);
                continue;
            }

            const s = p.s;
            const z = -s * lengthMeters + startForwardOffset;
            // Smooth arc: rise then settle
            const rise = Math.sin(Math.PI * Math.min(1, s)) * heightMeters;
            // Lateral falloff so lines converge near end
            const latFalloff = 1.0 - s * 0.8;
            const pos = new THREE.Vector3()
                .copy(origin)
                .addScaledVector(forward, z)
                .addScaledVector(up, rise)
                .addScaledVector(right, p.lateral * latFalloff);

            // Size and fade across life
            const alpha = 1.0 - s;
            const scale = p.scale * (0.6 + 0.6 * (1.0 - s)) * this.scaleMultiplier;

            this.tmpObj.position.copy(pos);
            this.tmpObj.scale.setScalar(scale);
            this.tmpObj.updateMatrix();
            this.imesh.setMatrixAt(i, this.tmpObj.matrix);

            const c = this.colors[i];
            c.setHSL(p.hue, 1.0, 0.55);
            c.multiplyScalar(alpha);
            this.imesh.setColorAt(i, c);
        }

        this.imesh.count = this.particles.length;
        this.imesh.instanceMatrix.needsUpdate = true;
        this.imesh.instanceColor!.needsUpdate = true;
    }
}


