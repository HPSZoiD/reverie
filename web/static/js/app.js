/**
 * StreamFlow - Web Frontend
 * app.js - Main Application Logic (UI2 Version)
 */

const API_BASE = '';

const App = {
    tracks: [],
    playlists: [],
    folders: [],
    currentView: 'home',
    currentPlaylistId: null,
    selectedTrackForPlaylist: null,
    explorationEpsilon: 0.3,

    async init() {
        console.log('Initializing StreamFlow...');
        await this.loadTracks();
        await this.loadPlaylists();
        await this.loadFolders();
        this.bindEvents();
        this.renderLibrary();
        this.loadRecommendations();
    },

    async loadTracks() {
        try {
            const response = await fetch(`${API_BASE}/api/tracks`);
            this.tracks = await response.json();
            console.log(`Loaded ${this.tracks.length} tracks`);
        } catch (error) {
            console.error('Failed to load tracks:', error);
            this.tracks = [];
        }
    },

    async loadPlaylists() {
        try {
            const response = await fetch(`${API_BASE}/api/playlists`);
            this.playlists = await response.json();
        } catch (error) {
            console.error('Failed to load playlists:', error);
            this.playlists = [];
        }
    },

    async loadFolders() {
        try {
            const response = await fetch(`${API_BASE}/api/folders`);
            this.folders = await response.json();
        } catch (error) {
            console.error('Failed to load folders:', error);
            this.folders = [];
        }
    },

    bindEvents() {
        // Navigation
        document.querySelectorAll('[data-nav]').forEach(btn => {
            btn.addEventListener('click', () => this.switchView(btn.dataset.nav));
        });

        // Dynamic click handlers
        document.addEventListener('click', (e) => {
            const playBtn = e.target.closest('[data-play-track]');
            if (playBtn) {
                const trackId = parseInt(playBtn.dataset.playTrack);
                this.playTrackSmart(trackId);
            }

            const addBtn = e.target.closest('[data-add-to-playlist]');
            if (addBtn) {
                e.stopPropagation();
                const trackId = parseInt(addBtn.dataset.addToPlaylist);
                this.openPlaylistModal(trackId);
            }

            const selectPlaylist = e.target.closest('[data-select-playlist]');
            if (selectPlaylist) {
                const playlistId = parseInt(selectPlaylist.dataset.selectPlaylist);
                this.addTrackToPlaylist(this.selectedTrackForPlaylist, playlistId);
            }

            const viewPlaylist = e.target.closest('[data-view-playlist]');
            if (viewPlaylist) {
                const playlistId = parseInt(viewPlaylist.dataset.viewPlaylist);
                this.viewPlaylistDetail(playlistId);
            }

            const removeFolder = e.target.closest('[data-remove-folder]');
            if (removeFolder) {
                const folderId = parseInt(removeFolder.dataset.removeFolder);
                this.removeFolder(folderId);
            }
        });

        // Main playback controls
        document.getElementById('btn-play-pause')?.addEventListener('click', () => Player.togglePlayPause());
        document.getElementById('btn-prev')?.addEventListener('click', () => Player.previous());
        document.getElementById('btn-next')?.addEventListener('click', () => Player.next());

        // Footer playback controls
        document.getElementById('footer-play-pause')?.addEventListener('click', () => Player.togglePlayPause());
        document.getElementById('footer-prev')?.addEventListener('click', () => Player.previous());
        document.getElementById('footer-next')?.addEventListener('click', () => Player.next());

        // Progress bar seeking (main)
        const progressContainer = document.getElementById('progress-container');
        if (progressContainer) {
            progressContainer.addEventListener('click', (e) => {
                const rect = progressContainer.getBoundingClientRect();
                const percent = (e.clientX - rect.left) / rect.width;
                Player.seek(percent);
            });
        }

        // Progress bar seeking (footer)
        const footerProgress = document.getElementById('footer-progress');
        if (footerProgress) {
            footerProgress.addEventListener('click', (e) => {
                const rect = footerProgress.getBoundingClientRect();
                const percent = (e.clientX - rect.left) / rect.width;
                Player.seek(percent);
            });
        }

        // Search inputs
        const searchInput = document.getElementById('search-input');
        if (searchInput) {
            let debounce = null;
            searchInput.addEventListener('input', () => {
                clearTimeout(debounce);
                debounce = setTimeout(() => this.doSearch(searchInput.value), 300);
            });
        }

        const librarySearch = document.getElementById('library-search');
        if (librarySearch) {
            let debounce = null;
            librarySearch.addEventListener('input', () => {
                clearTimeout(debounce);
                debounce = setTimeout(() => this.filterLibrary(librarySearch.value), 300);
            });
        }

        // Settings buttons
        document.getElementById('btn-add-folder')?.addEventListener('click', () => this.addFolder());
        document.getElementById('btn-scan-all')?.addEventListener('click', () => this.scanAllFolders());
        document.getElementById('btn-analyze')?.addEventListener('click', () => this.startAnalysis());
        document.getElementById('btn-refresh-recs')?.addEventListener('click', () => this.loadRecommendations());
        document.getElementById('btn-clear-library')?.addEventListener('click', () => this.clearLibrary());

        // Playlist creation
        document.getElementById('btn-create-playlist')?.addEventListener('click', () => this.openCreatePlaylistModal());
        document.getElementById('btn-confirm-create-playlist')?.addEventListener('click', () => this.createPlaylist());
        document.getElementById('btn-cancel-create-playlist')?.addEventListener('click', () => this.closeCreatePlaylistModal());

        // Playlist modal
        document.getElementById('btn-close-modal')?.addEventListener('click', () => this.closePlaylistModal());

        // Queue controls
        document.getElementById('btn-clear-queue')?.addEventListener('click', () => {
            Player.clearQueue();
            this.renderQueue();
        });

        // Playlist detail
        document.getElementById('btn-delete-playlist')?.addEventListener('click', () => {
            if (this.currentPlaylistId) this.deletePlaylist(this.currentPlaylistId);
        });
        document.getElementById('btn-play-playlist')?.addEventListener('click', () => {
            this.playCurrentPlaylist();
        });

        // Discovery slider
        document.getElementById('epsilon-slider')?.addEventListener('input', (e) => {
            const val = parseInt(e.target.value);
            this.explorationEpsilon = val / 100;
            document.getElementById('epsilon-value').textContent = `${val}%`;
        });

        // Crossfade controls
        document.getElementById('crossfade-toggle')?.addEventListener('change', (e) => {
            Player.crossfadeEnabled = e.target.checked;
        });

        // Mobile menu
        const mobileMenuBtn = document.getElementById('mobile-menu-btn');
        const mobileNav = document.getElementById('mobile-nav');
        const mobileNavClose = document.getElementById('mobile-nav-close');

        mobileMenuBtn?.addEventListener('click', () => {
            mobileNav.classList.remove('hidden');
            mobileNav.classList.add('flex');
            document.body.style.overflow = 'hidden';
        });

        mobileNavClose?.addEventListener('click', () => {
            mobileNav.classList.add('hidden');
            mobileNav.classList.remove('flex');
            document.body.style.overflow = '';
        });

        // Close mobile menu on nav item click
        mobileNav?.querySelectorAll('.mobile-nav-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                mobileNav.classList.add('hidden');
                mobileNav.classList.remove('flex');
                document.body.style.overflow = '';
            });
        });

        // Escape key closes mobile menu
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && mobileNav && !mobileNav.classList.contains('hidden')) {
                mobileNav.classList.add('hidden');
                mobileNav.classList.remove('flex');
                document.body.style.overflow = '';
            }
        });
    },

    switchView(viewName) {
        this.currentView = viewName;
        document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
        const targetView = document.getElementById(`view-${viewName}`);
        if (targetView) targetView.classList.add('active');

        // Update sidebar navigation highlighting
        document.querySelectorAll('.nav-btn').forEach(btn => {
            const isActive = btn.dataset.nav === viewName;
            btn.classList.toggle('bg-primary/20', isActive);
            btn.classList.toggle('text-primary', isActive);
            btn.classList.toggle('text-white/60', !isActive);
            btn.classList.toggle('hover:text-white', !isActive);
            btn.classList.toggle('hover:bg-white/5', !isActive);
        });

        // Load view-specific content
        if (viewName === 'library') this.renderLibrary();
        else if (viewName === 'history') this.loadHistory();
        else if (viewName === 'queue') this.renderQueue();
        else if (viewName === 'playlists') this.renderPlaylists();
        else if (viewName === 'settings') this.renderFolders();
    },

    // Smart queue using recommendations
    async playTrackSmart(trackId) {
        const track = this.tracks.find(t => t.id === trackId);
        if (!track) return;

        try {
            const response = await fetch(`${API_BASE}/api/recommendations?limit=20&epsilon=${this.explorationEpsilon}`);
            const recs = await response.json();
            const queue = [track, ...recs.filter(r => r.id !== trackId)];
            Player.setQueue(queue, trackId);
        } catch (error) {
            Player.setQueue(this.tracks, trackId);
        }
    },

    renderLibrary() {
        const container = document.getElementById('library-list');
        if (!container) return;
        if (this.tracks.length === 0) {
            container.innerHTML = '<tr><td colspan="7" class="px-6 py-4 text-text-secondary">No tracks. Go to Settings to scan folders.</td></tr>';
            return;
        }
        container.innerHTML = this.tracks.map((t, idx) => this.renderLibraryRow(t, idx + 1)).join('');
    },

    renderLibraryRow(track, index) {
        const bpmDisplay = track.tempo ? `<span class="px-2 py-1 rounded bg-surface-lighter text-xs font-mono text-purple-300 border border-purple-500/20">${Math.round(track.tempo)} BPM</span>` : '';
        const duration = this.formatDuration(track.duration_seconds);

        return `
            <tr class="group hover:bg-surface-lighter/40 transition-colors cursor-pointer" data-play-track="${track.id}">
                <td class="px-6 py-4 text-center text-text-secondary group-hover:text-white">
                    <span class="group-hover:hidden">${index}</span>
                    <span class="material-symbols-outlined hidden group-hover:inline-block text-[20px]">play_arrow</span>
                </td>
                <td class="px-6 py-4">
                    <div class="flex items-center gap-4">
                        <div class="size-10 rounded bg-surface-dark flex items-center justify-center shrink-0">
                            <span class="material-symbols-outlined text-text-secondary">music_note</span>
                        </div>
                        <div>
                            <p class="font-medium text-white">${track.title || 'Unknown'}</p>
                            <p class="text-xs text-text-secondary md:hidden">${track.artist || 'Unknown Artist'}</p>
                        </div>
                    </div>
                </td>
                <td class="px-6 py-4 text-text-secondary hidden md:table-cell">${track.artist || 'Unknown Artist'}</td>
                <td class="px-6 py-4 text-text-secondary hidden lg:table-cell">${track.album || 'Unknown Album'}</td>
                <td class="px-6 py-4 hidden sm:table-cell">
                    <div class="flex gap-2">${bpmDisplay}</div>
                </td>
                <td class="px-6 py-4 text-right text-text-secondary">${duration}</td>
                <td class="px-6 py-4 text-right">
                    <button data-add-to-playlist="${track.id}" class="text-text-secondary hover:text-white hover:bg-primary rounded-full p-1 transition-all opacity-0 group-hover:opacity-100">
                        <span class="material-symbols-outlined text-[20px]">add</span>
                    </button>
                </td>
            </tr>`;
    },

    filterLibrary(query) {
        const container = document.getElementById('library-list');
        if (!container) return;
        if (!query) {
            this.renderLibrary();
            return;
        }
        const q = query.toLowerCase();
        const filtered = this.tracks.filter(t =>
            (t.title && t.title.toLowerCase().includes(q)) ||
            (t.artist && t.artist.toLowerCase().includes(q)) ||
            (t.album && t.album.toLowerCase().includes(q))
        );
        if (filtered.length === 0) {
            container.innerHTML = '<tr><td colspan="7" class="px-6 py-4 text-text-secondary">No matching tracks.</td></tr>';
            return;
        }
        container.innerHTML = filtered.map((t, idx) => this.renderLibraryRow(t, idx + 1)).join('');
    },

    async doSearch(query) {
        const container = document.getElementById('search-results');
        if (!container) return;
        if (!query || query.length < 2) {
            container.innerHTML = '<p class="text-text-secondary text-sm">Type to search...</p>';
            return;
        }
        try {
            const response = await fetch(`${API_BASE}/api/search?q=${encodeURIComponent(query)}`);
            const results = await response.json();
            if (results.length === 0) {
                container.innerHTML = '<p class="text-text-secondary text-sm">No results found.</p>';
                return;
            }
            container.innerHTML = `
                <div class="bg-surface-dark/50 border border-surface-lighter rounded-xl overflow-hidden">
                    <table class="w-full text-left border-collapse">
                        <tbody class="text-sm divide-y divide-surface-lighter/50">
                            ${results.map((t, idx) => this.renderLibraryRow(t, idx + 1)).join('')}
                        </tbody>
                    </table>
                </div>`;
        } catch (error) {
            container.innerHTML = '<p class="text-red-500 text-sm">Search failed.</p>';
        }
    },

    async loadHistory() {
        const container = document.getElementById('history-list');
        if (!container) return;
        try {
            const response = await fetch(`${API_BASE}/api/history`);
            const history = await response.json();
            if (history.length === 0) {
                container.innerHTML = '<p class="text-text-secondary text-sm p-6">No listening history yet.</p>';
                return;
            }
            const rows = history.map((h, idx) => {
                const track = this.tracks.find(t => t.id === h.track_id) || h;
                return this.renderLibraryRow({ ...track, id: h.track_id }, idx + 1);
            }).join('');
            container.innerHTML = `
                <table class="w-full text-left border-collapse">
                    <tbody class="text-sm divide-y divide-surface-lighter/50">${rows}</tbody>
                </table>`;
        } catch (error) {
            container.innerHTML = '<p class="text-red-500 text-sm p-6">Failed to load history.</p>';
        }
    },

    renderQueue() {
        const container = document.getElementById('queue-list');
        if (!container) return;

        const queue = Player.queue;
        if (!queue || queue.length === 0) {
            container.innerHTML = '<p class="text-text-secondary text-sm">No tracks in queue. Play a song to start.</p>';
            return;
        }

        container.innerHTML = queue.map((track, idx) => {
            const isCurrent = idx === Player.currentIndex;
            return `
                <div class="group flex items-center gap-4 p-3 rounded-xl ${isCurrent ? 'bg-primary/10 border-l-2 border-primary' : 'bg-[#161118] hover:bg-surface-dark'} transition-all cursor-default" data-play-track="${track.id}">
                    <span class="material-symbols-outlined text-text-secondary cursor-grab hover:text-white px-2">drag_indicator</span>
                    <div class="size-12 rounded-lg bg-surface-dark flex items-center justify-center shrink-0">
                        ${isCurrent ? '<span class="material-symbols-outlined text-primary animate-pulse">equalizer</span>' : '<span class="material-symbols-outlined text-text-secondary">music_note</span>'}
                    </div>
                    <div class="flex-1 min-w-0">
                        <p class="font-bold ${isCurrent ? 'text-primary' : 'text-white'} truncate">${track.title || 'Unknown'}</p>
                        <p class="text-text-secondary text-sm truncate">${track.artist || 'Unknown Artist'}</p>
                    </div>
                    <div class="text-sm text-text-secondary font-mono">${this.formatDuration(track.duration_seconds)}</div>
                    <div class="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button data-add-to-playlist="${track.id}" class="p-2 hover:bg-white/10 rounded-full text-text-secondary hover:text-white transition-colors">
                            <span class="material-symbols-outlined text-[20px]">playlist_add</span>
                        </button>
                    </div>
                </div>`;
        }).join('');
    },

    async loadRecommendations() {
        const container = document.getElementById('recommendations-list');
        if (!container) return;
        container.innerHTML = '<p class="text-text-secondary text-sm col-span-full">Loading...</p>';
        try {
            const response = await fetch(`${API_BASE}/api/recommendations?limit=8&epsilon=${this.explorationEpsilon}`);
            const recs = await response.json();
            if (!recs || recs.length === 0) {
                container.innerHTML = '<p class="text-text-secondary text-sm col-span-full">No recommendations. Analyze tracks first.</p>';
                return;
            }
            container.innerHTML = recs.map(track => `
                <div class="group flex flex-col gap-3 p-3 rounded-2xl hover:bg-white/5 transition-colors cursor-pointer" data-play-track="${track.id}">
                    <div class="relative w-full aspect-square rounded-xl overflow-hidden bg-surface-dark shadow-lg">
                        <div class="w-full h-full flex items-center justify-center">
                            <span class="material-symbols-outlined text-4xl text-text-secondary/30">album</span>
                        </div>
                        <button class="absolute bottom-3 right-3 w-10 h-10 rounded-full bg-primary text-white shadow-lg translate-y-12 opacity-0 group-hover:translate-y-0 group-hover:opacity-100 transition-all duration-300 flex items-center justify-center hover:scale-105">
                            <span class="material-symbols-outlined" style="font-variation-settings: 'FILL' 1;">play_arrow</span>
                        </button>
                    </div>
                    <div>
                        <h3 class="text-white text-sm font-bold truncate">${track.title || 'Unknown'}</h3>
                        <p class="text-text-secondary text-xs truncate">${track.artist || 'Unknown Artist'}</p>
                    </div>
                </div>
            `).join('');
        } catch (error) {
            container.innerHTML = '<p class="text-text-secondary text-sm col-span-full">Failed to load recommendations.</p>';
        }
    },

    // Playlists
    renderPlaylists() {
        const container = document.getElementById('playlists-list');
        if (!container) return;
        if (this.playlists.length === 0) {
            container.innerHTML = '<p class="text-text-secondary text-sm col-span-full">No playlists yet. Create one!</p>';
            return;
        }
        container.innerHTML = this.playlists.map(p => `
            <div class="group flex flex-col gap-3 p-3 rounded-2xl hover:bg-white/5 transition-colors cursor-pointer" data-view-playlist="${p.id}">
                <div class="relative w-full aspect-square rounded-xl overflow-hidden bg-gradient-to-br from-surface-lighter to-background-dark shadow-lg flex items-center justify-center border border-white/5">
                    <span class="material-symbols-outlined text-5xl text-white/20">queue_music</span>
                    <button class="absolute bottom-3 right-3 w-10 h-10 rounded-full bg-primary text-white shadow-lg translate-y-12 opacity-0 group-hover:translate-y-0 group-hover:opacity-100 transition-all duration-300 flex items-center justify-center hover:scale-105">
                        <span class="material-symbols-outlined" style="font-variation-settings: 'FILL' 1;">play_arrow</span>
                    </button>
                </div>
                <div>
                    <h3 class="text-white text-base font-bold truncate">${p.name}</h3>
                    <p class="text-text-secondary text-sm">${p.track_count || 0} Tracks</p>
                </div>
            </div>
        `).join('');
    },

    openCreatePlaylistModal() {
        const modal = document.getElementById('create-playlist-modal');
        document.getElementById('new-playlist-name').value = '';
        modal.classList.remove('hidden');
        modal.classList.add('flex');
        document.getElementById('new-playlist-name').focus();
    },

    closeCreatePlaylistModal() {
        const modal = document.getElementById('create-playlist-modal');
        modal.classList.add('hidden');
        modal.classList.remove('flex');
    },

    async createPlaylist() {
        const nameInput = document.getElementById('new-playlist-name');
        const name = nameInput?.value?.trim();
        if (!name) return;
        try {
            await fetch(`${API_BASE}/api/playlists`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name })
            });
            await this.loadPlaylists();
            this.renderPlaylists();
            this.closeCreatePlaylistModal();
        } catch (error) { console.error('Create playlist error:', error); }
    },

    async viewPlaylistDetail(playlistId) {
        this.currentPlaylistId = playlistId;
        const playlist = this.playlists.find(p => p.id === playlistId);
        document.getElementById('playlist-detail-title').textContent = playlist?.name || 'Playlist';

        this.switchView('playlist-detail');

        const container = document.getElementById('playlist-tracks-list');
        try {
            const response = await fetch(`${API_BASE}/api/playlists/${playlistId}/tracks`);
            const tracks = await response.json();

            if (tracks.length === 0) {
                container.innerHTML = '<p class="text-text-secondary text-sm p-6">No tracks in this playlist.</p>';
                return;
            }

            const rows = tracks.map((t, idx) => `
                <tr class="group hover:bg-surface-lighter/40 transition-colors cursor-pointer" data-play-track="${t.id}">
                    <td class="px-6 py-4 text-center text-text-secondary group-hover:text-white">
                        <span class="group-hover:hidden">${idx + 1}</span>
                        <span class="material-symbols-outlined hidden group-hover:inline-block text-[20px]">play_arrow</span>
                    </td>
                    <td class="px-6 py-4">
                        <div class="flex items-center gap-4">
                            <div class="size-10 rounded bg-surface-dark flex items-center justify-center shrink-0">
                                <span class="material-symbols-outlined text-text-secondary">music_note</span>
                            </div>
                            <div>
                                <p class="font-medium text-white">${t.title || 'Unknown'}</p>
                                <p class="text-xs text-text-secondary">${t.artist || 'Unknown Artist'}</p>
                            </div>
                        </div>
                    </td>
                    <td class="px-6 py-4 text-right text-text-secondary">${this.formatDuration(t.duration_seconds)}</td>
                    <td class="px-6 py-4 text-right">
                        <button onclick="event.stopPropagation(); App.removeTrackFromPlaylist(${t.id}, ${playlistId})" 
                            class="text-text-secondary hover:text-red-400 hover:bg-red-500/10 rounded-full p-1 transition-all opacity-0 group-hover:opacity-100">
                            <span class="material-symbols-outlined text-[20px]">remove_circle</span>
                        </button>
                    </td>
                </tr>
            `).join('');

            container.innerHTML = `
                <table class="w-full text-left border-collapse">
                    <thead>
                        <tr class="text-xs text-text-secondary uppercase tracking-wider bg-surface-dark border-b border-surface-lighter">
                            <th class="px-6 py-4 font-medium w-16 text-center">#</th>
                            <th class="px-6 py-4 font-medium">Title</th>
                            <th class="px-6 py-4 font-medium text-right w-24">Duration</th>
                            <th class="px-6 py-4 font-medium w-16"></th>
                        </tr>
                    </thead>
                    <tbody class="text-sm divide-y divide-surface-lighter/50">${rows}</tbody>
                </table>`;
        } catch (error) {
            container.innerHTML = '<p class="text-red-500 text-sm p-6">Failed to load playlist.</p>';
        }
    },

    async playCurrentPlaylist() {
        if (!this.currentPlaylistId) return;
        try {
            const response = await fetch(`${API_BASE}/api/playlists/${this.currentPlaylistId}/tracks`);
            const tracks = await response.json();
            if (tracks.length > 0) {
                Player.setQueue(tracks, tracks[0].id);
            }
        } catch (error) { console.error('Play playlist error:', error); }
    },

    openPlaylistModal(trackId) {
        this.selectedTrackForPlaylist = trackId;
        const modal = document.getElementById('playlist-modal');
        const list = document.getElementById('playlist-modal-list');

        if (this.playlists.length === 0) {
            list.innerHTML = '<p class="text-text-secondary text-sm">No playlists. Create one first.</p>';
        } else {
            list.innerHTML = this.playlists.map(p => `
                <button data-select-playlist="${p.id}" class="w-full text-left p-3 rounded-lg bg-[#161118] hover:bg-primary/20 transition-colors text-white">
                    ${p.name}
                </button>
            `).join('');
        }

        modal.classList.remove('hidden');
        modal.classList.add('flex');
    },

    closePlaylistModal() {
        const modal = document.getElementById('playlist-modal');
        modal.classList.add('hidden');
        modal.classList.remove('flex');
        this.selectedTrackForPlaylist = null;
    },

    async addTrackToPlaylist(trackId, playlistId) {
        try {
            await fetch(`${API_BASE}/api/playlists/${playlistId}/add`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ track_id: trackId })
            });
            this.closePlaylistModal();
            await this.loadPlaylists();
        } catch (error) { console.error('Add to playlist error:', error); }
    },

    // Folders management
    renderFolders() {
        const container = document.getElementById('folders-list');
        if (!container) return;
        if (this.folders.length === 0) {
            container.innerHTML = '<p class="text-text-secondary text-sm">No folders added yet.</p>';
            return;
        }
        container.innerHTML = this.folders.map(f => `
            <div class="group flex items-center justify-between p-3 rounded-lg bg-[#161118] border border-surface-lighter hover:border-surface-lighter transition-all">
                <div class="flex items-center gap-3 overflow-hidden">
                    <div class="bg-surface-lighter p-2 rounded text-text-secondary">
                        <span class="material-symbols-outlined text-[20px]">folder</span>
                    </div>
                    <div class="flex flex-col min-w-0">
                        <span class="text-white text-sm font-medium truncate">${f.folder_path}</span>
                        <span class="text-text-secondary text-xs">${f.track_count || 0} tracks • ${f.last_scanned ? 'Last scanned: ' + new Date(f.last_scanned).toLocaleDateString() : 'Not scanned yet'}</span>
                    </div>
                </div>
                <button data-remove-folder="${f.id}" class="text-text-secondary hover:text-red-400 p-2 rounded-lg hover:bg-red-500/10 transition-colors opacity-0 group-hover:opacity-100" title="Remove Source">
                    <span class="material-symbols-outlined text-[20px]">delete</span>
                </button>
            </div>
        `).join('');
    },

    async addFolder() {
        const pathInput = document.getElementById('new-folder-path');
        const path = pathInput?.value?.trim();
        if (!path) { alert('Please enter a folder path.'); return; }
        try {
            const response = await fetch(`${API_BASE}/api/folders`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ path })
            });
            const data = await response.json();
            if (data.success) {
                pathInput.value = '';
                await this.loadFolders();
                this.renderFolders();
            } else {
                alert(data.message || 'Failed to add folder');
            }
        } catch (error) { console.error('Add folder error:', error); }
    },

    async removeFolder(folderId) {
        if (!confirm('Remove this folder from scan sources?')) return;
        try {
            await fetch(`${API_BASE}/api/folders/${folderId}`, { method: 'DELETE' });
            await this.loadFolders();
            this.renderFolders();
        } catch (error) { console.error('Remove folder error:', error); }
    },

    async scanAllFolders() {
        const statusEl = document.getElementById('scan-status');
        if (this.folders.length === 0) {
            alert('Add at least one folder first.');
            return;
        }

        statusEl.classList.remove('hidden');
        statusEl.textContent = 'Starting scan...';

        for (const folder of this.folders) {
            try {
                const response = await fetch(`${API_BASE}/api/scan`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ path: folder.folder_path })
                });
                const data = await response.json();
                if (data.status === 'started') {
                    await this.pollScanStatus(folder.folder_path);
                }
            } catch (error) { console.error('Scan error:', error); }
        }

        await this.loadTracks();
        await this.loadFolders();
        this.renderLibrary();
        this.renderFolders();
        statusEl.textContent = `Done! Library now has ${this.tracks.length} tracks.`;
    },

    async pollScanStatus(folderPath) {
        const statusEl = document.getElementById('scan-status');
        return new Promise((resolve) => {
            const check = async () => {
                const response = await fetch(`${API_BASE}/api/scan/status`);
                const data = await response.json();
                if (data.running) {
                    statusEl.textContent = `Scanning ${folderPath}: ${data.progress} / ${data.total}`;
                    setTimeout(check, 500);
                } else {
                    resolve();
                }
            };
            check();
        });
    },

    async startAnalysis() {
        const statusEl = document.getElementById('analyze-status');
        statusEl.classList.remove('hidden');
        statusEl.textContent = 'Starting analysis...';

        try {
            const response = await fetch(`${API_BASE}/api/analyze`, { method: 'POST' });
            const data = await response.json();

            if (data.status === 'started' || data.status === 'already_running') {
                statusEl.textContent = 'Analyzing...';
                this.pollAnalyzeStatus();
            } else {
                statusEl.textContent = 'No tracks to analyze. Scan folders first.';
            }
        } catch (error) {
            console.error('Analysis error:', error);
            statusEl.textContent = 'Analysis failed. Check console for details.';
        }
    },

    async pollAnalyzeStatus() {
        const statusEl = document.getElementById('analyze-status');
        const check = async () => {
            const response = await fetch(`${API_BASE}/api/analyze/status`);
            const data = await response.json();
            if (data.running) {
                statusEl.textContent = `Analyzing: ${data.progress} / ${data.total}`;
                setTimeout(check, 1000);
            } else {
                statusEl.textContent = `Done! Processed ${data.total} tracks.`;
                await this.loadTracks();
                this.renderLibrary();
                this.loadRecommendations();
            }
        };
        check();
    },

    formatDuration(seconds) {
        if (!seconds) return '--:--';
        const mins = Math.floor(seconds / 60);
        const secs = Math.floor(seconds % 60);
        return `${mins}:${secs.toString().padStart(2, '0')}`;
    },

    updateNowPlaying(track) {
        // Main view
        document.getElementById('now-playing-title').textContent = track.title || 'Unknown';
        document.getElementById('now-playing-artist').textContent = track.artist || 'Unknown Artist';

        // Footer
        document.getElementById('footer-title').textContent = track.title || 'Unknown';
        document.getElementById('footer-artist').textContent = track.artist || 'Unknown Artist';

        // Update queue view if visible
        if (this.currentView === 'queue') {
            this.renderQueue();
        }
    },

    async clearLibrary() {
        if (!confirm('Are you sure? This will remove ALL scanned tracks, playlists, and history. Your music files will NOT be deleted.')) {
            return;
        }
        try {
            const response = await fetch(`${API_BASE}/api/library/clear`, { method: 'POST' });
            const data = await response.json();
            if (data.success) {
                alert('Library cleared successfully!');
                this.tracks = [];
                this.playlists = [];
                this.renderLibrary();
                this.renderPlaylists();
                this.switchView('home');
            } else {
                alert('Failed to clear library');
            }
        } catch (error) {
            console.error('Clear library error:', error);
            alert('Failed to clear library: ' + error.message);
        }
    },

    async deletePlaylist(playlistId) {
        if (!confirm('Delete this playlist?')) return;
        try {
            await fetch(`${API_BASE}/api/playlists/${playlistId}`, { method: 'DELETE' });
            await this.loadPlaylists();
            this.switchView('playlists');
        } catch (error) {
            console.error('Delete playlist error:', error);
        }
    },

    async removeTrackFromPlaylist(trackId, playlistId) {
        try {
            await fetch(`${API_BASE}/api/playlists/${playlistId}/remove`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ track_id: trackId })
            });
            await this.loadPlaylists();
            this.viewPlaylistDetail(playlistId);
        } catch (error) {
            console.error('Remove track error:', error);
        }
    }
};

document.addEventListener('DOMContentLoaded', () => App.init());
