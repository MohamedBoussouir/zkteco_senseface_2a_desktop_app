const app = {
    devices: [],
    workPatterns: [],
    shifts: [],
    usersData: [],
    usersPage: 1,
    usersPerPage: 10,
    usersSearchQuery: '',
    currentPage: 'dashboard',
    defaultStartTime: '08:00',
    defaultEndTime: '17:00',
    currentLogPage: 1,
    logsPerPage: 15,
    logsSearchQuery: '',
    logsFilterDate: '',
    logsSearchTimeout: null,
    
    reportsPage: 1,
    reportsPerPage: 15,
    currentFilteredReport: [],

    async init() {
        const licenseStatus = await window.securityAPI.verifyLicenseStatus();
        if (!licenseStatus.valid) {
            const res = await window.electronAPI.invoke('get-machine-id');
            const midInput = document.getElementById('activation-mid');
            if (midInput) midInput.value = res.mid || 'UNKNOWN_MID';

            const errorMsg = document.getElementById('activation-error-msg');
            if (errorMsg) errorMsg.innerText = licenseStatus.message;

            const modal = document.getElementById('activation-modal');
            if (modal) modal.style.display = 'flex';
            // Stop initialization if license is invalid
            return;
        }

        this.loadSavedLanguage();
        await this.loadDefaultShiftSettings();
        await this.loadAdmsPort();
        this.bindEvents();
        await this.loadDevices();
        await this.loadShifts(); // pre-load shifts
        await this.loadWorkPatterns();
        this.showPage('dashboard');
        this.startStatusPolling();
        this.loadDashboardStats();

        // Handle User Form Submission
        const userForm = document.getElementById('add-user-form');
        if (userForm) {
            userForm.onsubmit = async (e) => {
                e.preventDefault();
                await this.saveUser();
            };
        }

        // Handle Shift Form Submission
        const shiftForm = document.getElementById('add-shift-form');
        if (shiftForm) {
            shiftForm.onsubmit = async (e) => {
                e.preventDefault();
                const name = document.getElementById('shift-name').value;
                const start = document.getElementById('shift-start').value;
                const end = document.getElementById('shift-end').value;
                
                this.showNotification('Creating shift...', 'info');
                const res = await window.electronAPI.invoke('add-shift', { name, start_time: start, end_time: end });
                if (res.success) {
                    this.showNotification('Shift created successfully');
                    document.getElementById('add-shift-form').reset();
                    await this.loadShifts();
                    await this.loadWorkPatterns(); // re-render pattern shift dropdowns
                    await this.renderDailyScheduler();
                } else {
                    this.showNotification('Failed: ' + res.error, 'error');
                }
            };
        }

        // Handle Pattern Form Submission
        const patternForm = document.getElementById('add-pattern-form');
        if (patternForm) {
            patternForm.onsubmit = async (e) => {
                e.preventDefault();
                await this.saveWorkPattern();
            };
        }

        // الفحص التلقائي للمستخدمين والبصمات عند الدخول
        setTimeout(async () => {
            if (this.devices.length > 0) {
                await this.syncAllUsers();
                await this.syncAllBio();
            }
        }, 1500);
    },

    bindEvents() {
        document.querySelectorAll('.nav-item').forEach(link => {
            link.onclick = (e) => {
                e.preventDefault();
                this.showPage(link.dataset.page);
            };
        });

        // Schedules Tab Switching
        document.querySelectorAll('.schedule-tab-btn').forEach(btn => {
            btn.onclick = (e) => {
                e.preventDefault();
                document.querySelectorAll('.schedule-tab-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');

                document.querySelectorAll('.schedule-tab-content').forEach(content => {
                    content.style.display = 'none';
                });
                const activeTab = document.getElementById(btn.dataset.tab);
                if (activeTab) {
                    activeTab.style.display = 'block';
                }
            };
        });

        const syncAllBtn = document.getElementById('sync-all-btn');
        if (syncAllBtn) {
            syncAllBtn.onclick = async (e) => {
                e.preventDefault();
                if (this.devices.length === 0) {
                    this.showNotification('No connected devices to sync!', 'error');
                    return;
                }
                syncAllBtn.disabled = true;
                const oldHtml = syncAllBtn.innerHTML;
                syncAllBtn.innerHTML = '<i class="fas fa-spinner fa-spin mr-1"></i> Syncing...';

                try {
                    await this.syncAllUsers();
                    await this.syncAllBio();
                    await this.loadDashboardStats();

                    // Refresh current active page instantly
                    const activePage = document.querySelector('.page.active')?.id?.replace('-page', '');
                    if (activePage === 'logs') this.loadLogs();
                    if (activePage === 'users') this.loadUsers();
                } catch (err) {
                    console.error(err);
                } finally {
                    syncAllBtn.disabled = false;
                    syncAllBtn.innerHTML = oldHtml;
                }
            };
        }

        const syncLogsBtn = document.getElementById('sync-logs-only-btn');
        if (syncLogsBtn) {
            syncLogsBtn.onclick = async (e) => {
                e.preventDefault();
                await this.syncAllLogsOnly();
            };
        }

        const clearLogsBtn = document.getElementById('clear-all-logs-btn');
        if (clearLogsBtn) {
            clearLogsBtn.onclick = async (e) => {
                e.preventDefault();
                await this.clearAllLogs();
            };
        }

        // Attendance Logs Filters
        const searchInput = document.getElementById('logs-search-input');
        if (searchInput) {
            searchInput.oninput = (e) => {
                clearTimeout(this.logsSearchTimeout);
                this.logsSearchTimeout = setTimeout(() => {
                    this.logsSearchQuery = e.target.value.trim();
                    this.currentLogPage = 1;
                    this.loadLogs();
                }, 300);
            };
        }

        const dateFilter = document.getElementById('logs-date-filter');
        if (dateFilter) {
            dateFilter.onchange = (e) => {
                this.logsFilterDate = e.target.value;
                this.currentLogPage = 1;
                this.loadLogs();
            };
        }

        const clearFiltersBtn = document.getElementById('clear-logs-filter-btn');
        if (clearFiltersBtn) {
            clearFiltersBtn.onclick = (e) => {
                e.preventDefault();
                this.logsSearchQuery = '';
                this.logsFilterDate = '';
                if (searchInput) searchInput.value = '';
                if (dateFilter) dateFilter.value = '';
                this.currentLogPage = 1;
                this.loadLogs();
            };
        }
    },

    async loadDevices() {
        this.devices = await window.electronAPI.invoke('get-devices');
        this.renderDevices();
        this.updateDeviceSelects();
    },

    updateDeviceSelects() {
        const selects = ['user-target-device'];
        selects.forEach(id => {
            const el = document.getElementById(id);
            if (el) {
                el.innerHTML = this.devices.map(d => `<option value="${d.id}">${d.name} (${d.sn || d.ip})</option>`).join('');
            }
        });
    },

    renderDevices() {
        const grid = document.getElementById('devices-grid');
        if (!grid) return;
        grid.innerHTML = this.devices.map(d => `
            <div class="card device-card">
                <div class="flex justify-between items-start mb-4">
                    <div class="device-info">
                        <h3 class="font-bold text-lg">${d.name}</h3>
                        <p class="text-slate-400 text-sm">SN: ${d.sn || 'Unknown'} <span style="font-size:0.75rem; opacity:0.6;">(${d.ip})</span></p>
                    </div>
                    <span class="status-badge warning" id="status-${d.id}">Checking...</span>
                </div>
                <div class="flex gap-2">
                    <button class="btn btn-primary btn-sm flex-1" onclick="app.testConn('${d.sn}', '${d.ip}')">
                        <i class="fas fa-plug"></i> Check Status
                    </button>
                    <button class="btn btn-outline btn-sm" onclick="app.deleteDevice(${d.id})">
                        <i class="fas fa-trash"></i>
                    </button>
                </div>
            </div>
        `).join('');
    },

    showPage(pageId) {
        document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
        document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));

        const target = document.getElementById(`${pageId}-page`);
        if (target) target.classList.add('active');

        const nav = document.querySelector(`.nav-item[data-page="${pageId}"]`);
        if (nav) nav.classList.add('active');

        // Dynamic page title and subtitle updates
        const lang = this.currentLang || 'en';
        const trans = this.translations[lang];

        const pageTitles = {
            dashboard: { title: trans.dashboard, subtitle: trans.subtitle_dashboard },
            users: { title: trans.users, subtitle: trans.subtitle_users },
            schedules: { title: trans.schedules, subtitle: trans.subtitle_schedules },
            logs: { title: trans.logs, subtitle: trans.subtitle_logs },
            devices: { title: trans.devices, subtitle: trans.subtitle_devices },
            reports: { title: trans.reports, subtitle: trans.subtitle_reports },
            settings: { title: trans.settings, subtitle: trans.subtitle_settings },
            playground: { title: "Debug Center", subtitle: "Send direct command packets to device sensors." }
        };

        const headerTitle = document.getElementById('page-title');
        const headerSubtitle = document.getElementById('page-subtitle');
        if (headerTitle && headerSubtitle && pageTitles[pageId]) {
            headerTitle.innerText = pageTitles[pageId].title;
            headerSubtitle.innerText = pageTitles[pageId].subtitle;
        }

        if (pageId === 'users') this.loadUsers();
        if (pageId === 'schedules') this.loadSchedulesTab();
        if (pageId === 'logs') this.loadLogs();
        if (pageId === 'dashboard') this.loadDashboardStats();
        if (pageId === 'settings') {
           this.loadStrategyMode();
           this.loadDefaultShiftSettings();
           this.loadAdmsPort();
        }
        if (pageId === 'reports') {
            this.loadDefaultShiftSettings();
            this.initReportsPage();
        }
    },

    async loadDashboardStats() {
        try {
            // 1. Fetch Instant Local DB Stats
            const localRes = await window.electronAPI.invoke('get-dashboard-stats-local');
            if (localRes.success && localRes.stats) {
                document.getElementById('total-employees').innerText = localRes.stats.usersCount;
                document.getElementById('total-fingerprints').innerText = localRes.stats.fpCount;
                document.getElementById('today-punches').innerText = localRes.stats.todayPunches;
                document.getElementById('total-logs').innerText = localRes.stats.logsCount;

                if (localRes.stats.chartData) {
                    this.renderChart(localRes.stats.chartData.labels, localRes.stats.chartData.data);
                }

                // Render Dashboard Recent Activity
                const res = await window.electronAPI.invoke('get-logs', { page: 1, limit: 5 });
                const logs = Array.isArray(res) ? res : (res.logs || []);
                const recentTbody = document.querySelector('#recent-table tbody');
                if (recentTbody && Array.isArray(logs)) {
                    recentTbody.innerHTML = logs.slice(0, 5).map(l => `
                        <tr class="hover:bg-slate-800/30">
                            <td class="p-3 border-b border-slate-700 font-medium">${l.user_name}</td>
                            <td class="p-3 border-b border-slate-700 text-slate-400">${l.user_id}</td>
                            <td class="p-3 border-b border-slate-700">${new Date(l.timestamp).toLocaleString()}</td>
                            <td class="p-3 border-b border-slate-700 text-slate-500">Device ${l.device_id}</td>
                        </tr>
                    `).join('');
                }
            }

            // 2. Show Loading Spinners ONLY for Hardware Overview
            const loadingHtml = '<i class="fas fa-spinner fa-spin text-slate-500 text-sm"></i>';
            const hwEls = ['hw-users', 'hw-fingers', 'hw-logs'];
            hwEls.forEach(id => {
                const el = document.getElementById(id);
                if (el) el.innerHTML = loadingHtml;
            });
            const statusEl = document.getElementById('device-status-text');
            if (statusEl) {
                statusEl.className = 'status-badge warning';
                statusEl.innerHTML = '<i class="fas fa-spinner fa-spin mr-1"></i> Checking...';
            }

            // 3. Fetch Live Hardware Stats (Async delay)
            const hwRes = await window.electronAPI.invoke('get-dashboard-stats-hw');
            if (hwRes.success && hwRes.hwInfo) {
                const info = hwRes.hwInfo;
                document.getElementById('hw-users').innerText = info.userCounts !== undefined ? info.userCounts : '--';
                document.getElementById('hw-user-cap').innerText = info.userCapacity || '10K';

                document.getElementById('hw-fingers').innerText = info.fpCounts !== undefined ? info.fpCounts : '--';
                document.getElementById('hw-finger-cap').innerText = info.fingerprintCapacity || '10K';

                document.getElementById('hw-logs').innerText = info.logCounts !== undefined ? info.logCounts : '--';
                document.getElementById('hw-log-cap').innerText = info.logCapacity || '100K';

                if (statusEl) {
                    statusEl.className = 'status-badge online';
                    statusEl.innerText = 'Online & Synced';
                }
            } else {
                hwEls.forEach(id => {
                    const el = document.getElementById(id);
                    if (el) el.innerText = 'Offline';
                });
                if (statusEl) {
                    statusEl.className = 'status-badge error';
                    statusEl.innerText = 'Offline';
                }
            }
        } catch (e) {
            console.error(e);
        }
    },

    renderChart(labels, data) {
        const ctx = document.getElementById('attendanceChart');
        if (!ctx) return;

        if (this.attendanceChartInstance) {
            this.attendanceChartInstance.data.labels = labels;
            this.attendanceChartInstance.data.datasets[0].data = data;
            this.attendanceChartInstance.update();
            return;
        }

        this.attendanceChartInstance = new Chart(ctx, {
            type: 'line',
            data: {
                labels: labels,
                datasets: [{
                    label: 'Punches',
                    data: data,
                    borderColor: '#818cf8',
                    backgroundColor: 'rgba(129, 140, 248, 0.2)',
                    tension: 0.4,
                    fill: true
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    y: { beginAtZero: true, grid: { color: '#334155' }, ticks: { color: '#94a3b8', precision: 0 } },
                    x: { grid: { color: '#334155' }, ticks: { color: '#94a3b8' } }
                },
                plugins: {
                    legend: { display: false }
                }
            }
        });
    },

    async loadUsers() {
        const users = await window.electronAPI.invoke('get-local-users');
        this.usersData = users || [];
        this.renderUsersTable();
    },

    handleUsersSearch(val) {
        this.usersSearchQuery = (val || '').trim().toLowerCase();
        this.usersPage = 1;
        this.renderUsersTable();
    },

    prevUsersPage() {
        if (this.usersPage > 1) {
            this.usersPage--;
            this.renderUsersTable();
        }
    },

    nextUsersPage() {
        const filtered = this.getFilteredUsers();
        const totalPages = Math.ceil(filtered.length / this.usersPerPage) || 1;
        if (this.usersPage < totalPages) {
            this.usersPage++;
            this.renderUsersTable();
        }
    },

    getFilteredUsers() {
        if (!this.usersSearchQuery) return this.usersData;
        return this.usersData.filter(u => 
            (u.name || '').toLowerCase().includes(this.usersSearchQuery) || 
            (u.user_id || '').toString().toLowerCase().includes(this.usersSearchQuery)
        );
    },

    renderUsersTable() {
        const tbody = document.querySelector('#users-table tbody');
        if (!tbody) return;
        
        const filtered = this.getFilteredUsers();
        const totalItems = filtered.length;
        const totalPages = Math.ceil(totalItems / this.usersPerPage) || 1;
        
        if (this.usersPage > totalPages) this.usersPage = totalPages;
        if (this.usersPage < 1) this.usersPage = 1;

        const startIndex = (this.usersPage - 1) * this.usersPerPage;
        const endIndex = Math.min(startIndex + this.usersPerPage, totalItems);
        
        const currentData = filtered.slice(startIndex, endIndex);

        const infoEl = document.getElementById('users-page-info');
        if (infoEl) {
            if (totalItems === 0) {
                infoEl.innerText = 'Showing 0 to 0 of 0 entries';
            } else {
                infoEl.innerText = `Showing ${startIndex + 1} to ${endIndex} of ${totalItems} entries`;
            }
        }

        tbody.innerHTML = currentData.map(u => {
            return `
                <tr class="hover:bg-slate-800/50">
                    <td class="p-3 border-b border-slate-700 font-medium">${u.name}</td>
                    <td class="p-3 border-b border-slate-700 text-slate-400">${u.user_id}</td>
                    <td class="p-3 border-b border-slate-700 text-slate-300 text-sm">
                        <div style="display: flex; flex-direction: column; gap: 4px;">
                            ${u.assigned_devices ? u.assigned_devices.map(d => `<div class="badge badge-info" style="display: inline-flex; align-items: center; gap: 6px; padding: 4px 8px; border-radius: 6px; background: rgba(56, 189, 248, 0.1); color: #38bdf8; border: 1px solid rgba(56, 189, 248, 0.2); font-size: 0.75rem;"><i class="fas fa-desktop"></i> <span>${d.name}</span> <span style="opacity: 0.6; font-family: monospace;">${d.ip}</span></div>`).join('') : ''}
                        </div>
                    </td>
                    <td class="p-3 border-b border-slate-700">
                        ${parseInt(u.role) === 14 
                            ? `<span class="status-badge" style="background: rgba(168, 85, 247, 0.15); color: #c084fc; border: 1px solid rgba(168, 85, 247, 0.3);"><i class="fas fa-shield-halved mr-1"></i> Admin</span>` 
                            : `<span class="status-badge" style="background: rgba(100, 116, 139, 0.15); color: #94a3b8; border: 1px solid rgba(100, 116, 139, 0.3);"><i class="fas fa-user mr-1"></i> User</span>`
                        }
                    </td>
                    <td class="p-3 border-b border-slate-700">
                        <span class="text-emerald-400 font-medium text-xs">${u.pattern_name || 'None (Use Default)'}</span>
                    </td>
                    <td class="p-3 border-b border-slate-700">
                        ${(() => {
                    let fpData = null;
                    try { fpData = JSON.parse(u.fingerprints || 'null'); } catch (e) { }
                    const count = fpData && typeof fpData === 'object' && fpData.count !== undefined
                        ? fpData.count
                        : (Array.isArray(fpData) ? fpData.length : 0);

                    if (count === 0) return '<span class="text-slate-600 italic text-xs">No fingerprints</span>';

                    return `
                                <div class="inline-flex items-center bg-slate-800/40 rounded-xl p-1 border border-slate-700/50 shadow-inner whitespace-nowrap gap-1">
                                    ${(fpData && Array.isArray(fpData.indices) ? fpData.indices : []).map(f => `
                                        <button class="finger-count-badge cursor-pointer hover:scale-110 transition-transform bg-transparent border-none p-0 flex items-center outline-none" 
                                            onclick="app.deleteFingerDirectFlow(${u.uid}, '${u.user_id}', ${f}, '${btoa(encodeURIComponent(JSON.stringify(u.assigned_devices)))}')" 
                                            title="Delete Finger ${f}">
                                            <i class="fas fa-fingerprint"></i> <span class="ml-1">${f}</span>
                                        </button>
                                    `).join('')}
                                    
                                    <div class="border-l border-slate-700/50 pl-1 ml-1 flex items-center">
                                        <button class="btn btn-xs btn-red" onclick="app.deleteAllFingersFlow(${u.uid}, '${u.user_id}', '${btoa(encodeURIComponent(JSON.stringify(u.assigned_devices)))}')" title="Clear All Data">
                                            <i class="fas fa-eraser"></i>
                                        </button>
                                    </div>
                                </div>
                            `;
                })()}
                    </td>

                    <td class="p-3 border-b border-slate-700">
                        <div class="actions-cell">
                            <button class="btn btn-icon btn-blue" onclick="app.enrollFingerFlow(${u.uid}, '${u.user_id}', '${btoa(encodeURIComponent(JSON.stringify(u.assigned_devices)))}')" title="Enroll Finger">
                                <i class="fas fa-fingerprint"></i>
                            </button>
                            <button class="btn btn-icon btn-blue" onclick="app.editUserFlow(${u.uid}, '${u.user_id}', '${(u.name || '').replace(/'/g, "\\'")}', '${btoa(encodeURIComponent(JSON.stringify(u.assigned_devices)))}', ${u.work_pattern_id || 'null'})" title="Edit User">
                                <i class="fas fa-edit"></i>
                            </button>
                            <button class="btn btn-icon btn-red" onclick="app.deleteUserFlow(${u.uid}, '${u.user_id}', '${btoa(encodeURIComponent(JSON.stringify(u.assigned_devices)))}')" title="Delete User">
                                <i class="fas fa-trash"></i>
                            </button>
                        </div>
                    </td>
                </tr>
            `;
        }).join('');
    },

    async syncAllUsers() {
        this.showNotification('Fetching all users from devices...', 'info');
        for (const dev of this.devices) {
            await window.electronAPI.invoke('sync-users-from-device', { ip: dev.ip, ports: [dev.port1, dev.port2], deviceId: dev.id });
        }
        this.loadUsers();
        this.showNotification('Users updated from all devices');
    },

    async syncAllBio() {
        this.showNotification('Syncing fingerprints from devices...', 'info');
        const users = await window.electronAPI.invoke('get-local-users');
        for (const dev of this.devices) {
            const devUsers = users.filter(u => u.assigned_devices && u.assigned_devices.some(d => d.id == dev.id));
            if (devUsers.length > 0) {
                await window.electronAPI.invoke('get-users-fingerprints', { ip: dev.ip, ports: [dev.port1, dev.port2], users: devUsers, deviceId: dev.id });
            }
        }
        this.loadUsers();
        this.showNotification('Fingerprints synchronized');
    },

    async syncAllLogsOnly() {
        this.showNotification('Fast syncing logs from devices...', 'info');
        const btn = document.getElementById('sync-logs-only-btn');
        let oldHtml = '';
        if (btn) {
            btn.disabled = true;
            oldHtml = btn.innerHTML;
            btn.innerHTML = '<i class="fas fa-spinner fa-spin mr-1"></i> Syncing...';
        }
        try {
            for (const dev of this.devices) {
                await window.electronAPI.invoke('sync-logs-from-device', { ip: dev.ip, ports: [dev.port1, dev.port2], deviceId: dev.id });
            }
            this.currentLogPage = 1;
            this.loadLogs();
            this.showNotification('Logs synced successfully');
        } catch (err) {
            console.error(err);
            this.showNotification('Error syncing logs', 'error');
        } finally {
            if (btn) {
                btn.disabled = false;
                btn.innerHTML = oldHtml;
            }
        }
    },

    promptDeviceSelection(title, devices) {
        return new Promise((resolve) => {
            if (!devices || devices.length === 0) {
                this.showNotification('No devices available', 'error');
                return resolve(null);
            }
            if (devices.length === 1) {
                return resolve(devices[0].id.toString());
            }

            document.getElementById('device-selection-title').innerText = title;
            const select = document.getElementById('device-selection-select');
            select.innerHTML = devices.map(d => `<option value="${d.id}">${d.name} (${d.ip})</option>`).join('');
            
            document.getElementById('device-selection-modal').style.display = 'flex';
            
            const confirmBtn = document.getElementById('device-selection-confirm');
            confirmBtn.onclick = () => {
                document.getElementById('device-selection-modal').style.display = 'none';
                resolve(select.value);
            };

            const cancelBtn = document.querySelector('#device-selection-modal .btn-secondary');
            cancelBtn.onclick = () => {
                document.getElementById('device-selection-modal').style.display = 'none';
                resolve(null);
            };
        });
    },

    async enrollFingerFlow(uid, userId, devicesEncoded) {
        try {
            const devices = JSON.parse(decodeURIComponent(atob(devicesEncoded)));
            const devId = await this.promptDeviceSelection('Select Device for Enrollment:', devices);
            if (devId) {
                this.enrollFinger(uid, userId, devId);
            }
        } catch (e) {
            this.showNotification('Error enrolling finger: ' + e.message, 'error');
        }
    },
    
    async deleteUserFlow(uid, userId, devicesEncoded) {
        try {
            const devices = JSON.parse(decodeURIComponent(atob(devicesEncoded)));
            const devId = await this.promptDeviceSelection('Select Device to Delete User From:', devices);
            if (devId) {
                this.deleteUser(uid, userId, devId);
            }
        } catch (e) {
            this.showNotification('Error deleting user: ' + e.message, 'error');
        }
    },
    
    async editUserFlow(uid, userId, name, devicesEncoded, workPatternId) {
        try {
            const devices = JSON.parse(decodeURIComponent(atob(devicesEncoded)));
            const devId = await this.promptDeviceSelection('Select Device to Edit:', devices);
            if (devId) {
                this.editUser(uid, userId, name, devId, workPatternId);
            }
        } catch (e) {
            this.showNotification('Error editing user: ' + e.message, 'error');
        }
    },
    
    async deleteFingerDirectFlow(uid, userId, fingerIndex, devicesEncoded) {
        try {
            const devices = JSON.parse(decodeURIComponent(atob(devicesEncoded)));
            const devId = await this.promptDeviceSelection('Select Device to Delete Finger From:', devices);
            if (devId) {
                this.deleteFingerDirect(uid, userId, devId, fingerIndex);
            }
        } catch (e) {
            this.showNotification('Error: ' + e.message, 'error');
        }
    },
    
    async deleteAllFingersFlow(uid, userId, devicesEncoded) {
        try {
            const devices = JSON.parse(decodeURIComponent(atob(devicesEncoded)));
            const devId = await this.promptDeviceSelection('Select Device to Clear All Fingerprints From:', devices);
            if (devId) {
                this.deleteAllFingers(uid, userId, devId);
            }
        } catch (e) {
            this.showNotification('Error clearing fingers: ' + e.message, 'error');
        }
    },

    enrollFinger(uid, userId, devId) {
        document.getElementById('enroll-modal').classList.add('active');
        document.querySelectorAll('.finger-btn').forEach(btn => {
            btn.onclick = async () => {
                const fingerIndex = parseInt(btn.dataset.idx);
                document.getElementById('enroll-modal').classList.remove('active');
                const dev = this.devices.find(d => d.id == devId);
                if (dev) {
                    this.showNotification('Follow instructions on device sensor...', 'info');
                    await window.electronAPI.invoke('enroll-fingerprint', { ip: dev.ip, ports: [dev.port1, dev.port2], uid, userId, fingerIndex, deviceId: dev.id });
                }
            };
        });
        document.getElementById('cancel-enroll-btn').onclick = () => {
            document.getElementById('enroll-modal').classList.remove('active');
        };
    },

    async deleteAllFingers(uid, userId, devId) {
        if (!confirm(`Are you sure you want to delete ALL fingerprints for user ${userId}?`)) return;
        const dev = this.devices.find(d => d.id == devId);
        if (dev) {
            this.showNotification('Clearing all fingerprints...', 'info');
            const res = await window.electronAPI.invoke('delete-all-fingerprints', { ip: dev.ip, ports: [dev.port1, dev.port2], uid, userId, deviceId: dev.id });
            if (res.success) {
                this.showNotification('All fingerprints cleared');
                this.loadUsers();
            } else {
                this.showNotification('Failed: ' + res.error, 'error');
            }
        }
    },

    async deleteFingerDirect(uid, userId, devId, fingerIndex) {
        if (!confirm(`Delete Finger ${fingerIndex} for user ${userId}?`)) {
            return;
        }

        const dev = this.devices.find(d => d.id == devId);
        if (dev) {
            this.showNotification(`Deleting finger ${fingerIndex}...`, 'info');
            const res = await window.electronAPI.invoke('delete-user-fingerprint', { ip: dev.ip, ports: [dev.port1, dev.port2], uid, userId, fingerIndex, deviceId: dev.id });
            if (res.success) {
                this.showNotification(`Finger ${fingerIndex} deleted`);
                this.loadUsers();
            } else {
                this.showNotification('Failed: ' + res.error, 'error');
            }
        }
    },

    async deleteUser(uid, userId, devId) {
        if (confirm(`Delete user ${userId} from device?`)) {
            const dev = this.devices.find(d => d.id == devId);
            if (dev) {
                const res = await window.electronAPI.invoke('delete-user', { ip: dev.ip, ports: [dev.port1, dev.port2], uid, userId, deviceId: dev.id });
                if (res.success) { this.loadUsers(); this.showNotification('User deleted'); }
            }
        }
    },

    async saveUser() {
        const name = document.getElementById('user-name').value;
        const userId = document.getElementById('user-id').value;
        const role = document.getElementById('user-role').value;
        const wpEl = document.getElementById('user-work-pattern');
        let workPatternId = wpEl ? wpEl.value : null;
        if (workPatternId === "") workPatternId = null;

        let uid = null;
        const uidEl = document.getElementById('user-uid');
        if (uidEl && uidEl.value) uid = uidEl.value;

        // In Hybrid mode, device selection is via checkboxes
        const deviceCheckboxes = document.querySelectorAll('#user-target-devices-container input[type="checkbox"]:checked');
        let deviceIds = [];
        
        if (deviceCheckboxes.length > 0) {
            deviceIds = Array.from(deviceCheckboxes).map(cb => parseInt(cb.value));
        } else {
            // Fallback to select if checkboxes are not used (just in case)
            const selectEl = document.getElementById('user-target-device');
            if (selectEl && selectEl.value) {
                deviceIds = [parseInt(selectEl.value)];
            }
        }

        if (deviceIds.length === 0) {
            this.showNotification('Please select at least one device', 'error');
            return;
        }

        this.showNotification('Saving user...', 'info');

        const isEdit = !!uid;
        let success = true;

        for (const devId of deviceIds) {
            const dev = this.devices.find(d => d.id == devId);
            if (!dev) continue;

            const res = await window.electronAPI.invoke(isEdit ? 'update-user' : 'create-user', { 
                ip: dev.ip, 
                ports: [dev.port1, dev.port2], 
                uid: isEdit ? parseInt(uid) : null, 
                userId, 
                name, 
                role, 
                password: '', 
                deviceId: dev.id,
                work_pattern_id: workPatternId 
            });

            if (!res.success) {
                success = false;
                this.showNotification(`Failed on ${dev.name}: ` + res.error, 'error');
            }
        }

        if (success) {
            this.showNotification(isEdit ? 'User updated successfully!' : 'User created successfully!');
            this.resetUserForm();
            this.loadUsers();
        }
    },

    editUser(uid, userId, name, deviceId, workPatternId) {
        document.getElementById('user-name').value = name;
        document.getElementById('user-id').value = userId;
        
        let uidEl = document.getElementById('user-uid');
        if (!uidEl) {
            uidEl = document.createElement('input');
            uidEl.type = 'hidden';
            uidEl.id = 'user-uid';
            document.getElementById('add-user-form').appendChild(uidEl);
        }
        uidEl.value = uid;
        
        const wpEl = document.getElementById('user-work-pattern');
        if (wpEl) wpEl.value = workPatternId || "";
        
        const selectEl = document.getElementById('user-target-device');
        if (selectEl) {
            selectEl.value = deviceId;
        }

        const submitBtn = document.getElementById('user-submit-btn');
        if (submitBtn) submitBtn.innerText = 'Update User';
        
        const cancelBtn = document.getElementById('user-cancel-btn');
        if (cancelBtn) cancelBtn.style.display = 'inline-block';
        
        this.showPage('users'); // Ensure we are on the users page, form is at the top
        document.getElementById('add-user-form').scrollIntoView({ behavior: 'smooth' });
    },

    resetUserForm() {
        const form = document.getElementById('add-user-form');
        if (form) form.reset();
        
        const uidEl = document.getElementById('user-uid');
        if (uidEl) uidEl.value = '';
        
        const submitBtn = document.getElementById('user-submit-btn');
        if (submitBtn) submitBtn.innerText = 'Create User on Device';
        
        const cancelBtn = document.getElementById('user-cancel-btn');
        if (cancelBtn) cancelBtn.style.display = 'none';
        
        this.updateDeviceSelects(); // resets checkboxes to all checked
    },

    async addDevice() {
        const name = document.getElementById('device-name').value;
        const sn = document.getElementById('device-sn').value;
        const ip = document.getElementById('device-ip').value || '0.0.0.0';
        const port1 = parseInt(document.getElementById('device-port1').value) || 8088;
        const port2 = parseInt(document.getElementById('device-port2').value) || 8088;

        if (!name || !sn) {
            this.showNotification('Please enter name and Serial Number (SN)', 'error');
            return;
        }

        const res = await window.electronAPI.invoke('add-device', { name, sn, ip, port1, port2 });
        if (res.success) {
            this.showNotification('Device added successfully! Please wait for it to ping the server.');
            this.loadDevices();
            document.getElementById('device-name').value = '';
            document.getElementById('device-sn').value = '';
            document.getElementById('device-ip').value = '';
        } else {
            this.showNotification('Failed: ' + res.error, 'error');
        }
    },

    async deleteDevice(id) {
        if (confirm('Delete this device and its linked data?')) {
            await window.electronAPI.invoke('delete-device', id);
            this.loadDevices();
            this.showNotification('Device removed');
        }
    },

    async loadLogs() {
        const res = await window.electronAPI.invoke('get-logs', { 
            page: this.currentLogPage, 
            limit: this.logsPerPage,
            searchQuery: this.logsSearchQuery,
            filterDate: this.logsFilterDate
        });
        let logs = [];
        let totalCount = 0;
        
        if (Array.isArray(res)) {
            logs = res;
            totalCount = logs.length;
        } else if (res && res.logs) {
            logs = res.logs;
            totalCount = res.totalCount;
            this.currentLogPage = res.currentPage;
        }

        const tbody = document.querySelector('#logs-table tbody');
        if (!tbody) return;

        const getStatusBadge = (status) => {
            const s = parseInt(status);
            switch (s) {
                case 0:
                    return '<span class="status-badge online" style="background: rgba(34, 197, 94, 0.1); color: #4ade80; border: 1px solid rgba(34, 197, 94, 0.2);"><i class="fas fa-sign-in-alt mr-1"></i> Check-In</span>';
                case 1:
                    return '<span class="status-badge error" style="background: rgba(239, 68, 68, 0.1); color: #f87171; border: 1px solid rgba(239, 68, 68, 0.2);"><i class="fas fa-sign-out-alt mr-1"></i> Check-Out</span>';
                case 2:
                    return '<span class="status-badge warning" style="background: rgba(245, 158, 11, 0.1); color: #fbbf24; border: 1px solid rgba(245, 158, 11, 0.2);"><i class="fas fa-coffee mr-1"></i> Break-Out</span>';
                case 3:
                    return '<span class="status-badge info" style="background: rgba(59, 130, 246, 0.1); color: #60a5fa; border: 1px solid rgba(59, 130, 246, 0.2);"><i class="fas fa-laptop mr-1"></i> Break-In</span>';
                case 4:
                    return '<span class="status-badge" style="background: rgba(139, 92, 246, 0.1); color: #a78bfa; border: 1px solid rgba(139, 92, 246, 0.2);"><i class="fas fa-business-time mr-1"></i> OT In</span>';
                case 5:
                    return '<span class="status-badge" style="background: rgba(236, 72, 153, 0.1); color: #f472b6; border: 1px solid rgba(236, 72, 153, 0.2);"><i class="fas fa-business-time mr-1"></i> OT Out</span>';
                default:
                    return '<span class="status-badge online"><i class="fas fa-check mr-1"></i> Verified</span>';
            }
        };

        tbody.innerHTML = logs.slice(0, 100).map(l => `
            <tr class="hover:bg-slate-800/30">
                <td class="p-3 border-b border-slate-700 font-medium">${l.user_name}</td>
                <td class="p-3 border-b border-slate-700 text-slate-400">${l.user_id}</td>
                <td class="p-3 border-b border-slate-700">${new Date(l.timestamp).toLocaleString()}</td>
                <td class="p-3 border-b border-slate-700">
                    ${getStatusBadge(l.status)}
                </td>
                <td class="p-3 border-b border-slate-700" style="text-align: right;">
                    <button class="btn btn-icon btn-red btn-xs" onclick="app.deleteLog(${l.id})" title="Delete Log">
                        <i class="fas fa-trash"></i>
                    </button>
                </td>
            </tr>
        `).join('');

        this.renderLogPagination(totalCount);
    },

    renderLogPagination(total) {
        const info = document.getElementById('pagination-info');
        const prev = document.getElementById('prev-page-btn');
        const next = document.getElementById('next-page-btn');
        const numbersContainer = document.getElementById('page-numbers');

        if (!info || !prev || !next || !numbersContainer) return;

        const totalPages = Math.ceil(total / this.logsPerPage) || 1;
        const start = total === 0 ? 0 : (this.currentLogPage - 1) * this.logsPerPage + 1;
        const end = Math.min(this.currentLogPage * this.logsPerPage, total);

        info.innerText = `Showing ${start} to ${end} of ${total} entries`;

        prev.disabled = this.currentLogPage <= 1;
        next.disabled = this.currentLogPage >= totalPages;

        prev.onclick = () => {
            if (this.currentLogPage > 1) {
                this.currentLogPage--;
                this.loadLogs();
            }
        };

        next.onclick = () => {
            if (this.currentLogPage < totalPages) {
                this.currentLogPage++;
                this.loadLogs();
            }
        };

        let html = '';
        const maxPagesToShow = 5;
        let startPage = Math.max(1, this.currentLogPage - 2);
        let endPage = Math.min(totalPages, startPage + maxPagesToShow - 1);
        
        if (endPage - startPage < maxPagesToShow - 1) {
            startPage = Math.max(1, endPage - maxPagesToShow + 1);
        }

        for (let i = startPage; i <= endPage; i++) {
            const active = i === this.currentLogPage ? 'btn-primary' : 'btn-secondary';
            html += `<button class="btn ${active} btn-sm" style="padding: 4px 10px; font-size: 0.85rem;" onclick="app.currentLogPage = ${i}; app.loadLogs()">${i}</button>`;
        }
        numbersContainer.innerHTML = html;
    },

    async deleteLog(id) {
        if (!confirm('Are you sure you want to delete this attendance record?')) return;
        this.showNotification('Deleting attendance record...', 'info');
        const res = await window.electronAPI.invoke('delete-log', id);
        if (res.success) {
            this.showNotification('Attendance record deleted');
            this.loadLogs();
            this.loadDashboardStats();
        } else {
            this.showNotification('Failed: ' + res.error, 'error');
        }
    },

    async clearAllLogs() {
        if (!confirm('⚠️ WARNING: This will permanently delete ALL attendance records from the local database! Are you absolutely sure?')) return;
        this.showNotification('Clearing all attendance logs...', 'info');
        const res = await window.electronAPI.invoke('clear-all-logs');
        if (res.success) {
            this.showNotification('All local attendance logs cleared successfully');
            this.loadLogs();
            this.loadDashboardStats();
        } else {
            this.showNotification('Failed: ' + res.error, 'error');
        }
    },

    showNotification(msg, type = 'success') {
        document.querySelectorAll('.notification-toast').forEach(t => t.remove());

        const toast = document.createElement('div');
        toast.className = `notification-toast ${type}`;
        toast.innerHTML = `
            <i class="fas ${type === 'success' ? 'fa-check-circle' : 'fa-info-circle'}"></i>
            <span>${msg}</span>
        `;
        document.body.appendChild(toast);
        setTimeout(() => toast?.remove(), 4000);
    },

    async testConn(sn, ip) {
        this.showNotification('Checking device status...', 'info');
        const res = await window.electronAPI.invoke('test-device-connection', { sn, ip });
        if (res.success) this.showNotification('Device is Online!');
        else this.showNotification(res.error || 'Device is Offline', 'error');
    },

    startStatusPolling() {
        setInterval(async () => {
            for (const d of this.devices) {
                const res = await window.electronAPI.invoke('test-device-connection', { sn: d.sn, ip: d.ip });
                const el = document.getElementById(`status-${d.id}`);
                if (el) {
                    el.className = `status-badge ${res.success ? 'online' : 'offline'}`;
                    el.innerText = res.success ? 'Online' : 'Offline';
                }
            }
        }, 15000);
    },

    async rebootAllDevices() {
        if (!confirm('Reboot all devices now?')) return;
        this.showNotification('Rebooting...', 'info');
        await window.electronAPI.invoke('reboot-all-devices');
    },

    async clearDeviceLogs() {
        if (!confirm('⚠️ WARNING: Are you sure you want to delete and clear ALL attendance logs inside the ZKTeco hardware device memory? This cannot be undone!')) return;
        if (!confirm('🚨 FINAL CONFIRMATION: Double check if you have synchronized all logs to your local database before clearing the hardware. Proceed?')) return;

        const statusEl = document.getElementById('sync-time-status');
        if (statusEl) statusEl.innerHTML = 'Clearing terminal logs... ⏳';

        this.showNotification('Cleaning device hardware memory...', 'warning');
        const res = await window.electronAPI.invoke('clear-device-logs');

        let success = true;
        let errMsg = '';
        if (Array.isArray(res)) {
            success = res.every(r => r.success);
            errMsg = res.map(r => r.error).filter(Boolean).join(', ');
        } else {
            success = false;
            errMsg = 'Connection error';
        }

        if (success) {
            this.showNotification('ZK terminal logs cleared successfully! 🧹');
            if (statusEl) statusEl.innerHTML = 'ZK Device logs cleared successfully! 🟢';
        } else {
            this.showNotification('Failed to clear logs: ' + errMsg, 'error');
            if (statusEl) statusEl.innerHTML = 'Failed to clear device logs: ' + errMsg + ' 🔴';
        }
    },

    async syncAllClocks() {
        const statusEl = document.getElementById('sync-time-status');
        if (statusEl) statusEl.innerHTML = 'Syncing...';
        await window.electronAPI.invoke('sync-all-times');
        this.showNotification('Clocks synchronized');
        if (statusEl) statusEl.innerHTML = '';
    },

    async setManualTime() {
        const inputVal = document.getElementById('manual-datetime-input').value;
        if (!inputVal) {
            this.showNotification('Please select a date and time first', 'error');
            return;
        }

        const statusEl = document.getElementById('sync-time-status');
        if (statusEl) statusEl.innerHTML = 'Setting manual time...';

        this.showNotification('Programming custom time...', 'info');
        const res = await window.electronAPI.invoke('set-custom-time', inputVal);

        let success = true;
        let errMsg = '';
        if (Array.isArray(res)) {
            success = res.every(r => r.success);
            errMsg = res.map(r => r.error).filter(Boolean).join(', ');
        } else {
            success = false;
            errMsg = 'Connection error';
        }

        if (success) {
            this.showNotification('Device clock set successfully!');
            if (statusEl) statusEl.innerHTML = 'Manual time programmed successfully! 🟢';
        } else {
            this.showNotification('Failed to set time: ' + errMsg, 'error');
            if (statusEl) statusEl.innerHTML = 'Failed: ' + errMsg + ' 🔴';
        }
    },

    async loadStrategyMode() {
        const statusEl = document.getElementById('program-auto-status');
        if (statusEl) statusEl.innerHTML = '<i class="fas fa-spinner fa-spin mr-1"></i> Loading logging strategy...';

        try {
            const res = await window.electronAPI.invoke('get-calc-mode');
            if (res.success) {
                const el = document.getElementById('setting-calc-mode');
                if (el) {
                    el.value = res.mode;
                    this.updateStrategyExplanation();
                }
                if (statusEl) statusEl.innerHTML = '<span style="color: #4ade80"><i class="fas fa-check-circle mr-1"></i> Strategy loaded successfully</span>';
            } else {
                if (statusEl) statusEl.innerHTML = `<span style="color: #f87171"><i class="fas fa-exclamation-triangle mr-1"></i> Failed to load settings</span>`;
            }
        } catch (err) {
            if (statusEl) statusEl.innerHTML = `<span style="color: #f87171"><i class="fas fa-exclamation-triangle mr-1"></i> Connection failed</span>`;
        }
    },

    updateStrategyExplanation() {
        const selectEl = document.getElementById('setting-calc-mode');
        if (!selectEl) return;
        const mode = selectEl.value;
        const explanationEl = document.getElementById('strategy-explanation');
        if (!explanationEl) return;

        if (mode === 'calculated') {
            explanationEl.innerHTML = `
                <strong>🤖 Smart Calculation Mode (Recommended):</strong><br>
                The app dynamically calculates attendance status based on daily punches. The first punch of the day is marked as <strong>Check-In (Arrivée)</strong> and the last punch as <strong>Check-Out (Départ)</strong>.<br>
                <span class="text-green-400 mt-1 block"><i class="fas fa-shield-alt"></i> The device screen remains clean and simple without any confusing status words.</span>
            `;
        } else {
            explanationEl.innerHTML = `
                <strong>👤 Device Keypad Selection Mode (Manual):</strong><br>
                Employees must manually press the <strong>F1</strong> (Arrivée) or <strong>F2</strong> (Départ) keys on the device physical keypad before punching their finger.<br>
                <span class="text-yellow-400 mt-1 block"><i class="fas fa-exclamation-triangle"></i> Status buttons display on the screen. Employees must remember to select their status.</span>
            `;
        }
    },

    async saveStrategyMode() {
        const selectEl = document.getElementById('setting-calc-mode');
        if (!selectEl) return;
        const mode = selectEl.value;

        const statusEl = document.getElementById('program-auto-status');
        if (statusEl) statusEl.innerHTML = '<i class="fas fa-spinner fa-spin mr-1"></i> Applying strategy to device...';

        this.showNotification('Saving strategy settings...', 'info');

        try {
            const res = await window.electronAPI.invoke('save-calc-mode', mode);
            if (res.success) {
                this.showNotification('Attendance strategy applied successfully!');
                if (statusEl) statusEl.innerHTML = '<span style="color: #4ade80"><i class="fas fa-check-circle mr-1"></i> Strategy applied successfully!</span>';

                // Refresh logs and dashboard stats instantly
                this.loadDashboardStats();
            } else {
                this.showNotification('Failed to apply strategy: ' + res.error, 'error');
                if (statusEl) statusEl.innerHTML = `<span style="color: #f87171"><i class="fas fa-exclamation-triangle mr-1"></i> ${res.error}</span>`;
            }
        } catch (err) {
            this.showNotification('Connection error: ' + err.message, 'error');
            if (statusEl) statusEl.innerHTML = '<span style="color: #f87171"><i class="fas fa-exclamation-triangle mr-1"></i> Connection failed</span>';
        }
    },

    async loadAdmsPort() {
        try {
            const res = await window.electronAPI.invoke('get-adms-port');
            if (res.success) {
                const portInput = document.getElementById('setting-adms-port');
                if (portInput) portInput.value = res.port;
            }
        } catch (err) {
            console.error('Failed to load ADMS port:', err);
        }
    },

    async applyAdmsPort() {
        const portInput = document.getElementById('setting-adms-port');
        if (!portInput || !portInput.value) return;

        const port = parseInt(portInput.value);
        if (port < 1 || port > 65535) {
            this.showNotification('Invalid port number.', 'error');
            return;
        }

        const statusEl = document.getElementById('adms-port-status');
        if (statusEl) statusEl.innerHTML = '<i class="fas fa-spinner fa-spin mr-1"></i> Saving port...';

        try {
            const res = await window.electronAPI.invoke('set-adms-port', port);
            if (res.success) {
                this.showNotification(res.message || 'Port updated successfully.', 'success');
                if (statusEl) statusEl.innerHTML = `<span style="color: #4ade80"><i class="fas fa-check mr-1"></i> ${res.message}</span>`;
            } else {
                this.showNotification('Failed to update port/firewall: ' + res.error, 'error');
                if (statusEl) statusEl.innerHTML = `<span style="color: #f87171"><i class="fas fa-exclamation-triangle mr-1"></i> ${res.error}</span>`;
            }
        } catch (err) {
            this.showNotification('Connection error: ' + err.message, 'error');
            if (statusEl) statusEl.innerHTML = `<span style="color: #f87171"><i class="fas fa-exclamation-triangle mr-1"></i> Connection failed</span>`;
        }
    },

    async loadDefaultShiftSettings() {
        try {
            const res = await window.electronAPI.invoke('get-default-shift');
            if (res.success) {
                this.defaultStartTime = res.start_time || '08:00';
                this.defaultEndTime = res.end_time || '17:00';
                
                // Populate on Settings page if inputs exist
                const startInput = document.getElementById('setting-default-start');
                const endInput = document.getElementById('setting-default-end');
                if (startInput) startInput.value = this.defaultStartTime;
                if (endInput) endInput.value = this.defaultEndTime;
                
                // Populate on Reports page as default fallback
                const reportStartInput = document.getElementById('report-start-time');
                const reportEndInput = document.getElementById('report-end-time');
                if (reportStartInput) reportStartInput.value = this.defaultStartTime;
                if (reportEndInput) reportEndInput.value = this.defaultEndTime;
            }
        } catch (err) {
            console.error('Failed to load default shift settings:', err);
        }
    },

    async saveDefaultShiftSettings() {
        const startInput = document.getElementById('setting-default-start');
        const endInput = document.getElementById('setting-default-end');
        if (!startInput || !endInput) return;
        
        const start_time = startInput.value;
        const end_time = endInput.value;
        
        const statusEl = document.getElementById('default-shift-status');
        if (statusEl) statusEl.innerHTML = '<i class="fas fa-spinner fa-spin mr-1"></i> Saving default shift settings...';
        
        this.showNotification('Saving default shift...', 'info');
        
        try {
            const res = await window.electronAPI.invoke('save-default-shift', { start_time, end_time });
            if (res.success) {
                this.defaultStartTime = start_time;
                this.defaultEndTime = end_time;
                
                // Update report inputs as well
                const reportStartInput = document.getElementById('report-start-time');
                const reportEndInput = document.getElementById('report-end-time');
                if (reportStartInput) reportStartInput.value = start_time;
                if (reportEndInput) reportEndInput.value = end_time;
                
                this.showNotification('Default shift settings saved successfully!');
                if (statusEl) statusEl.innerHTML = '<span style="color: #4ade80"><i class="fas fa-check-circle mr-1"></i> Default shift saved successfully!</span>';
                
                // Instantly re-render the scheduler grid so the option label updates
                await this.renderDailyScheduler();
            } else {
                this.showNotification('Failed to save default shift: ' + res.error, 'error');
                if (statusEl) statusEl.innerHTML = `<span style="color: #f87171"><i class="fas fa-exclamation-triangle mr-1"></i> ${res.error}</span>`;
            }
        } catch (err) {
            this.showNotification('Connection error: ' + err.message, 'error');
            if (statusEl) statusEl.innerHTML = '<span style="color: #f87171"><i class="fas fa-exclamation-triangle mr-1"></i> Connection failed</span>';
        }
    },

    setReportToday() {
        const el = document.getElementById('report-date');
        if (el) el.value = new Date().toISOString().split('T')[0];
    },

    initReportsPage() {
        const dateInput = document.getElementById('report-date');
        if (dateInput && !dateInput.value) {
            dateInput.value = new Date().toISOString().split('T')[0];
        }
        const monthInput = document.getElementById('report-month');
        if (monthInput && !monthInput.value) {
            const now = new Date();
            const y = now.getFullYear();
            const m = String(now.getMonth() + 1).padStart(2, '0');
            monthInput.value = `${y}-${m}`;
        }
        const yearSelect = document.getElementById('report-year');
        if (yearSelect && !yearSelect.value) {
            yearSelect.value = String(new Date().getFullYear());
        }
        const startDateInput = document.getElementById('report-start-date');
        if (startDateInput && !startDateInput.value) {
            startDateInput.value = new Date().toISOString().split('T')[0];
        }
        const endDateInput = document.getElementById('report-end-date');
        if (endDateInput && !endDateInput.value) {
            endDateInput.value = new Date().toISOString().split('T')[0];
        }
        this.renderReportTableHeader();
    },

    toggleReportPeriodInputs() {
        const mode = document.getElementById('report-mode').value;
        const dateGroup = document.getElementById('report-date-group');
        const monthGroup = document.getElementById('report-month-group');
        const yearGroup = document.getElementById('report-year-group');
        const rangeGroup = document.getElementById('report-range-group');
        
        if (dateGroup) dateGroup.style.display = mode === 'day' ? 'block' : 'none';
        if (monthGroup) monthGroup.style.display = mode === 'month' ? 'block' : 'none';
        if (yearGroup) yearGroup.style.display = mode === 'year' ? 'block' : 'none';
        if (rangeGroup) rangeGroup.style.display = mode === 'range' ? 'block' : 'none';
        
        this.renderReportTableHeader();
    },

    renderReportTableHeader() {
        const mode = document.getElementById('report-mode') ? document.getElementById('report-mode').value : 'day';
        const thead = document.querySelector('#late-report-table thead');
        if (!thead) return;
        
        const trans = this.translations[this.currentLang || 'en'] || this.translations.en;
        
        if (mode === 'day') {
            thead.innerHTML = `
                <tr>
                    <th class="p-3 border-b border-slate-700">${trans.col_employee}</th>
                    <th class="p-3 border-b border-slate-700">${trans.col_first_punch}</th>
                    <th class="p-3 border-b border-slate-700">${trans.col_last_punch}</th>
                    <th class="p-3 border-b border-slate-700">${trans.col_expected}</th>
                    <th class="p-3 border-b border-slate-700">${trans.col_delay}</th>
                    <th class="p-3 border-b border-slate-700">${trans.work_hrs}</th>
                    <th class="p-3 border-b border-slate-700">${trans.col_status}</th>
                </tr>
            `;
        } else {
            thead.innerHTML = `
                <tr>
                    <th class="p-3 border-b border-slate-700">${trans.col_employee}</th>
                    <th class="p-3 border-b border-slate-700">${trans.col_work_days}</th>
                    <th class="p-3 border-b border-slate-700">${trans.col_present_days}</th>
                    <th class="p-3 border-b border-slate-700">${trans.col_absent_days}</th>
                    <th class="p-3 border-b border-slate-700">${trans.col_late_days}</th>
                    <th class="p-3 border-b border-slate-700">${trans.col_total_delay}</th>
                    <th class="p-3 border-b border-slate-700">${trans.col_worked_hours}</th>
                    <th class="p-3 border-b border-slate-700">${trans.col_action}</th>
                </tr>
            `;
        }
    },

    async generateLateReport() {
        const mode = document.getElementById('report-mode').value;
        const date = document.getElementById('report-date').value;
        const month = document.getElementById('report-month').value;
        const year = document.getElementById('report-year').value;
        const startTime = document.getElementById('report-start-time').value;
        const endTime = document.getElementById('report-end-time').value;
        
        const startDateParam = document.getElementById('report-start-date') ? document.getElementById('report-start-date').value : '';
        const endDateParam = document.getElementById('report-end-date') ? document.getElementById('report-end-date').value : '';

        if (mode === 'day' && !date) {
            this.showNotification('يرجى اختيار التاريخ أولاً', 'warning');
            return;
        }
        if (mode === 'month' && !month) {
            this.showNotification('يرجى اختيار الشهر أولاً', 'warning');
            return;
        }
        if (mode === 'range') {
            if (!startDateParam || !endDateParam) {
                this.showNotification('يرجى اختيار تاريخ البدء وتاريخ الانتهاء أولاً', 'warning');
                return;
            }
            if (new Date(startDateParam) > new Date(endDateParam)) {
                this.showNotification('تاريخ البدء لا يمكن أن يكون بعد تاريخ الانتهاء', 'warning');
                return;
            }
        }

        const tbody = document.querySelector('#late-report-table tbody');
        if (tbody) tbody.innerHTML = '<tr><td colspan="8" class="text-center p-4"><i class="fas fa-spinner fa-spin mr-1"></i> جاري احتساب التقرير والورديات...</td></tr>';
        
        const kpiRow = document.getElementById('reports-kpi-row');
        if (kpiRow) kpiRow.style.display = 'none';

        try {
            const report = await window.electronAPI.invoke('get-late-report', { 
                date, 
                startTime, 
                endTime, 
                mode, 
                month, 
                year,
                startDateParam,
                endDateParam
            });
            this.currentReport = report || [];

            const searchInput = document.getElementById('report-search-input');
            if (searchInput) searchInput.value = '';
            const filterSelect = document.getElementById('report-status-filter');
            if (filterSelect) filterSelect.value = 'all';

            this.reportsPage = 1;
            this.currentFilteredReport = this.currentReport;
            this.renderLateReportTable();
            this.calculateAndRenderKPIs(this.currentReport, mode);
        } catch (err) {
            console.error(err);
            if (tbody) tbody.innerHTML = '<tr><td colspan="8" class="text-center p-4 text-red-500">فشل في إنشاء التقرير</td></tr>';
        }
    },

    calculateAndRenderKPIs(reportData, mode) {
        const kpiRow = document.getElementById('reports-kpi-row');
        if (!kpiRow) return;
        
        if (!reportData || reportData.length === 0) {
            kpiRow.style.display = 'none';
            return;
        }

        let totalWorkingDays = 0;
        let totalPresentDays = 0;
        let totalAbsentDays = 0;
        let totalLateDays = 0;
        let totalDelayMinutes = 0;
        let totalWorkedHours = 0;

        if (mode === 'day') {
            reportData.forEach(r => {
                if (r.status !== 'Off Day') {
                    totalWorkingDays++;
                    if (r.status === 'Absent') {
                        totalAbsentDays++;
                    } else {
                        totalPresentDays++;
                        if (r.status === 'Late') {
                            totalLateDays++;
                            const mins = parseInt(r.delay) || 0;
                            totalDelayMinutes += mins;
                        }
                        const hrs = parseFloat(r.worked) || 0;
                        totalWorkedHours += hrs;
                    }
                }
            });
        } else {
            reportData.forEach(r => {
                totalWorkingDays += r.totalDays || 0;
                totalPresentDays += r.presentDays || 0;
                totalAbsentDays += r.absentDays || 0;
                totalLateDays += r.lateDays || 0;
                totalDelayMinutes += r.totalDelayMins || 0;
                totalWorkedHours += parseFloat(r.totalWorkedHrs) || 0;
            });
        }

        const attendanceRate = totalWorkingDays > 0 
            ? ((totalPresentDays / totalWorkingDays) * 100).toFixed(1) 
            : '0.0';

        const trans = this.translations[this.currentLang || 'en'] || this.translations.en;

        kpiRow.style.display = 'grid';
        kpiRow.innerHTML = `
            <div class="kpi-card" style="border-left: 4px solid var(--success);">
                <div class="kpi-icon" style="background: rgba(16, 185, 129, 0.1); color: var(--success);">
                    <i class="fas fa-percentage"></i>
                </div>
                <div class="kpi-info">
                    <span class="kpi-title">${trans.rate_attendance}</span>
                    <span class="kpi-value">${attendanceRate}%</span>
                    <span class="kpi-sub">${totalPresentDays} / ${totalWorkingDays} ${trans.col_work_days}</span>
                </div>
            </div>

            <div class="kpi-card" style="border-left: 4px solid var(--accent-primary);">
                <div class="kpi-icon" style="background: rgba(99, 102, 241, 0.1); color: var(--accent-primary);">
                    <i class="fas fa-user-check"></i>
                </div>
                <div class="kpi-info">
                    <span class="kpi-title">${trans.rate_present}</span>
                    <span class="kpi-value">${totalPresentDays} <span style="font-size:0.8rem; font-weight:normal; color:var(--text-muted)">${trans.day_label}</span></span>
                    <span class="kpi-sub">${trans.col_worked_hours}: ${totalWorkedHours.toFixed(1)} hrs</span>
                </div>
            </div>

            <div class="kpi-card" style="border-left: 4px solid var(--danger);">
                <div class="kpi-icon" style="background: rgba(239, 68, 68, 0.1); color: var(--danger);">
                    <i class="fas fa-user-times"></i>
                </div>
                <div class="kpi-info">
                    <span class="kpi-title">${trans.rate_absent}</span>
                    <span class="kpi-value">${totalAbsentDays} <span style="font-size:0.8rem; font-weight:normal; color:var(--text-muted)">${trans.day_label}</span></span>
                    <span class="kpi-sub">${trans.rate_absent}: ${totalWorkingDays > 0 ? ((totalAbsentDays / totalWorkingDays) * 100).toFixed(1) : 0}%</span>
                </div>
            </div>

            <div class="kpi-card" style="border-left: 4px solid var(--warning);">
                <div class="kpi-icon" style="background: rgba(245, 158, 11, 0.1); color: var(--warning);">
                    <i class="fas fa-hourglass-half"></i>
                </div>
                <div class="kpi-info">
                    <span class="kpi-title">${trans.rate_late}</span>
                    <span class="kpi-value">${totalLateDays}</span>
                    <span class="kpi-sub">${trans.col_total_delay}: ${totalDelayMinutes} mins</span>
                </div>
            </div>
        `;
    },

    renderLateReportTable(reportData = this.currentFilteredReport) {
        const tbody = document.querySelector('#late-report-table tbody');
        if (!tbody) return;

        const trans = this.translations[this.currentLang || 'en'] || this.translations.en;
        
        const infoEl = document.getElementById('reports-page-info');

        if (!reportData || reportData.length === 0) {
            tbody.innerHTML = `<tr><td colspan="8" class="text-center p-4 text-slate-500">${trans.no_records}</td></tr>`;
            if (infoEl) infoEl.innerText = 'Showing 0 to 0 of 0 entries';
            return;
        }

        const totalItems = reportData.length;
        const totalPages = Math.ceil(totalItems / this.reportsPerPage) || 1;
        
        if (this.reportsPage > totalPages) this.reportsPage = totalPages;
        if (this.reportsPage < 1) this.reportsPage = 1;

        const startIndex = (this.reportsPage - 1) * this.reportsPerPage;
        const endIndex = Math.min(startIndex + this.reportsPerPage, totalItems);
        
        const currentData = reportData.slice(startIndex, endIndex);

        if (infoEl) {
            infoEl.innerText = `Showing ${startIndex + 1} to ${endIndex} of ${totalItems} entries`;
        }

        const mode = document.getElementById('report-mode') ? document.getElementById('report-mode').value : 'day';
        const startTime = document.getElementById('report-start-time').value;

        if (mode === 'day') {
            tbody.innerHTML = currentData.map(r => {
                const statusClass = r.status === 'Late' ? 'text-red-500 font-bold' :
                    (r.status === 'On Time' ? 'text-green-500 font-bold' : 
                     (r.status === 'Off Day' ? 'text-blue-400 font-semibold' : 'text-gray-400'));

                let arStatus = r.status;
                if (r.status === 'Late') arStatus = trans.status_late;
                if (r.status === 'On Time') arStatus = trans.status_on_time;
                if (r.status === 'Absent') arStatus = trans.status_absent;
                if (r.status === 'Off Day') arStatus = trans.status_off_day;

                return `
                    <tr class="hover:bg-slate-800/50 transition-colors">
                        <td class="p-3 border-b border-slate-700">
                            <div class="font-medium">${r.name}</div>
                            <div class="text-xs text-slate-500">ID: ${r.user_id || '--'}</div>
                        </td>
                        <td class="p-3 border-b border-slate-700 font-mono">${r.first}</td>
                        <td class="p-3 border-b border-slate-700 font-mono">${r.last}</td>
                        <td class="p-3 border-b border-slate-700 text-slate-400 text-xs">${r.expected || startTime}</td>
                        <td class="p-3 border-b border-slate-700 ${r.status === 'Late' ? 'text-orange-400' : ''}">${r.delay}</td>
                        <td class="p-3 border-b border-slate-700 font-mono">${r.worked}</td>
                        <td class="p-3 border-b border-slate-700">
                            <span class="${statusClass}">${arStatus}</span>
                        </td>
                    </tr>
                `;
            }).join('');
        } else {
            tbody.innerHTML = currentData.map((r, index) => {
                const uniqueId = `drawer-${r.user_id}-${index}`;
                const hasAbsent = r.absentDays > 0;
                const hasLate = r.lateDays > 0;
                
                const detailsHtml = r.dailyDetails.map(d => {
                    const statusClass = d.status === 'Late' ? 'text-red-500 font-bold' :
                        (d.status === 'On Time' ? 'text-green-500 font-bold' : 
                         (d.status === 'Off Day' ? 'text-blue-400 font-semibold' : 'text-gray-400'));
                    
                    let arStatus = d.status;
                    if (d.status === 'Late') arStatus = trans.status_late;
                    if (d.status === 'On Time') arStatus = trans.status_on_time;
                    if (d.status === 'Absent') arStatus = trans.status_absent;
                    if (d.status === 'Off Day') arStatus = trans.status_off_day;

                    return `
                        <tr>
                            <td class="font-mono text-xs">${d.date}</td>
                            <td><span class="text-xs text-slate-400">${d.expected}</span></td>
                            <td class="font-mono">${d.first}</td>
                            <td class="font-mono">${d.last}</td>
                            <td class="${d.status === 'Late' ? 'text-orange-400' : ''}">${d.delay}</td>
                            <td class="font-mono">${d.worked}</td>
                            <td><span class="${statusClass}">${arStatus}</span></td>
                        </tr>
                    `;
                }).join('');

                return `
                    <tr class="clickable-row hover:bg-slate-800/30 transition-colors" onclick="app.toggleDetailDrawer('${uniqueId}', this)">
                        <td class="p-3 border-b border-slate-700">
                            <div class="font-medium">${r.name}</div>
                            <div class="text-xs text-slate-500">ID: ${r.user_id || '--'}</div>
                        </td>
                        <td class="p-3 border-b border-slate-700 font-mono">${r.totalDays} <span style="font-size:0.75rem; color:var(--text-muted)">${trans.day_label}</span></td>
                        <td class="p-3 border-b border-slate-700 font-mono text-green-400 font-bold">${r.presentDays}</td>
                        <td class="p-3 border-b border-slate-700 font-mono ${hasAbsent ? 'text-red-400 font-bold' : 'text-slate-500'}">${r.absentDays}</td>
                        <td class="p-3 border-b border-slate-700 font-mono ${hasLate ? 'text-yellow-500 font-bold' : 'text-slate-500'}">${r.lateDays}</td>
                        <td class="p-3 border-b border-slate-700 font-mono ${hasLate ? 'text-orange-400' : 'text-slate-400'}">+${r.totalDelayMins} mins</td>
                        <td class="p-3 border-b border-slate-700 font-mono font-bold text-indigo-300">${r.totalWorkedHrs} hrs</td>
                        <td class="p-3 border-b border-slate-700">
                            <button class="btn btn-outline" style="padding: 4px 10px; font-size:0.75rem; border-radius: 6px; display:flex; align-items:center; gap:5px">
                                ${trans.details_btn} <i class="fas fa-chevron-down chevron-icon"></i>
                            </button>
                        </td>
                    </tr>
                    <tr id="${uniqueId}" class="detail-drawer-row">
                        <td colspan="8" class="p-0 border-b border-slate-700">
                            <div class="detail-drawer-container">
                                <div class="drawer-title">
                                    <i class="fas fa-calendar-day"></i> ${trans.employee_daily_schedule_title} <strong>${r.name}</strong> (ID: ${r.user_id})
                                </div>
                                <div class="table-container" style="max-height: 250px; overflow-y: auto; background: rgba(0,0,0,0.2); border-radius:10px; border: 1px solid rgba(255,255,255,0.03);">
                                    <table class="drawer-table">
                                        <thead>
                                            <tr>
                                                <th style="padding: 8px 12px; text-align: left;">${trans.date_label}</th>
                                                <th style="padding: 8px 12px; text-align: left;">${trans.shift_label}</th>
                                                <th style="padding: 8px 12px; text-align: left;">${trans.col_first_punch}</th>
                                                <th style="padding: 8px 12px; text-align: left;">${trans.col_last_punch}</th>
                                                <th style="padding: 8px 12px; text-align: left;">${trans.col_delay}</th>
                                                <th style="padding: 8px 12px; text-align: left;">${trans.work_hrs}</th>
                                                <th style="padding: 8px 12px; text-align: left;">${trans.col_status}</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            ${detailsHtml}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        </td>
                    </tr>
                `;
            }).join('');
        }
    },

    toggleDetailDrawer(drawerId, rowEl) {
        const drawer = document.getElementById(drawerId);
        if (!drawer) return;
        
        const isCollapsed = !drawer.classList.contains('active');
        
        document.querySelectorAll('.detail-drawer-row.active').forEach(d => {
            if (d.id !== drawerId) {
                d.classList.remove('active');
                const parentRow = d.previousElementSibling;
                if (parentRow) {
                    const icon = parentRow.querySelector('.chevron-icon');
                    if (icon) icon.classList.remove('chevron-rotated');
                }
            }
        });

        if (isCollapsed) {
            drawer.classList.add('active');
            const icon = rowEl.querySelector('.chevron-icon');
            if (icon) icon.classList.add('chevron-rotated');
        } else {
            drawer.classList.remove('active');
            const icon = rowEl.querySelector('.chevron-icon');
            if (icon) icon.classList.remove('chevron-rotated');
        }
    },

    filterLateReport() {
        const searchInput = document.getElementById('report-search-input');
        const filterSelect = document.getElementById('report-status-filter');
        if (!Array.isArray(this.currentReport)) return;

        const query = searchInput ? searchInput.value.toLowerCase().trim() : '';
        const statusFilter = filterSelect ? filterSelect.value : 'all';

        const filtered = this.currentReport.filter(r => {
            const nameMatch = r.name && r.name.toLowerCase().includes(query);
            const idMatch = r.user_id && r.user_id.toString().toLowerCase().includes(query);
            const matchesQuery = !query || nameMatch || idMatch;

            let matchesStatus = true;
            if (statusFilter !== 'all') {
                if (r.status !== undefined) {
                    matchesStatus = r.status === statusFilter;
                } else {
                    if (statusFilter === 'Late') {
                        matchesStatus = r.lateDays > 0;
                    } else if (statusFilter === 'On Time') {
                        matchesStatus = r.presentDays > 0 && r.lateDays === 0;
                    } else if (statusFilter === 'Absent') {
                        matchesStatus = r.absentDays > 0;
                    }
                }
            }

            return matchesQuery && matchesStatus;
        });

        this.reportsPage = 1;
        this.currentFilteredReport = filtered;
        this.renderLateReportTable();
        
        const mode = document.getElementById('report-mode') ? document.getElementById('report-mode').value : 'day';
        this.calculateAndRenderKPIs(filtered, mode);
    },

    prevReportsPage() {
        if (this.reportsPage > 1) {
            this.reportsPage--;
            this.renderLateReportTable();
        }
    },

    nextReportsPage() {
        const totalPages = Math.ceil((this.currentFilteredReport || []).length / this.reportsPerPage) || 1;
        if (this.reportsPage < totalPages) {
            this.reportsPage++;
            this.renderLateReportTable();
        }
    },

    translations: {
        en: {
            dashboard: "Dashboard",
            subtitle_dashboard: "Welcome back, manager.",
            users: "Manage Employees",
            subtitle_users: "Create, update and enroll employee fingerprints.",
            schedules: "Shifts & Schedules",
            subtitle_schedules: "Define working shifts and assign daily or weekly schedules.",
            logs: "Attendance Logs",
            subtitle_logs: "View, search and sync biometric check-in history.",
            devices: "Manage Devices",
            subtitle_devices: "Register and configure ZKTeco terminal hardware.",
            reports: "Late Reports",
            subtitle_reports: "Analyze shift records, working hours and lateness delays.",
            settings: "Settings",
            subtitle_settings: "Adjust terminal clock synchronization and system preferences.",
            sync_btn: "Sync All Devices",
            syncing: "Syncing...",
            
            // Dashboard
            total_employees: "Total Employees",
            total_fingerprints: "Total Fingerprints",
            today_punches: "Today Punches",
            total_logs: "Total Logs",
            hardware_overview: "Hardware Overview (Live)",
            users_on_device: "Users on Device",
            fingers_on_device: "Fingerprints on Device",
            logs_on_device: "Attendance Logs on Device",
            attendance_trend: "Attendance Trend",
            last_7_days: "Last 7 Days",
            recent_activity: "Recent Activity",
            view_all: "View All",
            col_employee: "Employee",
            col_id: "ID",
            col_time: "Time",
            col_device: "Device",
            
            // Employees
            add_new_employee: "Add New Employee",
            full_name: "Full Name",
            hardware_id: "Hardware ID (UID)",
            target_device: "Target Device",
            role: "Role",
            role_user: "Regular User",
            role_admin: "Administrator",
            btn_cancel: "Cancel",
            btn_create_user: "Create User on Device",
            employee_directory: "Employee Directory",
            search_employees_placeholder: "Search employees...",
            btn_fetch_all: "Fetch All",
            btn_sync_bio: "Sync Bio",
            col_name: "Name",
            col_bio_status: "Bio Status",
            col_card_number: "Card Number",
            col_actions: "Actions",
            
            // Schedules
            tab_define_shifts: "Define Shifts",
            tab_daily_assignments: "Daily Assignments",
            tab_bulk_scheduling: "Bulk Scheduling",
            define_new_shift: "Define New Shift",
            shift_name: "Shift Name",
            shift_name_placeholder: "e.g. Morning Shift / Afternoon Shift",
            shift_start: "Start Time",
            shift_end: "End Time",
            btn_save_shift: "Save Shift",
            defined_shifts: "Defined Shifts",
            shifts_explanation: "Here you can manage your work shifts. Deleting a shift will revert any employees currently assigned to it back to the default work schedule.",
            daily_assignments_desc: "Assign work shifts or off days to employees on a day-by-day basis. Changes are saved automatically.",
            select_date: "Select Date:",
            bulk_step1: "Step 1: Select Employees & Dates",
            date_range: "Date Range",
            start_date: "Start Date",
            end_date: "End Date",
            target_employees: "Target Employees",
            btn_select_all: "Select All",
            btn_clear_selection: "Clear Selection",
            bulk_step2: "Step 2: Assign & Apply",
            bulk_explanation: "Bulk schedule allows you to overwrite the shifts of multiple employees across a chosen period of time. This is perfect for setting weekends or assigning team shifts.",
            select_shift_or_off: "Select Work Shift / Off Day",
            option_off_day: "Off Day / Weekend",
            btn_apply_bulk: "Apply Bulk Schedule",
            
            // Logs
            attendance_records: "Attendance Records",
            select_device: "Select Device",
            from_date: "From Date",
            to_date: "To Date",
            search_logs_placeholder: "Search logs...",
            btn_pull_logs: "Pull Device Logs",
            btn_clear_filters: "Clear Filters",
            col_timestamp: "Timestamp",
            col_punch_state: "Punch State",
            col_device_ip: "Device IP",
            
            // Devices
            add_new_terminal: "Add New Terminal",
            device_name: "Device Name",
            ip_address: "IP Address",
            comm_port: "Communication Port",
            btn_add_terminal: "Add Terminal",
            connected_terminals: "Connected Terminals",
            
            // Reports & Settings
            report_filter_title: "Attendance Report Filter",
            period_mode: "Select Period Mode",
            mode_daily: "Daily",
            mode_monthly: "Monthly",
            mode_yearly: "Yearly",
            mode_range: "Date Range",
            select_month: "Select Month",
            select_year: "Select Year",
            period_range: "Period (From Date - To Date)",
            btn_generate_report: "Generate Report",
            rate_attendance: "Attendance Rate",
            rate_present: "Present",
            rate_absent: "Absent",
            rate_late: "Late / Tardy",
            col_work_days: "Work Days",
            col_delay: "Delay (Mins)",
            col_worked_hours: "Worked Hours",
            device_time_settings: "Device Time Settings",
            auto_sync_desc: "Automatic Sync (Sync with Computer Clock):",
            btn_sync_auto: "Sync Automatically",
            manual_time_desc: "Manual Time Adjustment:",
            btn_set_manual: "Set Time Manually",
            device_maintenance: "Device Maintenance:",
            btn_reboot: "Reboot Devices",
            btn_clear_logs: "Clear ZK Logs",
            logging_mode_title: "Attendance Logging Mode",
            logging_desc: "Choose how attendance punch states (Check-In / Check-Out) are recorded and displayed.",
            logging_strategy: "Logging Strategy",
            option_smart_calc: "Smart Calculation (First-In, Last-Out) 🤖",
            option_device_keypad: "Device Keypad Selection (Manual F1/F2) 👤",
            btn_apply_strategy: "Apply Strategy",
            app_lang_title: "Application Language",
            app_lang_desc: "Choose the display language for the application interface.",
            display_lang: "Display Language",
            company_default_shift: "Default Shift Times",
            company_default_desc: "Set the global default working hours for the company. These are used when no specific shift is assigned to an employee.",
            btn_save_default_shift: "Save Default Shift",
            system_info: "System Info",
            app_version: "App Version:",
            database_label: "Database:",
            storage_path: "Storage Path:",

            // Additional dynamic texts
            col_first_punch: "First Punch",
            col_last_punch: "Last Punch",
            col_expected: "Expected",
            col_status: "Status",
            col_present_days: "Present Days",
            col_absent_days: "Absent Days",
            col_late_days: "Late Days",
            col_total_delay: "Total Delay",
            col_action: "Action",
            col_shift: "Shift",
            status_late: "Late 🔴",
            status_on_time: "On Time 🟢",
            status_absent: "Absent 📁",
            status_off_day: "Off Day 🔵",
            status_all: "All Statuses",
            status_filter_late: "Late Only 🔴",
            status_filter_on_time: "On Time Only 🟢",
            status_filter_absent: "Absent Only 📁",
            no_records: "No matching records found",
            please_choose_period: "Please select period and generate report",
            details_btn: "Details",
            employee_daily_schedule_title: "Daily Attendance Log for Employee:",
            date_label: "Date",
            shift_label: "Shift",
            work_hrs: "Work Hrs",
            report_summary_title: "Attendance Summary",
            search_report_placeholder: "Search by name or ID...",
            day_label: "day",
            report_def_start: "Default Start Time",
            report_def_end: "Default End Time",
            today_btn: "Today",
            range_to: "to"
        },
        fr: {
            dashboard: "Tableau de Bord",
            subtitle_dashboard: "Bon retour, responsable.",
            users: "Gérer les Employés",
            subtitle_users: "Créer, mettre à jour et enregistrer les empreintes digitales.",
            schedules: "Horaires & Shifts",
            subtitle_schedules: "Définir les quarts de travail et planifier les horaires.",
            logs: "Journaux de Présence",
            subtitle_logs: "Consulter, rechercher et synchroniser l'historique.",
            devices: "Gérer les Appareils",
            subtitle_devices: "Enregistrer et configurer les terminaux ZKTeco.",
            reports: "Rapports de Retard",
            subtitle_reports: "Analyser les horaires, les heures de travail et les retards.",
            settings: "Paramètres",
            subtitle_settings: "Ajuster la synchronisation de l'horloge et les préférences.",
            sync_btn: "Synchro tous Appareils",
            syncing: "Synchro...",
            
            // Dashboard
            total_employees: "Total Employés",
            total_fingerprints: "Total Empreintes",
            today_punches: "Pointages Aujourd'hui",
            total_logs: "Total Journaux",
            hardware_overview: "Aperçu du Matériel (En direct)",
            users_on_device: "Utilisateurs sur Appareil",
            fingers_on_device: "Empreintes sur Appareil",
            logs_on_device: "Journaux sur Appareil",
            attendance_trend: "Tendance des Présences",
            last_7_days: "7 Derniers Jours",
            recent_activity: "Activité Récente",
            view_all: "Voir Tout",
            col_employee: "Employé",
            col_id: "ID",
            col_time: "Heure",
            col_device: "Appareil",
            
            // Employees
            add_new_employee: "Ajouter un Nouvel Employé",
            full_name: "Nom Complet",
            hardware_id: "ID Matériel (UID)",
            target_device: "Appareil Cible",
            role: "Rôle",
            role_user: "Utilisateur Standard",
            role_admin: "Administrateur",
            btn_cancel: "Annuler",
            btn_create_user: "Créer l'Employé sur l'Appareil",
            employee_directory: "Répertoire des Employés",
            search_employees_placeholder: "Rechercher des employés...",
            btn_fetch_all: "Récupérer Tout",
            btn_sync_bio: "Synchro Bio",
            col_name: "Nom",
            col_bio_status: "Statut Bio",
            col_card_number: "Numéro de Carte",
            col_actions: "Actions",
            
            // Schedules
            tab_define_shifts: "Définir les Shifts",
            tab_daily_assignments: "Assignations Journalières",
            tab_bulk_scheduling: "Planification en Masse",
            define_new_shift: "Définir un Nouveau Shift",
            shift_name: "Nom du Shift",
            shift_name_placeholder: "Ex: Shift du Matin / Shift du Soir",
            shift_start: "Heure de Début",
            shift_end: "Heure de Fin",
            btn_save_shift: "Enregistrer le Shift",
            defined_shifts: "Shifts Définis",
            shifts_explanation: "Ici, vous pouvez gérer vos shifts. Supprimer un shift rétablira tous les employés qui y sont actuellement affectés vers l'horaire par défaut.",
            daily_assignments_desc: "Attribuez des shifts de travail ou des jours de congé aux employés au jour le jour. Les modifications sont enregistrées automatiquement.",
            select_date: "Sélectionner la Date:",
            bulk_step1: "Étape 1: Sélectionner les Employés & Dates",
            date_range: "Période",
            start_date: "Date de Début",
            end_date: "Date de Fin",
            target_employees: "Employés Cibles",
            btn_select_all: "Tout Sélectionner",
            btn_clear_selection: "Effacer la Sélection",
            bulk_step2: "Étape 2: Assigner & Appliquer",
            bulk_explanation: "La planification en masse vous permet de remplacer les shifts de plusieurs employés sur une période choisie. C'est parfait pour définir les week-ends ou assigner les shifts d'équipe.",
            select_shift_or_off: "Sélectionner le Shift / Jour Férié",
            option_off_day: "Jour de Congé / Week-end",
            btn_apply_bulk: "Appliquer la Planification",
            
            // Logs
            attendance_records: "Journaux de Présence",
            select_device: "Sélectionner l'Appareil",
            from_date: "Date de Début",
            to_date: "Date de Fin",
            search_logs_placeholder: "Rechercher dans les journaux...",
            btn_pull_logs: "Télécharger les Journaux",
            btn_clear_filters: "Effacer les Filtres",
            col_timestamp: "Horodatage",
            col_punch_state: "État de Pointage",
            col_device_ip: "IP de l'Appareil",
            
            // Devices
            add_new_terminal: "Ajouter un Nouveau Terminal",
            device_name: "Nom de l'Appareil",
            ip_address: "Adresse IP",
            comm_port: "Port de Communication",
            btn_add_terminal: "Ajouter le Terminal",
            connected_terminals: "Terminaux Connectés",
            
            // Reports & Settings
            report_filter_title: "Filtre du Rapport de Présence",
            period_mode: "Sélectionner la Période",
            mode_daily: "Journalier",
            mode_monthly: "Mensuel",
            mode_yearly: "Annuel",
            mode_range: "Plage de dates",
            select_month: "Sélectionner le Mois",
            select_year: "Sélectionner l'Année",
            period_range: "Période (Du date - Au date)",
            btn_generate_report: "Générer le Rapport",
            rate_attendance: "Taux de Présence",
            rate_present: "Présents",
            rate_absent: "Absences",
            rate_late: "Retards",
            col_work_days: "Jours de Travail",
            col_delay: "Retard (Mins)",
            col_worked_hours: "Heures Travaillées",
            device_time_settings: "Réglages de l'Heure de l'Appareil",
            auto_sync_desc: "Mise à Jour Auto (Synchroniser avec l'Horloge PC):",
            btn_sync_auto: "Synchroniser Automatiquement",
            manual_time_desc: "Réglage Manuel de l'Heure:",
            btn_set_manual: "Régler l'Heure Manuellement",
            device_maintenance: "Maintenance des Appareils:",
            btn_reboot: "Redémarrer les Appareils",
            btn_clear_logs: "Effacer les Journaux ZK",
            logging_mode_title: "Mode de Validation des Présences",
            logging_desc: "Choisissez comment les états de pointage (Entrée / Sortie) sont enregistrés et affichés.",
            logging_strategy: "Stratégie de Pointage",
            option_smart_calc: "Calcul Intelligent (Premier Entré, Dernier Sorti) 🤖",
            option_device_keypad: "Sélection via Clavier Physique (F1/F2 Manuel) 👤",
            btn_apply_strategy: "Appliquer la Stratégie",
            app_lang_title: "Langue de l'Application",
            app_lang_desc: "Choisissez la langue d'affichage de l'interface utilisateur.",
            display_lang: "Langue d'Affichage",
            company_default_shift: "Horaires de Shift par Défaut",
            company_default_desc: "Définissez les heures de travail globales par défaut de l'entreprise. Celles-ci sont utilisées si aucun shift spécifique n'est affecté.",
            btn_save_default_shift: "Enregistrer le Shift par Défaut",
            system_info: "Infos Système",
            app_version: "Version de l'App:",
            database_label: "Base de données:",
            storage_path: "Chemin de Stockage:",

            // Additional dynamic texts
            col_first_punch: "Premier Pointage",
            col_last_punch: "Dernier Pointage",
            col_expected: "Horaire Prévu",
            col_status: "Statut",
            col_present_days: "Jours Présents",
            col_absent_days: "Jours Absents",
            col_late_days: "Jours de Retard",
            col_total_delay: "Total Retard",
            col_action: "Action",
            col_shift: "Shift",
            status_late: "En Retard 🔴",
            status_on_time: "À l'Heure 🟢",
            status_absent: "Absent 📁",
            status_off_day: "Jour de Congé 🔵",
            status_all: "Tous les Statuts",
            status_filter_late: "Retard Seulement 🔴",
            status_filter_on_time: "À l'Heure Seulement 🟢",
            status_filter_absent: "Absent Seulement 📁",
            no_records: "Aucun enregistrement correspondant trouvé",
            please_choose_period: "Veuillez sélectionner une période et générer le rapport",
            details_btn: "Détails",
            employee_daily_schedule_title: "Journal de présence quotidien pour l'employé :",
            date_label: "Date",
            shift_label: "Shift",
            work_hrs: "Heures de Travail",
            report_summary_title: "Résumé des Présences",
            search_report_placeholder: "Rechercher par nom ou ID...",
            day_label: "jour",
            report_def_start: "Heure de Début par Défaut",
            report_def_end: "Heure de Fin par Défaut",
            today_btn: "Aujourd'hui",
            range_to: "à"
        }
    },

    currentLang: 'en',

    changeLanguage(lang) {
        this.currentLang = lang;
        localStorage.setItem('hs_lang', lang);
        
        // 1. Update active page headers if currently rendering
        this.showPage(this.currentPage);

        // 2. Update Sync button text
        const syncAllBtn = document.getElementById('sync-all-btn');
        if (syncAllBtn) {
            syncAllBtn.innerHTML = `<i class="fas fa-sync-alt"></i> ${this.translations[lang].sync_btn}`;
        }

        // 3. Update sidebar navigation text
        const navItems = document.querySelectorAll('.nav-item');
        navItems.forEach(item => {
            const page = item.dataset.page;
            if (page && this.translations[lang][page]) {
                const icon = item.querySelector('i').outerHTML;
                item.innerHTML = `${icon} ${this.translations[lang][page]}`;
            }
        });

        // 4. Update dropdown status in Settings Page
        const selector = document.getElementById('setting-app-lang');
        if (selector) selector.value = lang;

        // 5. Translate all static UI elements dynamically
        this.translateStaticUI();

        this.showNotification(`Language changed to ${lang === 'en' ? 'English' : 'Français'}`);
    },

    translateStaticUI() {
        const lang = this.currentLang || 'en';
        const trans = this.translations[lang] || this.translations.en;
        
        const selectorsMap = {
            // Dashboard
            '#dashboard-page .stat-card:nth-child(1) h3': trans.total_employees,
            '#dashboard-page .stat-card:nth-child(2) h3': trans.total_fingerprints,
            '#dashboard-page .stat-card:nth-child(3) h3': trans.today_punches,
            '#dashboard-page .stat-card:nth-child(4) h3': trans.total_logs,
            '#dashboard-page .card:nth-child(2) .section-header h2': `<i class="fas fa-microchip"></i> ${trans.hardware_overview}`,
            '#dashboard-page .stats-grid > div:nth-child(1) h4': trans.users_on_device,
            '#dashboard-page .stats-grid > div:nth-child(2) h4': trans.fingers_on_device,
            '#dashboard-page .stats-grid > div:nth-child(3) h4': trans.logs_on_device,
            '#dashboard-page .chart-container-card .section-header h2': trans.attendance_trend,
            '#dashboard-page .chart-container-card .section-header span': trans.last_7_days,
            '#dashboard-page .recent-logs .section-header h2': trans.recent_activity,
            '#dashboard-page .recent-logs .section-header button': trans.view_all,
            '#recent-table th:nth-child(1)': trans.col_employee,
            '#recent-table th:nth-child(2)': trans.col_id,
            '#recent-table th:nth-child(3)': trans.col_time,
            '#recent-table th:nth-child(4)': trans.col_device,
            
            // Employees (Users)
            '#users-page .card:nth-child(1) .section-header h2': `<i class="fas fa-user-plus"></i> ${trans.add_new_employee}`,
            '#add-user-form .form-group:nth-child(1) label': trans.full_name,
            '#add-user-form .form-group:nth-child(2) label': trans.hardware_id,
            '#add-user-form .form-group:nth-child(3) label': trans.target_device,
            '#add-user-form .form-group:nth-child(4) label': trans.role,
            '#user-role option[value="0"]': trans.role_user,
            '#user-role option[value="14"]': trans.role_admin,
            '#user-cancel-btn': trans.btn_cancel,
            '#user-submit-btn': trans.btn_create_user,
            '#users-page .card:nth-child(2) .section-header h2': `<i class="fas fa-users"></i> ${trans.employee_directory}`,
            '#users-page .card:nth-child(2) .section-header button:nth-of-type(1)': `<i class="fas fa-download"></i> ${trans.btn_fetch_all}`,
            '#users-page .card:nth-child(2) .section-header button:nth-of-type(2)': `<i class="fas fa-fingerprint"></i> ${trans.btn_sync_bio}`,
            '#users-table th:nth-child(1)': trans.col_name,
            '#users-table th:nth-child(2)': trans.col_id,
            '#users-table th:nth-child(3)': trans.col_device,
            '#users-table th:nth-child(4)': trans.role,
            '#users-table th:nth-child(5)': 'Work Pattern',
            '#users-table th:nth-child(6)': trans.col_bio_status,
            '#users-table th:nth-child(7)': trans.col_actions,
            
            // Schedules
            '.schedules-tabs button[data-tab="tab-define-shifts"]': `<i class="fas fa-clock" style="color: #818cf8;"></i> ${trans.tab_define_shifts}`,
            '.schedules-tabs button[data-tab="tab-daily-schedule"]': `<i class="fas fa-calendar-day" style="color: #a855f7;"></i> ${trans.tab_daily_assignments}`,
            '.schedules-tabs button[data-tab="tab-bulk-schedule"]': `<i class="fas fa-layer-group" style="color: #f472b6;"></i> ${trans.tab_bulk_scheduling}`,
            '#tab-define-shifts .schedules-two-col .card:nth-child(1) h2': `<i class="fas fa-plus-circle text-indigo-400"></i> ${trans.define_new_shift}`,
            '#add-shift-form .form-group:nth-child(1) label': trans.shift_name,
            '#add-shift-form div:nth-child(2) .form-group:nth-child(1) label': trans.shift_start,
            '#add-shift-form div:nth-child(2) .form-group:nth-child(2) label': trans.shift_end,
            '#add-shift-form button[type="submit"]': `<i class="fas fa-plus"></i> ${trans.btn_save_shift}`,
            '#tab-define-shifts .schedules-two-col .card:nth-child(2) h2': `<i class="fas fa-list text-indigo-400"></i> ${trans.defined_shifts}`,
            '#tab-define-shifts .schedules-two-col .card:nth-child(2) .info-alert-card p': trans.shifts_explanation,
            '#tab-daily-schedule .search-filter-bar h2': `<i class="fas fa-calendar-check text-purple-400"></i> ${trans.tab_daily_assignments}`,
            '#tab-daily-schedule .search-filter-bar p': trans.daily_assignments_desc,
            '#tab-daily-schedule .search-filter-bar span': trans.select_date,
            '#daily-scheduler-table th:nth-child(1)': trans.col_name,
            '#daily-scheduler-table th:nth-child(2)': trans.col_id,
            '#daily-scheduler-table th:nth-child(3)': trans.select_shift_or_off,
            '#tab-bulk-schedule .card:nth-child(1) h2': `<i class="fas fa-users text-pink-400"></i> ${trans.bulk_step1}`,
            '#tab-bulk-schedule .card:nth-child(1) .form-group:nth-child(2) label': trans.date_range,
            '#tab-bulk-schedule .card:nth-child(1) .form-group:nth-child(2) span:nth-of-type(1)': trans.start_date,
            '#tab-bulk-schedule .card:nth-child(1) .form-group:nth-child(2) span:nth-of-type(2)': trans.end_date,
            '#tab-bulk-schedule .card:nth-child(1) .form-group:nth-child(3) label': trans.target_employees,
            '#tab-bulk-schedule .card:nth-child(1) button[onclick*="selectAllBulkEmployees(true)"]': trans.btn_select_all,
            '#tab-bulk-schedule .card:nth-child(1) button[onclick*="selectAllBulkEmployees(false)"]': trans.btn_clear_selection,
            '#tab-bulk-schedule .schedules-two-col > div:nth-child(2) h2': `<i class="fas fa-cog text-pink-400"></i> ${trans.bulk_step2}`,
            '#tab-bulk-schedule .schedules-two-col > div:nth-child(2) .info-alert-card p': trans.bulk_explanation,
            '#tab-bulk-schedule .schedules-two-col > div:nth-child(2) label': trans.select_shift_or_off,
            '#bulk-shift-select option[value="off"]': trans.option_off_day,
            '#tab-bulk-schedule button[onclick="app.applyBulkSchedule()"]': `<i class="fas fa-check"></i> ${trans.btn_apply_bulk}`,
            
            // Logs
            '#logs-page .card h2': `<i class="fas fa-history"></i> ${trans.attendance_records}`,
            '#logs-page .form-group:nth-child(1) label': trans.select_device,
            '#logs-page .form-group:nth-child(2) label': trans.from_date,
            '#logs-page .form-group:nth-child(3) label': trans.to_date,
            '#logs-page button[onclick="app.loadLogs()"]': `<i class="fas fa-download"></i> ${trans.btn_pull_logs}`,
            '#logs-page button[onclick="app.clearLogFilters()"]': `<i class="fas fa-trash-alt"></i> ${trans.btn_clear_filters}`,
            '#logs-table th:nth-child(1)': trans.col_name,
            '#logs-table th:nth-child(2)': trans.col_id,
            '#logs-table th:nth-child(3)': trans.col_timestamp,
            '#logs-table th:nth-child(4)': trans.col_punch_state,
            '#logs-table th:nth-child(5)': trans.col_card_number,
            '#logs-table th:nth-child(6)': trans.col_device_ip,
            
            // Devices
            '#devices-page .schedules-two-col .card:nth-child(1) h2': `<i class="fas fa-plus-circle text-indigo-400"></i> ${trans.add_new_terminal}`,
            '#devices-page .schedules-two-col .card:nth-child(1) .form-group:nth-child(1) label': trans.device_name,
            '#devices-page .schedules-two-col .card:nth-child(1) .form-group:nth-child(2) label': trans.ip_address,
            '#devices-page .schedules-two-col .card:nth-child(1) .form-group:nth-child(3) label': trans.comm_port,
            '#devices-page .schedules-two-col .card:nth-child(1) button[type="submit"]': `<i class="fas fa-plus"></i> ${trans.btn_add_terminal}`,
            '#devices-page .schedules-two-col .card:nth-child(2) h2': `<i class="fas fa-microchip text-indigo-400"></i> ${trans.connected_terminals}`,
            '#devices-table th:nth-child(1)': trans.col_name,
            '#devices-table th:nth-child(2)': trans.ip_address,
            '#devices-table th:nth-child(3)': trans.comm_port,
            '#devices-table th:nth-child(4)': trans.col_actions,
            
            // Reports
            '#reports-page .card h2': `<i class="fas fa-filter"></i> ${trans.report_filter_title}`,
            '#reports-page .form-group:nth-child(1) label': trans.period_mode,
            '#report-mode option[value="day"]': trans.mode_daily,
            '#report-mode option[value="month"]': trans.mode_monthly,
            '#report-mode option[value="year"]': trans.mode_yearly,
            '#report-mode option[value="range"]': trans.mode_range,
            '#reports-page .form-group:nth-child(2) label': trans.select_date,
            '#report-month-group label': trans.select_month,
            '#report-year-group label': trans.select_year,
            '#report-range-group label': trans.period_range,
            '#reports-page .form-group:nth-child(6) label': trans.report_def_start,
            '#reports-page .form-group:nth-child(7) label': trans.report_def_end,
            '#reports-page button[onclick="app.generateLateReport()"]': `<i class="fas fa-search"></i> ${trans.btn_generate_report}`,
            '#report-table-title': `<i class="fas fa-list-alt"></i> ${trans.report_summary_title}`,
            '#report-status-filter option[value="all"]': trans.status_all,
            '#report-status-filter option[value="Late"]': trans.status_filter_late,
            '#report-status-filter option[value="On Time"]': trans.status_filter_on_time,
            '#report-status-filter option[value="Absent"]': trans.status_filter_absent,
            '#report-today-btn': trans.today_btn,
            '#report-range-group span': trans.range_to,
            
            // Settings
            '#settings-page .settings-col:nth-child(1) .card:nth-child(1) h2': `<i class="fas fa-clock"></i> ${trans.device_time_settings}`,
            '#settings-page .settings-col:nth-child(1) .card:nth-child(1) p:nth-of-type(1)': trans.auto_sync_desc,
            '#settings-page .settings-col:nth-child(1) .card:nth-child(1) button[onclick="app.syncAllClocks()"]': `<i class="fas fa-sync-alt"></i> ${trans.btn_sync_auto}`,
            '#settings-page .settings-col:nth-child(1) .card:nth-child(1) p:nth-of-type(2)': trans.manual_time_desc,
            '#settings-page .settings-col:nth-child(1) .card:nth-child(1) button[onclick="app.setManualTime()"]': `<i class="fas fa-edit"></i> ${trans.btn_set_manual}`,
            '#settings-page .settings-col:nth-child(1) .card:nth-child(1) p:nth-of-type(3)': trans.device_maintenance,
            '#settings-page .settings-col:nth-child(1) .card:nth-child(1) button[onclick="app.rebootAllDevices()"]': `<i class="fas fa-power-off"></i> ${trans.btn_reboot}`,
            '#settings-page .settings-col:nth-child(1) .card:nth-child(1) button[onclick="app.clearDeviceLogs()"]': `<i class="fas fa-trash-alt"></i> ${trans.btn_clear_logs}`,
            '#settings-page .settings-col:nth-child(1) .card:nth-child(2) h2': `<i class="fas fa-magic"></i> ${trans.logging_mode_title}`,
            '#settings-page .settings-col:nth-child(1) .card:nth-child(2) p': trans.logging_desc,
            '#settings-page .settings-col:nth-child(1) .card:nth-child(2) label': trans.logging_strategy,
            '#setting-calc-mode option[value="calculated"]': trans.option_smart_calc,
            '#setting-calc-mode option[value="device"]': trans.option_device_keypad,
            '#settings-page .settings-col:nth-child(1) .card:nth-child(2) button': `<i class="fas fa-check-circle"></i> ${trans.btn_apply_strategy}`,
            '#settings-page .settings-col:nth-child(2) .card:nth-child(1) h2': `<i class="fas fa-language"></i> ${trans.app_lang_title}`,
            '#settings-page .settings-col:nth-child(2) .card:nth-child(1) p': trans.app_lang_desc,
            '#settings-page .settings-col:nth-child(2) .card:nth-child(1) label': trans.display_lang,
            '#settings-page .settings-col:nth-child(2) .card:nth-child(2) h2': `<i class="fas fa-clock"></i> ${trans.company_default_shift}`,
            '#settings-page .settings-col:nth-child(2) .card:nth-child(2) p': trans.company_default_desc,
            '#settings-page .settings-col:nth-child(2) .card:nth-child(2) .form-group:nth-of-type(1) label': trans.report_def_start,
            '#settings-page .settings-col:nth-child(2) .card:nth-child(2) .form-group:nth-of-type(2) label': trans.report_def_end,
            '#settings-page .settings-col:nth-child(2) .card:nth-child(2) button': `<i class="fas fa-save"></i> ${trans.btn_save_default_shift}`,
            '#settings-page .settings-col:nth-child(2) .card:nth-child(3) h2': `<i class="fas fa-info-circle"></i> ${trans.system_info}`,
            '#settings-page .settings-col:nth-child(2) .card:nth-child(3) .space-y-2 div:nth-child(1) span:nth-child(1)': trans.app_version,
            '#settings-page .settings-col:nth-child(2) .card:nth-child(3) .space-y-2 div:nth-child(2) span:nth-child(1)': trans.database_label,
            '#settings-page .settings-col:nth-child(2) .card:nth-child(3) .space-y-2 div:nth-child(3) span:nth-child(1)': trans.storage_path
        };
        
        for (const [selector, value] of Object.entries(selectorsMap)) {
            const el = document.querySelector(selector);
            if (el && value) {
                if (value.includes('<') && value.includes('>')) {
                    el.innerHTML = value;
                } else {
                    el.innerText = value;
                }
            }
        }
        
        const placeholders = {
            '#user-name': trans.full_name,
            '#users-search': trans.search_employees_placeholder,
            '#shift-name': trans.shift_name_placeholder,
            '#logs-search-input': trans.search_logs_placeholder,
            '#report-search-input': trans.search_report_placeholder
        };
        
        for (const [selector, value] of Object.entries(placeholders)) {
            const el = document.querySelector(selector);
            if (el && value) {
                el.placeholder = value;
            }
        }
    },

    loadSavedLanguage() {
        const saved = localStorage.getItem('hs_lang') || 'en';
        this.changeLanguage(saved);
    },

    copyMachineId() {
        const midInput = document.getElementById('activation-mid');
        if (midInput) {
            midInput.select();
            document.execCommand('copy');
            this.showNotification('Machine ID copied to clipboard!');
        }
    },

    async submitActivationKey() {
        const keyArea = document.getElementById('activation-key');
        if (!keyArea || !keyArea.value.trim()) {
            this.showNotification('Please enter a license key first!', 'error');
            return;
        }

        const res = await window.electronAPI.invoke('save-license-key', keyArea.value.trim());
        if (res.success) {
            this.showNotification('Activation successful! Reloading application...', 'success');
            setTimeout(() => {
                window.location.reload();
            }, 1500);
        } else {
            const errorMsg = document.getElementById('activation-error-msg');
            if (errorMsg) errorMsg.innerText = res.message || 'Activation failed.';
            this.showNotification(res.message || 'Activation failed.', 'error');
        }
    },

    // ==========================================
    // SHIFTS & SCHEDULING SYSTEM METHODS
    // ==========================================
    shifts: [],
    
    async loadSchedulesTab() {
        // Reset tabs to default (Define Shifts) on load
        document.querySelectorAll('.schedule-tab-btn').forEach(btn => {
            if (btn.dataset.tab === 'tab-define-shifts') {
                btn.classList.add('active');
            } else {
                btn.classList.remove('active');
            }
        });
        document.querySelectorAll('.schedule-tab-content').forEach(content => {
            if (content.id === 'tab-define-shifts') {
                content.style.display = 'block';
            } else {
                content.style.display = 'none';
            }
        });

        // Set today's date for daily schedule view if empty
        const viewDateEl = document.getElementById('scheduler-view-date');
        if (viewDateEl && !viewDateEl.value) {
            viewDateEl.value = new Date().toISOString().split('T')[0];
        }
        
        // Set default dates for bulk schedule
        const bulkStart = document.getElementById('bulk-start-date');
        const bulkEnd = document.getElementById('bulk-end-date');
        if (bulkStart && !bulkStart.value) {
            bulkStart.value = new Date().toISOString().split('T')[0];
        }
        if (bulkEnd && !bulkEnd.value) {
            // Default bulk range to 7 days
            const d = new Date();
            d.setDate(d.getDate() + 6);
            bulkEnd.value = d.toISOString().split('T')[0];
        }

        await this.loadShifts();
        await this.renderDailyScheduler();
        await this.loadBulkEmployeesList();
        
        // Bind onchange event for date picker
        if (viewDateEl && !viewDateEl.dataset.bound) {
            viewDateEl.onchange = () => this.renderDailyScheduler();
            viewDateEl.dataset.bound = "true";
        }
    },

    async loadShifts() {
        try {
            this.shifts = await window.electronAPI.invoke('get-shifts');
            
            // Render Shifts List
            const listContainer = document.getElementById('shifts-list-container');
            if (listContainer) {
                if (this.shifts.length === 0) {
                    listContainer.innerHTML = '<p class="text-xs text-slate-500 italic text-center p-3">No shifts defined. Add one above.</p>';
                } else {
                    listContainer.innerHTML = this.shifts.map(s => `
                        <div class="flex justify-between items-center bg-slate-800/40 p-2 rounded-lg border border-slate-700/50">
                            <div>
                                <span class="font-medium text-sm text-slate-200">${s.name}</span>
                                <div class="text-xs text-slate-400 font-mono">${s.start_time} - ${s.end_time}</div>
                            </div>
                            <button class="btn btn-xs btn-red" onclick="app.deleteShift(${s.id})" title="Delete Shift" style="padding: 4px 8px; border-radius: 6px;">
                                <i class="fas fa-trash-alt"></i>
                            </button>
                        </div>
                    `).join('');
                }
            }

            // Update Bulk Shift Select Dropdown
            const bulkSelect = document.getElementById('bulk-shift-select');
            if (bulkSelect) {
                bulkSelect.innerHTML = `<option value="none">Default (${this.defaultStartTime} - ${this.defaultEndTime}) ⚙️</option>` +
                    `<option value="off">${this.translations[this.currentLang || 'en'].option_off_day} 😴</option>` + 
                    this.shifts.map(s => `<option value="${s.id}">${s.name} (${s.start_time} - ${s.end_time}) 🕒</option>`).join('');
            }
        } catch (e) {
            console.error(e);
        }
    },

    async deleteShift(id) {
        if (!confirm('Are you sure you want to delete this shift? This will clear schedules using it.')) return;
        this.showNotification('Deleting shift...', 'info');
        const res = await window.electronAPI.invoke('delete-shift', id);
        if (res.success) {
            this.showNotification('Shift deleted successfully');
            await this.loadShifts();
            await this.renderDailyScheduler();
        } else {
            this.showNotification('Failed: ' + res.error, 'error');
        }
    },

    async loadWorkPatterns() {
        try {
            this.workPatterns = await window.electronAPI.invoke('get-work-patterns');
            this.renderWorkPatterns();
            this.populatePatternDropdowns();
        } catch (e) {
            console.error('Error loading patterns:', e);
        }
    },

    renderWorkPatterns() {
        const container = document.getElementById('patterns-list-container');
        if (!container) return;
        
        if (this.workPatterns.length === 0) {
            container.innerHTML = '<div class="text-center text-slate-500 text-sm py-4">No patterns defined yet.</div>';
            return;
        }

        const daysNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
        
        container.innerHTML = this.workPatterns.map(p => {
            const daysHtml = daysNames.map((name, idx) => {
                const pd = p.days.find(d => d.day_of_week === idx);
                let shiftDisplay = 'Off Day';
                if (pd && pd.shift_id) {
                    const shift = this.shifts.find(s => s.id === pd.shift_id);
                    if (shift) shiftDisplay = `${shift.name} (${shift.start_time}-${shift.end_time})`;
                }
                return `<div class="text-xs text-slate-300 flex justify-between border-b border-slate-700/50 py-1 last:border-0">
                    <span class="font-medium w-20">${name}:</span> 
                    <span class="text-emerald-400 text-right truncate pl-2">${shiftDisplay}</span>
                </div>`;
            }).join('');

            return `
                <div class="bg-slate-800/40 p-4 rounded-xl border border-slate-700/50 flex flex-col gap-3">
                    <div class="flex justify-between items-center border-b border-slate-700 pb-2">
                        <span class="font-medium text-emerald-400">${p.name}</span>
                        <button class="btn btn-xs btn-red" onclick="app.deleteWorkPattern(${p.id})" title="Delete Pattern" style="padding: 4px 8px; border-radius: 6px;">
                            <i class="fas fa-trash-alt"></i>
                        </button>
                    </div>
                    <div class="flex flex-col">
                        ${daysHtml}
                    </div>
                </div>
            `;
        }).join('');
    },

    populatePatternDropdowns() {
        const daysContainer = document.getElementById('pattern-days-container');
        if (daysContainer) {
            const daysNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
            
            const shiftOptions = `<option value="off">Off Day</option>` + 
                this.shifts.map(s => `<option value="${s.id}">${s.name} (${s.start_time}-${s.end_time})</option>`).join('');

            daysContainer.innerHTML = daysNames.map((name, idx) => `
                <div class="form-group flex justify-between items-center bg-slate-800/30 p-2 rounded-lg border border-slate-700/50" style="margin-bottom: 0;">
                    <label style="margin: 0; min-width: 80px;" class="text-sm font-medium text-slate-300">${name}</label>
                    <select id="pattern-day-${idx}" style="background: rgba(0,0,0,0.4); border: 1px solid var(--glass-border); color: white; padding: 6px; border-radius: 6px; font-size: 0.85rem; width: 60%; outline: none;">
                        ${shiftOptions}
                    </select>
                </div>
            `).join('');
        }

        const userPatternSelect = document.getElementById('user-work-pattern');
        if (userPatternSelect) {
            const currentVal = userPatternSelect.value;
            userPatternSelect.innerHTML = '<option value="">None (Use Default)</option>' +
                this.workPatterns.map(p => `<option value="${p.id}">${p.name}</option>`).join('');
            userPatternSelect.value = currentVal || '';
        }
    },

    async saveWorkPattern() {
        const name = document.getElementById('pattern-name').value;
        if (!name) return;

        const days = [];
        for (let i = 0; i < 7; i++) {
            const val = document.getElementById(`pattern-day-${i}`).value;
            days.push({
                day_of_week: i,
                shift_id: val === 'off' ? null : parseInt(val)
            });
        }

        this.showNotification('Saving Work Pattern...', 'info');
        const res = await window.electronAPI.invoke('save-work-pattern', { name, days });
        if (res.success) {
            this.showNotification('Pattern saved successfully', 'success');
            document.getElementById('add-pattern-form').reset();
            // Default select to 'off'
            for (let i = 0; i < 7; i++) {
                document.getElementById(`pattern-day-${i}`).value = 'off';
            }
            await this.loadWorkPatterns();
        } else {
            this.showNotification('Failed to save pattern', 'error');
        }
    },

    async deleteWorkPattern(id) {
        if (!confirm('Are you sure you want to delete this pattern? Employees assigned to it will fallback to defaults.')) return;
        
        this.showNotification('Deleting Pattern...', 'info');
        const res = await window.electronAPI.invoke('delete-work-pattern', id);
        if (res.success) {
            this.showNotification('Pattern deleted successfully', 'success');
            await this.loadWorkPatterns();
        } else {
            this.showNotification('Failed to delete pattern', 'error');
        }
    },

    async renderDailyScheduler() {
        const date = document.getElementById('scheduler-view-date').value;
        if (!date) return;

        const tbody = document.querySelector('#daily-scheduler-table tbody');
        if (!tbody) return;

        tbody.innerHTML = '<tr><td colspan="3" class="text-center p-3 text-xs"><i class="fas fa-spinner fa-spin mr-1"></i> Loading...</td></tr>';

        try {
            const users = await window.electronAPI.invoke('get-local-users');
            const dailySchedules = await window.electronAPI.invoke('get-schedules', { date });

            if (users.length === 0) {
                tbody.innerHTML = '<tr><td colspan="3" class="text-center p-3 text-slate-500 text-xs">No employees registered yet.</td></tr>';
                return;
            }

            tbody.innerHTML = users.map(u => {
                const schedule = dailySchedules.find(s => s.user_id == u.user_id);
                
                // Active option check
                const isOffSelected = schedule && schedule.is_off_day ? 'selected' : '';
                const isNoneSelected = !schedule ? 'selected' : '';

                const optionsHtml = this.shifts.map(s => {
                    const isSelected = schedule && !schedule.is_off_day && schedule.shift_id == s.id ? 'selected' : '';
                    return `<option value="${s.id}" ${isSelected}>${s.name} (${s.start_time} - ${s.end_time})</option>`;
                }).join('');

                return `
                    <tr class="hover:bg-slate-800/30">
                        <td class="p-2 border-b border-slate-700 font-medium text-xs text-left" style="padding: 10px 5px;">${u.name}</td>
                        <td class="p-2 border-b border-slate-700 text-slate-400 text-xs font-mono text-center" style="padding: 10px 5px;">${u.user_id}</td>
                        <td class="p-2 border-b border-slate-700 text-right" style="padding: 10px 5px;">
                            <select onchange="app.saveSingleSchedule('${u.user_id}', '${date}', this.value)" 
                                style="background: rgba(0,0,0,0.4); border: 1px solid var(--glass-border); color: white; padding: 4px 8px; border-radius: 6px; font-size: 0.75rem; width: auto; max-width: 180px; outline: none; cursor: pointer;">
                                <option value="none" ${isNoneSelected}>Default (${this.defaultStartTime} - ${this.defaultEndTime}) ⚙️</option>
                                <option value="off" ${isOffSelected}>Off Day 😴</option>
                                ${optionsHtml}
                            </select>
                        </td>
                    </tr>
                `;
            }).join('');
        } catch (e) {
            console.error(e);
            tbody.innerHTML = '<tr><td colspan="3" class="text-center p-3 text-red-400 text-xs">Error loading scheduler</td></tr>';
        }
    },

    async saveSingleSchedule(userId, date, val) {
        try {
            const isOffDay = val === 'off' ? 1 : 0;
            const shiftId = (val === 'none' || val === 'off') ? null : parseInt(val);

            this.showNotification('Saving schedule...', 'info');
            const res = await window.electronAPI.invoke('save-schedule', {
                user_id: userId.toString(),
                date,
                shift_id: shiftId,
                is_off_day: isOffDay
            });

            if (res.success) {
                this.showNotification('Schedule updated successfully');
            } else {
                this.showNotification('Failed: ' + res.error, 'error');
            }
        } catch (e) {
            console.error(e);
            this.showNotification('Connection failed', 'error');
        }
    },

    async loadBulkEmployeesList() {
        const container = document.getElementById('bulk-employees-list');
        if (!container) return;

        try {
            const users = await window.electronAPI.invoke('get-local-users');
            if (users.length === 0) {
                container.innerHTML = '<span class="text-xs text-slate-500 italic">No employees found.</span>';
                return;
            }

            container.innerHTML = users.map(u => `
                <label class="employee-checkbox-item">
                    <input type="checkbox" class="bulk-employee-checkbox" value="${u.user_id}" onchange="this.parentElement.classList.toggle('checked', this.checked)">
                    <span>${u.name} (ID: ${u.user_id})</span>
                </label>
            `).join('');
        } catch (e) {
            console.error(e);
        }
    },

    selectAllBulkEmployees(val) {
        document.querySelectorAll('.bulk-employee-checkbox').forEach(cb => {
            cb.checked = val;
            cb.parentElement.classList.toggle('checked', val);
        });
    },

    async applyBulkSchedule() {
        const startDateVal = document.getElementById('bulk-start-date').value;
        const endDateVal = document.getElementById('bulk-end-date').value;
        const shiftVal = document.getElementById('bulk-shift-select').value;

        if (!startDateVal || !endDateVal) {
            this.showNotification('Please select both start and end dates', 'error');
            return;
        }

        const selectedCheckboxes = document.querySelectorAll('.bulk-employee-checkbox:checked');
        if (selectedCheckboxes.length === 0) {
            this.showNotification('Please select at least one employee', 'error');
            return;
        }

        const userIds = Array.from(selectedCheckboxes).map(cb => cb.value);

        // Generate date array
        const dates = [];
        let curr = new Date(startDateVal);
        const end = new Date(endDateVal);
        while (curr <= end) {
            dates.push(curr.toISOString().split('T')[0]);
            curr.setDate(curr.getDate() + 1);
        }

        const isOffDay = shiftVal === 'off';
        const shiftId = (isOffDay || shiftVal === 'none') ? null : parseInt(shiftVal);

        this.showNotification(`Applying bulk schedule for ${userIds.length} employees...`, 'info');
        try {
            const res = await window.electronAPI.invoke('bulk-save-schedules', {
                userIds,
                dates,
                shiftId,
                isOffDay
            });

            if (res.success) {
                this.showNotification('Bulk schedule applied successfully!', 'success');
                await this.renderDailyScheduler();
            } else {
                this.showNotification('Failed: ' + res.error, 'error');
            }
        } catch (e) {
            console.error(e);
            this.showNotification('Connection failed', 'error');
        }
    }
};

window.app = app;
app.init();
app.setReportToday();
