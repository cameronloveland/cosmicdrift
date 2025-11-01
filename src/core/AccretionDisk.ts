import * as THREE from 'three';

export class AccretionDisk {
    public root = new THREE.Group();
    private disk!: THREE.Mesh;

    constructor() {
        this.createDisk();
    }

    private createDisk() {
        // Create ominous gradient texture with dark inner edge transitioning to bright outer
        const canvas = document.createElement('canvas');
        canvas.width = 1024;
        canvas.height = 1024;
        const ctx = canvas.getContext('2d')!;

        // Create radial gradient - dark red/purple inner edge to bright magenta/cyan outer
        const gradient = ctx.createRadialGradient(512, 512, 0, 512, 512, 512);
        // Inner ring - deep ominous red/purple (consuming)
        gradient.addColorStop(0, '#2a0010'); // Almost black red
        gradient.addColorStop(0.15, '#4a0020'); // Deep red
        gradient.addColorStop(0.25, '#6a0040'); // Dark purple-red
        gradient.addColorStop(0.35, '#8a0060'); // Purple-red
        gradient.addColorStop(0.45, '#aa0080'); // Bright purple-red
        gradient.addColorStop(0.55, '#cc00a0'); // Magenta
        gradient.addColorStop(0.65, '#ff2bd6'); // Bright pink
        gradient.addColorStop(0.75, '#ff6ae3'); // Light pink
        gradient.addColorStop(0.85, '#b83fff'); // Purple-cyan transition
        // Outer ring - cyan
        gradient.addColorStop(1, '#53d7ff');

        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, 1024, 1024);

        // Apply opacity fade at outer edge using global composite
        const alphaGradient = ctx.createRadialGradient(512, 512, 200, 512, 512, 512);
        alphaGradient.addColorStop(0, 'rgba(255, 255, 255, 1)'); // Fully opaque at center
        alphaGradient.addColorStop(0.7, 'rgba(255, 255, 255, 1)'); // Still opaque
        alphaGradient.addColorStop(0.85, 'rgba(255, 255, 255, 0.8)'); // Start fading
        alphaGradient.addColorStop(0.95, 'rgba(255, 255, 255, 0.4)'); // More fade
        alphaGradient.addColorStop(1, 'rgba(255, 255, 255, 0)'); // Fully transparent at edge
        
        // Use destination-in to apply alpha mask
        ctx.globalCompositeOperation = 'destination-in';
        ctx.fillStyle = alphaGradient;
        ctx.fillRect(0, 0, 1024, 1024);

        const texture = new THREE.CanvasTexture(canvas);
        texture.needsUpdate = true;

        // Create ring geometry - wider disk: inner radius 600, outer radius 1000
        const ringGeometry = new THREE.RingGeometry(600, 1000, 128, 1);
        
        // Create material with enhanced opacity and emissive glow
        const diskMaterial = new THREE.MeshBasicMaterial({
            map: texture,
            transparent: true,
            opacity: 0.95,
            blending: THREE.AdditiveBlending,
            side: THREE.DoubleSide,
            depthWrite: false,
            toneMapped: false
        });

        this.disk = new THREE.Mesh(ringGeometry, diskMaterial);
        
        // Tilt the disk for warped appearance (gravitational lensing effect)
        this.disk.rotation.x = Math.PI / 2 - 0.4; // Tilted ~23 degrees from horizontal
        this.disk.renderOrder = -1; // Render behind black hole core but visible
        
        this.root.add(this.disk);
    }

    update(dt: number) {
        // Disk is static - no rotation needed
    }
}

