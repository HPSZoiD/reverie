/**
 * StreamFlow - Web Frontend
 * player.js - Dual Deck Audio Player with Crossfade (UI2 Version)
 */

const Player = {
    // Dual Deck System
    audioA: new Audio(),
    audioB: new Audio(),
    activePlayer: 'A',

    // State
    queue: [],
    currentIndex: -1,
    isPlaying: false,

    // Crossfade Settings
    crossfadeEnabled: true,
    currentMixPlan: null,
    mixTimeoutId: null,

    init() {
        console.log('Player initialized (Dual Deck)');

        // Audio A events
        this.audioA.addEventListener('timeupdate', () => this.onTimeUpdate('A'));
        this.audioA.addEventListener('ended', () => this.onEnded('A'));
        this.audioA.addEventListener('loadedmetadata', () => this.onMetadataLoaded('A'));

        // Audio B events
        this.audioB.addEventListener('timeupdate', () => this.onTimeUpdate('B'));
        this.audioB.addEventListener('ended', () => this.onEnded('B'));
        this.audioB.addEventListener('loadedmetadata', () => this.onMetadataLoaded('B'));

        // Volume control
        this.initVolumeControl();
    },

    get activeAudio() {
        return this.activePlayer === 'A' ? this.audioA : this.audioB;
    },

    get nextAudio() {
        return this.activePlayer === 'A' ? this.audioB : this.audioA;
    },

    setQueue(tracks, startFromId = null) {
        this.queue = tracks;
        let startIndex = 0;
        if (startFromId !== null) {
            startIndex = tracks.findIndex(t => t.id === startFromId);
            if (startIndex === -1) startIndex = 0;
        }
        this.currentIndex = startIndex;
        this.playIndex(this.currentIndex);
    },

    clearQueue() {
        this.queue = [];
        this.currentIndex = -1;
        this.activeAudio.pause();
        this.nextAudio.pause();
        this.isPlaying = false;
        this.updatePlayPauseButton();
    },

    playIndex(index) {
        if (index < 0 || index >= this.queue.length) return;

        // Initialize AutoMix engine on first gesture
        if (window.autoMix && !window.autoMix.context) {
            window.autoMix.init(this.audioA, this.audioB);
        }

        const track = this.queue[index];
        const streamUrl = `/api/stream/${track.id}`;

        this.currentMixPlan = null; // Reset plan for new track
        if (this.mixTimeoutId) {
            clearTimeout(this.mixTimeoutId);
            this.mixTimeoutId = null;
        }

        // Stop other player and reset volume (incase we manually interrupted a transition)
        this.nextAudio.pause();
        this.nextAudio.volume = 1.0;

        this.activeAudio.src = streamUrl;
        this.activeAudio.volume = 1.0;
        this.activeAudio.play().then(() => {
            // Synchronize the AutoMix rhythmic grid at the exact moment playback starts
            if (window.autoMix && window.autoMix.context) {
                window.autoMix.activeTrackStartTime = window.autoMix.context.currentTime;
            }
        }).catch(e => console.error('Playback error:', e));
        this.isPlaying = true;

        // Setup and start visualizer
        if (typeof Visualizer !== 'undefined') {
            Visualizer.setupAudio(this.activeAudio);
            Visualizer.start();
        }

        this.updateUI(track);
        this.updatePlayPauseButton();
        App.updateNowPlaying(track);

        // Log to history
        this.logToHistory(track.id);
    },

    async logToHistory(trackId) {
        try {
            // Simple log - we'll enhance this later
            await fetch('/api/history', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ track_id: trackId, duration_listened: 0, skipped: false })
            });
        } catch (e) {
            // History logging is non-critical
        }
    },

    togglePlayPause() {
        if (this.activeAudio.paused) {
            this.activeAudio.play();
            this.isPlaying = true;
            if (typeof Visualizer !== 'undefined') Visualizer.start();
        } else {
            this.activeAudio.pause();
            this.isPlaying = false;
            if (typeof Visualizer !== 'undefined') Visualizer.stop();
        }
        this.updatePlayPauseButton();
    },

    next() {
        if (this.currentIndex < this.queue.length - 1) {
            this.currentIndex++;
            this.playIndex(this.currentIndex);
        }
    },

    previous() {
        if (this.activeAudio.currentTime > 3) {
            this.activeAudio.currentTime = 0;
        } else if (this.currentIndex > 0) {
            this.currentIndex--;
            this.playIndex(this.currentIndex);
        }
    },

    seek(percent) {
        if (this.activeAudio.duration) {
            this.activeAudio.currentTime = percent * this.activeAudio.duration;
            
            // Reschedule AutoMix if active
            if (this.currentMixPlan && this.crossfadeEnabled) {
                if (this.mixTimeoutId) clearTimeout(this.mixTimeoutId);
                
                const timeUntilFade = (this.currentMixPlan.fadeOutAt - this.activeAudio.currentTime) * 1000;
                
                if (timeUntilFade > 0) {
                    this.mixTimeoutId = setTimeout(() => {
                        this.triggerAutoMix();
                    }, timeUntilFade);
                } else {
                    // We seeked past the transition point, start it immediately
                    this.triggerAutoMix();
                }
            }
        }
    },

    // --- Crossfade Logic ---

    onTimeUpdate(deck) {
        // Only care about active deck for main UI updates
        if ((deck === 'A') !== (this.activePlayer === 'A')) {
            return;
        }

        const audio = this.activeAudio;

        // Update progress UI
        const progress = audio.currentTime / audio.duration || 0;
        this.updateProgress(progress, audio.currentTime, audio.duration);
    },

    triggerAutoMix() {
        console.log('Starting AutoMix Transition...');

        const nextTrack = this.queue[this.currentIndex + 1];
        const streamUrl = `/api/stream/${nextTrack.id}`;

        // Ensure B is loaded directly into Audio element
        if (!this.nextAudio.src.includes(nextTrack.id)) {
            this.nextAudio.src = streamUrl;
        }
        
        if (window.autoMix && this.currentMixPlan) {
            window.autoMix.execute(this.currentMixPlan, { audio: this.activeAudio }, { audio: this.nextAudio });
        } else {
            // Fallback
            this.nextAudio.volume = 0;
            this.nextAudio.play().catch(e => console.error(e));
        }

        // Switch active player instantly so UI progress bar maps to B
        this.activePlayer = this.activePlayer === 'A' ? 'B' : 'A';
        this.currentIndex++;
        
        if (typeof Visualizer !== 'undefined') {
            Visualizer.setupAudio(this.activeAudio);
        }

        this.updateUI(nextTrack);
        App.updateNowPlaying(nextTrack);
        this.logToHistory(nextTrack.id);
        
        // Let A end naturally (onEnded ignores it because activePlayer swapped)
    },

    onEnded(deck) {
        if ((deck === 'A') !== (this.activePlayer === 'A')) return; // Ignore fading out deck

        if (this.currentIndex < this.queue.length - 1) {
            this.currentIndex++;
            this.playIndex(this.currentIndex);
        } else {
            this.isPlaying = false;
            this.updatePlayPauseButton();
            if (typeof Visualizer !== 'undefined') Visualizer.stop();
        }
    },

    async onMetadataLoaded(deck) {
        // Update total duration display
        if ((deck === 'A') === (this.activePlayer === 'A')) {
            const duration = this.activeAudio.duration;
            const totalTimeEl = document.getElementById('total-time');
            const footerTotalEl = document.getElementById('footer-total-time');
            if (totalTimeEl) totalTimeEl.textContent = this.formatTime(duration);
            if (footerTotalEl) footerTotalEl.textContent = this.formatTime(duration);
            
            // Plan and Schedule AutoMix Transition
            if (this.crossfadeEnabled && window.autoMix && this.currentIndex < this.queue.length - 1) {
                const currentTrack = this.queue[this.currentIndex];
                const nextTrack = this.queue[this.currentIndex + 1];
                
                // 1. Unified High-Precision Analysis (BPM, Beats, Energy, Variance)
                const analysisA = await window.autoMix.analyze(currentTrack);
                const analysisB = await window.autoMix.analyze(nextTrack);
                
                // 2. Calculate the plan 
                this.currentMixPlan = window.autoMix.planTransition(analysisA, analysisB, duration);
                
                // Log output to confirm
                console.log(`[AutoMix] Prepared Transition: fadeOutAt=${this.currentMixPlan.fadeOutAt.toFixed(2)}s, overlapSecs=${this.currentMixPlan.overlapSecs.toFixed(1)}s, method=${this.currentMixPlan.method}`);
                
                // 4. Schedule execution 
                const timeUntilFade = (this.currentMixPlan.fadeOutAt - this.activeAudio.currentTime) * 1000;
                
                if (timeUntilFade > 0) {
                    if (this.mixTimeoutId) clearTimeout(this.mixTimeoutId);
                    this.mixTimeoutId = setTimeout(() => {
                        this.triggerAutoMix();
                    }, timeUntilFade);
                }
            }
        }
    },

    // --- UI Updates ---

    updateUI(track) {
        // Update Now Playing display in home view
        const title = document.getElementById('now-playing-title');
        const artist = document.getElementById('now-playing-artist');
        if (title) title.textContent = track.title || 'Unknown';
        if (artist) artist.textContent = track.artist || 'Unknown Artist';
    },

    updateProgress(percent, current, total) {
        const percentValue = `${percent * 100}%`;

        // Main player progress
        const progressBar = document.getElementById('progress-bar');
        const progressThumb = document.getElementById('progress-thumb');
        const currentTimeEl = document.getElementById('current-time');
        const totalTimeEl = document.getElementById('total-time');

        if (progressBar) progressBar.style.width = percentValue;
        if (progressThumb) progressThumb.style.left = percentValue;
        if (currentTimeEl) currentTimeEl.textContent = this.formatTime(current);
        if (totalTimeEl) totalTimeEl.textContent = this.formatTime(total);

        // Footer progress
        const footerProgressBar = document.getElementById('footer-progress-bar');
        const footerProgressThumb = document.getElementById('footer-progress-thumb');
        const footerMiniProgress = document.getElementById('footer-mini-progress');
        const footerCurrentTimeEl = document.getElementById('footer-current-time');
        const footerTotalTimeEl = document.getElementById('footer-total-time');

        if (footerProgressBar) footerProgressBar.style.width = percentValue;
        if (footerProgressThumb) footerProgressThumb.style.left = percentValue;
        if (footerMiniProgress) footerMiniProgress.style.width = percentValue;
        if (footerCurrentTimeEl) footerCurrentTimeEl.textContent = this.formatTime(current);
        if (footerTotalTimeEl) footerTotalTimeEl.textContent = this.formatTime(total);
    },

    updatePlayPauseButton() {
        // Update main play/pause button
        const btn = document.getElementById('btn-play-pause');
        if (btn) {
            const icon = btn.querySelector('.material-symbols-outlined');
            if (icon) icon.textContent = this.isPlaying ? 'pause' : 'play_arrow';
        }

        // Update footer play/pause button
        const footerBtn = document.getElementById('footer-play-pause');
        if (footerBtn) {
            const icon = footerBtn.querySelector('.material-symbols-outlined');
            if (icon) icon.textContent = this.isPlaying ? 'pause' : 'play_arrow';
        }
    },

    initVolumeControl() {
        const volumeBar = document.getElementById('volume-bar');
        const volumeBtn = document.getElementById('btn-volume');

        if (volumeBar && volumeBar.parentElement) {
            volumeBar.parentElement.addEventListener('click', (e) => {
                const rect = volumeBar.parentElement.getBoundingClientRect();
                const percent = (e.clientX - rect.left) / rect.width;
                this.setVolume(Math.max(0, Math.min(1, percent)));
            });
        }

        if (volumeBtn) {
            volumeBtn.addEventListener('click', () => {
                if (this.audioA.volume > 0 || this.audioB.volume > 0) {
                    this.setVolume(0);
                } else {
                    this.setVolume(0.66);
                }
            });
        }
    },

    setVolume(level) {
        this.audioA.volume = level;
        this.audioB.volume = level;

        const volumeBar = document.getElementById('volume-bar');
        const volumeBtn = document.getElementById('btn-volume');

        if (volumeBar) volumeBar.style.width = `${level * 100}%`;
        if (volumeBtn) {
            const icon = volumeBtn.querySelector('.material-symbols-outlined');
            if (icon) {
                if (level === 0) icon.textContent = 'volume_off';
                else if (level < 0.5) icon.textContent = 'volume_down';
                else icon.textContent = 'volume_up';
            }
        }
    },

    formatTime(seconds) {
        if (!seconds || isNaN(seconds)) return '0:00';
        const mins = Math.floor(seconds / 60);
        const secs = Math.floor(seconds % 60);
        return `${mins}:${secs.toString().padStart(2, '0')}`;
    }
};

// Initialize Player
Player.init();
