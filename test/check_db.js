const knex = require('knex');
const path = require('path');

const db = knex({
    client: 'sqlite3',
    connection: {
        filename: path.join(__dirname, '../attendance.db'),
    },
    useNullAsDefault: true,
});

async function checkDb() {
    try {
        const logs = await db('attendance').select('*').limit(15);
        console.log("Database records:");
        console.log(logs);
    } catch (e) {
        console.error(e);
    } finally {
        db.destroy();
    }
}

checkDb();
