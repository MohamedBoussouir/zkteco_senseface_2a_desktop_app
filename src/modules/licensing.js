const crypto = require('crypto');
const { machineIdSync } = require('node-machine-id');
const fs = require('fs');
const path = require('path');

class LicensingManager {
    constructor(secretKey = 'HS_ZK_SECRET_KEY_2026') {
        this.secretKey = crypto.createHash('sha256').update(secretKey).digest();
        this.licensePath = path.join(process.cwd(), 'license.json');
        this.timeTrackPath = path.join(process.cwd(), '.sys_cache.json');
    }

    encrypt(text) {
        const iv = crypto.randomBytes(16);
        const cipher = crypto.createCipheriv('aes-256-gcm', this.secretKey, iv);
        let encrypted = cipher.update(text, 'utf8', 'hex');
        encrypted += cipher.final('hex');
        const authTag = cipher.getAuthTag().toString('hex');
        return JSON.stringify({
            iv: iv.toString('hex'),
            content: encrypted,
            authTag: authTag
        });
    }

    decrypt(encryptedJsonStr) {
        try {
            const encryptedData = JSON.parse(encryptedJsonStr);
            if (!encryptedData.iv || !encryptedData.content || !encryptedData.authTag) return null;

            const iv = Buffer.from(encryptedData.iv, 'hex');
            const authTag = Buffer.from(encryptedData.authTag, 'hex');
            
            const decipher = crypto.createDecipheriv('aes-256-gcm', this.secretKey, iv);
            decipher.setAuthTag(authTag);

            let decrypted = decipher.update(encryptedData.content, 'hex', 'utf8');
            decrypted += decipher.final('utf8');
            return decrypted;
        } catch (e) {
            return null;
        }
    }

    getMachineId() {
        try {
            return machineIdSync();
        } catch (e) {
            console.error('[Licensing] Failed to get machine ID:', e.message);
            return 'UNKNOWN_MACHINE_ID';
        }
    }

    checkClockFraud() {
        const now = new Date().getTime();
        let lastRun = 0;

        if (fs.existsSync(this.timeTrackPath)) {
            const encryptedTime = fs.readFileSync(this.timeTrackPath, 'utf8');
            const decryptedTime = this.decrypt(encryptedTime);
            lastRun = parseInt(decryptedTime) || 0;
        }

        if (now < lastRun) return false;

        fs.writeFileSync(this.timeTrackPath, this.encrypt(now.toString()));
        return true;
    }

    verifyLicense() {
        if (!this.checkClockFraud()) {
            return { valid: false, message: "System clock tampering detected! Please adjust date and time." };
        }

        if (!fs.existsSync(this.licensePath)) {
            return { valid: false, message: "License file missing. Please contact the developer." };
        }

        const encryptedLicense = fs.readFileSync(this.licensePath, 'utf8');
        const decryptedData = this.decrypt(encryptedLicense);

        if (!decryptedData) {
            return { valid: false, message: "Invalid license data." };
        }

        try {
            const { mid, expiry } = JSON.parse(decryptedData);
            const currentMid = this.getMachineId();
            const now = new Date();
            const expiryDate = new Date(expiry);

            if (mid !== currentMid) {
                return { valid: false, message: "This license is assigned to a different device." };
            }

            if (now > expiryDate) {
                return { valid: false, message: `License expired on ${expiryDate.toLocaleDateString()}.` };
            }

            return { valid: true, expiryDate };
        } catch (e) {
            return { valid: false, message: "Failed to read license data." };
        }
    }

    saveLicenseKey(key) {
        try {
            const decrypted = this.decrypt(key.trim());
            if (!decrypted) return { success: false, message: "Invalid license key for the approved encryption." };

            const { mid, expiry } = JSON.parse(decrypted);
            const currentMid = this.getMachineId();
            const now = new Date();
            const expiryDate = new Date(expiry);

            if (mid !== currentMid) {
                return { success: false, message: "This license is assigned to a different device." };
            }

            if (now > expiryDate) {
                return { success: false, message: `This license expired on ${expiryDate.toLocaleDateString()}.` };
            }

            fs.writeFileSync(this.licensePath, key.trim(), 'utf8');
            return { success: true };
        } catch (e) {
            return { success: false, message: "License key data is corrupted or invalid." };
        }
    }

    generateLicense(mid, expiry) {
        const payload = JSON.stringify({ mid, expiry });
        return this.encrypt(payload);
    }
}

const licensing = new LicensingManager();
module.exports = licensing;
