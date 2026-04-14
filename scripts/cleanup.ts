import { initializeApp, cert, getApp, getApps } from 'firebase-admin/app';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import * as dotenv from 'dotenv';

dotenv.config();

// Configuration
const RETENTION_DAYS = 30; // Data older than this will be deleted
const BATCH_SIZE = 500;

async function cleanup() {
  console.log('********************************');
  console.log('*** FIRESTORE CLEANUP V1.3 ***');
  console.log('********************************');
  
  const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
  const dbIdEnv = process.env.FIRESTORE_DATABASE_ID;
  
  console.log(`DEBUG: Raw Database ID from Env: "${dbIdEnv}"`);
  
  if (!serviceAccountJson) {
    console.error('!!! ERROR: FIREBASE_SERVICE_ACCOUNT_KEY IS MISSING !!!');
    process.exit(1);
  }

  try {
    const serviceAccount = JSON.parse(serviceAccountJson);
    const databaseId = (dbIdEnv || '(default)').trim();
    const projectId = serviceAccount.project_id;

    console.log(`DEBUG: Service Account Project: "${projectId}"`);
    console.log(`DEBUG: Using Database ID: "${databaseId}"`);
    
    if (getApps().length === 0) {
      console.log('DEBUG: Initializing Firebase Admin...');
      initializeApp({
        credential: cert(serviceAccount),
        projectId: projectId
      });
    }

    const db = getFirestore(databaseId);
    console.log('DEBUG: Firestore instance initialized.');
    const now = new Date();
    const cutoffDate = new Date(now.getTime() - (RETENTION_DAYS * 24 * 60 * 60 * 1000));
    const cutoffTimestamp = Timestamp.fromDate(cutoffDate);

    console.log(`Cutoff Date: ${cutoffDate.toISOString()}`);
    console.log(`Checking collection: "usageHistory"`);

    const collectionRef = db.collection('usageHistory');
    
    // Test connection with a simple limit(1) get
    console.log('Testing connection to Firestore...');
    try {
      await collectionRef.limit(1).get();
      console.log('Connection successful.');
    } catch (connError: any) {
      console.error('Connection test failed!');
      console.error(`Error Code: ${connError.code}`);
      console.error(`Error Message: ${connError.message}`);
      throw connError;
    }

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
