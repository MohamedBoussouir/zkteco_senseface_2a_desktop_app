const ZKLib = require('node-zklib');
const readline = require('readline');

function pad(num) {
    return String(num).padStart(2, '0');
}

function getEncodedTime(hour, minute, second = 0) {
    const year = 2026;
    const month = 4; // May (0-indexed: 4)
    const day = 18;
    return ((year - 2000) * 12 * 31 + month * 31 + (day - 1)) * 24 * 60 * 60 + (hour * 3600 + minute * 60 + second);
}

async function setDeviceTime(zk, hour, minute, second = 0) {
    console.log('Disabling device to write clock safely...');
    await zk.disableDevice();
    
    const year = 2026;
    const month = 5; // May (1-indexed)
    const day = 18;

    // Method 1: Command 202 (4-byte encoded)
    try {
        const encoded = ((year - 2000) * 12 * 31 + (month - 1) * 31 + (day - 1)) * 24 * 60 * 60 + (hour * 3600 + minute * 60 + second);
        const buf4 = Buffer.alloc(4);
        buf4.writeUInt32LE(encoded, 0);
        await zk.executeCmd(202, buf4);
        console.log(' -> Sent Method 1 (Cmd 202, 4-byte encoded)');
    } catch(e) {
        console.log('Method 1 failed:', e.message);
    }

    // Method 2: Command 10 (4-byte encoded)
    try {
        const encoded = ((year - 2000) * 12 * 31 + (month - 1) * 31 + (day - 1)) * 24 * 60 * 60 + (hour * 3600 + minute * 60 + second);
        const buf4 = Buffer.alloc(4);
        buf4.writeUInt32LE(encoded, 0);
        await zk.executeCmd(10, buf4);
        console.log(' -> Sent Method 2 (Cmd 10, 4-byte encoded)');
    } catch(e) {
        console.log('Method 2 failed:', e.message);
    }

    // Method 3: Command 10 (6-byte array: YY, MM, DD, HH, MM, SS)
    try {
        const buf6 = Buffer.from([year % 100, month, day, hour, minute, second]);
        await zk.executeCmd(10, buf6);
        console.log(' -> Sent Method 3 (Cmd 10, 6-byte array)');
    } catch(e) {
        console.log('Method 3 failed:', e.message);
    }

    // Method 4: Native setTime
    try {
        const targetDate = new Date(year, month - 1, day, hour, minute, second);
        await zk.setTime(targetDate);
        console.log(' -> Sent Method 4 (Library Native)');
    } catch(e) {
        console.log('Method 4 failed:', e.message);
    }

    await zk.executeCmd(1013); // CMD_REFRESHDATA
    await zk.executeCmd(1014); // Refresh options
    
    console.log('Enabling device...');
    await zk.enableDevice();
    
    // Command 1017 makes the device beep to confirm
    try { await zk.executeCmd(1017, Buffer.alloc(0)); } catch(e) {}
}

async function getDeviceTime(zk) {
    const res = await zk.executeCmd(201, Buffer.alloc(0));
    if (res.length < 12) return null;
    const tVal = res.readUInt32LE(8);
    
    const second = tVal % 60;
    let time = (tVal - second) / 60;
    const minute = time % 60;
    time = (time - minute) / 60;
    const hour = time % 24;
    return { hour, minute, second };
}

async function showMenu(zk) {
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });
    
    const timeInfo = await getDeviceTime(zk);
    console.log(`\n======================================================`);
    console.log(`📱 ZK DEVICE INTERACTIVE TIME TESTING SUITE`);
    if (timeInfo) {
        console.log(`Current Device Clock: ${pad(timeInfo.hour)}:${pad(timeInfo.minute)}:${pad(timeInfo.second)}`);
    }
    console.log(`======================================================`);
    console.log(`[1] Trigger Check-In Screen 🟢 (Arrivée)`);
    console.log(`[2] Trigger Check-Out Screen 🔴 (Bonne fin / Départ)`);
    console.log(`[3] Restore Device Clock to PC Time`);
    console.log(`[4] Read Last Attendance Record to verify status`);
    console.log(`[5] Exit`);
    console.log(`======================================================`);
    
    rl.question('Select an option (1-5): ', async (answer) => {
        rl.close();
        const opt = answer.trim();
        
        try {
            if (opt === '1') {
                console.log('\nSetting device clock to 07:59:57 (3 seconds before 08:00 Check-In)...');
                await setDeviceTime(zk, 7, 59, 57);
                console.log('Waiting 3.5 seconds for clock to transition naturally...');
                await new Promise(r => setTimeout(r, 3800));
                
                // Force a screen redraw by cycling device state
                console.log('Refreshing device screen UI...');
                await zk.disableDevice();
                await zk.enableDevice();
                
                console.log('\n🟢 Boundary crossed! The active state has changed to Check-In (Arrivée)!');
                console.log('💡 Note: ZK K40 standby screen text does not redraw dynamically during clock jumps.');
                console.log('👉 To update the screen text instantly without turning the device off:');
                console.log('   Press the [F1] key on the keypad, or simply place your finger to punch!');
            } 
            else if (opt === '2') {
                console.log('\nSetting device clock to 16:59:57 (3 seconds before 17:00 Check-Out)...');
                await setDeviceTime(zk, 16, 59, 57);
                console.log('Waiting 3.5 seconds for clock to transition naturally...');
                await new Promise(r => setTimeout(r, 3800));
                
                // Force a screen redraw by cycling device state
                console.log('Refreshing device screen UI...');
                await zk.disableDevice();
                await zk.enableDevice();
                
                console.log('\n🔴 Boundary crossed! The active state has changed to Check-Out (Départ / Bonne fin)!');
                console.log('💡 Note: ZK K40 standby screen text does not redraw dynamically during clock jumps.');
                console.log('👉 To update the screen text instantly without turning the device off:');
                console.log('   Press the [F2] key on the keypad, or simply place your finger to punch!');
            } 
            else if (opt === '3') {
                console.log('\nRestoring device clock to PC time...');
                const now = new Date();
                await setDeviceTime(zk, now.getHours(), now.getMinutes(), now.getSeconds());
                console.log('Done! Device clock synchronized with your computer (No reboot performed).');
            }
            else if (opt === '4') {
                console.log('\nFetching last attendance records from device...');
                const logs = await zk.getAttendances();
                const lData = Array.isArray(logs) ? logs : (logs.data || []);
                if (lData.length === 0) {
                    console.log('No attendance logs found.');
                } else {
                    const last = lData[lData.length - 1];
                    const states = {
                        0: 'Check-In 🟢 (Arrivée)',
                        1: 'Check-Out 🔴 (Départ)',
                        2: 'Break-Out 🟠',
                        3: 'Break-In 🔵',
                        4: 'OT In 🟣',
                        5: 'OT Out -'
                    };
                    console.log('\n----------------------------------------');
                    console.log('LAST RECORD FOUND:');
                    console.log(`User ID  : ${last.deviceUserId || last.userId}`);
                    console.log(`Time     : ${last.recordTime || last.timestamp}`);
                    console.log(`Raw Status: ${last.status}`);
                    console.log(`Status   : ${states[last.status] || 'Unknown'}`);
                    console.log('----------------------------------------');
                }
            }
            else if (opt === '5') {
                console.log('Exiting...');
                await zk.disconnect();
                process.exit(0);
            }
            else {
                console.log('Invalid option!');
            }
        } catch (e) {
            console.error('Error during execution:', e.message);
        }
        
        // Loop back to show menu
        setTimeout(() => showMenu(zk), 2000);
    });
}

async function run() {
    const ip = '192.168.0.157';
    const port = 4370;
    
    console.log(`Connecting to ZK Terminal at ${ip}:${port}...`);
    const zk = new ZKLib(ip, port, 10000, 4000);
    
    try {
        await zk.createSocket();
        console.log('Connected successfully!');
        
        // Program the standard schedules for the test
        console.log('Initializing standard schedules for the test...');
        await zk.disableDevice();
        
        // Enforce working StateMode=3 and ~ShowState=1
        await zk.executeCmd(12, Buffer.from('StateMode=3\0'));
        await zk.executeCmd(12, Buffer.from('~ShowState=1\0'));
        
        console.log('Setting AS1 (Check-In) to 08:00 (2048) and AS2 (Check-Out) to 17:00 (4352)...');
        await zk.executeCmd(12, Buffer.from(`AS1=2048\0`));  // 08:00 Check-In (Slot 1)
        await zk.executeCmd(12, Buffer.from(`AS2=4352\0`));  // 17:00 Check-Out (Slot 2)
        await zk.executeCmd(12, Buffer.from(`AS3=-1\0`));    // Disabled (Slot 3)
        await zk.executeCmd(12, Buffer.from(`AS4=-1\0`));    // Disabled (Slot 4)
        await zk.executeCmd(12, Buffer.from(`AS5=-1\0`));    // Disabled (Slot 5)
        await zk.executeCmd(12, Buffer.from(`AS6=-1\0`));    // Disabled (Slot 6)
        
        await zk.executeCmd(1013); // CMD_REFRESHDATA
        await zk.executeCmd(1014); // Refresh options
        
        await zk.enableDevice();
        console.log('Standard schedules initialized successfully!');
        
        showMenu(zk);
        
    } catch (e) {
        console.error('Connection failed:', e.message);
    }
}

run();
