import { initializeApp, cert, getApp, getApps } from 'firebase-admin/app';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import * as dotenv from 'dotenv';

dotenv.config();

// Configuration
const RETENTION_DAYS = 30; // Data older than this will be deleted
const BATCH_SIZE = 500;

async function cleanup() {
  console.log('--- Starting Firestore Cleanup ---');
  
  const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
  
  if (!serviceAccountJson) {
    console.error('Error: FIREBASE_SERVICE_ACCOUNT_KEY environment variable is not set.');
    process.exit(1);
  }

  try {
    const serviceAccount = JSON.parse(serviceAccountJson);
    
    if (getApps().length === 0) {
      initializeApp({
        credential: cert(serviceAccount)
      });
    }

    const db = getFirestore();
    const now = new Date();
    const cutoffDate = new Date(now.getTime() - (RETENTION_DAYS * 24 * 60 * 60 * 1000));
    const cutoffTimestamp = Timestamp.fromDate(cutoffDate);

    console.log(`Deleting records in 'usageHistory' older than: ${cutoffDate.toISOString()}`);

    const collectionRef = db.collection('usageHistory');
    const query = collectionRef.where('timestamp', '<', cutoffTimestamp).limit(BATCH_SIZE);

    let deletedCount = 0;

    async function deleteBatch() {
      const snapshot = await query.get();
      
      if (snapshot.empty) {
        return 0;
      }

      const batch = db.batch();
      snapshot.docs.forEach((doc) => {
        batch.delete(doc.ref);
      });

      await batch.commit();
      return snapshot.size;
    }

    let count;
    do {
      count = await deleteBatch();
      deletedCount += count;
      if (count > 0) {
        console.log(`Deleted ${count} records... (Total: ${deletedCount})`);
      }
    } while (count === BATCH_SIZE);

    console.log(`--- Cleanup Finished. Total records deleted: ${deletedCount} ---`);
    process.exit(0);
  } catch (error) {
    console.error('Cleanup failed:', error);
    process.exit(1);
  }
}

cleanup();
