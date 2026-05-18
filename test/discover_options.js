const ZKLib = require('node-zklib');

async function run() {
    const ip = '192.168.0.157';
    const port = 4370;
    
    console.log(`Connecting to ZK Terminal at ${ip}:${port}...`);
    const zk = new ZKLib(ip, port, 10000, 4000);
    
    try {
        await zk.createSocket();
        console.log('Connected successfully!\n');
        
        const suspectedOptions = [
            '~ShowState',
            'ShowState',
            'StateMode',
            'PunchStateMode',
            'StateKeys',
            'FKeyMode',
            'AutoState',
            'AutoSwitchState',
            'PunchState',
            'ShortcutKey',
            'StateTime',
            'ASMode',
            'PunchStateRequired',
            'AutoSwitch',
            'AttState',
            'ExtState',
            'FKeyOn',
            'ShowStateMode'
        ];
        
        console.log('===================================================');
        console.log('QUERYING SYSTEM OPTIONS:');
        console.log('===================================================');
        for (const option of suspectedOptions) {
            try {
                const res = await zk.executeCmd(11, Buffer.from(`${option}\0`));
                const responseStr = res.slice(8).toString('ascii').replace(/\0/g, '');
                console.log(`${option}: "${responseStr}"`);
            } catch (err) {
                console.log(`${option}: Error: ${err.message}`);
            }
        }
        
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
