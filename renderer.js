const app = {
    devices: [],
    currentPage: 'dashboard',

    async init() {
        this.bindEvents();
        await this.loadDevices();
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
                el.innerHTML = this.devices.map(d => `<option value="${d.id}">${d.name} (${d.ip})</option>`).join('');
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
                        <p class="text-slate-400 text-sm">${d.ip}:${d.port1}</p>
                    </div>
                    <span class="status-badge warning" id="status-${d.id}">Checking...</span>
                </div>
                <div class="flex gap-2">
                    <button class="btn btn-primary btn-sm flex-1" onclick="app.testConn('${d.ip}', [${d.port1}, ${d.port2}])">
                        <i class="fas fa-plug"></i> Test
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
        const pageTitles = {
            dashboard: { title: "Dashboard", subtitle: "Welcome back, manager." },
            users: { title: "Manage Employees", subtitle: "Create, update and enroll employee fingerprints." },
            logs: { title: "Attendance Logs", subtitle: "View, search and sync biometric check-in history." },
            devices: { title: "Manage Devices", subtitle: "Register and configure ZKTeco terminal hardware." },
            reports: { title: "Late Reports", subtitle: "Analyze shift records, working hours and lateness delays." },
            settings: { title: "Settings", subtitle: "Adjust terminal clock synchronization and system preferences." },
            playground: { title: "Debug Center", subtitle: "Send direct command packets to device sensors." }
        };

        const headerTitle = document.getElementById('page-title');
        const headerSubtitle = document.getElementById('page-subtitle');
        if (headerTitle && headerSubtitle && pageTitles[pageId]) {
            headerTitle.innerText = pageTitles[pageId].title;
            headerSubtitle.innerText = pageTitles[pageId].subtitle;
        }

        if (pageId === 'users') this.loadUsers();
        if (pageId === 'logs') this.loadLogs();
        if (pageId === 'dashboard') this.loadDashboardStats();
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
                const logs = await window.electronAPI.invoke('get-logs');
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
        } catch(e) {
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
        const tbody = document.querySelector('#users-table tbody');
        if (!tbody) return;
        tbody.innerHTML = users.map(u => {
            return `
                <tr class="hover:bg-slate-800/50">
                    <td class="p-3 border-b border-slate-700 font-medium">${u.name}</td>
                    <td class="p-3 border-b border-slate-700 text-slate-400">${u.user_id}</td>
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
                                            onclick="app.deleteFingerDirect(${u.uid}, '${u.user_id}', ${u.device_id}, ${f})" 
                                            title="Delete Finger ${f}">
                                            <i class="fas fa-fingerprint"></i> <span class="ml-1">${f}</span>
                                        </button>
                                    `).join('')}
                                    
                                    <div class="border-l border-slate-700/50 pl-1 ml-1 flex items-center">
                                        <button class="btn btn-xs btn-red" onclick="app.deleteAllFingers(${u.uid}, '${u.user_id}', ${u.device_id})" title="Clear All Data">
                                            <i class="fas fa-eraser"></i>
                                        </button>
                                    </div>
                                </div>
                            `;
                })()}
                    </td>
                    <td class="p-3 border-b border-slate-700">
                        <span class="status-badge online">Device ${u.device_id}</span>
                    </td>
                    <td class="p-3 border-b border-slate-700">
                        <div class="actions-cell">
                            <button class="btn btn-icon btn-blue" onclick="app.enrollFinger(${u.uid}, '${u.user_id}', ${u.device_id})" title="Enroll Finger">
                                <i class="fas fa-fingerprint"></i>
                            </button>
                            <button class="btn btn-icon btn-blue" onclick="app.editUser(${u.uid}, '${u.user_id}', '${u.name.replace(/'/g, "\\'")}', ${u.device_id})" title="Edit User">
                                <i class="fas fa-edit"></i>
                            </button>
                            <button class="btn btn-icon btn-red" onclick="app.deleteUser(${u.uid}, '${u.user_id}', ${u.device_id})" title="Delete User">
                                <i class="fas fa-trash"></i>
                            </button>
                        </div>
                    </td>
                </tr>
            `;
        }).join('');
    },

    async saveUser() {
        const name = document.getElementById('user-name').value;
        const userId = document.getElementById('user-id').value;
        const devId = document.getElementById('user-target-device').value;
        const role = document.getElementById('user-role').value;

        const dev = this.devices.find(d => d.id == devId);
        if (!dev) return;

        this.showNotification('Saving user to device...', 'info');
        const res = await window.electronAPI.invoke('create-user', {
            ip: dev.ip,
            ports: [dev.port1, dev.port2],
            uid: userId,
            userId,
            name,
            role: parseInt(role)
        });

        if (res.success) {
            this.showNotification('User saved successfully');
            this.loadUsers();
            this.resetUserForm();
        } else {
            this.showNotification('Error: ' + res.error, 'error');
        }
    },

    editUser(uid, userId, name, devId) {
        document.getElementById('user-name').value = name;
        document.getElementById('user-id').value = uid;
        document.getElementById('user-target-device').value = devId;
        document.getElementById('user-submit-btn').innerText = 'Update User';
        document.getElementById('user-cancel-btn').style.display = 'block';
        this.showNotification('Edit mode: Modify data and click Update', 'info');
    },

    resetUserForm() {
        document.getElementById('add-user-form').reset();
        document.getElementById('user-submit-btn').innerText = 'Create User on Device';
        document.getElementById('user-cancel-btn').style.display = 'none';
    },

    async syncAllLogsOnly() {
        if (this.devices.length === 0) {
            this.showNotification('No connected devices to sync!', 'error');
            return;
        }
        
        const syncLogsBtn = document.getElementById('sync-logs-only-btn');
        let oldHtml = '';
        if (syncLogsBtn) {
            syncLogsBtn.disabled = true;
            oldHtml = syncLogsBtn.innerHTML;
            syncLogsBtn.innerHTML = '<i class="fas fa-spinner fa-spin mr-1"></i> Syncing Logs...';
        }
        
        this.showNotification('Fetching attendance logs only (Lightning Fast)...', 'info');
        let totalSynced = 0;
        try {
            for (const dev of this.devices) {
                const res = await window.electronAPI.invoke('sync-logs-from-device', { ip: dev.ip, ports: [dev.port1, dev.port2] });
                if (res.success) {
                    totalSynced += res.logsCount || 0;
                }
            }
            this.showNotification(`Successfully synchronized ${totalSynced} attendance logs!`);
            await this.loadDashboardStats();
            
            // Refresh current active page instantly
            const activePage = document.querySelector('.page.active')?.id?.replace('-page', '');
            if (activePage === 'logs') this.loadLogs();
            if (activePage === 'users') this.loadUsers();
        } catch (err) {
            console.error(err);
            this.showNotification('Failed to sync logs: ' + err.message, 'error');
        } finally {
            if (syncLogsBtn) {
                syncLogsBtn.disabled = false;
                syncLogsBtn.innerHTML = oldHtml;
            }
        }
    },

    async syncAllUsers() {
        this.showNotification('Fetching all users from devices...', 'info');
        for (const dev of this.devices) {
            await window.electronAPI.invoke('sync-users-from-device', { ip: dev.ip, ports: [dev.port1, dev.port2] });
        }
        this.loadUsers();
        this.showNotification('Users updated from all devices');
    },

    async syncAllBio() {
        this.showNotification('Syncing fingerprints from devices...', 'info');
        const users = await window.electronAPI.invoke('get-local-users');
        for (const dev of this.devices) {
            const devUsers = users.filter(u => u.device_id == dev.id);
            if (devUsers.length > 0) {
                await window.electronAPI.invoke('get-users-fingerprints', { ip: dev.ip, ports: [dev.port1, dev.port2], users: devUsers });
            }
        }
        this.loadUsers();
        this.showNotification('Fingerprints synchronized');
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
                    await window.electronAPI.invoke('enroll-fingerprint', { ip: dev.ip, ports: [dev.port1, dev.port2], uid, userId, fingerIndex });
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
            const res = await window.electronAPI.invoke('delete-all-fingerprints', { ip: dev.ip, ports: [dev.port1, dev.port2], uid, userId });
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
            const res = await window.electronAPI.invoke('delete-user-fingerprint', { ip: dev.ip, ports: [dev.port1, dev.port2], uid, userId, fingerIndex });
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
                const res = await window.electronAPI.invoke('delete-user', { ip: dev.ip, ports: [dev.port1, dev.port2], uid, userId });
                if (res.success) { this.loadUsers(); this.showNotification('User deleted'); }
            }
        }
    },

    async addDevice() {
        const name = document.getElementById('device-name').value;
        const ip = document.getElementById('device-ip').value;
        const port1 = parseInt(document.getElementById('device-port1').value) || 4370;
        const port2 = parseInt(document.getElementById('device-port2').value) || 4371;

        if (!name || !ip) {
            this.showNotification('Please enter name and IP', 'error');
            return;
        }

        const res = await window.electronAPI.invoke('add-device', { name, ip, port1, port2 });
        if (res.success) {
            this.showNotification('Device added successfully!');
            this.loadDevices();
            document.getElementById('device-name').value = '';
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
        const logs = await window.electronAPI.invoke('get-logs');
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

    async testConn(ip, ports) {
        this.showNotification('Testing connection...', 'info');
        const res = await window.electronAPI.invoke('test-device-connection', { ip, ports });
        if (res.success) this.showNotification('Connection Successful!');
        else this.showNotification('Connection Failed', 'error');
    },

    startStatusPolling() {
        setInterval(async () => {
            for (const d of this.devices) {
                const res = await window.electronAPI.invoke('test-device-connection', { ip: d.ip, ports: [d.port1, d.port2] });
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

    async syncAllClocks() {
        const statusEl = document.getElementById('sync-time-status');
        if (statusEl) statusEl.innerHTML = 'Syncing...';
        await window.electronAPI.invoke('sync-all-times');
        this.showNotification('Clocks synchronized');
        if (statusEl) statusEl.innerHTML = 'Done';
    },

    setReportToday() {
        const el = document.getElementById('report-date');
        if (el) el.value = new Date().toISOString().split('T')[0];
    },

    async generateLateReport() {
        const date = document.getElementById('report-date').value;
        const startTime = document.getElementById('report-start-time').value;
        const endTime = document.getElementById('report-end-time').value;
        if (!date || !startTime) return;

        const tbody = document.querySelector('#late-report-table tbody');
        tbody.innerHTML = '<tr><td colspan="7" class="text-center p-4">Calculating...</td></tr>';

        const report = await window.electronAPI.invoke('get-late-report', { date, startTime, endTime });

        tbody.innerHTML = report.map(r => {
            const statusClass = r.status === 'Late' ? 'text-red-500 font-bold' :
                (r.status === 'On Time' ? 'text-green-500 font-bold' : 'text-gray-400');

            return `
                <tr class="hover:bg-slate-800/50 transition-colors">
                    <td class="p-3 border-b border-slate-700">
                        <div class="font-medium">${r.name}</div>
                        <div class="text-xs text-slate-500">ID: ${r.user_id || '--'}</div>
                    </td>
                    <td class="p-3 border-b border-slate-700">${r.first}</td>
                    <td class="p-3 border-b border-slate-700">${r.last}</td>
                    <td class="p-3 border-b border-slate-700 text-slate-400">${startTime}</td>
                    <td class="p-3 border-b border-slate-700 ${r.status === 'Late' ? 'text-orange-400' : ''}">${r.delay}</td>
                    <td class="p-3 border-b border-slate-700 font-mono">${r.worked}</td>
                    <td class="p-3 border-b border-slate-700">
                        <span class="${statusClass}">${r.status}</span>
                    </td>
                </tr>
            `;
        }).join('');
    }
};

window.app = app;
app.init();
app.setReportToday();
