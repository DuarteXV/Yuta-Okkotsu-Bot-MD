
import axios from 'axios';
import { execFile } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { pipeline } from 'stream/promises';
import { Transform } from 'stream';

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const API_URL = 'https://api.alyacore.xyz/dl/tiktok';
const API_KEY = 'Duarte-zz12';

const TEMP_DIR = path.resolve(__dirname, '../../tmp');

const MAX_INPUT_MB = 500;
const MAX_SIZE_MB = 60;

const MAX_INPUT_BYTES = MAX_INPUT_MB * 1024 * 1024;
const MAX_SIZE_BYTES = MAX_SIZE_MB * 1024 * 1024;

const API_TIMEOUT = 25000;
const DOWNLOAD_TIMEOUT = 120000;

function validateTikTokUrl(value) {
  try {
    const parsed = new URL(value);

    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return false;
    }

    const hostname = parsed.hostname.toLowerCase();

    return (
      hostname === 'tiktok.com' ||
      hostname.endsWith('.tiktok.com')
    );
  } catch {
    return false;
  }
}

function createSizeLimiter(maxBytes) {
  let downloaded = 0;

  return new Transform({
    transform(chunk, encoding, callback) {
      downloaded += chunk.length;

      if (downloaded > maxBytes) {
        return callback(
          new Error(`El video supera el límite de ${MAX_INPUT_MB} MB.`)
        );
      }

      callback(null, chunk);
    }
  });
}

async function getTikTokData(url) {
  const { data: response } = await axios.get(API_URL, {
    params: {
      url,
      key: API_KEY
    },
    timeout: API_TIMEOUT,
    headers: {
      Accept: 'application/json',
      'User-Agent': 'Mozilla/5.0'
    }
  });

  if (!response?.status || !response?.data?.dl) {
    throw new Error(
      response?.message ||
      response?.msg ||
      'AlyaCore no pudo obtener el video.'
    );
  }

  const data = response.data;

  if (data.type !== 'video') {
    throw new Error('El enlace no contiene un video compatible.');
  }

  return {
    videoUrl: data.dl,
    title: data.title || 'Video de TikTok',
    authorNick: data.author?.nickname || 'Desconocido',
    username: data.author?.unique_id || null,
    avatar: data.author?.avatar || null,
    likes: data.stats?.likes ?? 'N/A',
    shares: data.stats?.shares ?? 'N/A',
    downloads: data.stats?.downloads ?? 'N/A',
    comments: data.stats?.comments ?? 'N/A',
    plays: data.stats?.plays ?? 'N/A',
    duration: data.duration || 'N/A',
    region: data.region || 'N/A',
    thumbnail: data.cover || null
  };
}

async function downloadTikTokStream(url, outputPath) {
  const response = await axios.get(url, {
    responseType: 'stream',
    timeout: DOWNLOAD_TIMEOUT,
    maxContentLength: Infinity,
    maxBodyLength: Infinity,
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
      Referer: 'https://www.tiktok.com/'
    }
  });

  if (response.status !== 200) {
    response.data.destroy();

    throw new Error(
      `El servidor de video respondió con HTTP ${response.status}.`
    );
  }

  const contentLength = Number(response.headers['content-length']);

  if (
    Number.isFinite(contentLength) &&
    contentLength > MAX_INPUT_BYTES
  ) {
    response.data.destroy();

    throw new Error(
      `El video supera el límite de ${MAX_INPUT_MB} MB.`
    );
  }

  await pipeline(
    response.data,
    createSizeLimiter(MAX_INPUT_BYTES),
    fs.createWriteStream(outputPath)
  );

  const stats = await fs.promises.stat(outputPath);

  if (!stats.size) {
    throw new Error('El archivo descargado está vacío.');
  }

  return stats.size;
}

async function getVideoDuration(filePath) {
  const { stdout } = await execFileAsync('ffprobe', [
    '-v',
    'error',
    '-show_entries',
    'format=duration',
    '-of',
    'default=noprint_wrappers=1:nokey=1',
    filePath
  ]);

  const duration = Number(stdout.trim());

  if (!Number.isFinite(duration) || duration <= 0) {
    throw new Error('No se pudo validar la duración del video.');
  }

  return duration;
}

async function processTikTokVideo(inputPath, outputPath, fileSize) {
  if (fileSize <= MAX_SIZE_BYTES) {
    try {
      await execFileAsync('ffmpeg', [
        '-y',
        '-i',
        inputPath,
        '-c',
        'copy',
        '-avoid_negative_ts',
        'make_zero',
        '-movflags',
        '+faststart',
        outputPath
      ]);

      await getVideoDuration(outputPath);

      return outputPath;
    } catch {
      // Si el remux falla, se intenta una conversión compatible.
    }
  }

  let maxWidth = 1920;

  if (fileSize > 150 * 1024 * 1024) {
    maxWidth = 854;
  } else if (fileSize > 100 * 1024 * 1024) {
    maxWidth = 1280;
  }

  const scaleFilter =
    `scale='if(gt(iw,${maxWidth}),${maxWidth},iw)':-2`;

  await execFileAsync('ffmpeg', [
    '-y',
    '-i',
    inputPath,
    '-vf',
    scaleFilter,
    '-c:v',
    'libx264',
    '-preset',
    'ultrafast',
    '-crf',
    '28',
    '-c:a',
    'aac',
    '-b:a',
    '96k',
    '-threads',
    '2',
    '-movflags',
    '+faststart',
    '-pix_fmt',
    'yuv420p',
    outputPath
  ]);

  await getVideoDuration(outputPath);

  return outputPath;
}

async function safeReact(react, emoji) {
  try {
    if (typeof react === 'function') {
      await react(emoji);
    }
  } catch {
    // No interrumpir la descarga por un error de reacción.
  }
}

export default {
  name: ['tiktok', 'tt'],
  description: 'Descarga videos de TikTok rápido.',
  category: 'dl',
  groupOnly: false,

  async run({
    sock,
    from,
    msg,
    args,
    usedPrefix,
    cmdName,
    reply,
    react
  }) {
    let inputPath;
    let outputPath;

    try {
      const url = args?.[0]?.trim();

      if (!url) {
        return reply({
          text:
            `🎵 Por favor, ingresa un enlace de TikTok.\n\n` +
            `📝 *Ejemplo:* ${usedPrefix}${cmdName} https://www.tiktok.com/@usuario/video/1234567890`
        });
      }

      if (!validateTikTokUrl(url)) {
        return reply({
          text:
            `❌ URL de TikTok inválida. Por favor verifica el enlace.\n\n` +
            `✅ *URLs válidas:*\n` +
            `• https://www.tiktok.com/@usuario/video/...\n` +
            `• https://vm.tiktok.com/...\n` +
            `• https://vt.tiktok.com/...`
        });
      }

      await safeReact(react, '🔄');

      await reply({
        text: '> ✎...Descargando video.'
      });

      await fs.promises.mkdir(TEMP_DIR, {
        recursive: true
      });

      const randomId = crypto.randomBytes(8).toString('hex');

      inputPath = path.join(
        TEMP_DIR,
        `tt_${randomId}.mp4`
      );

      outputPath = path.join(
        TEMP_DIR,
        `tt_${randomId}_out.mp4`
      );

      const result = await getTikTokData(url);

      const fileSize = await downloadTikTokStream(
        result.videoUrl,
        inputPath
      );

      const finalPath = await processTikTokVideo(
        inputPath,
        outputPath,
        fileSize
      );

      const titulo = result.title;

      let caption = `☑ *Video de TikTok descargado*\n`;
      caption += `─╮\n`;
      caption += `   ╰━━━━━━(☆)━━━━━━─╮\n`;
      caption += `*👤 ᴀᴜᴛᴏʀ:* ${result.authorNick || 'Desconocido'}\n`;
      caption += `*♡ ʟɪᴋᴇs:* ${result.likes ?? 'N/A'}\n`;
      caption += `*⌲ sʜᴀʀᴇ:* ${result.shares ?? 'N/A'}\n`;
      caption += `*⎙ sᴀᴠᴇ:* ${result.downloads ?? 'N/A'}\n`;
      caption += `*○ ᴄᴏᴍᴍᴇɴᴛ:* ${result.comments ?? 'N/A'}\n`;
      caption += `*📹 ᴛɪᴛᴜʟᴏ:* ${titulo}`;

      await sock.sendMessage(
        from,
        {
          video: {
            url: finalPath
          },
          mimetype: 'video/mp4',
          fileName: 'tiktok.mp4',
          caption
        },
        {
          quoted: msg
        }
      );

      await safeReact(react, '✅');

    } catch (error) {
      console.error('[TIKTOK DOWNLOAD ERROR]', error);

      await safeReact(react, '❌');

      await reply({
        text: `❌ Error al procesar la descarga: ${error.message}`
      });

    } finally {
      for (const file of [inputPath, outputPath]) {
        if (!file) continue;

        try {
          await fs.promises.unlink(file);
        } catch {
          // El archivo puede no haberse creado.
        }
      }
    }
  }
};
