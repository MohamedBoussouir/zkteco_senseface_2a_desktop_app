const knex = require('knex');
const path = require('path');

const dbPath = path.join(process.cwd(), 'attendance.db');

const db = knex({
    client: 'sqlite3',
    connection: {
        filename: dbPath,
    },
    useNullAsDefault: true,
});

async function initDb() {
    // Users Table
    const hasUsers = await db.schema.hasTable('users');
    if (!hasUsers) {
        await db.schema.createTable('users', (table) => {
            table.increments('id');
            table.integer('uid');
            table.string('user_id');
            table.string('name');
            table.integer('role');
            table.integer('device_id');
            table.text('fingerprints'); // JSON array
            table.unique(['user_id', 'device_id']);
        });
    } else {
        // Self-healing: ensure fingerprints column exists
        const hasFingers = await db.schema.hasColumn('users', 'fingerprints');
        if (!hasFingers) {
            await db.schema.alterTable('users', (table) => {
                table.text('fingerprints');
            });
        }
    }

    // Attendance Table
    const hasAttendance = await db.schema.hasTable('attendance');
    if (!hasAttendance) {
        await db.schema.createTable('attendance', (table) => {
            table.increments('id');
            table.string('user_id');
            table.string('user_name');
            table.string('timestamp');
            table.integer('status');
            table.integer('device_id');
            table.unique(['user_id', 'timestamp', 'device_id']);
        });
    }

    // Devices Table
    const hasDevices = await db.schema.hasTable('devices');
    if (!hasDevices) {
        await db.schema.createTable('devices', (table) => {
            table.increments('id');
            table.string('name');
            table.string('ip');
            table.integer('port1');
            table.integer('port2');
        });
    }
}

module.exports = { db, initDb };
