const fs = require('fs');
let code = fs.readFileSync('renderer.js', 'utf8');

const target = '    enrollFinger(uid, userId, devId) {';

const replacement = `    promptDeviceSelection(title, devices) {
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
            select.innerHTML = devices.map(d => \`<option value="\${d.id}">\${d.name} (\${d.ip})</option>\`).join('');
            
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
        const devices = JSON.parse(decodeURIComponent(atob(devicesEncoded)));
        const devId = await this.promptDeviceSelection('Select Device for Enrollment:', devices);
        if (devId) {
            this.enrollFinger(uid, userId, devId);
        }
    },
    
    async deleteUserFlow(uid, userId, devicesEncoded) {
        const devices = JSON.parse(decodeURIComponent(atob(devicesEncoded)));
        const devId = await this.promptDeviceSelection('Select Device to Delete User From:', devices);
        if (devId) {
            this.deleteUser(uid, userId, devId);
        }
    },
    
    async editUserFlow(uid, userId, name, devicesEncoded, workPatternId) {
        const devices = JSON.parse(decodeURIComponent(atob(devicesEncoded)));
        const devId = await this.promptDeviceSelection('Select Device to Edit:', devices);
        if (devId) {
            this.editUser(uid, userId, name, devId, workPatternId);
        }
    },
    
    async deleteFingerDirectFlow(uid, userId, fingerIndex, devicesEncoded) {
        const devices = JSON.parse(decodeURIComponent(atob(devicesEncoded)));
        const devId = await this.promptDeviceSelection('Select Device to Delete Finger From:', devices);
        if (devId) {
            this.deleteFingerDirect(uid, userId, devId, fingerIndex);
        }
    },
    
    async deleteAllFingersFlow(uid, userId, devicesEncoded) {
        const devices = JSON.parse(decodeURIComponent(atob(devicesEncoded)));
        const devId = await this.promptDeviceSelection('Select Device to Clear All Fingerprints From:', devices);
        if (devId) {
            this.deleteAllFingers(uid, userId, devId);
        }
    },

    enrollFinger(uid, userId, devId) {`;

if (code.includes(target) && !code.includes('promptDeviceSelection')) {
    code = code.replace(target, replacement);
    fs.writeFileSync('renderer.js', code);
    console.log('Successfully patched Flow methods!');
} else {
    console.log('Target not found or already patched.');
}
