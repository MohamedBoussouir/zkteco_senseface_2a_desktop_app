const ZKLib = require('node-zklib');

function getEncodedTime(hour, minute, second) {
    const year = 2026;
    const month = 4; // May (0-indexed: 4)
    const day = 18;
    return ((year - 2000) * 12 * 31 + month * 31 + (day - 1)) * 24 * 60 * 60 + (hour * 3600 + minute * 60 + second);
}

async function run() {
    const ip = '192.168.0.157';
    const port = 4370;
    
    console.log(`Connecting to ZK Terminal at ${ip}:${port}...`);
    const zk = new ZKLib(ip, port, 10000, 4000);
    
    try {
        await zk.createSocket();
        console.log('Connected successfully!\n');
        
        console.log('Disabling device to write options safely...');
        await zk.disableDevice();
        
        // 1. Set StateMode=3 (Manual + Auto) which is the working state logging mode
        console.log('Setting StateMode=3 (Manual + Auto) and ~ShowState=1...');
        await zk.executeCmd(12, Buffer.from('StateMode=3\0'));
        await zk.executeCmd(12, Buffer.from('~ShowState=1\0'));
        
        // 2. Program schedule: Check-In (AS1) at 08:00, Check-Out (AS2) at 17:00
        console.log('Programming schedules:');
        console.log(' -> AS1 (Check-In 🟢) scheduled at 08:00 AM (Raw: 2048)');
        console.log(' -> AS2 (Check-Out 🔴) scheduled at 17:00 PM (Raw: 4352)');
        
        await zk.executeCmd(12, Buffer.from('AS1=2048\0'));
        await zk.executeCmd(12, Buffer.from('AS2=4352\0'));
        await zk.executeCmd(12, Buffer.from('AS3=-1\0'));
        await zk.executeCmd(12, Buffer.from('AS4=-1\0'));
        await zk.executeCmd(12, Buffer.from('AS5=-1\0'));
        await zk.executeCmd(12, Buffer.from('AS6=-1\0'));
        
        // 3. Jump the clock to 16:59:45 (15 seconds before the 17:00 threshold!)
        console.log('Setting device clock to 16:59:45 to let it tick past 17:00...');
        const encoded = getEncodedTime(16, 59, 45);
        const buf = Buffer.alloc(4);
        buf.writeUInt32LE(encoded, 0);
        await zk.executeCmd(202, buf);
        
        // Refresh options
        console.log('Applying options in device memory (CMD_REFRESHOPTION)...');
        await zk.executeCmd(1014);
        
        console.log('Enabling device...');
        await zk.enableDevice();
        
        console.log('\n✅ Setup successfully prepared!');
        console.log('----------------------------------------------------');
        console.log('Instructions:');
        console.log('1. Look at the device screen: it should show 16:59 (Arrivée).');
        console.log('2. Wait 15 seconds for the clock to reach 17:00.');
        console.log('3. Watch closely: Does it tick past 17:00 and change to "Bonne fin"?');
        console.log('4. Once it reaches 17:00 and changes, place your finger to punch!');
        console.log('5. Tell me as soon as you punch!');
        console.log('----------------------------------------------------');
        
    } catch (e) {
        console.error('An error occurred:', e.message);
    } finally {
        try {
            await zk.disconnect();
        } catch (e) {}
    }
}

run();
