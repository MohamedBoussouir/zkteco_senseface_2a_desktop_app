const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    invoke: (channel, data) => ipcRenderer.invoke(channel, data),
    on: (channel, func) => {
        const subscription = (event, ...args) => func(...args);
        ipcRenderer.on(channel, subscription);
        return () => ipcRenderer.removeListener(channel, subscription);
    },
    removeAllListeners: (channel) => ipcRenderer.removeAllListeners(channel),
    log: (msg) => ipcRenderer.send('log', msg)
});

contextBridge.exposeInMainWorld('securityAPI', {
    verifyLicenseStatus: async () => {
        try {
            return await ipcRenderer.invoke('check-license');
        } catch (error) {
            console.error('IPC Communication Error:', error);
            return { valid: false, message: 'حدث خطأ غير متوقع أثناء الاتصال بنظام الحماية.' };
        }
    }
});
