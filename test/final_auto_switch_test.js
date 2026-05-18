const ZKLib = require('node-zklib');

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
        
        // 1. Set StateMode=1 (YES / ENABLE) and ~ShowState=1 (Show States)
        console.log('Setting StateMode=1 (Enable Auto Switch) and ~ShowState=1...');
        await zk.executeCmd(12, Buffer.from('StateMode=1\0'));
        await zk.executeCmd(12, Buffer.from('~ShowState=1\0'));
        
        // 2. Schedule so that at the current time, Check-Out (1) is active!
        // We set AS2 (Check-Out 🔴) to trigger at 01:00 AM (Raw: 1*256 + 0 = 256)
        // We set AS1 (Check-In 🟢) to trigger at 23:00 PM (Raw: 23*256 + 0 = 5888)
        // Since the current time (around 14:42) is between 01:00 AM and 23:00 PM,
        // the active state will be AS2 (Check-Out / Départ) 🔴!
        console.log('Programming schedules:');
        console.log(' -> AS2 (Check-Out 🔴) scheduled at 01:00 AM (Active State)');
        console.log(' -> AS1 (Check-In 🟢) scheduled at 23:00 PM (Inactive State)');
        
        await zk.executeCmd(12, Buffer.from('AS2=256\0'));   // 01:00 AM
        await zk.executeCmd(12, Buffer.from('AS1=5888\0'));  // 23:00 PM
        
        // Disable other slots for this test
        await zk.executeCmd(12, Buffer.from('AS3=-1\0'));
        await zk.executeCmd(12, Buffer.from('AS4=-1\0'));
        await zk.executeCmd(12, Buffer.from('AS5=-1\0'));
        await zk.executeCmd(12, Buffer.from('AS6=-1\0'));
        
        // Refresh options
        console.log('Applying options in device memory (CMD_REFRESHOPTION)...');
        await zk.executeCmd(1014);
        
        console.log('Enabling device...');
        await zk.enableDevice();
        
        // 3. Reboot the device so the LCD UI loads the new Auto State layout!
        console.log('Rebooting device to apply screen layout refresh...');
        await zk.executeCmd(1004, Buffer.alloc(0)); // CMD_RESTART
        await new Promise(r => setTimeout(r, 500));
        await zk.executeCmd(1001, Buffer.alloc(0)); // CMD_EXIT
        
        console.log('\n✅ Script executed successfully! Device is now rebooting.');
        console.log('Wait 20 seconds for the device to boot up, then place your finger to punch and tell me!');
        
    } catch (e) {
        console.error('An error occurred:', e.message);
    } finally {
        try {
            await zk.disconnect();
        } catch (e) {}
    }
}

run();
