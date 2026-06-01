const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const { initDb } = require('./src/modules/db');
const { setupIpcHandlers } = require('./src/modules/ipc-handlers');
const { startAdmsServer } = require('./src/modules/adms-server');
const licensing = require('./src/modules/licensing');

ipcMain.on('log', (event, msg) => {
    console.log(`[Renderer] ${msg}`);
});

let mainWindow;

async function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1600,
        height: 950,
        minWidth: 1400,
        minHeight: 850,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false
        },
        title: "HS ZK Attendance System"
    });

    mainWindow.loadFile('index.html');
    
    // Security: Block DevTools shortcuts in production
    const isDev = process.env.NODE_ENV === 'development';
    if (!isDev) {
        mainWindow.removeMenu();
        mainWindow.webContents.on('before-input-event', (event, input) => {
            if (
                (input.control && input.shift && input.key.toLowerCase() === 'i') ||
                (input.meta && input.shift && input.key.toLowerCase() === 'i') ||
                (input.key === 'F12')
            ) {
                event.preventDefault();
                console.warn('DevTools shortcut blocked.');
            }
        });
    }

    // Initialize IPC Handlers
    setupIpcHandlers(mainWindow);

    // Start Background Tasks
    startAdmsServer(80, mainWindow);
}

// Security: License Check IPC
ipcMain.handle('check-license', async () => {
    try {
        const result = licensing.verifyLicense();
        return result;
    } catch (e) {
        return { valid: false, message: 'License check failed.' };
    }
});

app.whenReady().then(async () => {
    await initDb();
    createWindow();

    app.on('activate', function () {
        if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
});

app.on('window-all-closed', function () {
    if (process.platform !== 'darwin') app.quit();
});
