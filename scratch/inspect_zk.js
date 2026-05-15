const ZKLib = require('node-zklib');

async function test() {
    console.log('--- Inspecting ZKLib Prototype ---');
    const zk = new ZKLib('192.168.0.157', 4370, 10000, 4000);
    
    const methods = Object.getOwnPropertyNames(Object.getPrototypeOf(zk));
    console.log('Available Methods:', methods);
    
    // Check if executeCmd or similar exists
    const hasExecute = methods.includes('executeCmd');
    const hasSend = methods.includes('sendCommand');
    console.log('Has executeCmd:', hasExecute);
    console.log('Has sendCommand:', hasSend);
    
    process.exit(0);
}

test().catch(err => {
    console.error('Error:', err);
    process.exit(1);
});
