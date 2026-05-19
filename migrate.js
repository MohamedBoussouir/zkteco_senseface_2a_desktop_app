const { initDb, db } = require('./src/modules/db');

async function main() {
    console.log("🛠️ Starting database self-healing migration...");
    await initDb();
    console.log("✅ Database self-healing complete! The 'card_number' column exists now.");
    await db.destroy();
}

main().catch(console.error);
