const ZKLib = require('node-zklib');
const readline = require('readline');

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

const ip = '192.168.0.157';
const port = 4370;

function askQuestion(query) {
    return new Promise(resolve => rl.question(query, resolve));
}

// Encode time: Hour * 256 + Minute
function encodeZKTime(hour, minute) {
    return (hour << 8) | minute;
}

async function main() {
    console.log(`\n======================================================`);
    console.log(`📺 ZK SCREEN WORD CONTROLLER (Arrivée vs Départ)`);
    console.log(`Connecting to ZK Terminal at ${ip}:${port}...`);
    console.log(`======================================================`);

    const zk = new ZKLib(ip, port, 10000, 4000);
    
    try {
        await zk.createSocket();
        console.log('🟢 Connected successfully!');

        // Get current device clock
        const resTime = await zk.executeCmd(201, Buffer.alloc(0));
        const tVal = resTime.readUInt32LE(8);
        const s = tVal % 60;
        let time = (tVal - s) / 60;
        const m = time % 60;
        time = (time - m) / 60;
        const h = time % 24;

        console.log(`🕒 Current Device Time: ${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}\n`);

        console.log('Select the screen state you want to display:');
        console.log('--------------------------------------------');
        console.log(' [1] Set Screen to Check-In (🟢 Arrivée)');
        console.log(' [2] Set Screen to Check-Out (🔴 Départ / Bonne fin)');
        console.log('--------------------------------------------');

        const choice = await askQuestion('Enter choice (1 or 2): ');

        if (choice.trim() === '1') {
            console.log('\nConfiguring device for: Check-In (Arrivée) 🟢...');
            await zk.disableDevice();
            
            // Set StateMode=3 (Working mode) and ShowState=1
            await zk.executeCmd(12, Buffer.from('StateMode=3\0'));
            await zk.executeCmd(12, Buffer.from('~ShowState=1\0'));

            // Set AS1 (Check-In) to be active right now!
            // We set AS1 to 01:00 AM (so it's active at the current clock time)
            // And disable AS2 (Check-Out)
            await zk.executeCmd(12, Buffer.from(`AS1=${encodeZKTime(1, 0)}\0`)); // 01:00 AM
            await zk.executeCmd(12, Buffer.from('AS2=-1\0')); // Disabled
            await zk.executeCmd(12, Buffer.from('AS3=-1\0'));
            await zk.executeCmd(12, Buffer.from('AS4=-1\0'));

            console.log('Applying memory refresh...');
            await zk.executeCmd(1014); // CMD_REFRESHOPTION
            await zk.enableDevice();

            console.log('Rebooting device to apply new screen layout...');
            await zk.executeCmd(1004, Buffer.alloc(0)); // CMD_RESTART
            console.log('\n✅ Successfully set screen to: Arrivée 🟢 (Device is rebooting...)');
        } 
        else if (choice.trim() === '2') {
            console.log('\nConfiguring device for: Check-Out (Départ / Bonne fin) 🔴...');
            await zk.disableDevice();

            // Set StateMode=3 (Working mode) and ShowState=1
            await zk.executeCmd(12, Buffer.from('StateMode=3\0'));
            await zk.executeCmd(12, Buffer.from('~ShowState=1\0'));

            // Set AS4 (Check-Out / Départ) to be active right now!
            // We set AS4 to 01:00 AM (so it's active at the current clock time)
            // And disable AS1, AS2, AS3
            await zk.executeCmd(12, Buffer.from('AS1=-1\0')); // Disabled
            await zk.executeCmd(12, Buffer.from('AS2=-1\0')); // Disabled
            await zk.executeCmd(12, Buffer.from('AS3=-1\0')); // Disabled
            await zk.executeCmd(12, Buffer.from(`AS4=${encodeZKTime(1, 0)}\0`)); // 01:00 AM

            console.log('Applying memory refresh...');
            await zk.executeCmd(1014); // CMD_REFRESHOPTION
            await zk.enableDevice();

            console.log('Rebooting device to apply new screen layout...');
            await zk.executeCmd(1004, Buffer.alloc(0)); // CMD_RESTART
            console.log('\n✅ Successfully set screen to: Départ / Bonne fin 🔴 (Device is rebooting...)');
        } 
        else {
            console.log('❌ Invalid choice. Exiting.');
        }

    } catch (e) {
        console.error('❌ An error occurred:', e.message);
    } finally {
        try {
            await zk.disconnect();
        } catch (e) {}
        rl.close();
    }
}

main();
