const db=require('knex')({client:'sqlite3',connection:{filename:'attendance.db'}});
const getUsersQuery=async()=>{
    const rawUsers = await db('users')
        .leftJoin('work_patterns', 'users.work_pattern_id', 'work_patterns.id')
        .leftJoin('devices', 'users.device_id', 'devices.id')
        .select(
            'users.user_id',
            db.raw('MAX(users.uid) as uid'),
            db.raw('MAX(users.name) as name'),
            db.raw('MAX(users.role) as role'),
            db.raw('MAX(users.photo) as photo'),
            db.raw('MAX(users.work_pattern_id) as work_pattern_id'),
            db.raw('MAX(work_patterns.name) as pattern_name'),
            db.raw("GROUP_CONCAT(users.fingerprints, '|||') as all_fingerprints"),
            db.raw("GROUP_CONCAT(devices.id, '|||') as device_ids"),
            db.raw("GROUP_CONCAT(devices.name, '|||') as device_names"),
            db.raw("GROUP_CONCAT(devices.ip, '|||') as device_ips")
        )
        .groupBy('users.user_id');
    return rawUsers;
};
getUsersQuery().then(console.log).catch(console.error).finally(()=>process.exit(0));
