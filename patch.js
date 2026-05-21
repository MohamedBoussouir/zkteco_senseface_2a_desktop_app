const fs = require('fs');
let code = fs.readFileSync('renderer.js', 'utf8');

// 1. Add pagination variables
if (!code.includes('usersData: []')) {
    code = code.replace(/shifts: \[\],/, 'shifts: [],\n    usersData: [],\n    usersPage: 1,\n    usersPerPage: 10,\n    usersSearchQuery: \'\',');
}

// 2. Replace loadUsers and add pagination methods
const startIndex = code.indexOf('    async loadUsers() {');
const searchString = 'async syncAllUsers() {';
const endIndex = code.indexOf(searchString);

if (startIndex !== -1 && endIndex !== -1) {
    const newMethods = `    async loadUsers() {
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
                infoEl.innerText = \`Showing \${startIndex + 1} to \${endIndex} of \${totalItems} entries\`;
            }
        }

        tbody.innerHTML = currentData.map(u => {
            return \`
                <tr class="hover:bg-slate-800/50">
                    <td class="p-3 border-b border-slate-700 font-medium">\${u.name}</td>
                    <td class="p-3 border-b border-slate-700 text-slate-400">\${u.user_id}</td>
                    <td class="p-3 border-b border-slate-700 text-slate-300 text-sm">
                        <div style="display: flex; flex-direction: column; gap: 4px;">
                            \${u.assigned_devices ? u.assigned_devices.map(d => \`<div class="badge badge-info" style="display: inline-flex; align-items: center; gap: 6px; padding: 4px 8px; border-radius: 6px; background: rgba(56, 189, 248, 0.1); color: #38bdf8; border: 1px solid rgba(56, 189, 248, 0.2); font-size: 0.75rem;"><i class="fas fa-desktop"></i> <span>\${d.name}</span> <span style="opacity: 0.6; font-family: monospace;">\${d.ip}</span></div>\`).join('') : ''}
                        </div>
                    </td>
                    <td class="p-3 border-b border-slate-700">
                        \${parseInt(u.role) === 14 
                            ? \`<span class="status-badge" style="background: rgba(168, 85, 247, 0.15); color: #c084fc; border: 1px solid rgba(168, 85, 247, 0.3);"><i class="fas fa-shield-halved mr-1"></i> Admin</span>\` 
                            : \`<span class="status-badge" style="background: rgba(100, 116, 139, 0.15); color: #94a3b8; border: 1px solid rgba(100, 116, 139, 0.3);"><i class="fas fa-user mr-1"></i> User</span>\`
                        }
                    </td>
                    <td class="p-3 border-b border-slate-700">
                        <span class="text-emerald-400 font-medium text-xs">\${u.pattern_name || 'None (Use Default)'}</span>
                    </td>
                    <td class="p-3 border-b border-slate-700">
                        \${(() => {
                    let fpData = null;
                    try { fpData = JSON.parse(u.fingerprints || 'null'); } catch (e) { }
                    const count = fpData && typeof fpData === 'object' && fpData.count !== undefined
                        ? fpData.count
                        : (Array.isArray(fpData) ? fpData.length : 0);

                    if (count === 0) return '<span class="text-slate-600 italic text-xs">No fingerprints</span>';

                    return \`
                                <div class="inline-flex items-center bg-slate-800/40 rounded-xl p-1 border border-slate-700/50 shadow-inner whitespace-nowrap gap-1">
                                    \${(fpData && Array.isArray(fpData.indices) ? fpData.indices : []).map(f => \`
                                        <button class="finger-count-badge cursor-pointer hover:scale-110 transition-transform bg-transparent border-none p-0 flex items-center outline-none" 
                                            onclick="app.deleteFingerDirectFlow(\${u.uid}, '\${u.user_id}', \${f}, '\${btoa(encodeURIComponent(JSON.stringify(u.assigned_devices)))}')" 
                                            title="Delete Finger \${f}">
                                            <i class="fas fa-fingerprint"></i> <span class="ml-1">\${f}</span>
                                        </button>
                                    \`).join('')}
                                    
                                    <div class="border-l border-slate-700/50 pl-1 ml-1 flex items-center">
                                        <button class="btn btn-xs btn-red" onclick="app.deleteAllFingersFlow(\${u.uid}, '\${u.user_id}', '\${btoa(encodeURIComponent(JSON.stringify(u.assigned_devices)))}')" title="Clear All Data">
                                            <i class="fas fa-eraser"></i>
                                        </button>
                                    </div>
                                </div>
                            \`;
                })()}
                    </td>

                    <td class="p-3 border-b border-slate-700">
                        <div class="actions-cell">
                            <button class="btn btn-icon btn-blue" onclick="app.enrollFingerFlow(\${u.uid}, '\${u.user_id}', '\${btoa(encodeURIComponent(JSON.stringify(u.assigned_devices)))}')" title="Enroll Finger">
                                <i class="fas fa-fingerprint"></i>
                            </button>
                            <button class="btn btn-icon btn-blue" onclick="app.editUserFlow(\${u.uid}, '\${u.user_id}', '\${(u.name || '').replace(/'/g, "\\\\'")}', '\${btoa(encodeURIComponent(JSON.stringify(u.assigned_devices)))}', \${u.work_pattern_id || 'null'})" title="Edit User">
                                <i class="fas fa-edit"></i>
                            </button>
                            <button class="btn btn-icon btn-red" onclick="app.deleteUserFlow(\${u.uid}, '\${u.user_id}', '\${btoa(encodeURIComponent(JSON.stringify(u.assigned_devices)))}')" title="Delete User">
                                <i class="fas fa-trash"></i>
                            </button>
                        </div>
                    </td>
                </tr>
            \`;
        }).join('');
    },

    `;
    code = code.substring(0, startIndex) + newMethods + code.substring(endIndex);
}

fs.writeFileSync('renderer.js', code);
