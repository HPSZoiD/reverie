/**
 * Audio Visualizer - Circular Bars Style
 */

const Visualizer = {
    canvas: null,
    ctx: null,
    audioContext: null,
    analyser: null,
    dataArray: null,
    animationId: null,
    isSetup: false,

    init() {
        this.canvas = document.getElementById('visualizer');
        if (!this.canvas) return;
        this.ctx = this.canvas.getContext('2d');
        this.resize();
        window.addEventListener('resize', () => this.resize());
    },

    resize() {
        if (!this.canvas) return;
        const container = this.canvas.parentElement;
        this.canvas.width = container.offsetWidth;
        this.canvas.height = container.offsetHeight;
    },

    setupAudio(audioElement) {
        try {
            // First try to grab the mathematically-aligned Analyser from the single AutoMix flow
            if (window.autoMix && window.autoMix.context) {
                const deck = window.autoMix.deckA.audio === audioElement ? window.autoMix.deckA : window.autoMix.deckB;
                this.audioContext = window.autoMix.context;
                this.analyser = deck.analyser;
                this.dataArray = new Uint8Array(this.analyser.frequencyBinCount);
                this.isSetup = true;
                return;
            }

            // Fallback (only used if AutoMix somehow failed to init)
            if (this.isSetup) return;
            this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
            this.analyser = this.audioContext.createAnalyser();
            this.analyser.fftSize = 256;

            const source = this.audioContext.createMediaElementSource(audioElement);
            source.connect(this.analyser);
            this.analyser.connect(this.audioContext.destination);

            this.dataArray = new Uint8Array(this.analyser.frequencyBinCount);
            this.isSetup = true;
            console.log('Visualizer audio setup complete via fallback');
        } catch (error) {
            console.error('Visualizer setup error:', error);
        }
    },

    start() {
        if (!this.isSetup || !this.ctx) return;
        this.draw();
    },

    stop() {
        if (this.animationId) {
            cancelAnimationFrame(this.animationId);
            this.animationId = null;
        }
        if (this.ctx && this.canvas) {
            this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        }
    },

    draw() {
        if (!this.analyser || !this.ctx) return;

        this.animationId = requestAnimationFrame(() => this.draw());

        this.analyser.getByteFrequencyData(this.dataArray);

        const width = this.canvas.width;
        const height = this.canvas.height;
        const centerX = width / 2;
        const centerY = height / 2;
        const radius = Math.min(width, height) * 0.22;

        this.ctx.clearRect(0, 0, width, height);

        // Number of bars
        const bars = 64;
        const step = Math.floor(this.dataArray.length / bars);

        for (let i = 0; i < bars; i++) {
            const value = this.dataArray[i * step];
            const normalizedValue = value / 255;

            const angle = (i / bars) * Math.PI * 2 - Math.PI / 2;
            const barHeight = normalizedValue * radius * 0.8 + 5;

            const x1 = centerX + Math.cos(angle) * radius;
            const y1 = centerY + Math.sin(angle) * radius;
            const x2 = centerX + Math.cos(angle) * (radius + barHeight);
            const y2 = centerY + Math.sin(angle) * (radius + barHeight);

            // Gradient from primary blue to cyan
            const hue = 210 + normalizedValue * 30;
            const lightness = 50 + normalizedValue * 20;

            this.ctx.beginPath();
            this.ctx.moveTo(x1, y1);
            this.ctx.lineTo(x2, y2);
            this.ctx.strokeStyle = `hsla(${hue}, 80%, ${lightness}%, ${0.6 + normalizedValue * 0.4})`;
            this.ctx.lineWidth = 3;
            this.ctx.lineCap = 'round';
            this.ctx.stroke();
        }

        // Inner glow circle
        const gradient = this.ctx.createRadialGradient(centerX, centerY, radius * 0.5, centerX, centerY, radius);
        gradient.addColorStop(0, 'rgba(19, 91, 236, 0.1)');
        gradient.addColorStop(1, 'rgba(19, 91, 236, 0)');
        this.ctx.beginPath();
        this.ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
        this.ctx.fillStyle = gradient;
        this.ctx.fill();
    }
};

// Initialize on load
document.addEventListener('DOMContentLoaded', () => Visualizer.init());
