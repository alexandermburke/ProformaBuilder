const admin = require('firebase-admin');
const fs = require('fs');

admin.initializeApp({
  credential: admin.credential.applicationDefault()
});

const db = admin.firestore();

async function exportCollection(name) {
  const snapshot = await db.collection(name).get();
  const data = snapshot.docs.map(doc => ({
    id: doc.id,
    ...doc.data()
  }));

  fs.writeFileSync(`${name}.json`, JSON.stringify(data, null, 2));
  console.log(`Exported ${name}`);
}

async function run() {
  const collections = await db.listCollections();
  for (const col of collections) {
    await exportCollection(col.id);
  }
}

run();