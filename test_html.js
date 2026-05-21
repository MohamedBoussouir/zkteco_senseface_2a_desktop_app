let u = { uid: null, user_id: '1', name: 'test', assigned_devices: [{id: 1, name: 'ZK TEST', ip: '192.168.0.109'}], work_pattern_id: null };
let html = `app.editUserFlow(${u.uid}, '${u.user_id}', '${(u.name || '').replace(/'/g, "\\'")}', '${btoa(encodeURIComponent(JSON.stringify(u.assigned_devices)))}', ${u.work_pattern_id || 'null'})`;
console.log(html);
