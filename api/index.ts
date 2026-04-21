import express from "express";
import * as dotenv from "dotenv";

dotenv.config();

const app = express();
app.use(express.json());

// Brevo Email API (Manual Test)
app.post("/api/send-test-email", async (req, res) => {
  const { email, name } = req.body;
  const BREVO_API_KEY = process.env.BREVO_API_KEY;

  if (!BREVO_API_KEY) {
    return res.status(500).json({ error: "Brevo API Key belum dikonfigurasi di Vercel Settings." });
  }

  try {
    const senderEmail = "random23sx21@gmail.com"; 

    const response = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: {
        "accept": "application/json",
        "api-key": BREVO_API_KEY,
        "content-type": "application/json"
      },
      body: JSON.stringify({
        sender: { name: "DapurPintar Notif", email: senderEmail },
        to: [{ email: email, name: name || "Pengguna DapurPintar" }],
        subject: "Tes Notifikasi Email DapurPintar 🍳",
        htmlContent: `
          <div style="font-family: sans-serif; padding: 30px; color: #333; background-color: #f9fafb; border-radius: 20px;">
            <div style="background-color: #ffffff; padding: 40px; border-radius: 24px; border: 1px solid #e5e7eb; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);">
              <h1 style="color: #059669; margin-top: 0;">Halo ${name || "Pengguna"}!</h1>
              <p style="font-size: 16px; line-height: 1.6;">Integrasi Brevo Anda <b>BERHASIL</b>.</p>
              <p style="font-size: 16px; line-height: 1.6;">Email ini dikirim dari server DapurPintar menggunakan API Key Anda di Vercel.</p>
              <div style="margin-top: 30px; padding-top: 20px; border-top: 1px solid #f3f4f6; color: #6b7280; font-size: 12px;">
                <p>Selamat memasak!<br/><b>Tim DapurPintar</b></p>
              </div>
            </div>
          </div>
        `
      })
    });

    const data = await response.json();
    if (response.ok) {
      res.json({ success: true, messageId: data.messageId });
    } else {
      res.status(500).json({ error: data.message || "Brevo API Error" });
    }
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Automated Reminder API (Triggered by Frontend)
app.post("/api/send-automated-reminder", async (req, res) => {
  const { email, name, expiringItems } = req.body;
  const BREVO_API_KEY = process.env.BREVO_API_KEY;

  if (!BREVO_API_KEY) {
    return res.status(500).json({ error: "Brevo API Key not configured" });
  }

  if (!expiringItems || expiringItems.length === 0) {
    return res.json({ success: true, message: "No items to remind" });
  }

  try {
    const itemsHtml = expiringItems.map((item: any) => `
      <li style="margin-bottom: 12px; padding: 15px; border-left: 5px solid #ef4444; background: #ffffff; border-radius: 12px; box-shadow: 0 1px 2px rgba(0,0,0,0.05);">
        <b style="font-size: 16px; color: #111827;">${item.name}</b><br/>
        <span style="font-size: 13px; color: #6b7280;">
          Kuantitas: ${item.quantity} ${item.unit} | 
          <b>Kedaluwarsa: ${new Date(item.expiryDate).toLocaleDateString('id-ID', { day: 'numeric', month: 'long' })}</b>
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
        to: [{ email: email }],
        subject: "⚠️ Perhatian: Bahan Makanan Anda Akan Kedaluwarsa!",
        htmlContent: `
          <div style="font-family: sans-serif; background-color: #f9fafb; padding: 40px; color: #374151;">
            <div style="max-width: 550px; margin: 0 auto; background: #ffffff; padding: 35px; border-radius: 28px; border: 1px solid #e5e7eb;">
              <h2 style="color: #059669; font-size: 24px; margin-bottom: 8px;">DapurPintar Reminder 🍳</h2>
              <p style="font-size: 15px; margin-bottom: 25px;">Halo <b>${name || "Sobat Dapur"}</b>! Kami mencatat ada beberapa bahan makanan yang harus segera diolah:</p>
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
      res.json({ success: true });
    } else {
      const errorData = await response.json();
      res.status(500).json({ error: errorData.message });
    }
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Default exported function for Vercel
export default app;
