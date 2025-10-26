export class SpeedometerGauge {
    private canvas: HTMLCanvasElement;
    private ctx: CanvasRenderingContext2D;
    private speed: number = 0;
    private boost: number = 0;
    private flow: number = 0;
    private targetSpeed: number = 0;
    private targetBoost: number = 0;
    private targetFlow: number = 0;
    private actualSpeed: number = 0;
    private lapCurrent: number = 1;
    private lapTotal: number = 3;
    private maxSpeed: number = 1000; // Maximum speed in km/h
    private segments: number = 16;
    private centerX: number = 0;
    private centerY: number = 0;
    private animationId: number | null = null;
    private pulseTime: number = 0;
    private lightSweepAngle: number = 0;

    constructor(canvasId: string) {
        this.canvas = document.getElementById(canvasId) as HTMLCanvasElement;
        this.ctx = this.canvas.getContext('2d')!;

        // Set up canvas size
        this.updateSize();
        window.addEventListener('resize', () => this.updateSize());

        // Start animation loop
        this.animate();
    }

    private updateSize() {
        const rect = this.canvas.getBoundingClientRect();
        const dpr = window.devicePixelRatio || 1;

        this.canvas.width = rect.width * dpr;
        this.canvas.height = rect.height * dpr;

        this.ctx.scale(dpr, dpr);

        // Update center position
        this.centerX = rect.width / 2;
        this.centerY = rect.height / 2;
    }

    public setValues(speedKmh: number, boostLevel: number, flow: number, lapCurrent: number = 1, lapTotal: number = 3) {
        // Store actual speed for display
        this.actualSpeed = speedKmh;
        this.lapCurrent = lapCurrent;
        this.lapTotal = lapTotal;

        // Speed arc represents actual speed relative to max speed
        this.targetSpeed = Math.max(0, Math.min(1, speedKmh / this.maxSpeed));

        this.targetBoost = Math.max(0, Math.min(1, boostLevel));
        this.targetFlow = Math.max(0, Math.min(1, flow));
    }

    public setMaxSpeed(maxSpeed: number) {
        this.maxSpeed = maxSpeed;
    }

    private animate() {
        // Smooth value interpolation
        this.speed = this.speed + (this.targetSpeed - this.speed) * 0.15;
        this.boost = this.boost + (this.targetBoost - this.boost) * 0.15;
        this.flow = this.flow + (this.targetFlow - this.flow) * 0.15;

        // Update pulse time for glow effect
        this.pulseTime += 0.05;

        // Update light sweep angle (slow rotation)
        this.lightSweepAngle += 0.008;

        this.draw();
        this.animationId = requestAnimationFrame(() => this.animate());
    }

    private draw() {
        // Clear canvas
        this.ctx.clearRect(0, 0, this.canvas.width / (window.devicePixelRatio || 1), this.canvas.height / (window.devicePixelRatio || 1));

        const baseRadius = Math.min(this.canvas.width, this.canvas.height) / (window.devicePixelRatio || 1) * 0.4;
        const boostRadius = baseRadius;
        const flowRadius = baseRadius * 0.85;
        const speedRadius = baseRadius * 0.70;

        // Draw atmospheric background first
        this.drawBackgroundGlow(baseRadius);

        // Draw radial grid structure
        this.drawRadialGrid(baseRadius);

        // Draw speed markers
        this.drawSpeedMarkers(baseRadius);

        // Arc spans from bottom-left to bottom-right (speedometer style)
        const arcStart = Math.PI * 0.75;  // Bottom-left
        const arcEnd = Math.PI * 2.25;    // Bottom-right
        const totalAngle = arcEnd - arcStart;
        const segmentAngle = totalAngle / this.segments;

        // Draw boost arc (outermost, cyan)
        this.drawArc(boostRadius, this.boost, '#53d7ff', 12, 1.0);

        // Draw flow arc (middle layer, magenta)
        this.drawArc(flowRadius, this.flow, '#ff2bd6', 10, 1.0);

        // Draw speed arc (innermost, white) - represents actual speed
        this.drawArc(speedRadius, this.speed, '#ffffff', 8, 1.0);

        // Draw center speed text with decorations
        this.drawSpeedText();

        // Draw dynamic lighting effects
        this.drawDynamicLighting(baseRadius);
    }

    private drawArc(radius: number, value: number, color: string, lineWidth: number, baseAlpha: number) {
        const arcStart = Math.PI * 0.75;
        const arcEnd = Math.PI * 2.25;
        const totalAngle = arcEnd - arcStart;
        const segmentAngle = totalAngle / this.segments;
        const filledSegments = Math.ceil(value * this.segments);

        // Check if this arc is full (boost or flow at 100%)
        const isFull = value >= 0.95; // Close to 100%
        const pulseIntensity = isFull ? (Math.sin(this.pulseTime) * 0.3 + 0.7) : 1.0; // Pulse between 0.4 and 1.0

        for (let i = 0; i < this.segments; i++) {
            const segmentStartAngle = arcStart + (i * segmentAngle);
            const segmentEndAngle = segmentStartAngle + segmentAngle * 0.85; // Leave gap between segments

            const isFilled = i < filledSegments;
            const alpha = isFilled ? baseAlpha * pulseIntensity : 0.15; // Apply pulse to filled segments

            // Draw segment with enhanced neon effects
            if (isFilled) {
                // Use composite blend modes for authentic neon bleeding
                this.ctx.save();

                // Outer glow layer (screen blend for brightening)
                this.ctx.globalCompositeOperation = 'screen';
                this.ctx.beginPath();
                this.ctx.arc(this.centerX, this.centerY, radius, segmentStartAngle, segmentEndAngle);
                this.ctx.lineWidth = lineWidth + 16;
                this.ctx.strokeStyle = color;
                this.ctx.globalAlpha = 0.08 * pulseIntensity;
                this.ctx.stroke();

                // Middle glow layer
                this.ctx.beginPath();
                this.ctx.arc(this.centerX, this.centerY, radius, segmentStartAngle, segmentEndAngle);
                this.ctx.lineWidth = lineWidth + 10;
                this.ctx.strokeStyle = color;
                this.ctx.globalAlpha = 0.15 * pulseIntensity;
                this.ctx.stroke();

                // Inner glow layer
                this.ctx.beginPath();
                this.ctx.arc(this.centerX, this.centerY, radius, segmentStartAngle, segmentEndAngle);
                this.ctx.lineWidth = lineWidth + 6;
                this.ctx.strokeStyle = color;
                this.ctx.globalAlpha = 0.25 * pulseIntensity;
                this.ctx.stroke();

                // Core segment
                this.ctx.globalCompositeOperation = 'source-over';
                this.ctx.beginPath();
                this.ctx.arc(this.centerX, this.centerY, radius, segmentStartAngle, segmentEndAngle);
                this.ctx.lineWidth = lineWidth;
                this.ctx.strokeStyle = color;
                this.ctx.globalAlpha = alpha;
                this.ctx.stroke();

                // Extra intense glow when full
                if (isFull) {
                    this.ctx.globalCompositeOperation = 'lighter';
                    this.ctx.beginPath();
                    this.ctx.arc(this.centerX, this.centerY, radius, segmentStartAngle, segmentEndAngle);
                    this.ctx.lineWidth = lineWidth + 20;
                    this.ctx.strokeStyle = color;
                    this.ctx.globalAlpha = 0.06 * pulseIntensity;
                    this.ctx.stroke();
                }

                this.ctx.restore();
            } else {
                // Unfilled segments with subtle glow
                this.ctx.beginPath();
                this.ctx.arc(this.centerX, this.centerY, radius, segmentStartAngle, segmentEndAngle);
                this.ctx.lineWidth = lineWidth;
                this.ctx.strokeStyle = color;
                this.ctx.globalAlpha = alpha;
                this.ctx.stroke();
            }
        }

        // Reset alpha and composite operation
        this.ctx.globalAlpha = 1.0;
        this.ctx.globalCompositeOperation = 'source-over';
    }

    private drawSpeedText() {
        const speedKmh = Math.round(this.actualSpeed);

        this.ctx.save();

        // Draw decorative hexagonal frame around speed
        this.drawSpeedFrame();

        // Main speed display with futuristic styling
        this.ctx.fillStyle = '#ffffff';
        this.ctx.font = 'bold 48px Orbitron, monospace';
        this.ctx.textAlign = 'center';
        this.ctx.textBaseline = 'middle';
        this.ctx.shadowColor = '#53d7ff';
        this.ctx.shadowBlur = 15;
        this.ctx.shadowOffsetX = 0;
        this.ctx.shadowOffsetY = 0;

        this.ctx.fillText(`${speedKmh}`, this.centerX, this.centerY - 5);

        // SPEED label with technical styling above the number
        this.ctx.font = 'bold 12px Orbitron, monospace';
        this.ctx.fillStyle = 'rgba(83, 215, 255, 0.8)';
        this.ctx.shadowBlur = 5;
        this.ctx.fillText('SPEED', this.centerX, this.centerY - 35);

        // KM/H label
        this.ctx.font = 'bold 14px Orbitron, monospace';
        this.ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
        this.ctx.shadowBlur = 8;
        this.ctx.fillText('KM/H', this.centerX, this.centerY + 25);

        // Lap information with monospace styling and separators
        this.ctx.font = 'bold 16px Orbitron, monospace';
        this.ctx.fillStyle = 'rgba(255, 43, 214, 0.8)';
        this.ctx.shadowBlur = 5;
        this.ctx.shadowColor = '#ff2bd6';
        this.ctx.fillText(`LAP ${this.lapCurrent}/${this.lapTotal}`, this.centerX, this.centerY + 100);

        this.ctx.restore();
    }

    private drawSpeedFrame() {
        this.ctx.save();

        // Hexagonal frame around speed display
        const frameSize = 60;
        const hexPoints = 6;
        const angleStep = (Math.PI * 2) / hexPoints;

        this.ctx.strokeStyle = 'rgba(83, 215, 255, 0.3)';
        this.ctx.lineWidth = 2;
        this.ctx.shadowColor = '#53d7ff';
        this.ctx.shadowBlur = 8;

        this.ctx.beginPath();
        for (let i = 0; i < hexPoints; i++) {
            const angle = i * angleStep;
            const x = this.centerX + Math.cos(angle) * frameSize;
            const y = this.centerY - 10 + Math.sin(angle) * frameSize;

            if (i === 0) {
                this.ctx.moveTo(x, y);
            } else {
                this.ctx.lineTo(x, y);
            }
        }
        this.ctx.closePath();
        this.ctx.stroke();

        // Corner accent lines
        this.ctx.strokeStyle = 'rgba(255, 43, 214, 0.4)';
        this.ctx.lineWidth = 1;
        this.ctx.shadowBlur = 4;
        this.ctx.shadowColor = '#ff2bd6';

        for (let i = 0; i < hexPoints; i += 2) {
            const angle = i * angleStep;
            const x1 = this.centerX + Math.cos(angle) * (frameSize - 15);
            const y1 = this.centerY - 10 + Math.sin(angle) * (frameSize - 15);
            const x2 = this.centerX + Math.cos(angle) * (frameSize + 5);
            const y2 = this.centerY - 10 + Math.sin(angle) * (frameSize + 5);

            this.ctx.beginPath();
            this.ctx.moveTo(x1, y1);
            this.ctx.lineTo(x2, y2);
            this.ctx.stroke();
        }

        this.ctx.restore();
    }

    private drawBackgroundGlow(radius: number) {
        // Create radial gradient background for atmospheric depth
        const gradient = this.ctx.createRadialGradient(
            this.centerX, this.centerY, 0,
            this.centerX, this.centerY, radius * 1.5
        );

        //gradient.addColorStop(0, 'rgba(10, 3, 36, 0.8)'); // Dark center
        //gradient.addColorStop(0.3, 'rgba(11, 26, 95, 0.4)'); // Deep blue
        //        gradient.addColorStop(0.7, 'rgba(83, 215, 255, 0.1)'); // Cyan edge
        //gradient.addColorStop(1, 'rgba(255, 43, 214, 0.05)'); // Magenta outer

        // this.ctx.fillStyle = gradient;
        // this.ctx.fillRect(0, 0, this.canvas.width / (window.devicePixelRatio || 1), this.canvas.height / (window.devicePixelRatio || 1));
    }

    private drawRadialGrid(radius: number) {
        this.ctx.save();
        this.ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
        this.ctx.lineWidth = 1;

        // Draw radial spokes every 15 degrees
        for (let angle = 0; angle < Math.PI * 2; angle += Math.PI / 12) {
            const x1 = this.centerX + Math.cos(angle) * (radius * 0.3);
            const y1 = this.centerY + Math.sin(angle) * (radius * 0.3);
            const x2 = this.centerX + Math.cos(angle) * (radius * 1.1);
            const y2 = this.centerY + Math.sin(angle) * (radius * 1.1);

            this.ctx.beginPath();
            this.ctx.moveTo(x1, y1);
            this.ctx.lineTo(x2, y2);
            this.ctx.stroke();
        }

        // Draw concentric grid circles
        this.ctx.strokeStyle = 'rgba(83, 215, 255, 0.08)';
        for (let r = radius * 0.3; r <= radius * 1.1; r += radius * 0.2) {
            this.ctx.beginPath();
            this.ctx.arc(this.centerX, this.centerY, r, 0, Math.PI * 2);
            this.ctx.stroke();
        }

        this.ctx.restore();
    }

    private drawSpeedMarkers(radius: number) {
        this.ctx.save();
        this.ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
        this.ctx.lineWidth = 2;
        this.ctx.font = 'bold 10px Orbitron, monospace';
        this.ctx.textAlign = 'center';
        this.ctx.textBaseline = 'middle';
        this.ctx.fillStyle = 'rgba(255, 255, 255, 0.6)';

        const arcStart = Math.PI * 0.75;
        const arcEnd = Math.PI * 2.25;
        const totalAngle = arcEnd - arcStart;

        // Speed markers at 0, 250, 500, 750, 1000 km/h
        const speedMarkers = [0, 250, 500, 750, 1000];

        for (const speed of speedMarkers) {
            const angle = arcStart + (speed / 1000) * totalAngle;
            const x1 = this.centerX + Math.cos(angle) * (radius * 0.95);
            const y1 = this.centerY + Math.sin(angle) * (radius * 0.95);
            const x2 = this.centerX + Math.cos(angle) * (radius * 1.05);
            const y2 = this.centerY + Math.sin(angle) * (radius * 1.05);

            // Draw tick mark
            this.ctx.beginPath();
            this.ctx.moveTo(x1, y1);
            this.ctx.lineTo(x2, y2);
            this.ctx.stroke();

            // Draw speed label
            const labelX = this.centerX + Math.cos(angle) * (radius * 1.15);
            const labelY = this.centerY + Math.sin(angle) * (radius * 1.15);
            this.ctx.fillText(speed.toString(), labelX, labelY);
        }

        this.ctx.restore();
    }

    private drawDynamicLighting(radius: number) {
        this.ctx.save();

        // Rotating ambient light sweep
        const sweepAngle = this.lightSweepAngle;
        const sweepGradient = this.ctx.createRadialGradient(
            this.centerX + Math.cos(sweepAngle) * (radius * 0.3),
            this.centerY + Math.sin(sweepAngle) * (radius * 0.3),
            0,
            this.centerX + Math.cos(sweepAngle) * (radius * 0.3),
            this.centerY + Math.sin(sweepAngle) * (radius * 0.3),
            radius * 0.8
        );

        sweepGradient.addColorStop(0, 'rgba(83, 215, 255, 0.15)');
        sweepGradient.addColorStop(0.5, 'rgba(255, 43, 214, 0.08)');
        sweepGradient.addColorStop(1, 'rgba(83, 215, 255, 0)');

        this.ctx.fillStyle = sweepGradient;
        this.ctx.fillRect(0, 0, this.canvas.width / (window.devicePixelRatio || 1), this.canvas.height / (window.devicePixelRatio || 1));

        // Speed-responsive core glow
        const speedIntensity = Math.min(1, this.actualSpeed / 200);
        const coreGlow = this.ctx.createRadialGradient(
            this.centerX, this.centerY, 0,
            this.centerX, this.centerY, radius * 0.4
        );

        coreGlow.addColorStop(0, `rgba(83, 215, 255, ${0.1 + speedIntensity * 0.2})`);
        coreGlow.addColorStop(1, 'rgba(83, 215, 255, 0)');

        this.ctx.fillStyle = coreGlow;
        this.ctx.fillRect(0, 0, this.canvas.width / (window.devicePixelRatio || 1), this.canvas.height / (window.devicePixelRatio || 1));

        this.ctx.restore();
    }

    public destroy() {
        if (this.animationId) {
            cancelAnimationFrame(this.animationId);
        }
        window.removeEventListener('resize', () => this.updateSize());
    }
}
