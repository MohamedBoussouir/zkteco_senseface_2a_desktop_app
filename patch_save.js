const fs = require('fs');
let code = fs.readFileSync('renderer.js', 'utf8');

const replacement = `    async saveUser() {
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
                this.showNotification(\`Failed on \${dev.name}: \` + res.error, 'error');
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
        
        // Uncheck all first
        document.querySelectorAll('#user-target-devices-container input[type="checkbox"]').forEach(cb => cb.checked = false);
        
        // Check only the selected device
        const targetCb = document.querySelector(\`#user-target-devices-container input[type="checkbox"][value="\${deviceId}"]\`);
        if (targetCb) targetCb.checked = true;

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

    async addDevice() {`;

if (!code.includes('async saveUser() {')) {
    code = code.replace('    async addDevice() {', replacement);
    fs.writeFileSync('renderer.js', code);
    console.log('Patched CRUD methods!');
} else {
    console.log('Already patched!');
}
