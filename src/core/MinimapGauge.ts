import * as THREE from 'three';
import { Track } from './Track';
import type { ShipState } from './types';

interface ShipPosition {
    t: number;
    color: string;
    isPlayer: boolean;
}

export class MinimapGauge {
    private canvas!: HTMLCanvasElement;
    private ctx!: CanvasRenderingContext2D;
    private track!: Track;
    private centerX: number = 0;
    private centerY: number = 0;
    private radius: number = 0;
    private trackPoints: { x: number; y: number }[] = [];
    private startLinePoints: { x: number; y: number }[] = [];
    private shipPositions: ShipPosition[] = [];
    private animationId: number | null = null;
    private tunnelSegments: Array<{ startIdx: number; endIdx: number; startT: number; endT: number }> = [];
    private pulseTime = 0;

    // Track bounds for normalization
    private minX: number = 0;
    private maxX: number = 0;
    private minZ: number = 0;
    private maxZ: number = 0;
    private boundsScale: number = 1;
    private boundsOffsetX: number = 0;
    private boundsOffsetZ: number = 0;

    constructor(canvasId: string, track: Track) {
        this.canvas = document.getElementById(canvasId) as HTMLCanvasElement;
        if (!this.canvas) {
            console.error(`MinimapGauge: Canvas element with id "${canvasId}" not found`);
            return;
        }
        this.ctx = this.canvas.getContext('2d')!;
        this.track = track;

        // Set up canvas size
        this.updateSize();
        window.addEventListener('resize', () => this.updateSize());

        // Precompute track projection
        this.precomputeTrackProjection();

        // Start animation loop
        this.animate();
    }

    private updateSize() {
        const rect = this.canvas.getBoundingClientRect();
        const dpr = window.devicePixelRatio || 1;

        this.canvas.width = rect.width * dpr;
        this.canvas.height = rect.height * dpr;

        this.ctx.scale(dpr, dpr);

        // Update center position and radius
        this.centerX = rect.width / 2;
        this.centerY = rect.height / 2;
        this.radius = Math.min(rect.width, rect.height) * 0.4; // Use 80% of canvas for map

        // Recompute track projection when size changes
        this.precomputeTrackProjection();
    }

    private precomputeTrackProjection() {
        // Get track positions and project to 2D (top-down view: X/Z plane, ignore Y)
        const positions = this.track.cachedPositions;
        if (!positions || positions.length === 0) {
            console.warn('MinimapGauge: Track positions not available');
            return;
        }

        // Find bounds of track in X/Z plane
        this.minX = Infinity;
        this.maxX = -Infinity;
        this.minZ = Infinity;
        this.maxZ = -Infinity;

        for (const pos of positions) {
            this.minX = Math.min(this.minX, pos.x);
            this.maxX = Math.max(this.maxX, pos.x);
            this.minZ = Math.min(this.minZ, pos.z);
            this.maxZ = Math.max(this.maxZ, pos.z);
        }

        // Add padding for better visualization
        const padding = 100;
        this.minX -= padding;
        this.maxX += padding;
        this.minZ -= padding;
        this.maxZ += padding;

        // Calculate scale to fit track within circular minimap bounds
        const width = this.maxX - this.minX;
        const height = this.maxZ - this.minZ;
        const maxDim = Math.max(width, height);
        this.boundsScale = (this.radius * 0.85) / (maxDim * 0.5); // Use 85% of radius, account for radius being half-width

        // Calculate offset to center the track
        this.boundsOffsetX = (this.minX + this.maxX) * 0.5;
        this.boundsOffsetZ = (this.minZ + this.maxZ) * 0.5;

        // Project track positions to 2D
        this.trackPoints = positions.map(pos => {
            const x = this.centerX + (pos.x - this.boundsOffsetX) * this.boundsScale;
            const y = this.centerY + (pos.z - this.boundsOffsetZ) * this.boundsScale; // Z becomes Y in top-down view
            return { x, y };
        });

        // Project start line (at t=0, which is first position)
        const startPos = positions[0];
        const binormals = this.track.cachedBinormals;
        if (!binormals || binormals.length === 0) {
            console.warn('MinimapGauge: Track binormals not available, skipping start line');
            return;
        }
        const startBinormal = binormals[0];
        const startWidth = this.track.width;
        const startLeft = new THREE.Vector3()
            .copy(startPos)
            .addScaledVector(startBinormal, -startWidth * 0.5);
        const startRight = new THREE.Vector3()
            .copy(startPos)
            .addScaledVector(startBinormal, startWidth * 0.5);

        this.startLinePoints = [
            {
                x: this.centerX + (startLeft.x - this.boundsOffsetX) * this.boundsScale,
                y: this.centerY + (startLeft.z - this.boundsOffsetZ) * this.boundsScale
            },
            {
                x: this.centerX + (startRight.x - this.boundsOffsetX) * this.boundsScale,
                y: this.centerY + (startRight.z - this.boundsOffsetZ) * this.boundsScale
            }
        ];

        // Precompute tunnel segments
        this.tunnelSegments = [];
        const tunnelSegments = this.track.getTunnelSegments();
        const samples = positions.length;

        for (const tunnel of tunnelSegments) {
            let startIdx = Math.floor(tunnel.startT * samples) % samples;
            let endIdx = Math.floor(tunnel.endT * samples) % samples;

            // Handle wrap-around case
            if (tunnel.startT <= tunnel.endT) {
                // Normal case
                if (endIdx < startIdx) endIdx += samples;
            } else {
                // Wrap case - tunnel crosses t=0/1 boundary
                if (endIdx > startIdx) endIdx -= samples;
            }

            this.tunnelSegments.push({
                startIdx: startIdx % samples,
                endIdx: endIdx % samples,
                startT: tunnel.startT,
                endT: tunnel.endT
            });
        }
    }

    public updateShips(playerState: ShipState, npcStates: Array<{ state: ShipState; color: string }>) {
        this.shipPositions = [];

        // Add player
        if (playerState) {
            this.shipPositions.push({
                t: playerState.t,
                color: '#53d7ff', // Cyan for player
                isPlayer: true
            });
        }

        // Add NPCs
        if (npcStates) {
            npcStates.forEach(npc => {
                if (npc.state) {
                    this.shipPositions.push({
                        t: npc.state.t,
                        color: npc.color,
                        isPlayer: false
                    });
                }
            });
        }
    }

    private projectTrackPosition(t: number): { x: number; y: number } | null {
        // Normalize t to [0, 1)
        let normalizedT = t % 1;
        if (normalizedT < 0) {
            normalizedT += 1;
        }

        // Find corresponding position in cached positions
        const positions = this.track.cachedPositions;
        if (!positions || positions.length === 0) {
            return null;
        }

        const index = Math.floor(normalizedT * positions.length) % positions.length;
        const pos = positions[index];

        // Project to 2D
        const x = this.centerX + (pos.x - this.boundsOffsetX) * this.boundsScale;
        const y = this.centerY + (pos.z - this.boundsOffsetZ) * this.boundsScale;

        return { x, y };
    }

    private animate() {
        // Update pulse time for animations
        this.pulseTime += 0.05;
        this.draw();
        this.animationId = requestAnimationFrame(() => this.animate());
    }

    private draw() {
        // Clear canvas
        const dpr = window.devicePixelRatio || 1;
        this.ctx.clearRect(0, 0, this.canvas.width / dpr, this.canvas.height / dpr);

        // Draw blackhole dark mass at center
        this.drawBlackhole();

        // Draw track outline (includes tunnel segments)
        this.drawTrack();

        // Draw start line
        this.drawStartLine();

        // Draw ship positions
        this.drawShips();
    }

    private drawBlackhole() {
        this.ctx.save();

        // Blackhole is at world origin (0, 0, 0), which projects to minimap center
        const blackholeRadius = this.radius * 0.2; // 20% of minimap radius
        const gradient = this.ctx.createRadialGradient(
            this.centerX, this.centerY, 0,
            this.centerX, this.centerY, blackholeRadius
        );

        // Dark purple-black center fading to transparent
        gradient.addColorStop(0, 'rgba(10, 0, 21, 0.95)');
        gradient.addColorStop(0.5, 'rgba(10, 0, 21, 0.7)');
        gradient.addColorStop(1, 'rgba(10, 0, 21, 0)');

        this.ctx.fillStyle = gradient;
        this.ctx.beginPath();
        this.ctx.arc(this.centerX, this.centerY, blackholeRadius, 0, Math.PI * 2);
        this.ctx.fill();

        this.ctx.restore();
    }

    private drawTrack() {
        if (this.trackPoints.length === 0) return;

        this.ctx.save();

        // Draw normal track segments first
        this.ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
        this.ctx.lineWidth = 2;
        this.ctx.shadowColor = 'rgba(83, 215, 255, 0.3)';
        this.ctx.shadowBlur = 6;

        // Track which points are in tunnels
        const inTunnel = new Set<number>();
        for (const tunnel of this.tunnelSegments) {
            let startIdx = tunnel.startIdx;
            let endIdx = tunnel.endIdx;

            // Handle wrap-around
            if (tunnel.startT <= tunnel.endT) {
                // Normal case
                for (let i = startIdx; i <= endIdx; i++) {
                    inTunnel.add(i % this.trackPoints.length);
                }
            } else {
                // Wrap case
                for (let i = startIdx; i < this.trackPoints.length; i++) {
                    inTunnel.add(i);
                }
                for (let i = 0; i <= endIdx; i++) {
                    inTunnel.add(i);
                }
            }
        }

        // Draw track in segments, coloring tunnels differently
        // Draw normal track segments first (excluding tunnel segments), then tunnels on top
        this.ctx.beginPath();
        let pathStarted = false;
        let lastWasTunnel = false;

        for (let i = 0; i < this.trackPoints.length; i++) {
            const isTunnel = inTunnel.has(i);

            if (!isTunnel) {
                if (!pathStarted || lastWasTunnel) {
                    // Start new path segment
                    if (pathStarted) {
                        // Close previous segment before starting new one
                        this.ctx.stroke();
                    }
                    this.ctx.beginPath();
                    this.ctx.moveTo(this.trackPoints[i].x, this.trackPoints[i].y);
                    pathStarted = true;
                } else {
                    this.ctx.lineTo(this.trackPoints[i].x, this.trackPoints[i].y);
                }
                lastWasTunnel = false;
            } else {
                lastWasTunnel = true;
            }
        }

        // Close the last normal segment if it was started
        if (pathStarted && !lastWasTunnel) {
            // Check if we need to connect back to start (if start is not in tunnel)
            if (!inTunnel.has(0)) {
                this.ctx.lineTo(this.trackPoints[0].x, this.trackPoints[0].y);
            }
            this.ctx.stroke();
        }

        // Draw tunnel segments on top with colors
        for (const tunnel of this.tunnelSegments) {
            let startIdx = tunnel.startIdx;
            let endIdx = tunnel.endIdx;
            const samples = this.trackPoints.length;

            this.ctx.lineWidth = 5;
            this.ctx.shadowBlur = 10;

            if (tunnel.startT <= tunnel.endT) {
                // Normal case - draw continuous segment with gradient
                const startPoint = this.trackPoints[startIdx % samples];
                const endPoint = this.trackPoints[endIdx % samples];

                // Create linear gradient from start to end of tunnel
                const gradient = this.ctx.createLinearGradient(
                    startPoint.x, startPoint.y,
                    endPoint.x, endPoint.y
                );
                gradient.addColorStop(0, '#53d7ff'); // Cyan start
                gradient.addColorStop(1, '#ff2bd6'); // Magenta end

                this.ctx.strokeStyle = gradient;
                this.ctx.shadowColor = 'rgba(255, 43, 214, 0.7)';

                this.ctx.beginPath();
                this.ctx.moveTo(startPoint.x, startPoint.y);
                for (let i = startIdx + 1; i <= endIdx; i++) {
                    const idx = i % samples;
                    this.ctx.lineTo(this.trackPoints[idx].x, this.trackPoints[idx].y);
                }
                this.ctx.stroke();
            } else {
                // Wrap case - draw two segments with gradient
                const midColor = '#b061ea'; // Blend of cyan and magenta

                this.ctx.strokeStyle = midColor;
                this.ctx.shadowColor = 'rgba(176, 97, 234, 0.7)';

                // First segment from startIdx to end
                this.ctx.beginPath();
                this.ctx.moveTo(this.trackPoints[startIdx].x, this.trackPoints[startIdx].y);
                for (let i = startIdx + 1; i < samples; i++) {
                    this.ctx.lineTo(this.trackPoints[i].x, this.trackPoints[i].y);
                }
                this.ctx.stroke();

                // Second segment from 0 to endIdx
                this.ctx.beginPath();
                this.ctx.moveTo(this.trackPoints[0].x, this.trackPoints[0].y);
                for (let i = 1; i <= endIdx; i++) {
                    this.ctx.lineTo(this.trackPoints[i].x, this.trackPoints[i].y);
                }
                this.ctx.stroke();
            }
        }

        // Draw inner track fill (subtle)
        this.ctx.fillStyle = 'rgba(83, 215, 255, 0.05)';
        this.ctx.fill();

        this.ctx.restore();
    }

    private drawStartLine() {
        if (this.startLinePoints.length < 2) return;

        this.ctx.save();

        // Pulse effect for start line
        const pulseIntensity = 0.8 + 0.2 * Math.sin(this.pulseTime * 3);

        // Calculate extended start line (make it slightly longer for visibility)
        const dx = this.startLinePoints[1].x - this.startLinePoints[0].x;
        const dy = this.startLinePoints[1].y - this.startLinePoints[0].y;
        const length = Math.sqrt(dx * dx + dy * dy);
        const extendBy = 5; // Extend line by 5 pixels on each side (reduced from 15)

        const extendedStart = {
            x: this.startLinePoints[0].x - (dx / length) * extendBy,
            y: this.startLinePoints[0].y - (dy / length) * extendBy
        };
        const extendedEnd = {
            x: this.startLinePoints[1].x + (dx / length) * extendBy,
            y: this.startLinePoints[1].y + (dy / length) * extendBy
        };

        // Outer glow layer (reduced size)
        this.ctx.globalCompositeOperation = 'screen';
        this.ctx.strokeStyle = '#53d7ff';
        this.ctx.lineWidth = 6;
        this.ctx.shadowColor = '#53d7ff';
        this.ctx.shadowBlur = 12;
        this.ctx.globalAlpha = 0.3 * pulseIntensity;

        this.ctx.beginPath();
        this.ctx.moveTo(extendedStart.x, extendedStart.y);
        this.ctx.lineTo(extendedEnd.x, extendedEnd.y);
        this.ctx.stroke();

        // Middle glow layer
        this.ctx.lineWidth = 5;
        this.ctx.shadowBlur = 10;
        this.ctx.globalAlpha = 0.5 * pulseIntensity;
        this.ctx.stroke();

        // Core bright line
        this.ctx.globalCompositeOperation = 'source-over';
        this.ctx.strokeStyle = '#53d7ff';
        this.ctx.lineWidth = 4;
        this.ctx.shadowColor = '#53d7ff';
        this.ctx.shadowBlur = 14;
        this.ctx.globalAlpha = 1.0 * pulseIntensity;

        this.ctx.beginPath();
        this.ctx.moveTo(extendedStart.x, extendedStart.y);
        this.ctx.lineTo(extendedEnd.x, extendedEnd.y);
        this.ctx.stroke();

        // White core for extra brightness
        this.ctx.strokeStyle = '#ffffff';
        this.ctx.lineWidth = 2;
        this.ctx.shadowBlur = 8;
        this.ctx.globalAlpha = 0.9 * pulseIntensity;
        this.ctx.stroke();

        this.ctx.restore();
    }

    private drawShips() {
        for (const shipPos of this.shipPositions) {
            const projected = this.projectTrackPosition(shipPos.t);
            if (!projected) continue;

            this.ctx.save();

            const dotRadius = shipPos.isPlayer ? 4 : 3;
            const glowRadius = shipPos.isPlayer ? 8 : 6;

            // Outer glow
            this.ctx.globalCompositeOperation = 'screen';
            const glowGradient = this.ctx.createRadialGradient(
                projected.x, projected.y, 0,
                projected.x, projected.y, glowRadius
            );
            glowGradient.addColorStop(0, shipPos.color);
            // Add alpha to color for middle stop
            const colorWithAlpha = shipPos.color.length === 7
                ? shipPos.color + '88'
                : shipPos.color.replace(')', ', 0.53)').replace('rgb', 'rgba');
            glowGradient.addColorStop(0.5, colorWithAlpha);
            glowGradient.addColorStop(1, 'transparent');
            this.ctx.fillStyle = glowGradient;
            this.ctx.fillRect(
                projected.x - glowRadius,
                projected.y - glowRadius,
                glowRadius * 2,
                glowRadius * 2
            );

            // Dot with glow
            this.ctx.globalCompositeOperation = 'source-over';
            this.ctx.fillStyle = shipPos.color;
            this.ctx.shadowColor = shipPos.color;
            this.ctx.shadowBlur = 10;
            this.ctx.beginPath();
            this.ctx.arc(projected.x, projected.y, dotRadius, 0, Math.PI * 2);
            this.ctx.fill();

            // Player gets an additional outer ring
            if (shipPos.isPlayer) {
                this.ctx.strokeStyle = shipPos.color;
                this.ctx.lineWidth = 1.5;
                this.ctx.shadowBlur = 8;
                this.ctx.globalAlpha = 0.7;
                this.ctx.beginPath();
                this.ctx.arc(projected.x, projected.y, dotRadius + 2, 0, Math.PI * 2);
                this.ctx.stroke();
            }

            this.ctx.restore();
        }
    }

    public destroy() {
        if (this.animationId !== null) {
            cancelAnimationFrame(this.animationId);
            this.animationId = null;
        }
    }
}

