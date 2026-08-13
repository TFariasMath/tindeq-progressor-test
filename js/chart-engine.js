/**
 * High-performance 60 FPS HTML5 Canvas Chart Engine
 * Renders real-time 80Hz force telemetry streams smoothly without DOM bottlenecks.
 */

export class ForceChartEngine {
    constructor(canvasElement) {
        this.canvas = canvasElement;
        this.ctx = canvasElement.getContext('2d');
        
        // Data buffer: Array of { timeSec, weightKg }
        this.buffer = [];
        this.maxWindowSeconds = 10.0; // Show last 10 seconds of data
        this.peakWeight = 0.0;
        
        this.animFrameId = null;
        this.isLoopRunning = false;

        this._setupCanvasResolution();
        window.addEventListener('resize', () => this._setupCanvasResolution());
    }

    _setupCanvasResolution() {
        if (!this.canvas) return;
        const rect = this.canvas.getBoundingClientRect();
        const dpr = window.devicePixelRatio || 1;
        
        this.canvas.width = rect.width * dpr;
        this.canvas.height = rect.height * dpr;
        
        this.ctx.scale(dpr, dpr);
        this.displayWidth = rect.width;
        this.displayHeight = rect.height;
    }

    pushSamples(samples) {
        if (!samples || samples.length === 0) return;
        
        for (const s of samples) {
            const timeSec = s.timestampUs / 1000000.0;
            const weightKg = Math.max(0, s.weightKg);
            
            this.buffer.push({ timeSec, weightKg });
            if (weightKg > this.peakWeight) {
                this.peakWeight = weightKg;
            }
        }

        // Trim buffer to window duration
        if (this.buffer.length > 0) {
            const latestTime = this.buffer[this.buffer.length - 1].timeSec;
            const cutoffTime = latestTime - this.maxWindowSeconds;
            
            while (this.buffer.length > 0 && this.buffer[0].timeSec < cutoffTime) {
                this.buffer.shift();
            }
        }
    }

    clear() {
        this.buffer = [];
        this.peakWeight = 0.0;
        this.render();
    }

    startRenderLoop() {
        if (this.isLoopRunning) return;
        this.isLoopRunning = true;
        
        const loop = () => {
            if (!this.isLoopRunning) return;
            this.render();
            this.animFrameId = requestAnimationFrame(loop);
        };
        
        this.animFrameId = requestAnimationFrame(loop);
    }

    stopRenderLoop() {
        this.isLoopRunning = false;
        if (this.animFrameId) {
            cancelAnimationFrame(this.animFrameId);
            this.animFrameId = null;
        }
    }

    render() {
        const width = this.displayWidth || this.canvas.width;
        const height = this.displayHeight || this.canvas.height;
        const ctx = this.ctx;

        // Clear canvas background
        ctx.fillStyle = '#0f172a'; // Dark slate background
        ctx.fillRect(0, 0, width, height);

        // Chart margins
        const paddingLeft = 45;
        const paddingRight = 20;
        const paddingTop = 25;
        const paddingBottom = 30;

        const graphWidth = width - paddingLeft - paddingRight;
        const graphHeight = height - paddingTop - paddingBottom;

        // Determine Y axis max scale (auto-scaling up to highest kg + 20% margin, min 10kg)
        let maxKg = Math.max(10, this.peakWeight * 1.15);
        
        // Draw background grid lines & Y labels
        ctx.lineWidth = 1;
        ctx.strokeStyle = '#1e293b';
        ctx.fillStyle = '#64748b';
        ctx.font = '11px Inter, sans-serif';
        ctx.textAlign = 'right';
        ctx.textBaseline = 'middle';

        const ySteps = 5;
        for (let i = 0; i <= ySteps; i++) {
            const kgVal = (maxKg / ySteps) * i;
            const yPos = paddingTop + graphHeight - (i / ySteps) * graphHeight;

            // Grid line
            ctx.beginPath();
            ctx.moveTo(paddingLeft, yPos);
            ctx.lineTo(paddingLeft + graphWidth, yPos);
            ctx.stroke();

            // Label
            ctx.fillText(`${kgVal.toFixed(0)} kg`, paddingLeft - 8, yPos);
        }

        // Draw Peak Force Marker Line (if any)
        if (this.peakWeight > 0.5) {
            const peakY = paddingTop + graphHeight - (this.peakWeight / maxKg) * graphHeight;
            ctx.save();
            ctx.strokeStyle = 'rgba(239, 68, 68, 0.6)'; // Red accent
            ctx.setLineDash([4, 4]);
            ctx.beginPath();
            ctx.moveTo(paddingLeft, peakY);
            ctx.lineTo(paddingLeft + graphWidth, peakY);
            ctx.stroke();
            
            ctx.fillStyle = '#ef4444';
            ctx.textAlign = 'left';
            ctx.fillText(`PICO: ${this.peakWeight.toFixed(1)} kg`, paddingLeft + 10, peakY - 8);
            ctx.restore();
        }

        if (this.buffer.length < 2) {
            // Draw empty state message
            ctx.fillStyle = '#475569';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.font = '14px Inter, sans-serif';
            ctx.fillText('Esperando transmisión de datos...', paddingLeft + graphWidth / 2, paddingTop + graphHeight / 2);
            return;
        }

        // Calculate time window X mapping
        const latestTime = this.buffer[this.buffer.length - 1].timeSec;
        const startTime = latestTime - this.maxWindowSeconds;

        // Draw Force Curve Gradient Area
        const gradient = ctx.createLinearGradient(0, paddingTop, 0, paddingTop + graphHeight);
        gradient.addColorStop(0, 'rgba(56, 189, 248, 0.4)'); // Sky blue gradient
        gradient.addColorStop(1, 'rgba(56, 189, 248, 0.0)');

        ctx.beginPath();
        let firstPt = true;

        for (const pt of this.buffer) {
            const normX = (pt.timeSec - startTime) / this.maxWindowSeconds;
            const xPos = paddingLeft + normX * graphWidth;
            const yPos = paddingTop + graphHeight - (pt.weightKg / maxKg) * graphHeight;

            if (firstPt) {
                ctx.moveTo(xPos, yPos);
                firstPt = false;
            } else {
                ctx.lineTo(xPos, yPos);
            }
        }

        // Stroke line
        ctx.lineWidth = 2.5;
        ctx.strokeStyle = '#38bdf8'; // Sky blue
        ctx.stroke();

        // Fill area below curve
        const lastX = paddingLeft + graphWidth;
        const bottomY = paddingTop + graphHeight;
        ctx.lineTo(lastX, bottomY);
        ctx.lineTo(paddingLeft, bottomY);
        ctx.closePath();
        ctx.fillStyle = gradient;
        ctx.fill();
    }
}
