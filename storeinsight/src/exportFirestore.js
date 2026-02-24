let adminRef = null;
let fsRef = null;

async function loadDeps() {
  if (!adminRef || !fsRef) {
    const adminMod = await import('firebase-admin');
    const fsMod = await import('node:fs');
    adminRef = adminMod.default;
    fsRef = fsMod.default;
  }
  return { admin: adminRef, fs: fsRef };
}

async function exportCollection(db, fs, name) {
  const snapshot = await db.collection(name).get();
  const data = snapshot.docs.map((doc) => ({
    id: doc.id,
    ...doc.data(),
  }));

  fs.writeFileSync(`${name}.json`, JSON.stringify(data, null, 2));
  console.log(`Exported ${name}`);
}

async function run() {
  const { admin, fs } = await loadDeps();

  admin.initializeApp({
    credential: admin.credential.applicationDefault(),
  });

  const db = admin.firestore();
  const collections = await db.listCollections();
  for (const col of collections) {
    await exportCollection(db, fs, col.id);
  }
}

run();
