const lm = require('../src/modules/licensing');

// --- DEVELOPER TOOL: Run this to generate a license ---
// Usage: node license_generator.js <machine_id> <days>

const args = process.argv.slice(2);
if (args.length < 2) {
    console.log('\x1b[36mUsage: node license_generator.js <machine_id> <days_valid>\x1b[0m');
    console.log(`Your Machine ID: \x1b[32m${lm.getMachineId()}\x1b[0m`);
    process.exit(0);
}

const targetMid = args[0];
const days = parseInt(args[1]);
const expiry = new Date();
expiry.setDate(expiry.getDate() + days);

const licenseString = lm.generateLicense(targetMid, expiry.toISOString());

const fs = require('fs');
fs.writeFileSync('license.dat', licenseString);

console.log('\x1b[32m[Success] License generated successfully!\x1b[0m');
console.log(`Machine ID: ${targetMid}`);
console.log(`Expiry: ${expiry.toLocaleString()}`);
console.log('\x1b[33mFile "license.dat" created. Send this to your client.\x1b[0m');
