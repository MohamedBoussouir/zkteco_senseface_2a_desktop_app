const ZKLib = require('node-zklib');

async function run() {
    const ip = '192.168.0.157';
    const port = 4370;
    
    console.log(`Connecting to ZK Terminal at ${ip}:${port}...`);
    const zk = new ZKLib(ip, port, 10000, 4000);
    
    try {
        await zk.createSocket();
        console.log('Connected successfully!\n');
        
        console.log('Restoring StateMode to 3 (Default working state)...');
        await zk.executeCmd(12, Buffer.from(`StateMode=3\0`));
        
        // Refresh options
        console.log('Applying changes...');
        await zk.executeCmd(1014); // CMD_REFRESHOPTION
        
        console.log('\nReading back StateMode to verify:');
        const res = await zk.executeCmd(11, Buffer.from(`StateMode\0`));
        const responseStr = res.slice(8).toString('ascii').replace(/\0/g, '');
        console.log(`StateMode Option is now restored to: "${responseStr}"`);
        
    } catch (e) {
        console.error('An error occurred:', e.message);
    } finally {
        try {
            await zk.disconnect();
            console.log('\nDisconnected.');
        } catch (e) {}
    }
}

run();
