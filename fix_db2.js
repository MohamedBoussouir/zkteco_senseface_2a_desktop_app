const db = require('knex')({
    client: 'sqlite3',
    connection: { filename: 'attendance.db' },
    useNullAsDefault: true
});

async function fix() {
    await db('users').whereIn('user_id', ['10', '26']).update({ fingerprints: '{"count":0,"indices":[]}' });
}

fix().then(() => console.log('Fixed DB')).finally(() => process.exit(0));
