import * as THREE from 'three';

export class ShipJetEngine {
    public root = new THREE.Group();

    // Idle (warm cap) state
    private idleMaterial!: THREE.ShaderMaterial;
    private idleMesh!: THREE.Mesh;
    private idleOpacity: number = 0.35;

    // Moving (blue cone) state
    private coneMaterial!: THREE.MeshBasicMaterial;
    private coneMesh!: THREE.Mesh;
    private coneOpacity: number = 0.95;

    // Inner boost core (tight hot-blue cone)
    private coreMaterial!: THREE.MeshBasicMaterial;
    private coreMesh!: THREE.Mesh;
    private coreOpacity: number = 0.0;

    // (Removed warm outer cone)

    // Animation state
    private timeSec: number = 0;
    private tmpColor = new THREE.Color();

    constructor(position: THREE.Vector3 = new THREE.Vector3(0, 0, -0.9)) {
        // Warm idle cap material using radial alpha falloff for soft edge
        this.idleMaterial = new THREE.ShaderMaterial({
            uniforms: {
                uColor: { value: new THREE.Color(1.0, 0.6, 0.2) },
                uOpacity: { value: this.idleOpacity },
                uSoftness: { value: 0.45 }
            },
            vertexShader: `
                varying vec2 vUv;
                void main() {
                    vUv = uv;
                    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                }
            `,
            fragmentShader: `
                varying vec2 vUv;
                uniform vec3 uColor;
                uniform float uOpacity;
                uniform float uSoftness; // 0..1, edge feather
                void main() {
                    vec2 c = vUv - 0.5;
                    float r = length(c) * 2.0; // 0 at center, ~1 at edge
                    float edge = 1.0 - smoothstep(1.0 - uSoftness, 1.0, r);
                    float alpha = uOpacity * edge;
                    gl_FragColor = vec4(uColor, alpha);
                }
            `,
            transparent: true,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            depthTest: true,
            toneMapped: false,
            side: THREE.DoubleSide
        });

        // Idle cap: circular billboard perpendicular to engine axis (-Z)
        const idleGeo = new THREE.CircleGeometry(0.11, 32);
        this.idleMesh = new THREE.Mesh(idleGeo, this.idleMaterial);
        this.idleMesh.position.copy(position);
        this.idleMesh.rotation.y = Math.PI; // face -Z
        this.idleMesh.position.z += 0.005; // tuck slightly into nozzle so it touches
        this.idleMesh.renderOrder = 0;
        this.root.add(this.idleMesh);

        // Blue cone material (solid color, no gradient)
        this.coneMaterial = new THREE.MeshBasicMaterial({
            color: new THREE.Color(0.2, 0.65, 1.0),
            transparent: true,
            opacity: this.coneOpacity,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            toneMapped: false
        });

        // Cone points backward along -Z; translate so base sits at origin (no forward protrusion)
        const coneHeight = 0.26;
        const coneRadius = 0.10;
        const coneGeo = new THREE.ConeGeometry(coneRadius, coneHeight, 20, 1, false);
        // Place base at y=0 so after -90deg X-rotation the base sits at the nozzle (z=0)
        // and the tip extends backward along -Z
        coneGeo.translate(0, coneHeight * 0.5, 0);
        this.coneMesh = new THREE.Mesh(coneGeo, this.coneMaterial);
        this.coneMesh.position.copy(position);
        this.coneMesh.position.z -= 0.001; // tiny tuck to avoid z-fighting
        this.coneMesh.rotation.x = -Math.PI / 2;
        this.coneMesh.visible = true; // always visible (idle flame present)
        this.coneMesh.renderOrder = 1; // draw after idle disc for correct layering
        this.root.add(this.coneMesh);

        // Inner hot core cone: smaller, brighter blue, reveals when boosting
        this.coreMaterial = new THREE.MeshBasicMaterial({
            color: new THREE.Color(0.35, 0.85, 1.0),
            transparent: true,
            opacity: this.coreOpacity,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            toneMapped: false
        });
        const coreHeight = 0.22;
        const coreRadius = 0.06;
        const coreGeo = new THREE.ConeGeometry(coreRadius, coreHeight, 20, 1, false);
        coreGeo.translate(0, coreHeight * 0.5, 0);
        this.coreMesh = new THREE.Mesh(coreGeo, this.coreMaterial);
        this.coreMesh.position.copy(position);
        this.coreMesh.position.z -= 0.001;
        this.coreMesh.rotation.x = -Math.PI / 2;
        this.coreMesh.visible = false;
        this.coreMesh.renderOrder = 1; // draw with inner stack
        this.root.add(this.coreMesh);

        // No outer warm cone; engine visuals are purely blue
    }

    // isMoving=true when the ship has non-zero forward speed
    public update(dt: number, isMoving: boolean, isBoosting: boolean) {
        this.timeSec += dt;

        // Subtle pulse for idle cap
        const idlePulse = 0.9 + 0.1 * (0.5 + 0.5 * Math.sin(this.timeSec * 4.0));
        const idleTargetOpacity = 0.3 * idlePulse;
        this.idleOpacity = THREE.MathUtils.damp(this.idleOpacity, isMoving ? 0.0 : idleTargetOpacity, isMoving ? 14 : 4, dt);
        this.idleMaterial.uniforms.uOpacity.value = THREE.MathUtils.clamp(this.idleOpacity, 0.0, 0.6);
        this.idleMesh.visible = !isMoving && (this.idleMaterial.uniforms.uOpacity.value as number) > 0.01;

        // Blue cone is always visible; smaller/dimmer at idle
        const conePulse = 1.0 + 0.08 * Math.sin(this.timeSec * 12.0);
        // Make the cone more opaque overall; brighten further during boost
        const coneTargetOpacity = isMoving ? (isBoosting ? 1.0 : 0.98) : 0.85;
        this.coneOpacity = THREE.MathUtils.damp(this.coneOpacity, coneTargetOpacity, 10, dt);
        this.coneMaterial.opacity = THREE.MathUtils.clamp(this.coneOpacity * conePulse, 0.0, 1.0);
        // Slight color shift toward hotter blue while boosting
        if (isBoosting) {
            this.coneMaterial.color.setRGB(0.28, 0.82, 1.0);
        } else {
            this.coneMaterial.color.setRGB(0.2, 0.65, 1.0);
        }
        this.coneMesh.visible = this.coneMaterial.opacity > 0.02;

        // Maintain consistent scale; keep geometry allocations out of hot path
        // Optional slight length modulation for life without gradient
        const boostLen = isBoosting ? 0.14 : 0.0;
        const scaleZ = isMoving ? (1.0 + boostLen + 0.06 * Math.sin(this.timeSec * 9.0)) : 0.9;
        const radiusScale = isMoving ? (isBoosting ? 1.05 : 1.0) : 0.85;
        this.coneMesh.scale.set(radiusScale, radiusScale, scaleZ);

        // Inner core: tight hot-blue flame that appears and glows when boosting
        const coreTargetOpacity = isBoosting ? 1.0 : (isMoving ? 0.35 : 0.0);
        const corePulse = 0.98 + 0.12 * Math.sin(this.timeSec * 18.0);
        this.coreOpacity = THREE.MathUtils.damp(this.coreOpacity, coreTargetOpacity, isBoosting ? 16 : 8, dt);
        this.coreMaterial.opacity = THREE.MathUtils.clamp(this.coreOpacity * corePulse, 0.0, 1.0);
        // Make the core a brighter, hotter blue when boosting
        if (isBoosting) {
            this.coreMaterial.color.setRGB(0.45, 0.95, 1.0);
        } else {
            this.coreMaterial.color.setRGB(0.35, 0.85, 1.0);
        }
        this.coreMesh.visible = this.coreMaterial.opacity > 0.02;
        this.coreMesh.scale.set(1.0, 1.0, isBoosting ? 1.2 : 1.0);

        // No outer warm cone to update
    }

    public dispose() {
        this.idleMaterial.dispose();
        if (this.idleMesh.geometry) this.idleMesh.geometry.dispose();
        this.root.remove(this.idleMesh);

        this.coneMaterial.dispose();
        if (this.coneMesh.geometry) this.coneMesh.geometry.dispose();
        this.root.remove(this.coneMesh);

        this.coreMaterial.dispose();
        if (this.coreMesh.geometry) this.coreMesh.geometry.dispose();
        this.root.remove(this.coreMesh);

        // No outer warm cone resources to dispose
    }
}

