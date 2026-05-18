const ZKLib = require('node-zklib');

async function testLogs() {
    const ip = '192.168.0.157';
    const port = 4370;
    
    console.log(`Connecting to ZK Terminal at ${ip}:${port}...`);
    const zk = new ZKLib(ip, port, 10000, 4000);
    
    try {
        await zk.createSocket();
        console.log('Connected successfully!');
        
        console.log('Fetching attendance records from device...');
        const logs = await zk.getAttendances();
        const lData = Array.isArray(logs) ? logs : (logs.data || []);
        
        console.log(`Fetched ${lData.length} records. Parsing statuses:\n`);
        
        const getStatusName = (status) => {
            const s = parseInt(status);
            switch (s) {
                case 0: return 'Check-In 🟢';
                case 1: return 'Check-Out 🔴';
                case 2: return 'Break-Out 🟠';
                case 3: return 'Break-In 🔵';
                case 4: return 'OT In 🟣';
                case 5: return 'OT Out -';
                default: return `Verified / Unknown (${status})`;
            }
        };

        // Reverse to get the latest punches first
        const displayLogs = [...lData].reverse().slice(0, 20);
        
        console.log('-----------------------------------------------------------------------------------');
        console.log(String('USER ID').padEnd(12) + ' | ' + String('TIMESTAMP').padEnd(25) + ' | ' + String('RAW STATUS').padEnd(10) + ' | ' + 'PUNCH TYPE');
        console.log('-----------------------------------------------------------------------------------');
        
        for (const log of displayLogs) {
            const rawId = log.deviceUserId || log.userId;
            const time = log.recordTime || log.timestamp;
            const status = log.status;
            
            const timeStr = time instanceof Date ? time.toLocaleString() : new Date(time).toLocaleString();
            
            console.log(
                String(rawId).padEnd(12) + ' | ' + 
                String(timeStr).padEnd(25) + ' | ' + 
                String(status !== undefined ? status : 'undefined').padEnd(10) + ' | ' + 
                getStatusName(status)
            );
        }
        console.log('-----------------------------------------------------------------------------------');
        console.log(`Showing the latest 20 punches of total ${lData.length} logs.`);
        
    } catch (e) {
        console.error('An error occurred:', e.message);
    } finally {
        try {
            await zk.disconnect();
            console.log('\nDisconnected from device.');
        } catch (e) {}
    }
}

testLogs();
