const http = require('http');
const readline = require('readline');

let pendingCommand = null;
let cmdId = 100;

const server = http.createServer((req, res) => {
    console.log(`[HTTP] Incoming request: ${req.method} ${req.url}`);
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    
    if (url.pathname.includes('/iclock/cdata')) {
        if (req.method === 'GET') {
            res.writeHead(200, { 'Content-Type': 'text/plain' });
            res.end(`GET OPTION FROM: ${url.searchParams.get('SN') || 'UNKNOWN'}\nStamp=9999\nOpStamp=9999\nErrorDelay=60\nDelay=10\nTransTimes=00:00;14:00\nTransInterval=1\nTransFlag=1111000000\nTimeZone=1\nRealtime=1\nEncrypt=0`);
        } else {
            let body = '';
            req.on('data', chunk => body += chunk);
            req.on('end', () => {
                console.log(`\n[DEVICE -> SERVER] (cdata) Received Data: \n${body}`);
                res.writeHead(200, { 'Content-Type': 'text/plain' });
                res.end('OK');
            });
        }
    } else if (url.pathname.includes('/iclock/getrequest')) {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        if (pendingCommand) {
            console.log(`[SERVER -> DEVICE] Sending command: ${pendingCommand}`);
            res.end(`C:${cmdId}:${pendingCommand}`);
            pendingCommand = null;
            cmdId++;
        } else {
            res.end('OK');
        }
    } else if (url.pathname.includes('/iclock/devicecmd')) {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', () => {
            console.log(`\n[DEVICE -> SERVER] (devicecmd) Command Result: \n${body}`);
            res.writeHead(200, { 'Content-Type': 'text/plain' });
            res.end('OK');
        });
    } else {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end('OK');
    }
});

const PORT = 8081;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`\n==============================================`);
    console.log(`🧪 ADMS Test Server running on port ${PORT}`);
    console.log(`==============================================`);
    console.log(`1. Change your ZKTeco device Cloud Server Port to: ${PORT}`);
    console.log(`2. The script will AUTOMATICALLY send the test command.`);
    console.log(`==============================================\n`);
    
    // Set the command automatically so you don't have to type it
    pendingCommand = "ENROLL_FP PIN=18\tFID=3";
    console.log(`[QUEUED] Waiting for device to ping to automatically send: "${pendingCommand}"`);
});
