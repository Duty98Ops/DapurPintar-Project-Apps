import { initializeApp, cert, getApp, getApps } from 'firebase-admin/app';
import { getFirestore, Timestamp, FieldValue } from 'firebase-admin/firestore';
import * as dotenv from 'dotenv';

dotenv.config();

async function sendReminders() {
  console.log('=========================================');
  console.log('   DAPURPINTAR AUTOMATED REMINDERS');
  console.log('=========================================');
  
  const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
  const dbIdEnv = process.env.FIRESTORE_DATABASE_ID;
  const BREVO_API_KEY = process.env.BREVO_API_KEY;
  
  if (!serviceAccountJson) {
    console.error('FATAL ERROR: FIREBASE_SERVICE_ACCOUNT_KEY is missing!');
    process.exit(1);
  }

  if (!BREVO_API_KEY) {
    console.error('FATAL ERROR: BREVO_API_KEY is missing!');
    process.exit(1);
  }

  try {
    const serviceAccount = JSON.parse(serviceAccountJson);
    const databaseId = (dbIdEnv || '').trim();
    const projectId = serviceAccount.project_id;

    if (getApps().length === 0) {
      initializeApp({
        credential: cert(serviceAccount),
        projectId: projectId
      });
      console.log('- Firebase Admin Initialized.');
    }

    const db = databaseId ? getFirestore(databaseId) : getFirestore();
    
    // 1. Get all users who have email reminders enabled
    const usersSnapshot = await db.collection('users')
      .where('emailRemindersEnabled', '==', true)
      .get();

    console.log(`- Found ${usersSnapshot.size} users with reminders enabled.`);

    for (const userDoc of usersSnapshot.docs) {
      const userData = userDoc.data();
      const userId = userDoc.id;
      const userEmail = userData.reminderEmail || userData.email;
      const userName = userData.fullName || userData.displayName;

      console.log(`- Checking user: ${userEmail} (${userId})`);

      // 2. Check if sent in last 20h (relaxed from 24h to account for cron jitter)
      const now = new Date();
      const lastSent = userData.lastReminderSentAt?.toDate();
      if (lastSent && (now.getTime() - lastSent.getTime()) < 20 * 60 * 60 * 1000) {
        console.log(`  - Skipping: Already sent in the last 20h.`);
        continue;
      }

      // 3. Find food items expiring in the next 3 days
      const threeDaysFromNow = new Date();
      threeDaysFromNow.setDate(threeDaysFromNow.getDate() + 3);
      // Also include 3 days in the past or strictly items that ARE currently available but expired?
      // The user mentioned "Mie Sedap expired on 22 Apr" and on 23 Apr it was sent.
      // So we should probably check for items that are 'available' and expiryDate <= threeDaysFromNow
      // (including those already expired)
      
      const foodItemsSnapshot = await db.collection('foodItems')
        .where('userId', '==', userId)
        .where('status', '==', 'available')
        .get();

      const expiringItems = foodItemsSnapshot.docs.filter(doc => {
        const item = doc.data();
        if (!item.expiryDate) return false;
        const expiryDate = item.expiryDate.toDate();
        // Send if it's already expired OR expiring in the next 3 days
        return expiryDate <= threeDaysFromNow;
      }).map(doc => doc.data());

      if (expiringItems.length > 0) {
        console.log(`  - Found ${expiringItems.length} expiring/expired items. Sending email...`);
        
        // 4. Send Email via Brevo
        const itemsHtml = expiringItems.map((item: any) => `
          <li style="margin-bottom: 12px; padding: 15px; border-left: 5px solid #ef4444; background: #ffffff; border-radius: 12px; box-shadow: 0 1px 2px rgba(0,0,0,0.05);">
            <b style="font-size: 16px; color: #111827;">${item.name}</b><br/>
            <span style="font-size: 13px; color: #6b7280;">
              Kuantitas: ${item.quantity} ${item.unit} | 
              <b>Kedaluwarsa: ${item.expiryDate.toDate().toLocaleDateString('id-ID', { day: 'numeric', month: 'long' })}</b>
            </span>
          </li>
        `).join("");

        const response = await fetch("https://api.brevo.com/v3/smtp/email", {
          method: "POST",
          headers: {
            "accept": "application/json",
            "api-key": BREVO_API_KEY,
            "content-type": "application/json"
          },
          body: JSON.stringify({
            sender: { name: "DapurPintar Reminder", email: "random23sx21@gmail.com" },
            to: [{ email: userEmail }],
            subject: "⚠️ Perhatian: Bahan Makanan Anda Akan Kedaluwarsa!",
            htmlContent: `
              <div style="font-family: sans-serif; background-color: #f9fafb; padding: 40px; color: #374151;">
                <div style="max-width: 550px; margin: 0 auto; background: #ffffff; padding: 35px; border-radius: 28px; border: 1px solid #e5e7eb;">
                  <h2 style="color: #059669; font-size: 24px; margin-bottom: 8px;">DapurPintar Reminder 🍳</h2>
                  <p style="font-size: 15px; margin-bottom: 25px;">Halo <b>${userName || "Sobat Dapur"}</b>! Kami mencatat ada beberapa bahan makanan yang harus segera diolah:</p>
                  <ul style="list-style: none; padding: 0;">
                    ${itemsHtml}
                  </ul>
                  <div style="margin-top: 30px; padding-top: 25px; border-top: 1px solid #f3f4f6;">
                    <p style="font-size: 14px; color: #6b7280;">Jangan sampai ada makanan yang terbuang ya. Masak sesuatu yang lezat hari ini!</p>
                    <a href="https://ais-pre-ojl57w4e3742buhldvxeuh-687661494013.asia-east1.run.app" style="display: inline-block; background: #059669; color: #ffffff; padding: 14px 28px; border-radius: 14px; text-decoration: none; font-weight: bold; font-size: 14px;">Buka Aplikasi DapurPintar</a>
                  </div>
                </div>
              </div>
            `
          })
        });

        if (response.ok) {
          console.log(`  - Success: Email sent to ${userEmail}.`);
          // 5. Update lastReminderSentAt
          await userDoc.ref.update({
            lastReminderSentAt: FieldValue.serverTimestamp()
          });
        } else {
          const errorData = await response.json() as any;
          console.error(`  - Failed to send email to ${userEmail}:`, errorData.message || 'Unknown error');
        }
      } else {
        console.log(`  - No expiring items found.`);
      }
    }

    console.log('--- Send Reminders Finished ---');
    process.exit(0);
  } catch (error) {
    console.error('Script failed:', error);
    process.exit(1);
  }
}

sendReminders();
