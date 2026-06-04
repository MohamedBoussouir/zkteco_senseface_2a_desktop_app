const { db } = require('./db');
const { queueAdmsCommand } = require('./adms-server');

let isSyncing = false;
let loopStarted = false;

async function startBackgroundSync(mainWindow) {
    const runSync = async () => {
        if (isSyncing) return;
        isSyncing = true;
        console.log('[Scheduler] Executing sync cycle...');

        try {
            // In ADMS, devices push data automatically.
            // But we can force a sync by queuing a global DATA QUERY command.
            queueAdmsCommand('DATA QUERY ATTLOG');
            queueAdmsCommand('DATA QUERY userinfo');
            queueAdmsCommand('DATA QUERY BIODATA');
            
            if (mainWindow) mainWindow.webContents.send('background-sync-complete');
        } catch (e) {
            console.error('[Scheduler] Sync error:', e.message || e);
        } finally {
            isSyncing = false;
        }
        // Force full pull every 30 minutes just in case
        setTimeout(runSync, 30 * 60 * 1000); 
    };

    if (loopStarted) {
        console.log('[Scheduler] Manual sync trigger requested.');
        if (!isSyncing) return runSync();
        return;
    }
    
    loopStarted = true;
    console.log('[Scheduler] Background sync loop initialized.');
    runSync();
}

module.exports = { startBackgroundSync };
