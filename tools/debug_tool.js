const ZK = require('node-zklib');

async function debugDevice(ip, port = 4370) {
    console.log(`\x1b[36m[Debugger] Connecting to ${ip}:${port}...\x1b[0m`);
    
    // Try TCP first, then UDP
    const protocols = ['tcp', 'udp'];
    
    for (const proto of protocols) {
        console.log(`\x1b[33m[Attempt] Trying ${proto.toUpperCase()} mode...\x1b[0m`);
        const zk = new ZK(ip, {
            port: port,
            timeout: 5000,
            connectionType: proto
        });

        try {
            await zk.createSocket();
            console.log(`\x1b[32m[Debugger] Connected via ${proto.toUpperCase()}!\x1b[0m`);
            const users = await zk.getUsers();
            console.log(`\x1b[33m[Data] Found ${users.data.length} users.\x1b[0m`);

            for (const user of users.data) {
                console.log(`\x1b[34m[User] ID: ${user.userId}, Name: ${user.name}, UID: ${user.uid}\x1b[0m`);
                for (let i = 0; i <= 9; i++) {
                    const b = Buffer.alloc(3);
                    b.writeUInt16LE(parseInt(user.uid), 0);
                    b.writeUInt8(i, 2);
                    try {
                        const res = await zk.executeCmd(9, b);
                        if (res && res.length > 0) {
                            const code = res.readUInt16LE(0);
                            const hex = res.toString('hex').match(/../g).join(' ');
                            if (code === 2000 || code === 2002 || code === 1501) {
                                console.log(`   \x1b[32m✓ Finger ${i}: FOUND (Code ${code}) | RAW: ${hex}\x1b[0m`);
                            } else {
                                console.log(`   \x1b[90m✗ Finger ${i}: Empty (Code ${code})\x1b[0m`);
                            }
                        }
                    } catch (e) { }
                }
            }
            await zk.disconnect();
            return; 
        } catch (e) {
            console.log(`\x1b[31m[Fail] ${proto.toUpperCase()} failed: ${e.message || 'Handshake Error'}\x1b[0m`);
            try { await zk.disconnect(); } catch(i) {}
        }
    }
}

debugDevice('192.168.0.157', 4370);
