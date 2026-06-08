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
            table.integer('work_pattern_id').unsigned().references('id').inTable('work_patterns').onDelete('SET NULL');
            table.text('photo'); // Base64 image
            table.string('password');
            table.string('card_number');
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
        // Self-healing: ensure work_pattern_id column exists
        const hasWorkPatternId = await db.schema.hasColumn('users', 'work_pattern_id');
        if (!hasWorkPatternId) {
            await db.schema.alterTable('users', (table) => {
                table.integer('work_pattern_id').unsigned().references('id').inTable('work_patterns').onDelete('SET NULL');
            });
        }
        // Self-healing: ensure last_sync_time column exists
        const hasLastSyncTime = await db.schema.hasColumn('users', 'last_sync_time');
        if (!hasLastSyncTime) {
            await db.schema.alterTable('users', (table) => {
                table.bigInteger('last_sync_time').defaultTo(0);
            });
        }
        // Self-healing: ensure photo column exists
        const hasPhoto = await db.schema.hasColumn('users', 'photo');
        if (!hasPhoto) {
            await db.schema.alterTable('users', (table) => {
                table.text('photo');
            });
        }
        // Self-healing: ensure password column exists
        const hasPassword = await db.schema.hasColumn('users', 'password');
        if (!hasPassword) {
            await db.schema.alterTable('users', (table) => {
                table.string('password');
            });
        }
        // Self-healing: ensure card_number column exists
        const hasCardNumber = await db.schema.hasColumn('users', 'card_number');
        if (!hasCardNumber) {
            await db.schema.alterTable('users', (table) => {
                table.string('card_number');
            });
        }
    }

    // Clean up user_devices from previous experimental many-to-many setup
    await db.schema.dropTableIfExists('user_devices');

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
            table.string('sn').unique(); // Serial Number for ADMS
            table.string('ip'); // Kept for legacy/local network use
            table.integer('port1');
            table.integer('port2');
            table.bigInteger('last_seen').defaultTo(0);
        });
    } else {
        // Self-healing: ensure sn column exists
        const hasSn = await db.schema.hasColumn('devices', 'sn');
        if (!hasSn) {
            await db.schema.alterTable('devices', (table) => {
                table.string('sn').unique();
            });
        }
        // Self-healing: ensure last_seen column exists
        const hasLastSeen = await db.schema.hasColumn('devices', 'last_seen');
        if (!hasLastSeen) {
            await db.schema.alterTable('devices', (table) => {
                table.bigInteger('last_seen').defaultTo(0);
            });
        }
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
    await db('settings').insert({ key: 'default_start_time', value: '08:00' }).onConflict('key').ignore();
    await db('settings').insert({ key: 'default_end_time', value: '17:00' }).onConflict('key').ignore();
    await db('settings').insert({ key: 'adms_port', value: '80' }).onConflict('key').ignore();


    // Shifts Table
    const hasShifts = await db.schema.hasTable('shifts');
    if (!hasShifts) {
        await db.schema.createTable('shifts', (table) => {
            table.increments('id');
            table.string('name');
            table.string('start_time');
            table.string('end_time');
        });
        // Insert default shifts
        await db('shifts').insert([
            { name: 'Morning Shift', start_time: '08:00', end_time: '17:00' },
            { name: 'Evening Shift', start_time: '16:00', end_time: '00:00' }
        ]);
    }

    // Schedules Table
    const hasSchedules = await db.schema.hasTable('schedules');
    if (!hasSchedules) {
        await db.schema.createTable('schedules', (table) => {
            table.increments('id');
            table.string('user_id');
            table.string('date'); // YYYY-MM-DD
            table.integer('shift_id').unsigned().references('id').inTable('shifts').onDelete('CASCADE');
            table.integer('is_off_day').defaultTo(0);
            table.unique(['user_id', 'date']);
        });
    }
    // Work Patterns Table
    const hasWorkPatterns = await db.schema.hasTable('work_patterns');
    if (!hasWorkPatterns) {
        await db.schema.createTable('work_patterns', (table) => {
            table.increments('id');
            table.string('name');
        });
    }

    // Work Pattern Days Table
    const hasWorkPatternDays = await db.schema.hasTable('work_pattern_days');
    if (!hasWorkPatternDays) {
        await db.schema.createTable('work_pattern_days', (table) => {
            table.integer('pattern_id').unsigned().references('id').inTable('work_patterns').onDelete('CASCADE');
            table.integer('day_of_week'); // 0 (Sunday) to 6 (Saturday)
            table.integer('shift_id').unsigned().references('id').inTable('shifts').onDelete('SET NULL');
            table.unique(['pattern_id', 'day_of_week']);
        });
    }
}

module.exports = { db, initDb };    
