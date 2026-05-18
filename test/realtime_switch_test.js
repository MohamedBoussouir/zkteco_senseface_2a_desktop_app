const ZKLib = require('node-zklib');
const readline = require('readline');

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

function pad(num) {
    return String(num).padStart(2, '0');
}

function askQuestion(query) {
    return new Promise(resolve => rl.question(query, resolve));
}

function decodeZKTime(tVal) {
    const second = tVal % 60;
    const rMin = Math.floor(tVal / 60);
    const minute = rMin % 60;
    const rHour = Math.floor(rMin / 60);
    const hour = rHour % 24;
    const rDay = Math.floor(rHour / 24);
    const day = (rDay % 31) + 1;
    const rMonth = Math.floor(rDay / 31);
    const month = (rMonth % 12) + 1;
    const year = Math.floor(rMonth / 12) + 2000;

    return { year, month, day, hour, minute, second };
}

async function run() {
    const ip = '192.168.0.157';
    const port = 4370;

    console.log(`Connecting to ZK Terminal at ${ip}:${port}...`);
    const zk = new ZKLib(ip, port, 10000, 4000);

    try {
        await zk.createSocket();
        console.log('Connected successfully!\n');

        // 1. Fetch exact device time using CMD_GET_TIME (201)
        console.log('Fetching exact internal clock time from device...');
        const res = await zk.executeCmd(201, Buffer.alloc(0));
        if (res.length < 12) {
            throw new Error('Failed to retrieve device time: response too short');
        }

        const tVal = res.readUInt32LE(8);
        const deviceTime = decodeZKTime(tVal);
        console.log(`Device Clock Time: ${pad(deviceTime.hour)}:${pad(deviceTime.minute)}:${pad(deviceTime.second)} (${deviceTime.year}-${deviceTime.month}-${deviceTime.day})`);

        const hour = deviceTime.hour;
        const min = deviceTime.minute;

        console.log('\nSelect scheduling mode:');
        console.log('[1] Automatic Test Slots (+1 min and +2 min from current clock)');
        console.log('[2] Enter Custom Times Manually (Type your own hours and minutes)');
        const choice = await askQuestion('Select an option (1 or 2): ');

        let t1Hour, t1Min, t2Hour, t2Min;

        if (choice.trim() === '2') {
            console.log('\n--- ENTER CUSTOM TIMES MANUALLY ---');
            
            const inHourStr = await askQuestion('Enter Check-In (Arrivée) Hour [0-23]: ');
            t1Hour = parseInt(inHourStr.trim()) || 8;
            
            const inMinStr = await askQuestion('Enter Check-In (Arrivée) Minute [0-59]: ');
            t1Min = parseInt(inMinStr.trim()) || 0;

            const outHourStr = await askQuestion('Enter Check-Out (Départ) Hour [0-23]: ');
            t2Hour = parseInt(outHourStr.trim()) || 17;

            const outMinStr = await askQuestion('Enter Check-Out (Départ) Minute [0-59]: ');
            t2Min = parseInt(outMinStr.trim()) || 0;
        } else {
            // Trigger 1 (Check-In) in 1 minute from the device's current minute
            t1Min = min + 1;
            t1Hour = hour;
            if (t1Min >= 60) {
                t1Min = t1Min % 60;
                t1Hour = (t1Hour + 1) % 24;
            }

            // Trigger 2 (Check-Out) in 2 minutes from the device's current minute
            t2Min = min + 2;
            t2Hour = hour;
            if (t2Min >= 60) {
                t2Min = t2Min % 60;
                t2Hour = (t2Hour + 1) % 24;
            }
        }

        const as1Val = (t1Hour << 8) | t1Min;
        const as2Val = (t2Hour << 8) | t2Min; // Will write to both AS2 and AS4

        console.log('\n===================================================');
        console.log('PROGRAMMING REALTIME SWITCH TEST (REBOOT-FREE):');
        console.log(`Device Clock Time: ${pad(hour)}:${pad(min)}`);
        console.log(` -> AS1 (Check-In 🟢 / Arrivée) set to: ${pad(t1Hour)}:${pad(t1Min)} (Raw: ${as1Val})`);
        console.log(` -> AS2 & AS4 (Check-Out 🔴 / Départ) set to: ${pad(t2Hour)}:${pad(t2Min)} (Raw: ${as2Val})`);
        console.log('===================================================\n');

        // Set StateMode=3 (Manual + Auto) so the standby screen displays the active state word constantly!
        console.log('Setting StateMode=3 (Manual + Auto) and ~ShowState=1...');
        await zk.executeCmd(12, Buffer.from('StateMode=3\0'));
        await zk.executeCmd(12, Buffer.from('~ShowState=1\0'));

        // Write schedules to AS1, AS2, AS4, and disable AS3
        await zk.executeCmd(12, Buffer.from(`AS1=${as1Val}\0`));
        await zk.executeCmd(12, Buffer.from(`AS2=${as2Val}\0`)); // Treat AS2 as Check-Out
        await zk.executeCmd(12, Buffer.from(`AS3=-1\0`));         // Disabled
        await zk.executeCmd(12, Buffer.from(`AS4=${as2Val}\0`)); // Treat AS4 as Check-Out
        await zk.executeCmd(12, Buffer.from(`AS5=-1\0`));
        await zk.executeCmd(12, Buffer.from(`AS6=-1\0`));

        // Apply changes to device options memory
        console.log('Applying changes to device memory (CMD_REFRESHOPTION)...');
        await zk.executeCmd(1014);

        console.log('\n✅ Rules programmed successfully!');
        console.log('\n⏱️ TEST RUN DIRECTIONS (NO REBOOT / NO SHUTDOWN):');
        console.log('---------------------------------------------------');
        console.log(`1. Look at your device's screen right now.`);
        console.log(`2. Current time on device clock: ${pad(hour)}:${pad(min)}`);
        console.log(`3. When the clock ticks to ${pad(t1Hour)}:${pad(t1Min)}:`);
        console.log(`   👉 The screen word will change automatically to Arrivée 🟢!`);
        console.log(`4. When the clock ticks to ${pad(t2Hour)}:${pad(t2Min)}:`);
        console.log(`   👉 The screen word will change automatically to Bonne fin / Départ 🔴!`);
        console.log('---------------------------------------------------');
        console.log('\nKeeping the script open to monitor the device. Press Ctrl+C to exit when done.');
        
        // Wait forever so they can see the test complete
        await new Promise(() => {});

    } catch (e) {
        console.error('An error occurred:', e.message);
    } finally {
        try {
            await zk.disconnect();
            console.log('\nDisconnected.');
        } catch (e) { }
        rl.close();
    }
}

run();
