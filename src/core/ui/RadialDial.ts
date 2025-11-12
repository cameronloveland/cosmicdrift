export class RadialDial {
    private canvas: HTMLCanvasElement;
    private ctx: CanvasRenderingContext2D;
    private value: number = 0;
    private targetValue: number = 0;
    private segments: number = 16;
    private color: string = '#53d7ff';
    private radius: number = 80;
    private centerX: number = 0;
    private centerY: number = 0;
    private animationId: number | null = null;

    constructor(canvasId: string, color: string = '#53d7ff') {
        this.canvas = document.getElementById(canvasId) as HTMLCanvasElement;
        this.ctx = this.canvas.getContext('2d')!;
        this.color = color;

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

        // Adjust radius based on canvas size
        this.radius = Math.min(rect.width, rect.height) * 0.35;
    }

    public setValue(newValue: number) {
        this.targetValue = Math.max(0, Math.min(1, newValue));
    }

    private animate() {
        // Smooth value interpolation
        this.value = this.value + (this.targetValue - this.value) * 0.15;

        this.draw();
        this.animationId = requestAnimationFrame(() => this.animate());
    }

    private draw() {
        // Clear canvas
        this.ctx.clearRect(0, 0, this.canvas.width / (window.devicePixelRatio || 1), this.canvas.height / (window.devicePixelRatio || 1));

        // Determine rotation based on dial position
        const isLeftDial = this.canvas.id === 'boostDial';
        const rotationAngle = isLeftDial ? Math.PI / 2 : -Math.PI / 2; // 90 degrees for left, -90 for right

        // Save context state
        this.ctx.save();

        // Apply rotation
        this.ctx.translate(this.centerX, this.centerY);
        this.ctx.rotate(rotationAngle);
        this.ctx.translate(-this.centerX, -this.centerY);

        // Draw arc segments
        const startAngle = Math.PI * 0.1; // Start from top-left
        const endAngle = Math.PI * 0.9;   // End at bottom-left (180 degree arc)
        const totalAngle = endAngle - startAngle;
        const segmentAngle = totalAngle / this.segments;

        // Calculate how many segments should be filled
        const filledSegments = Math.floor(this.value * this.segments);

        for (let i = 0; i < this.segments; i++) {
            const segmentStartAngle = startAngle + (i * segmentAngle);
            const segmentEndAngle = segmentStartAngle + segmentAngle * 0.85; // Leave gap between segments

            const isFilled = i < filledSegments;
            const alpha = isFilled ? 1.0 : 0.15; // Dim unfilled segments

            // Draw segment
            this.ctx.beginPath();
            this.ctx.arc(this.centerX, this.centerY, this.radius, segmentStartAngle, segmentEndAngle);
            this.ctx.lineWidth = 8;
            this.ctx.strokeStyle = this.color;
            this.ctx.globalAlpha = alpha;
            this.ctx.stroke();

            // Add glow effect for filled segments
            if (isFilled) {
                this.ctx.beginPath();
                this.ctx.arc(this.centerX, this.centerY, this.radius, segmentStartAngle, segmentEndAngle);
                this.ctx.lineWidth = 12;
                this.ctx.strokeStyle = this.color;
                this.ctx.globalAlpha = 0.3;
                this.ctx.stroke();

                this.ctx.beginPath();
                this.ctx.arc(this.centerX, this.centerY, this.radius, segmentStartAngle, segmentEndAngle);
                this.ctx.lineWidth = 16;
                this.ctx.strokeStyle = this.color;
                this.ctx.globalAlpha = 0.1;
                this.ctx.stroke();
            }
        }

        // Restore context state
        this.ctx.restore();

        // Reset alpha
        this.ctx.globalAlpha = 1.0;
    }

    public destroy() {
        if (this.animationId) {
            cancelAnimationFrame(this.animationId);
        }
        window.removeEventListener('resize', () => this.updateSize());
    }
}

