import * as THREE from 'three';
import { COLORS, SHIELD } from '../constants';

export class ShipShield {
    public root = new THREE.Group();

    // Shield mesh and material
    private shieldMaterial!: THREE.ShaderMaterial;
    private shieldMesh!: THREE.Mesh;
    private shieldOpacity: number = 0.0;

    // Base scale values for ellipsoid shape
    private baseScaleX: number = SHIELD.radiusX;
    private baseScaleY: number = SHIELD.radiusY;
    private baseScaleZ: number = SHIELD.radiusZ;

    // Animation state
    private timeSec: number = 0;
    private tmpColor = new THREE.Color();

    // Shield state
    private isActive: boolean = false;

    constructor(position: THREE.Vector3 = new THREE.Vector3(0, 0, 0)) {
        // Create shield material with radial alpha falloff for soft glow edge
        this.shieldMaterial = new THREE.ShaderMaterial({
            uniforms: {
                uColor: { value: COLORS.neonCyan.clone() }, // Neon cyan glow color
                uOpacity: { value: this.shieldOpacity },
                uSoftness: { value: 0.3 }, // Edge feather amount
                uTime: { value: 0.0 }, // For animation
                uIntensity: { value: 1.0 } // Glow intensity multiplier
            },
            vertexShader: `
                varying vec3 vPos;
                varying vec3 vWorldPosition;
                varying vec3 vNormal;
                varying vec2 vUv;
                void main() {
                    vPos = position;
                    vUv = uv;
                    vNormal = normalize(normalMatrix * normal);
                    vWorldPosition = (modelMatrix * vec4(position, 1.0)).xyz;
                    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                }
            `,
            fragmentShader: `
                varying vec3 vPos;
                varying vec3 vWorldPosition;
                varying vec3 vNormal;
                varying vec2 vUv;
                uniform vec3 uColor;
                uniform float uOpacity;
                uniform float uSoftness;
                uniform float uTime;
                uniform float uIntensity;
                
                void main() {
                    // Radial distance from center (0 at center, 1 at edge)
                    vec2 c = vUv - 0.5;
                    float r = length(c) * 2.0;
                    
                    // Create soft edge falloff
                    float edge = 1.0 - smoothstep(1.0 - uSoftness, 1.0, r);
                    
                    // Add subtle pulsing animation
                    float pulse = 1.0 + 0.05 * sin(uTime * 2.0);
                    
                    // Rim lighting effect: brighter at edges based on normal
                    // Use absolute value of normal components to create rim glow
                    float rimGlow = 0.4 + 0.6 * (1.0 - abs(dot(vNormal, vec3(0.0, 0.0, 1.0))));

                    // Animated clarity bands (moving transparent areas)
                    // Use normalized local position on sphere for stable patterns
                    vec3 pn = normalize(vPos);
                    // Angular stripes around Y axis
                    float stripes = 0.5 + 0.5 * sin(10.0 * (atan(pn.z, pn.x) + uTime * 0.8));
                    // Latitudinal ripples from top to bottom
                    float ripples = 0.5 + 0.5 * sin(12.0 * (acos(clamp(pn.y, -1.0, 1.0)) - uTime * 1.2));
                    // Combine and remap to 0.6..1.0 range (lower = clearer/holes)
                    float clarity = mix(0.6, 1.0, stripes * ripples);
                    // Secondary slow sweep to avoid repetitiveness
                    float sweep = 0.85 + 0.15 * (0.5 + 0.5 * sin((pn.x + pn.z) * 6.0 + uTime * 0.6));
                    clarity *= sweep;
                    
                    // Combine edge falloff with rim glow and pulse
                    float alpha = uOpacity * edge * pulse * rimGlow * clarity;
                    
                    // Boost color intensity for glow effect
                    vec3 finalColor = uColor * uIntensity * (1.0 + rimGlow * 0.4);
                    
                    gl_FragColor = vec4(finalColor, alpha);
                }
            `,
            transparent: true,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            depthTest: true,
            side: THREE.DoubleSide,
            toneMapped: false
        });

        // Create ellipsoid geometry that roughly matches ship dimensions
        // Ship is ~1.2 units long, ~0.7 units wide (with wings), ~0.5 units tall
        // Scale to create a shield that wraps around the ship with some padding
        this.baseScaleX = SHIELD.radiusX;  // Width (includes wings)
        this.baseScaleY = SHIELD.radiusY; // Height
        this.baseScaleZ = SHIELD.radiusZ;  // Length (front to back)
        const segments = 32;    // Geometry detail

        // Use sphere geometry and scale it to create ellipsoid
        const shieldGeo = new THREE.SphereGeometry(1.0, segments, segments);
        this.shieldMesh = new THREE.Mesh(shieldGeo, this.shieldMaterial);
        this.shieldMesh.scale.set(this.baseScaleX, this.baseScaleY, this.baseScaleZ);
        this.shieldMesh.position.copy(position);
        this.shieldMesh.renderOrder = -1; // Render before ship geometry
        this.shieldMesh.visible = false; // Start hidden
        this.root.add(this.shieldMesh);
    }

    // Center shield on the given object using its bounding box center (in object's local space)
    public centerOn(object: THREE.Object3D) {
        const box = new THREE.Box3().setFromObject(object);
        const worldCenter = box.getCenter(new THREE.Vector3());
        const localCenter = object.worldToLocal(worldCenter.clone());
        this.root.position.copy(localCenter);
    }

    public setActive(active: boolean) {
        this.isActive = active;
    }

    public update(dt: number) {
        this.timeSec += dt;

        // Update time uniform for animation
        this.shieldMaterial.uniforms.uTime.value = this.timeSec;

        // Smoothly transition opacity based on active state
        const targetOpacity = this.isActive ? 0.4 : 0.0;
        this.shieldOpacity = THREE.MathUtils.damp(
            this.shieldOpacity,
            targetOpacity,
            this.isActive ? 8.0 : 12.0,
            dt
        );

        // Update material opacity
        this.shieldMaterial.uniforms.uOpacity.value = THREE.MathUtils.clamp(
            this.shieldOpacity,
            0.0,
            0.6
        );

        // Show/hide mesh based on opacity
        this.shieldMesh.visible = this.shieldOpacity > 0.01;

        // Subtle pulsing scale when active (preserve ellipsoid shape)
        if (this.isActive) {
            const pulse = 1.0 + 0.02 * Math.sin(this.timeSec * 3.0);
            this.shieldMesh.scale.set(
                this.baseScaleX * pulse,
                this.baseScaleY * pulse,
                this.baseScaleZ * pulse
            );
        } else {
            // Reset to base scale when inactive
            this.shieldMesh.scale.set(this.baseScaleX, this.baseScaleY, this.baseScaleZ);
        }
    }

    public dispose() {
        this.shieldMaterial.dispose();
        if (this.shieldMesh.geometry) {
            this.shieldMesh.geometry.dispose();
        }
        this.root.remove(this.shieldMesh);
    }
}

