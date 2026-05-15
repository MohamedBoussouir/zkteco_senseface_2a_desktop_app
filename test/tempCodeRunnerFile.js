
const PORT = 4370;

const zk = new ZKLib(IP, PORT, 10000, 4000);

async function scan_user_uid() {
  const usersResult = await zk.getUsers();
  const users = usersResult.data || usersResult || [];
  return users.map(u => u.uid);
}

async function scan(uid, f) {
  const buf = Buffer.alloc(3);
  buf.writeUInt16LE(uid, 0);
  buf.writeUInt8(f, 2);

  const res = await zk.executeCmd(9, buf).catch(e => e);
  console.log(`UID:${uid} | Finger:${f} →`, res);
}

async function main() {
  await zk.createSocket();
  console.log("✅ Connected\n");

  // أولاً: جلب كل الـ UIDs
  const uids = await scan_user_uid();
  console.log("UIDs:", uids, "\n");

  // ثانياً: فحص بصمات كل مستخدم
  for (const uid of uids) {
    for (let f = 0; f <= 9; f++) {
      await scan(uid, f);
    }
    console.log("");
  }

  await zk.disconnect();
  console.log("🔌 Disconnected");
}

main();



