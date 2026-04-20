import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import * as dotenv from "dotenv";
import fs from "fs";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function createServer() {
  const app = express();

  app.use(express.json());

  // Brevo Email API (Manual Test)
  app.post("/api/send-test-email", async (req, res) => {
    const { email, name } = req.body;
    const BREVO_API_KEY = process.env.BREVO_API_KEY;

    if (!BREVO_API_KEY) {
      console.error("DEBUG: BREVO_API_KEY is missing in process.env");
      return res.status(500).json({ error: "Brevo API Key belum dikonfigurasi di menu Secrets." });
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
                <p style="font-size: 16px; line-height: 1.6;">Email ini dikirim dari server DapurPintar menggunakan API Key Anda.</p>
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
        console.log("DEBUG: Email sent successfully via Brevo. ID:", data.messageId);
        res.json({ success: true, messageId: data.messageId });
      } else {
        console.error("DEBUG: Brevo API Error:", data);
        const errorMsg = data.message || JSON.stringify(data);
        throw new Error(`Brevo API Error: ${errorMsg}`);
      }
    } catch (error: any) {
      console.error("Brevo Error:", error);
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
      console.error("Automated Reminder Error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Gemini AI Setup (Server-side)
  const GEMINI_API_KEY = process.env.MY_CUSTOM_GEMINI_KEY || process.env.GEMINI_API_KEY || "";
  if (!GEMINI_API_KEY || GEMINI_API_KEY === "MY_GEMINI_API_KEY") {
    console.warn("WARNING: Gemini API Key is empty or using placeholder value!");
  }

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  return app;
}

// Start the server for production/local dev
if (process.env.NODE_ENV !== "production" || !process.env.VERCEL) {
  createServer().then(app => {
    const PORT = 3000;
    app.listen(PORT, "0.0.0.0", () => {
      console.log(`Server running on http://localhost:${PORT}`);
    });
  });
}

export default createServer;
