const http = require('http');
const url = require('url');
const { db } = require('./db');

let server = null;
let pendingCommands = [];
let cmdIdCounter = 200;
let discoveredDevices = new Set();

function getDiscoveredDevices() {
    return Array.from(discoveredDevices);
}

function clearDiscoveredDevices() {
    discoveredDevices.clear();
}

async function handleDeviceSeen(sn, mainWindow) {
    if (!sn) return;
    try {
        let dev = await db('devices').where('sn', sn).first();
        if (dev) {
            await db('devices').where('id', dev.id).update({ last_seen: Date.now() });
        } else {
            discoveredDevices.add(sn);
        }
    } catch (e) {
        console.error(`[ADMS] Error handling device seen: ${e.message}`);
    }
}

function startAdmsServer(port = 80, mainWindow = null) {
    if (server) {
        console.log(`[ADMS] Server already running on port ${port}`);
        return;
    }

    server = http.createServer(async (req, res) => {
        const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
        const pathname = parsedUrl.pathname;
        const query = Object.fromEntries(parsedUrl.searchParams);

        if (pathname === '/') {
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end('<h2>✅ خادم ADMS يعمل بنجاح!</h2>');
            return;
        }

        if (pathname === '/iclock/cdata') {
            if (req.method === 'GET') {
                console.log(`[ADMS] Handshake from SN: ${query.SN}`);
                await handleDeviceSeen(query.SN, mainWindow);
                res.writeHead(200, { 'Content-Type': 'text/plain' });
                res.end('OK');
            } else if (req.method === 'POST') {
                let body = '';
                req.on('data', chunk => { body += chunk.toString(); });
                req.on('end', async () => {
                    console.log(`\n--- [ADMS] Raw Data for ${query.table} ---`);
                    console.log(body.substring(0, 500) + (body.length > 500 ? '...\n' : '\n'));
                    console.log(`----------------------------------------`);
                    
                    try {
                        await processAdmsData(query.table, body, query.SN, mainWindow);
                    } catch (e) {
                        console.error(`[ADMS] Error processing data: ${e.message}`);
                    }
                    res.writeHead(200, { 'Content-Type': 'text/plain' });
                    res.end('OK');
                });
            }
        } else if (pathname === '/iclock/getrequest') {
            await handleDeviceSeen(query.SN, mainWindow);
            if (pendingCommands.length > 0) {
                const cmdString = pendingCommands.map(cmd => {
                    cmdIdCounter++;
                    return `C:${cmdIdCounter}:${cmd}`;
                }).join('\n');
                console.log(`[ADMS] Sending commands to device:\n${cmdString}`);
                res.writeHead(200, { 'Content-Type': 'text/plain' });
                res.end(cmdString);
                pendingCommands = []; // Clear after sending
            } else {
                res.writeHead(200, { 'Content-Type': 'text/plain' });
                res.end('OK');
            }
        } else if (pathname === '/iclock/devicecmd') {
            await handleDeviceSeen(query.SN, mainWindow);
            let body = '';
            req.on('data', chunk => body += chunk.toString());
            req.on('end', () => {
                console.log(`[ADMS] Command executed status from device: \n${body}`);
                res.writeHead(200, { 'Content-Type': 'text/plain' });
                res.end('OK');
            });
        } else {
            res.writeHead(404, { 'Content-Type': 'text/plain' });
            res.end('Not Found');
        }
    });

    server.listen(port, () => {
        console.log(`[ADMS] Server listening on port ${port}`);
        if (mainWindow) {
            mainWindow.webContents.send('log', `ADMS Server started on port ${port}. Please set your device Cloud Server IP to your PC IP and port ${port}.`);
        }
    });

    server.on('error', (e) => {
        console.error(`[ADMS] Server error: ${e.message}`);
    });
}

function stopAdmsServer() {
    if (server) {
        server.close();
        server = null;
        console.log('[ADMS] Server stopped.');
    }
}

function queueAdmsCommand(command) {
    pendingCommands.push(command);
    console.log(`[ADMS] Queued command from UI: ${command}`);
}

async function processAdmsData(table, data, sn, mainWindow) {
    if (!data) return;

    const lines = data.split('\n').map(l => l.trim()).filter(l => l.length > 0);

    let device = null;
    try {
        device = await db('devices').where('sn', sn).orWhere('ip', sn).first();
        if (!device) {
            device = await db('devices').first(); // Fallback
        }
    } catch(e) {
        console.error('[ADMS] DB Error fetching device:', e);
    }

    if (!device) {
        console.log(`[ADMS] Auto-creating device entry for SN: ${sn}...`);
        try {
            await db('devices').insert({ name: `SenseFace-${sn}`, sn: sn, ip: '0.0.0.0', port1: 8088, port2: 8088, last_seen: Date.now() });
            device = await db('devices').where('sn', sn).first();
        } catch(e) {}
    }

    if (!device) {
        console.log('[ADMS] Critical: Still no device available to link data to.');
        return;
    }

    if (table === 'ATTLOG') {
        for (const line of lines) {
            const parts = line.split('\t');
            if (parts.length >= 2) {
                const userId = parts[0].trim();
                const timestamp = parts[1].trim(); 
                const status = parts[2] ? parseInt(parts[2].trim()) : 0;

                try {
                    await db('attendance').insert({
                        user_id: userId,
                        user_name: 'Unknown (ADMS)',
                        timestamp: timestamp,
                        status: status,
                        device_id: device.id
                    }).onConflict(['user_id', 'timestamp', 'device_id']).ignore();
                    
                    console.log(`[ADMS] Inserted attendance: ${userId} at ${timestamp}`);
                } catch(e) {}
            }
        }
        if (mainWindow) mainWindow.webContents.send('sync-progress', 'Attendance synced via ADMS');
    } 
    else if (table === 'USER' || table === 'OPERLOG' || (table || '').toUpperCase() === 'USERINFO') {
        for (const line of lines) {
            if (line.startsWith('BIOPHOTO') || line.startsWith('USERPIC')) {
                // Inline parse BIOPHOTO and USERPIC
                let userIdMatch = line.match(/\bPIN=([^\t\s]+)/i) || line.match(/\bPin=([^\t\s]+)/i);
                let userId = userIdMatch ? userIdMatch[1].trim() : null;
                let typeMatch = line.match(/\bType=([^\t\s]+)/i);
                // Type 9 is Face Photo, Type 0/1/etc is fingerprint. USERPIC doesn't send Type, so we assume it's a photo
                let type = typeMatch ? parseInt(typeMatch[1]) : 9;
                
                let contentMatch = line.match(/Content=(.*)/i) || line.match(/TMP=(.*)/i);
                let content = contentMatch ? contentMatch[1].trim() : null;

                if (userId && content && (type === 9 || line.startsWith('USERPIC'))) {
                    try {
                        await db('users').where({ user_id: userId }).update({
                            photo: content,
                            last_sync_time: Date.now()
                        });
                        console.log(`[ADMS] Saved BioPhoto/UserPic for User ${userId} (from OPERLOG)`);
                    } catch(e) {}
                }
                continue;
            }
            if (line.startsWith('BIODATA') || line.startsWith('templatev10') || line.startsWith('fingrtmp')) {
                // Inline parse BIODATA
                let userIdMatch = line.match(/\bPIN=([^\t\s]+)/i) || line.match(/\bPin=([^\t\s]+)/i);
                let userId = userIdMatch ? userIdMatch[1].trim() : null;
                let fingerIdMatch = line.match(/\bFID=([^\t\s]+)/i) || line.match(/\bFingerID=([^\t\s]+)/i) || line.match(/\bNo=([^\t\s]+)/i);
                let fingerId = fingerIdMatch ? parseInt(fingerIdMatch[1]) : 0;
                let typeMatch = line.match(/\bType=([^\t\s]+)/i);
                let type = typeMatch ? parseInt(typeMatch[1]) : 1;

                if (userId && type === 1) {
                    try {
                        let user = await db('users').where({ user_id: userId, device_id: device.id }).first();
                        if (user) {
                            let fpData = { count: 0, indices: [] };
                            try { fpData = JSON.parse(user.fingerprints || '{"count":0,"indices":[]}'); } catch(e){}
                            
                            // If index not already present, add it
                            if (!fpData.indices.includes(fingerId)) {
                                fpData.indices.push(fingerId);
                                fpData.count = fpData.indices.length;
                                await db('users').where({ id: user.id }).update({
                                    fingerprints: JSON.stringify(fpData)
                                });
                                console.log(`[ADMS] Saved template ${fingerId} for User ${userId} (from OPERLOG)`);
                            }
                        }
                    } catch(e) {}
                }
                continue;
            }

            let userId = (line.match(/\bPIN=([^\t\s]+)/i) || [])[1];
            if (userId) userId = userId.trim();
            let nameMatch = line.match(/\bName=([^\t]+)/i);
            let name = nameMatch ? nameMatch[1].trim() : 'Unknown';
            let roleMatch = line.match(/\bPri=([^\t\s]+)/i);
            let role = roleMatch ? parseInt(roleMatch[1]) : 0;

            if (userId) {
                console.log(`[DEBUG USER PARSE] line: "${line}" -> userId: ${userId}, name: ${name}`);
                try {
                    let updateData = {
                        role: role,
                        last_sync_time: Date.now()
                    };
                    if (name !== 'Unknown') {
                        updateData.name = name;
                    }

                    await db('users').insert({
                        uid: parseInt(userId),
                        user_id: userId,
                        name: name,
                        role: role,
                        device_id: device.id,
                        fingerprints: '{"count": 0, "indices": []}',
                        last_sync_time: Date.now()
                    }).onConflict(['user_id', 'device_id']).merge(updateData);
                    
                    console.log(`[ADMS] Inserted/Updated user: ${userId} - ${name}`);
                } catch(e) {}
            }
        }
        if (mainWindow) mainWindow.webContents.send('sync-progress', 'Users synced via ADMS');
    }
    else if (table === 'templatev10' || table === 'fingrtmp' || table === 'BIODATA') {
        for (const line of lines) {
                    
            let userIdMatch = line.match(/\bPIN=([^\t\s]+)/i) || line.match(/\bPin=([^\t\s]+)/i);
            let userId = userIdMatch ? userIdMatch[1].trim() : null;
            let fingerIdMatch = line.match(/\bFID=([^\t\s]+)/i) || line.match(/\bFingerID=([^\t\s]+)/i) || line.match(/\bNo=([^\t\s]+)/i);
            let fingerId = fingerIdMatch ? parseInt(fingerIdMatch[1]) : 0;
            let typeMatch = line.match(/\bType=([^\t\s]+)/i);
            let type = typeMatch ? parseInt(typeMatch[1]) : 1;

            if (userId && type === 1) {
                try {
                    let u = await db('users').where({ user_id: userId, device_id: device.id }).first();
                    
                    if (!u) {
                        try {
                            await db('users').insert({
                                uid: parseInt(userId) || 0,
                                user_id: userId,
                                name: `User ${userId}`,
                                role: 0,
                                device_id: device.id,
                                fingerprints: '{"count": 0, "indices": []}'
                            });
                            u = await db('users').where({ user_id: userId, device_id: device.id }).first();
                            console.log(`[ADMS] Auto-created User ${userId} from BIODATA`);
                        } catch(e) { console.error(e); }
                    }

                    if (u) {
                        let fpData = { count: 0, indices: [] };
                        try { 
                            let parsed = JSON.parse(u.fingerprints || '{"count":0, "indices":[]}'); 
                            if (Array.isArray(parsed)) {
                                fpData = { count: parsed.length, indices: parsed };
                            } else if (parsed && Array.isArray(parsed.indices)) {
                                fpData = parsed;
                            }
                        } catch(e){}
                        
                        if (!fpData.indices.includes(fingerId)) {
                            fpData.indices.push(fingerId);
                            fpData.count = fpData.indices.length;
                            await db('users').where('id', u.id).update({
                                fingerprints: JSON.stringify(fpData),
                                last_sync_time: Date.now()
                            });
                            console.log(`[ADMS] Updated BioData for User ${userId}, FID: ${fingerId}`);
                        } else {
                            await db('users').where('id', u.id).update({ last_sync_time: Date.now() });
                        }
                    }
                } catch(e) {}
            }
        }
        if (mainWindow) mainWindow.webContents.send('sync-progress', 'BioData synced via ADMS');
    }
    else if (table === 'BIOPHOTO') {
        for (const line of lines) {
            let userIdMatch = line.match(/\bPIN=([^\t\s]+)/i) || line.match(/\bPin=([^\t\s]+)/i);
            let userId = userIdMatch ? userIdMatch[1].trim() : null;
            let typeMatch = line.match(/\bType=([^\t\s]+)/i);
            let type = typeMatch ? parseInt(typeMatch[1]) : 9;
            
            // Extract the base64 content
            let contentMatch = line.match(/Content=(.*)/i) || line.match(/TMP=(.*)/i);
            let content = contentMatch ? contentMatch[1].trim() : null;

            if (userId && content && type === 9) {
                try {
                    await db('users').where({ user_id: userId }).update({
                        photo: content,
                        last_sync_time: Date.now()
                    });
                    console.log(`[ADMS] Saved BioPhoto for User ${userId}`);
                } catch(e) { console.error('[ADMS] Error saving BioPhoto:', e); }
            }
        }
        if (mainWindow) mainWindow.webContents.send('sync-progress', 'Photos synced via ADMS');
    }
}

module.exports = {
    startAdmsServer,
    stopAdmsServer,
    queueAdmsCommand,
    getDiscoveredDevices,
    clearDiscoveredDevices
};
