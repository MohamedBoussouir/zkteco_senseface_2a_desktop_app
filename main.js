const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const { initDb } = require('./src/modules/db');
const { setupIpcHandlers } = require('./src/modules/ipc-handlers');
const { startBackgroundSync } = require('./src/modules/scheduler');
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
    
    // Check License on startup
    const license = licensing.verifyLicense();
    if (!license.valid) {
        mainWindow.webContents.on('did-finish-load', () => {
            mainWindow.webContents.send('license-error', license.message);
        });
    }

    // Initialize IPC Handlers
    setupIpcHandlers(mainWindow);

    // Start Background Tasks
    startBackgroundSync(mainWindow);
}

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
