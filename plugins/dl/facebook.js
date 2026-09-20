import axios from "axios";
import ffmpeg from "fluent-ffmpeg";
import { writeFile, readFile, unlink } from "fs/promises";
import path from "path";

function decodeHtmlEntities(str) {
  return str
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function validateFacebookUrl(url) {
  let cleaned = url.trim().replace(/[^\x00-\x7F]/g, "");

  const patterns = [
    /(?:https?:\/\/)?(?:www\.)?facebook\.com\/.+\/videos\/\d+/,
    /(?:https?:\/\/)?(?:www\.)?facebook\.com\/watch\/?\?v=\d+/,
    /(?:https?:\/\/)?(?:www\.)?facebook\.com\/reel\/\d+/,
    /(?:https?:\/\/)?fb\.watch\/[A-Za-z0-9_-]+/,
    /(?:https?:\/\/)?(?:m\.)?facebook\.com\/.+\/videos\/\d+/,
    /(?:https?:\/\/)?(?:www\.)?facebook\.com\/share\/[rv]\/[A-Za-z0-9_-]+/,
  ];

  for (const pattern of patterns) {
    if (pattern.test(cleaned)) {
      if (!cleaned.startsWith("http://") && !cleaned.startsWith("https://")) {
        cleaned = "https://" + cleaned;
      }
      return cleaned;
    }
  }

  return null;
}

async function fixVideo(buffer) {
  const tmpDir = process.env.TMPDIR || "./tmp";
  const inputPath = path.join(tmpDir, `fb_in_${Date.now()}.mp4`);
  const outputPath = path.join(tmpDir, `fb_out_${Date.now()}.mp4`);

  await writeFile(inputPath, buffer);

  await new Promise((resolve, reject) => {
    ffmpeg(inputPath)
      .outputOptions([
        "-c:v libx264",
        "-preset veryfast",
        "-crf 28",
        "-c:a aac",
        "-b:a 128k",
        "-movflags +faststart",
        "-pix_fmt yuv420p"
      ])
      .save(outputPath)
      .on("end", resolve)
      .on("error", reject);
  });

  const fixedBuffer = await readFile(outputPath);

  await unlink(inputPath).catch(() => {});
  await unlink(outputPath).catch(() => {});

  return fixedBuffer;
}

async function downloadFacebookVideo(url) {
  const res = await axios.get("https://api.alyacore.xyz/dl/facebook", {
    params: { url, key: "Duarte-zz12" },
    timeout: 25000
  });

  const data = res.data;

  if (!data.status || !Array.isArray(data.resultados) || !data.resultados.length) {
    throw new Error("No se encontraron formatos disponibles en la respuesta de la API");
  }

  const formatos = data.resultados;
  const mejorFormato =
    formatos.find(f => f.url?.includes("snapcdn.app") && f.quality?.includes("720p")) ||
    formatos.find(f => f.url?.includes("snapcdn.app") && f.quality?.includes("360p")) ||
    formatos.find(f => f.url?.includes("snapcdn.app") && f.url !== "/") ||
    formatos.find(f => f.quality?.includes("1080p") && f.url !== "/") ||
    formatos.find(f => f.quality?.includes("720p") && f.url !== "/" && !f.url?.includes("fbcdn.net")) ||
    formatos.find(f => f.url !== "/");

  if (!mejorFormato) {
    throw new Error("No se encontró un enlace de descarga de video válido");
  }

  const videoUrl = decodeHtmlEntities(mejorFormato.url);
  const headers = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Referer": "https://www.facebook.com/"
  };

  const videoRes = await axios.get(videoUrl, {
    responseType: "arraybuffer",
    timeout: 30000,
    headers
  });

  const contentType = videoRes.headers["content-type"] || "";
  if (!contentType.includes("video") || videoRes.data.byteLength < 10000) {
    throw new Error("El enlace no devolvió un video válido (posible bloqueo del CDN o link expirado)");
  }

  const rawBuffer = Buffer.from(videoRes.data);
  const fixedBuffer = await fixVideo(rawBuffer);

  return { buffer: fixedBuffer };
}

export default {
  name: ["facebook", "fb"],
  description: "Descarga videos de Facebook",
  category: "dl",
  ownerOnly: false,

  async run({ sock, from, msg, text, usedPrefix, react, reply }) {
    try {
      if (!text) {
        return await reply({
          text: `Debes ingresar un enlace de Facebook.\n\nUso: ${usedPrefix}facebook https://www.facebook.com/watch?v=1234567890`
        });
      }

      const facebookUrl = validateFacebookUrl(text);
      if (!facebookUrl) {
        return await reply({
          text:
            `URL de Facebook inválida.\n\n` +
            `URLs válidas:\n` +
            `• facebook.com/.../videos/...\n` +
            `• facebook.com/watch?v=...\n` +
            `• facebook.com/reel/...\n` +
            `• facebook.com/share/v/...\n` +
            `• fb.watch/...`
        });
      }

      await react("⏳");

      const result = await downloadFacebookVideo(facebookUrl);

      await sock.sendMessage(
        from,
        { video: result.buffer, mimetype: "video/mp4", caption: "Aquí tienes :D" },
        { quoted: msg }
      );

      await react("✅");

    } catch (error) {
      await react("❌");
      await reply({ text: `Error: ${error.message}` });
      console.error("Error en facebook:", error);
    }
  }
};