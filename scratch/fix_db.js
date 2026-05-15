const path = require('path');
const os = require('os');
const knex = require('knex')({
    client: 'sqlite3',
    connection: {
        filename: path.join(os.homedir(), 'AppData', 'Roaming', 'hs_zk_attendance_desktop', 'attendance.sqlite')
    },
    useNullAsDefault: true
});

async function fix() {
    try {
        await knex('config').where('key', 'device_ip').update({ value: '192.168.1.157' });
        await knex('config').where('key', 'port_1').update({ value: '4370' });
        await knex('config').where('key', 'port_2').update({ value: '4371' });
        await knex('config').where('key', 'port_3').update({ value: '4372' });
        console.log('Database configuration fixed to 192.168.1.157');
        process.exit(0);
    } catch (e) {
        console.error(e);
        process.exit(1);
    }
}
fix();
