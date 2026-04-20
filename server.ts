import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import { fileURLToPath } from "url";
import * as dotenv from "dotenv";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  // Brevo Email API
  app.post("/api/send-test-email", async (req, res) => {
    const { email, name } = req.body;
    const BREVO_API_KEY = process.env.BREVO_API_KEY;

    if (!BREVO_API_KEY) {
      return res.status(500).json({ error: "Brevo API Key belum dikonfigurasi di server." });
    }

    try {
      const response = await fetch("https://api.brevo.com/v3/smtp/email", {
        method: "POST",
        headers: {
          "accept": "application/json",
          "api-key": BREVO_API_KEY,
          "content-type": "application/json"
        },
        body: JSON.stringify({
          sender: { name: "DapurPintar", email: "noreply@dapurpintar.com" },
          to: [{ email: email, name: name || "Pengguna DapurPintar" }],
          subject: "Tes Notifikasi Email DapurPintar 🍳",
          htmlContent: `
            <div style="font-family: sans-serif; padding: 20px; color: #333;">
              <h2 style="color: #059669;">Halo ${name || "Pengguna"}!</h2>
              <p>Ini adalah email percobaan dari fitur <b>Notifikasi Pintar DapurPintar</b>.</p>
              <p>Jika Anda menerima email ini, berarti integrasi Brevo Anda sudah berhasil dikonfigurasi dengan benar.</p>
              <br/>
              <p>Selamat memasak!<br/>Tim DapurPintar</p>
            </div>
          `
        })
      });

      const data = await response.json();
      if (response.ok) {
        res.json({ success: true, messageId: data.messageId });
      } else {
        throw new Error(data.message || "Gagal mengirim email via Brevo.");
      }
    } catch (error: any) {
      console.error("Brevo Error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Gemini AI Setup (Server-side)
  // Using a custom name to avoid AI Studio's reserved name "GEMINI_API_KEY"
  const GEMINI_API_KEY = process.env.MY_CUSTOM_GEMINI_KEY || process.env.GEMINI_API_KEY || "";
  
  if (!GEMINI_API_KEY || GEMINI_API_KEY === "MY_GEMINI_API_KEY") {
    console.warn("WARNING: Gemini API Key is empty or using placeholder value!");
  }

  // Simple in-memory cache for recipes (Moved to frontend in geminiService.ts)

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
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

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
