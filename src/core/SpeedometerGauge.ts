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

        this.draw();
        this.animationId = requestAnimationFrame(() => this.animate());
    }

    private draw() {
        // Clear canvas
        this.ctx.clearRect(0, 0, this.canvas.width / (window.devicePixelRatio || 1), this.canvas.height / (window.devicePixelRatio || 1));

        const baseRadius = Math.min(this.canvas.width, this.canvas.height) / (window.devicePixelRatio || 1) * 0.4;
        const speedRadius = baseRadius;
        const boostRadius = baseRadius * 0.85;
        const flowRadius = baseRadius * 0.70;

        // Arc spans from bottom-left to bottom-right (speedometer style)
        const arcStart = Math.PI * 0.75;  // Bottom-left
        const arcEnd = Math.PI * 2.25;    // Bottom-right
        const totalAngle = arcEnd - arcStart;
        const segmentAngle = totalAngle / this.segments;

        // Draw speed arc (outermost, white) - represents actual speed
        this.drawArc(speedRadius, this.speed, '#ffffff', 8, 1.0);

        // Draw boost arc (middle layer, cyan)
        this.drawArc(boostRadius, this.boost, '#53d7ff', 12, 1.0);

        // Draw flow arc (inner layer, magenta)
        this.drawArc(flowRadius, this.flow, '#ff2bd6', 10, 1.0);

        // Draw center speed text
        this.drawSpeedText();
    }

    private drawArc(radius: number, value: number, color: string, lineWidth: number, baseAlpha: number) {
        const arcStart = Math.PI * 0.75;
        const arcEnd = Math.PI * 2.25;
        const totalAngle = arcEnd - arcStart;
        const segmentAngle = totalAngle / this.segments;
        const filledSegments = Math.floor(value * this.segments);

        for (let i = 0; i < this.segments; i++) {
            const segmentStartAngle = arcStart + (i * segmentAngle);
            const segmentEndAngle = segmentStartAngle + segmentAngle * 0.85; // Leave gap between segments

            const isFilled = i < filledSegments;
            const alpha = isFilled ? baseAlpha : 0.15; // Dim unfilled segments

            // Draw segment
            this.ctx.beginPath();
            this.ctx.arc(this.centerX, this.centerY, radius, segmentStartAngle, segmentEndAngle);
            this.ctx.lineWidth = lineWidth;
            this.ctx.strokeStyle = color;
            this.ctx.globalAlpha = alpha;
            this.ctx.stroke();

            // Add glow effect for filled segments
            if (isFilled) {
                this.ctx.beginPath();
                this.ctx.arc(this.centerX, this.centerY, radius, segmentStartAngle, segmentEndAngle);
                this.ctx.lineWidth = lineWidth + 4;
                this.ctx.strokeStyle = color;
                this.ctx.globalAlpha = 0.3;
                this.ctx.stroke();

                this.ctx.beginPath();
                this.ctx.arc(this.centerX, this.centerY, radius, segmentStartAngle, segmentEndAngle);
                this.ctx.lineWidth = lineWidth + 8;
                this.ctx.strokeStyle = color;
                this.ctx.globalAlpha = 0.1;
                this.ctx.stroke();
            }
        }

        // Reset alpha
        this.ctx.globalAlpha = 1.0;
    }

    private drawSpeedText() {
        const speedKmh = Math.round(this.actualSpeed);

        this.ctx.save();
        this.ctx.fillStyle = '#ffffff';
        this.ctx.font = 'bold 48px Arial, sans-serif';
        this.ctx.textAlign = 'center';
        this.ctx.textBaseline = 'middle';
        this.ctx.shadowColor = '#53d7ff';
        this.ctx.shadowBlur = 10;

        this.ctx.fillText(`${speedKmh}`, this.centerX, this.centerY - 10);

        this.ctx.font = 'bold 16px Arial, sans-serif';
        this.ctx.fillText('KM/H', this.centerX, this.centerY + 20);

        // Draw lap information at the bottom
        this.ctx.font = 'bold 14px Arial, sans-serif';
        this.ctx.fillText(`LAP ${this.lapCurrent}/${this.lapTotal}`, this.centerX, this.centerY + 50);

        this.ctx.restore();
    }

    public destroy() {
        if (this.animationId) {
            cancelAnimationFrame(this.animationId);
        }
        window.removeEventListener('resize', () => this.updateSize());
    }
}
