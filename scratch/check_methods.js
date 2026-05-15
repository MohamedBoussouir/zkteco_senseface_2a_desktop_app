const ZKLib = require('node-zklib');
const zk = new ZKLib('127.0.0.1', 4370, 100, 100);
console.log('Available methods:', Object.getOwnPropertyNames(Object.getPrototypeOf(zk)));
process.exit(0);
