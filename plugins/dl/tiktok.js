
import axios from 'axios';
import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { pipeline } from 'stream/promises';
import { Transform } from 'stream';

const execAsync = promisify(exec);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const tmp = path.join(__dirname, '../../tmp');

const API = 'https://btch-downloader-api-green.vercel.app/api/download/tiktok';

if (!fs.existsSync(tmp)) {
  fs.mkdirSync(tmp, { recursive: true });
}

const MAX_INPUT_MB = 500;
const MAX_SIZE_MB = 60;

function validateTikTokUrl(url) {
  if (!url) return null;

  try {
    const parsed = new URL(url);

    if (
      !['tiktok.com', 'www.tiktok.com', 'vm.tiktok.com',
        'vt.tiktok.com', 'm.tiktok.com'].includes(parsed.hostname)
    ) {
      return null;
    }

    return parsed.href;
  } catch {
    return null;
  }
}

async function getTikTokData(url) {
  const { data } = await axios.get(API, {
    params: { url },
    timeout: 45000,
    headers: {
      'User-Agent': 'Mozilla/5.0',
      'Accept': 'application/json'
    }
  });

  if (!data?.success || data.platform !== 'tiktok') {
    throw new Error(
      data?.message || data?.error || 'La API no pudo procesar el video.'
    );
  }

  const normalized = data.normalized;
  const original = data.result;

  const media = normalized?.media || [];

  const video = media.find(item =>
    item.type === 'video' &&
    typeof item.url === 'string' &&
    item.url.startsWith('http')
  );

  if (!video) {
    throw new Error('La API no devolvió un enlace de video válido.');
  }

  return {
    videoUrl: video.url,
    title: normalized.title || original?.title || 'Sin título',
    authorNick:
      normalized.author?.nickname ||
      normalized.author?.name ||
      original?.author?.nickname ||
      original?.author?.name ||
      'Desconocido',
    likes: original?.digg_count ?? original?.likes ?? 'N/A',
    shares: original?.share_count ?? original?.shares ?? 'N/A',
    downloads: original?.download_count ?? original?.downloads ?? 'N/A',
    comments: original?.comment_count ?? original?.comments ?? 'N/A'
  };
}

async function descargarAArchivo(url, destPath) {
  const response = await axios.get(url, {
    responseType: 'stream',
    timeout: 90000,
    maxContentLength: Infinity,
    headers: {
      'User-Agent': 'Mozilla/5.0',
      'Referer': 'https://www.tiktok.com/'
    }
  });

  const contentLength = Number(response.headers['content-length']);

  if (
    Number.isFinite(contentLength) &&
    contentLength > MAX_INPUT_MB * 1024 * 1024
  ) {
    response.data.destroy();
    throw new Error(`El video supera el límite de ${MAX_INPUT_MB}MB.`);
  }

  let downloaded = 0;

  const limiter = new Transform({
    transform(chunk, encoding, callback) {
      downloaded += chunk.length;

      if (downloaded > MAX_INPUT_MB * 1024 * 1024) {
        callback(
          new Error(`El video supera el límite de ${MAX_INPUT_MB}MB.`)
        );
        return;
      }

      callback(null, chunk);
    }
  });

  await pipeline(
    response.data,
    limiter,
    fs.createWriteStream(destPath)
  );

  if (!fs.existsSync(destPath) || fs.statSync(destPath).size === 0) {
    throw new Error('El servidor devolvió un archivo vacío.');
  }
}

async function validarSalida(outP) {
  if (!fs.existsSync(outP) || fs.statSync(outP).size === 0) {
    throw new Error(`FFmpeg generó un archivo vacío o inexistente: ${outP}`);
  }

  const { stdout } = await execAsync(
    `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${outP}"`
  );

  const outDuration = parseFloat(stdout.trim());

  if (!outDuration || outDuration <= 0) {
    throw new Error(`FFmpeg generó un archivo corrupto: ${outP}`);
  }
}

async function processVideoFile(inputP, outP) {
  const originalSizeMB = fs.statSync(inputP).size / (1024 * 1024);

  if (originalSizeMB <= MAX_SIZE_MB) {
    // Remux puro: conserva calidad, resolución y FPS.
    await execAsync(
      `ffmpeg -y -fflags +genpts -i "${inputP}" -c copy -avoid_negative_ts make_zero -movflags +faststart "${outP}"`,
      { timeout: 180000 }
    );

    await validarSalida(outP);
    return;
  }

  const { stdout: fpsRaw } = await execAsync(
    `ffprobe -v error -select_streams v:0 -show_entries stream=r_frame_rate -of default=noprint_wrappers=1:nokey=1 "${inputP}"`
  );

  const fps = fpsRaw.trim() || '30/1';

  let scaleFilter = '';

  if (originalSizeMB > 150) {
    scaleFilter = `-vf "scale='min(854,iw)':-2`;
    scaleFilter += '"';
  } else if (originalSizeMB > 100) {
    scaleFilter = `-vf "scale='min(1280,iw)':-2`;
    scaleFilter += '"';
  }

  await execAsync(
    `ffmpeg -y -fflags +genpts -i "${inputP}" ${scaleFilter} -r ${fps} -threads 2 -c:v libx264 -preset ultrafast -crf 28 -c:a aac -b:a 96k -avoid_negative_ts make_zero -movflags +faststart "${outP}"`,
    {
      maxBuffer: 1024 * 1024 * 20,
      timeout: 600000
    }
  );

  await validarSalida(outP);
}

export default {
  name: ['tiktok', 'tt'],
  description: 'Descarga videos de TikTok rápido',
  category: 'dl',
  groupOnly: false,

  async run({ sock, from, msg, args, usedPrefix, cmdName, reply, react }) {
    if (!args[0]) {
      return await reply({
        text: `🎵 Por favor, ingresa un enlace de TikTok.\n\n📝 *Ejemplo:* ${usedPrefix}${cmdName} https://www.tiktok.com/@usuario/video/1234567890`
      });
    }

    const tiktokUrl = validateTikTokUrl(args[0]);

    if (!tiktokUrl) {
      return await reply({
        text: `❌ URL de TikTok inválida. Por favor verifica el enlace.\n\n✅ *URLs válidas:*\n• https://www.tiktok.com/@usuario/video/...\n• https://vm.tiktok.com/...\n• https://vt.tiktok.com/...`
      });
    }

    await react('🔄');
    await reply({ text: `> ✎...Descargando video.` });

    const id = crypto.randomBytes(8).toString('hex');
    const inputP = path.join(tmp, `tt_${id}.mp4`);
    const outP = path.join(tmp, `tt_${id}_out.mp4`);

    try {
      // 1. Consultar BTCH Downloader.
      const result = await getTikTokData(tiktokUrl);

      if (!result?.videoUrl) {
        throw new Error('No se encontró un enlace de video disponible.');
      }

      // 2. Descargar mediante STREAM directamente al archivo temporal.
      await descargarAArchivo(result.videoUrl, inputP);

      const sizeMB = fs.statSync(inputP).size / (1024 * 1024);

      if (sizeMB > MAX_INPUT_MB) {
        throw new Error(
          `El video pesa ${sizeMB.toFixed(0)}MB, demasiado grande para procesar (límite: ${MAX_INPUT_MB}MB).`
        );
      }

      if (sizeMB > MAX_SIZE_MB) {
        await reply({
          text: `⏳ El video pesa ${sizeMB.toFixed(0)}MB, comprimiendo antes de enviar (puede tardar unos minutos)...`
        });
      }

      // 3. Procesamiento con FFmpeg.
      let finalPath = inputP;

      try {
        await processVideoFile(inputP, outP);
        finalPath = outP;
      } catch (e) {
        console.error('No se pudo procesar el video:', e?.stack || e.message);

        if (sizeMB > MAX_SIZE_MB) {
          throw new Error(
            `No se pudo comprimir el video (${sizeMB.toFixed(0)}MB) y es demasiado pesado para enviar sin comprimir.`
          );
        }
      }

      // 4. Conservar diseño original.
      const titulo = result.title?.trim() || 'Sin título';

      let caption = `☑ *Video de TikTok descargado*\n`;
      caption += `─╮\n`;
      caption += `   ╰━━━━━━(☆)━━━━━━─╮\n`;
      caption += `*👤 ᴀᴜᴛᴏʀ:* ${result.authorNick || 'Desconocido'}\n`;
      caption += `*♡ ʟɪᴋᴇs:* ${result.likes ?? 'N/A'}\n`;
      caption += `*⌲ sʜᴀʀᴇ:* ${result.shares ?? 'N/A'}\n`;
      caption += `*⎙ sᴀᴠᴇ:* ${result.downloads ?? 'N/A'}\n`;
      caption += `*○ ᴄᴏᴍᴍᴇɴᴛ:* ${result.comments ?? 'N/A'}\n`;
      caption += `*📹 ᴛɪᴛᴜʟᴏ:* ${titulo}`;

      // 5. Baileys lee el archivo mediante su ruta.
      await sock.sendMessage(from, {
        video: { url: finalPath },
        mimetype: 'video/mp4',
        fileName: 'tiktok.mp4',
        caption
      }, { quoted: msg });

      await react('✅');

    } catch (error) {
      console.error('Error en TikTok download:', error?.stack || error);

      await react('❌');

      await reply({
        text: `❌ Error al procesar la descarga: ${error.message}`
      });

    } finally {
      try {
        if (fs.existsSync(inputP)) fs.unlinkSync(inputP);
      } catch {}

      try {
        if (fs.existsSync(outP)) fs.unlinkSync(outP);
      } catch {}
    }
  }
};
