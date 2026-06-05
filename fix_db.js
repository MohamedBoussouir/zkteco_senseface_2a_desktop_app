const db=require('knex')({client:'sqlite3',connection:{filename:'attendance.db'}});
async function fix(){
    let users = await db('users');
    for(let u of users){
        let fp = JSON.parse(u.fingerprints || '{"count":0,"indices":[]}');
        if(fp.indices.includes(1) && fp.indices.includes(0)){
            fp.indices = fp.indices.filter(i => i !== 1);
            fp.count = fp.indices.length;
            await db('users').where('id', u.id).update({ fingerprints: JSON.stringify(fp) });
        }
    }
}
fix().then(()=>console.log('Fixed')).finally(()=>process.exit(0));
