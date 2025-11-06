import * as THREE from 'three';

export class ShipJetEngine {
    public root = new THREE.Group();
    private glowMaterial!: THREE.MeshBasicMaterial;
    private engineGlow!: THREE.Mesh;

    constructor(position: THREE.Vector3 = new THREE.Vector3(0, 0, -0.9)) {
        // Engine glow effect (from rocket booster) - blue to orange gradient
        this.glowMaterial = new THREE.MeshBasicMaterial({
            color: 0xffffff, // White base, will use vertex colors
            transparent: true,
            opacity: 0.85,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            toneMapped: false,
            vertexColors: true // Enable vertex colors for gradient
        });

        // Create rocket booster flame with blue-to-orange gradient
        const coneGeometry = new THREE.ConeGeometry(0.12, 0.3, 16, 1, true);

        // Add vertex colors for blue-to-orange gradient
        const colors: number[] = [];
        const positions = coneGeometry.attributes.position.array;
        const vertexCount = positions.length / 3;

        for (let i = 0; i < vertexCount; i++) {
            // Y coordinate determines position along cone (0 at base, 0.15 at tip for height 0.3)
            const yPos = positions[i * 3 + 1];
            const normalizedY = (yPos + 0.15) / 0.3; // Normalize to 0-1
            const clampedY = THREE.MathUtils.clamp(normalizedY, 0, 1);

            // Gradient: 30% blue, then blend to vibrant orange at tip
            const blueColor = new THREE.Color(0.2, 0.6, 1.0); // Bright blue
            const vibrantOrangeColor = new THREE.Color(1.0, 0.5, 0.0); // Vibrant orange
            const orangeColor = new THREE.Color(1.0, 0.6, 0.15); // Orange transition

            let gradientColor: THREE.Color;
            if (clampedY <= 0.3) {
                // First 30%: pure blue
                gradientColor = blueColor;
            } else if (clampedY <= 0.7) {
                // 30-70%: blue to orange
                const t = (clampedY - 0.3) / 0.4;
                gradientColor = blueColor.clone().lerp(orangeColor, t);
            } else {
                // 70-100%: orange to vibrant orange at tip
                const t = (clampedY - 0.7) / 0.3;
                gradientColor = orangeColor.clone().lerp(vibrantOrangeColor, t);
            }

            colors.push(gradientColor.r, gradientColor.g, gradientColor.b);
        }

        coneGeometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));

        this.engineGlow = new THREE.Mesh(coneGeometry, this.glowMaterial);
        this.engineGlow.position.copy(position);
        this.engineGlow.rotation.x = -Math.PI / 2; // Point backward
        this.root.add(this.engineGlow);
    }

    public update(dt: number, isBoosting: boolean) {
        // Static glow - blue flame effect
        // Core color (bright blue)
        const coreColor = new THREE.Color(0.2, 0.6, 1.0);
        // Brighter blue tint when boosting
        const boostColor = new THREE.Color(0.4, 0.8, 1.0);

        // Lerp between colors based on boost state - subtle transition
        const finalColor = coreColor.clone();
        if (isBoosting) {
            finalColor.lerp(boostColor, 0.3); // Brighter blue when boosting
        }

        // Update material color
        this.glowMaterial.color.copy(finalColor);

        // Constant opacity - static size
        this.glowMaterial.opacity = 0.85;

        // Static size - no scale animation
        this.engineGlow.scale.set(1.0, 1.0, 1.0);

        // Always visible
        this.engineGlow.visible = true;
    }

    public dispose() {
        this.glowMaterial.dispose();
        if (this.engineGlow.geometry) {
            this.engineGlow.geometry.dispose();
        }
        this.root.remove(this.engineGlow);
    }
}

