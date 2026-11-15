
import axios from 'axios';
import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { pipeline } from 'stream/promises';

const execAsync = promisify(exec);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const tmp = path.join(__dirname, '../../tmp');

if (!fs.existsSync(tmp)) {
  fs.mkdirSync(tmp, { recursive: true });
}

const MAX_INPUT_MB = 500;
const MAX_SIZE_MB = 60;

function validateTikTokUrl(url) {
  if (!url) return null;

  const regex =
    /^(https?:\/\/)?(www\.|vm\.|vt\.)?tiktok\.com\/[\w\d@?=&/.-]+/i;

  const match = url.match(regex);
  return match ? match[0] : null;
}

function formatDebug(data) {
  const output = JSON.stringify(data, null, 2);

  // Evitar mensajes demasiado extensos para WhatsApp.
  return output.length > 10000
    ? output.slice(0, 10000) + '\n... [Respuesta truncada]'
    : output;
}

async function downloadTikTokNormal(url) {
  let debug = {};

  try {
    const apiUrl = 'https://www.tikwm.com/api/';

    const response = await axios.get(apiUrl, {
      params: { url },
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
        Accept: 'application/json, text/plain, */*',
        Referer: 'https://www.tikwm.com/',
        Origin: 'https://www.tikwm.com'
      },
      timeout: 30000
    });

    const data = response.data;

    debug = {
      statusHTTP: response.status,
      codigo: data?.code ?? null,
      mensaje: data?.msg ?? null,
      parametros: {
        urlEnviada: url
      },
      respuesta: data,
      deteccion: {
        tieneData: !!data?.data,
        tienePlay: !!data?.data?.play,
        tieneWmplay: !!data?.data?.wmplay,
        tieneHdplay: !!data?.data?.hdplay,
        clavesData: data?.data
          ? Object.keys(data.data)
          : []
      }
    };

    if (
      Number(data?.code) === 0 &&
      data?.data &&
      (data.data.play || data.data.wmplay || data.data.hdplay)
    ) {
      const d = data.data;

      return {
        videoUrl: d.play || d.hdplay || d.wmplay,
        title: d.title,
        authorNick: d.author?.nickname || 'Desconocido',
        likes: d.digg_count,
        shares: d.share_count,
        downloads: d.download_count,
        comments: d.comment_count,
        debug
      };
    }

    const error = new Error(
      `TikWM no devolvió datos utilizables. Código: ${data?.code ?? 'N/A'} | Mensaje: ${data?.msg ?? 'Sin mensaje'}`
    );

    error.debug = debug;
    throw error;

  } catch (error) {
    if (!debug.statusHTTP) {
      debug = {
        ...debug,
        error: error.message,
        codigoHTTP: error.response?.status ?? null,
        respuestaHTTP: error.response?.data ?? null,
        codigoError: error.code ?? null
      };
    }

    error.debug = debug;
    throw error;
  }
}

async function descargarAArchivo(url, destPath) {
  const response = await axios.get(url, {
    responseType: 'stream',
    timeout: 60000,
    headers: {
      'User-Agent': 'Mozilla/5.0'
    }
  });

  await pipeline(response.data, fs.createWriteStream(destPath));
}

async function validarSalida(outP) {
  if (!fs.existsSync(outP) || fs.statSync(outP).size === 0) {
    throw new Error(`Archivo vacío o inexistente: ${outP}`);
  }

  const { stdout } = await execAsync(
    `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${outP}"`
  );

  const duration = parseFloat(stdout.trim());

  if (!duration || duration <= 0) {
    throw new Error(`Duración inválida: ${outP}`);
  }
}

async function processVideoFile(inputP, outP) {
  const originalSizeMB =
    fs.statSync(inputP).size / (1024 * 1024);

  if (originalSizeMB <= MAX_SIZE_MB) {
    await execAsync(
      `ffmpeg -y -fflags +genpts -i "${inputP}" -c copy -avoid_negative_ts make_zero -movflags +faststart "${outP}"`
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
    scaleFilter = `-vf "scale='min(854,iw)':-2"`;
  } else if (originalSizeMB > 100) {
    scaleFilter = `-vf "scale='min(1280,iw)':-2"`;
  }

  await execAsync(
    `ffmpeg -y -fflags +genpts -i "${inputP}" ${scaleFilter} -r ${fps} -threads 2 ` +
    `-c:v libx264 -preset ultrafast -crf 28 ` +
    `-c:a aac -b:a 96k -avoid_negative_ts make_zero -movflags +faststart "${outP}"`,
    {
      maxBuffer: 1024 * 1024 * 20,
      timeout: 600000
    }
  );

  await validarSalida(outP);
}

export default {
  name: ['tiktok', 'tt'],
  description: 'Descarga videos de TikTok con diagnóstico',
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
    if (!args[0]) {
      return await reply({
        text:
          `🎵 Ingresa un enlace de TikTok.\n\n` +
          `📝 Ejemplo: ${usedPrefix}${cmdName} https://www.tiktok.com/@usuario/video/1234567890`
      });
    }

    const tiktokUrl = validateTikTokUrl(args[0]);

    if (!tiktokUrl) {
      return await reply({
        text:
          '❌ URL de TikTok inválida.\n\n' +
          'Ejemplos:\n' +
          '• https://www.tiktok.com/@usuario/video/...\n' +
          '• https://vm.tiktok.com/...\n' +
          '• https://vt.tiktok.com/...'
      });
    }

    await react('🔄');
    await reply({ text: '> ✎...Descargando video.' });

    const id = crypto.randomBytes(8).toString('hex');
    const inputP = path.join(tmp, `tt_${id}.mp4`);
    const outP = path.join(tmp, `tt_${id}_out.mp4`);

    try {
      const result = await downloadTikTokNormal(tiktokUrl);

      // Diagnóstico exitoso de la API.
      await reply({
        text:
          '🔍 *DEBUG TIKWM*\n\n' +
          'La API respondió correctamente.\n\n' +
          '```json\n' +
          formatDebug(result.debug) +
          '\n```'
      });

      if (!result?.videoUrl) {
        throw new Error('La API no proporcionó una URL de video.');
      }

      await descargarAArchivo(result.videoUrl, inputP);

      const sizeMB =
        fs.statSync(inputP).size / (1024 * 1024);

      if (sizeMB > MAX_INPUT_MB) {
        throw new Error(
          `El video pesa ${sizeMB.toFixed(0)}MB. Límite: ${MAX_INPUT_MB}MB.`
        );
      }

      if (sizeMB > MAX_SIZE_MB) {
        await reply({
          text:
            `⏳ El video pesa ${sizeMB.toFixed(0)}MB, ` +
            'comprimiendo antes de enviar...'
        });
      }

      let finalPath = inputP;

      try {
        await processVideoFile(inputP, outP);
        finalPath = outP;
      } catch (e) {
        console.error(
          'Error FFmpeg:',
          e?.stack || e.message
        );

        if (sizeMB > MAX_SIZE_MB) {
          throw new Error(
            `No se pudo comprimir el video (${sizeMB.toFixed(0)}MB).`
          );
        }
      }

      const titulo = result.title?.trim() || 'Sin título';

      let caption = `☑ *Video de TikTok descargado*\n`;
      caption += `─╮\n`;
      caption += `   ╰━━━━━━(☆)━━━━━━─╮\n`;
      caption += `*👤 ᴀᴜᴛᴏʀ:* ${result.authorNick}\n`;
      caption += `*♡ ʟɪᴋᴇs:* ${result.likes ?? 'N/A'}\n`;
      caption += `*⌲ sʜᴀʀᴇ:* ${result.shares ?? 'N/A'}\n`;
      caption += `*⎙ sᴀᴠᴇ:* ${result.downloads ?? 'N/A'}\n`;
      caption += `*○ ᴄᴏᴍᴍᴇɴᴛ:* ${result.comments ?? 'N/A'}\n`;
      caption += `*📹 ᴛɪᴛᴜʟᴏ:* ${titulo}`;

      await sock.sendMessage(
        from,
        {
          video: { url: finalPath },
          mimetype: 'video/mp4',
          fileName: 'tiktok.mp4',
          caption
        },
        { quoted: msg }
      );

      await react('✅');

    } catch (error) {
      console.error(
        'Error TikTok:',
        error?.stack || error
      );

      await react('❌');

      const debug = error.debug
        ? formatDebug(error.debug)
        : 'No se recibió una respuesta válida de la API.';

      await reply({
        text:
          `❌ *Error al procesar TikTok*\n\n` +
          `📌 *Error:* ${error.message}\n\n` +
          `🔍 *Diagnóstico:*\n` +
          '```json\n' +
          debug +
          '\n```'
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
