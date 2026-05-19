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
            table.string('card_number');
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
        // Self-healing: ensure card_number column exists
        const hasCard = await db.schema.hasColumn('users', 'card_number');
        if (!hasCard) {
            await db.schema.alterTable('users', (table) => {
                table.string('card_number');
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

    // Settings Table
    const hasSettings = await db.schema.hasTable('settings');
    if (!hasSettings) {
        await db.schema.createTable('settings', (table) => {
            table.string('key').primary();
            table.string('value');
        });
        await db('settings').insert({ key: 'calc_mode', value: 'calculated' });
    }
}

module.exports = { db, initDb };
