const knex = require('knex');
const db = knex({
    client: 'sqlite3',
    connection: { filename: './attendance.db' },
    useNullAsDefault: true
});

async function check() {
    const users = await db('users').select('uid', 'user_id', 'name', 'fingerprints');
    console.log(JSON.stringify(users, null, 2));
    process.exit(0);
}
check();
