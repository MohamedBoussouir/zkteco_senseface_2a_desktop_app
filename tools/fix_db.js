const knex = require('knex')({
    client: 'sqlite3',
    connection: {
        filename: "./attendance.db"
    },
    useNullAsDefault: true
});

async function fixDatabase() {
    try {
        const hasColumn = await knex.schema.hasColumn('users', 'fingerprints');
        if (!hasColumn) {
            console.log("Adding 'fingerprints' column to 'users' table...");
            await knex.schema.table('users', (table) => {
                table.text('fingerprints').defaultTo('[]');
            });
            console.log("Column added successfully!");
        } else {
            console.log("Column 'fingerprints' already exists.");
        }
        process.exit(0);
    } catch (e) {
        console.error("Error fixing database:", e.message);
        process.exit(1);
    }
}

fixDatabase();
