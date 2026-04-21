import { initializeApp, cert, getApp, getApps } from 'firebase-admin/app';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import * as dotenv from 'dotenv';

dotenv.config();

// Configuration
const RETENTION_DAYS = 180; // Data older than 6 months will be deleted
const BATCH_SIZE = 500;

async function cleanup() {
  console.log('=========================================');
  console.log('   FIRESTORE CLEANUP SCRIPT V1.4');
  console.log('=========================================');
  
  const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
  const dbIdEnv = process.env.FIRESTORE_DATABASE_ID;
  
  if (!serviceAccountJson) {
    console.error('FATAL ERROR: FIREBASE_SERVICE_ACCOUNT_KEY is missing!');
    process.exit(1);
  }

  try {
    const serviceAccount = JSON.parse(serviceAccountJson);
    const databaseId = (dbIdEnv || '').trim();
    const projectId = serviceAccount.project_id;

    console.log(`- Project ID: ${projectId}`);
    console.log(`- Database ID: ${databaseId || '(default)'}`);
    
    if (getApps().length === 0) {
      initializeApp({
        credential: cert(serviceAccount),
        projectId: projectId
      });
      console.log('- Firebase Admin Initialized.');
    }

    // Use the specific database ID or default
    const db = databaseId ? getFirestore(databaseId) : getFirestore();
    
    const now = new Date();
    const cutoffDate = new Date(now.getTime() - (RETENTION_DAYS * 24 * 60 * 60 * 1000));
    const cutoffTimestamp = Timestamp.fromDate(cutoffDate);

    console.log(`- Target Collection: usageHistory`);
    console.log(`- Cutoff Date: ${cutoffDate.toISOString()}`);

    const collectionRef = db.collection('usageHistory');
    
    console.log('- Testing connection...');
    try {
      const testSnapshot = await collectionRef.limit(1).get();
      console.log(`- Connection OK. Found ${testSnapshot.size} sample records.`);
    } catch (connError: any) {
      console.error('!!! Connection test failed !!!');
      console.error(`Code: ${connError.code}`);
      console.error(`Message: ${connError.message}`);
      throw connError;
    }

    const query = collectionRef.where('timestamp', '<', cutoffTimestamp).limit(BATCH_SIZE);

    let deletedCount = 0;

    async function deleteBatch(q: any) {
      const snapshot = await q.get();
      
      if (snapshot.empty) {
        return 0;
      }

      const batch = db.batch();
      snapshot.docs.forEach((doc: any) => {
        batch.delete(doc.ref);
      });

      await batch.commit();
      return snapshot.size;
    }

    // Cleanup usageHistory
    let count;
    do {
      count = await deleteBatch(query);
      deletedCount += count;
      if (count > 0) {
        console.log(`Deleted ${count} usageHistory records... (Total: ${deletedCount})`);
      }
    } while (count === BATCH_SIZE);

    // Cleanup old foodItems that are not 'available' (legacy cleanup)
    console.log(`Checking for old consumed/discarded foodItems...`);
    const foodItemsRef = db.collection('foodItems');
    const oldFoodQuery = foodItemsRef
      .where('status', 'in', ['consumed', 'discarded'])
      .where('updatedAt', '<', cutoffTimestamp)
      .limit(BATCH_SIZE);

    let foodDeletedCount = 0;
    do {
      count = await deleteBatch(oldFoodQuery);
      foodDeletedCount += count;
      if (count > 0) {
        console.log(`Deleted ${count} old foodItems... (Total: ${foodDeletedCount})`);
      }
    } while (count === BATCH_SIZE);

    console.log(`--- Cleanup Finished ---`);
    console.log(`Total usageHistory deleted: ${deletedCount}`);
    console.log(`Total old foodItems deleted: ${foodDeletedCount}`);
    process.exit(0);
  } catch (error) {
    console.error('Cleanup failed:', error);
    process.exit(1);
  }
}

cleanup();
