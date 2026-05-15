const crypto = require('crypto');
const { machineIdSync } = require('node-machine-id');
const fs = require('fs');
const path = require('path');

class LicensingManager {
    constructor(secretKey = 'HS_ZK_SECRET_KEY_2026') {
        this.secretKey = crypto.createHash('sha256').update(secretKey).digest();
        this.iv = Buffer.alloc(16, 0); 
        this.licensePath = path.join(process.cwd(), 'license.dat');
        this.timeTrackPath = path.join(process.cwd(), '.sys_cache.dat');
    }

    encrypt(text) {
        const cipher = crypto.createCipheriv('aes-256-cbc', this.secretKey, this.iv);
        let encrypted = cipher.update(text, 'utf8', 'hex');
        encrypted += cipher.final('hex');
        return encrypted;
    }

    decrypt(hex) {
        try {
            const decipher = crypto.createDecipheriv('aes-256-cbc', this.secretKey, this.iv);
            let decrypted = decipher.update(hex, 'hex', 'utf8');
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
            return { valid: false, message: "تلاعب في تاريخ النظام! يرجى ضبط التاريخ والوقت." };
        }

        if (!fs.existsSync(this.licensePath)) {
            return { valid: false, message: "ملف الترخيص مفقود. يرجى التواصل مع المطور." };
        }

        const encryptedLicense = fs.readFileSync(this.licensePath, 'utf8');
        const decryptedData = this.decrypt(encryptedLicense);

        if (!decryptedData) {
            return { valid: false, message: "بيانات الترخيص غير صالحة." };
        }

        try {
            const { mid, expiry } = JSON.parse(decryptedData);
            const currentMid = this.getMachineId();
            const now = new Date();
            const expiryDate = new Date(expiry);

            if (mid !== currentMid) {
                return { valid: false, message: "هذا الترخيص مخصص لجهاز آخر." };
            }

            if (now > expiryDate) {
                return { valid: false, message: `انتهت صلاحية الترخيص في ${expiryDate.toLocaleDateString()}.` };
            }

            return { valid: true, expiryDate };
        } catch (e) {
            return { valid: false, message: "فشل في قراءة بيانات الترخيص." };
        }
    }
}

const licensing = new LicensingManager();
module.exports = licensing;
