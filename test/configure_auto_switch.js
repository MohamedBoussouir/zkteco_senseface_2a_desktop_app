const ZKLib = require('node-zklib');

// Helper to decode ZK time format (Hour * 256 + Minute)
function decodeZKTime(valStr) {
    const val = parseInt(valStr);
    if (isNaN(val) || val === -1) {
        return 'Disabled ❌';
    }
    const hour = Math.floor(val / 256);
    const minute = val % 256;
    const hourStr = String(hour).padStart(2, '0');
    const minuteStr = String(minute).padStart(2, '0');
    return `${hourStr}:${minuteStr} ⏰`;
}

// Helper to encode time (Hour * 256 + Minute)
function encodeZKTime(hour, minute) {
    return (hour << 8) | minute;
}

async function run() {
    const ip = '192.168.0.157';
    const port = 4370;
    
    console.log(`Connecting to ZK Terminal at ${ip}:${port}...`);
    const zk = new ZKLib(ip, port, 10000, 4000);
    
    try {
        await zk.createSocket();
        console.log('Connected successfully!\n');
        
        // ----------------------------------------------------
        // 1. READ CURRENT AUTO-SWITCH RULES
        // ----------------------------------------------------
        console.log('===================================================');
        console.log('READING CURRENT AUTO-SWITCH STATUS TIMERS (AS1 - AS16):');
        console.log('===================================================');
        
        for (let i = 1; i <= 16; i++) {
            try {
                // Command 11 is CMD_OPTIONS_RRQ
                const res = await zk.executeCmd(11, Buffer.from(`AS${i}\0`));
                const responseStr = res.slice(8).toString('ascii').replace(/\0/g, '');
                
                if (responseStr.includes('=')) {
                    const value = responseStr.split('=')[1];
                    console.log(`AS${i} Slot: ${decodeZKTime(value)} (Raw Option: "${responseStr}")`);
                } else {
                    console.log(`AS${i} Slot: Failed to parse (Raw: "${responseStr}")`);
                }
            } catch (err) {
                console.log(`AS${i} Slot: Error reading: ${err.message}`);
            }
        }
        
        // Read ShowState option (whether to show status on device screen)
        try {
            const res = await zk.executeCmd(11, Buffer.from(`ShowState\0`));
            const responseStr = res.slice(8).toString('ascii').replace(/\0/g, '');
            console.log(`\nShowState Option: ${responseStr}`);
        } catch(e) {}
        
        // ----------------------------------------------------
        // 2. DEMONSTRATION OF PROGRAMMING
        // ----------------------------------------------------
        console.log('\n===================================================');
        console.log('PROGRAMMING AUTOMATIC SWITCH RULES (EXAMPLE):');
        console.log('===================================================');
        
        // Suppose we want to configure:
        // - AS1 to switch to Check-In (0) at 08:00 AM
        // - AS2 to switch to Break-Out (2) at 12:00 PM
        // - AS3 to switch to Break-In (3) at 13:00 PM
        // - AS4 to switch to Check-Out (1) at 17:00 PM
        
        const schedule = [
            { slot: 1, hour: 8,  minute: 0,  label: 'Check-In 🟢' },
            { slot: 2, hour: 12, minute: 0,  label: 'Break-Out 🟠' },
            { slot: 3, hour: 13, minute: 0,  label: 'Break-In 🔵' },
            { slot: 4, hour: 17, minute: 0,  label: 'Check-Out 🔴' }
        ];
        
        console.log('Writing schedules to ZK Terminal...');
        for (const item of schedule) {
            const encodedVal = encodeZKTime(item.hour, item.minute);
            const cmdStr = `AS${item.slot}=${encodedVal}\0`;
            
            // Command 12 is CMD_OPTIONS_WRQ
            await zk.executeCmd(12, Buffer.from(cmdStr));
            console.log(`  -> Configured AS${item.slot} for ${item.label} at ${String(item.hour).padStart(2,'0')}:${String(item.minute).padStart(2,'0')} (Encoded: ${encodedVal})`);
        }
        
        // Refresh options to apply settings on ZK firmware
        console.log('\nApplying changes to device memory (CMD_REFRESHOPTION)...');
        await zk.executeCmd(1014); // CMD_REFRESHOPTION
        console.log('Device scheduled states successfully programmed!');
        
        // ----------------------------------------------------
        // 3. READ BACK TO CONFIRM
        // ----------------------------------------------------
        console.log('\n===================================================');
        console.log('VERIFYING NEW PROGRAMMED VALUES (AS1 - AS4):');
        console.log('===================================================');
        for (let i = 1; i <= 4; i++) {
            const res = await zk.executeCmd(11, Buffer.from(`AS${i}\0`));
            const responseStr = res.slice(8).toString('ascii').replace(/\0/g, '');
            const value = responseStr.split('=')[1];
            console.log(`AS${i} Slot: ${decodeZKTime(value)} (Confirmed Raw: "${responseStr}")`);
        }
        
    } catch (e) {
        console.error('An error occurred during programming:', e.message);
    } finally {
        try {
            await zk.disconnect();
            console.log('\nDisconnected from device.');
        } catch (e) {}
    }
}

run();
