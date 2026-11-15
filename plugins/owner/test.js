import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import zlib from 'zlib';
import { fileURLToPath } from 'url';
import axios from 'axios';
import { pipeline } from 'stream/promises';
import { Transform } from 'stream';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const TEMP_DIR = path.resolve(__dirname, '../../tmp');
const ORIGIN = 'https://www.instagram.com';

const MAX_SIZE_MB = 100;
const MAX_SIZE_BYTES = MAX_SIZE_MB * 1024 * 1024;
const MAX_MEDIA = 10;

const PAGE_TIMEOUT = 25000;
const REQUEST_TIMEOUT = 30000;
const DOWNLOAD_TIMEOUT = 120000;

// UA genérico: sin modelo, sin build, sin versión exacta del WebView.
const USER_AGENT =
  'Mozilla/5.0 (Linux; Android 13; K) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36';

// Idioma neutro: no delata país.
const ACCEPT_LANGUAGE = 'en-US,en;q=0.9';

// Viewport de catálogo (no es la densidad real de tu pantalla).
const VIEWPORT = { dpr: '3', wd: '412x915' };

// Valores repetidos en las URLs capturadas (#1..#46).
const HS = '20772.HYP:instagram_web_logged_out_pkg.2.1...0';
const COMET = '117';
const CRN_POST =
  'comet.instagramwebloggedout.PolarisPostLandingPageFullyPerfOptimizedRoute';

// --------------------------------------------------
// Validación
// --------------------------------------------------

function validateInstagramUrl(value) {
  try {
    const parsed = new URL(value);
    if (!['http:', 'https:'].includes(parsed.protocol)) return false;
    const hostname = parsed.hostname.toLowerCase();
    if (hostname !== 'instagram.com' && !hostname.endsWith('.instagram.com')) return false;
    return /^\/(reel|reels|p|tv)\/[A-Za-z0-9_-]+\/?$/.test(parsed.pathname);
  } catch {
    return false;
  }
}

function parseInstagramUrl(value) {
  const parsed = new URL(value);
  const match = parsed.pathname.match(/^\/(reel|reels|p|tv)\/([A-Za-z0-9_-]+)/);
  if (!match) throw new Error('No se pudo identificar la publicación.');
  return { type: match[1] === 'reels' ? 'reel' : match[1], shortcode: match[2] };
}

// --------------------------------------------------
// Cookie jar
// --------------------------------------------------

function createCookieJar() {
  const jar = { dpr: VIEWPORT.dpr, wd: VIEWPORT.wd };

  return {
    absorb(response) {
      let cookies = [];
      if (typeof response.headers.getSetCookie === 'function') {
        cookies = response.headers.getSetCookie();
      } else {
        const raw = response.headers.get('set-cookie');
        if (raw) cookies = raw.split(/,(?=\s*[^;=]+=)/);
      }
      for (const cookie of cookies) {
        const pair = cookie.split(';')[0];
        const index = pair.indexOf('=');
        if (index > 0) {
          jar[pair.slice(0, index).trim()] = pair.slice(index + 1).trim();
        }
      }
    },
    get(name) { return jar[name] || ''; },
    header() {
      return Object.entries(jar)
        .filter(([, value]) => value)
        .map(([key, value]) => `${key}=${value}`)
        .join('; ');
    }
  };
}

// --------------------------------------------------
// HTTP
// --------------------------------------------------

async function ig(url, jar, init = {}) {
  const response = await fetch(url, {
    ...init,
    redirect: 'follow',
    signal: AbortSignal.timeout(init.timeout || REQUEST_TIMEOUT),
    headers: {
      'user-agent': USER_AGENT,
      'accept': '*/*',
      'accept-language': ACCEPT_LANGUAGE,
      // 'identity' evita el zstd que usa el servidor (visto en el cuerpo de #9).
      'accept-encoding': 'identity',
      'cookie': jar.header(),
      ...(init.headers || {})
    }
  });
  jar.absorb(response);
  return response;
}

async function readText(response) {
  const buffer = Buffer.from(await response.arrayBuffer());
  if (!buffer.length) return '';
  const head = buffer.subarray(0, 4).toString('latin1');
  if (/^[{<\[f\s]/.test(head)) return buffer.toString('utf8');

  const encoding = String(response.headers.get('content-encoding') || '').toLowerCase();
  const decoders = [
    [/zstd/, () => zlib.zstdDecompressSync?.(buffer)],
    [/br/, () => zlib.brotliDecompressSync(buffer)],
    [/gzip/, () => zlib.gunzipSync(buffer)],
    [/deflate/, () => zlib.inflateSync(buffer)]
  ];
  for (const [pattern, decode] of decoders) {
    if (!pattern.test(encoding)) continue;
    try {
      const output = decode();
      if (output?.length) return output.toString('utf8');
    } catch { /* prueba el siguiente */ }
  }
  return buffer.toString('utf8');
}

// --------------------------------------------------
// Utilidades
// --------------------------------------------------

function calculateJazoest(lsd) {
  return '2' + [...lsd].reduce((total, char) => total + char.charCodeAt(0), 0);
}

function buildForm(pairs) {
  return pairs
    .filter(([key]) => key)
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value ?? '')}`)
    .join('&');
}

function stripPrefix(text) {
  return text.replace(/^\s*for \(;;\);/, '');
}

// envjson + LSD + server_revision: lo único necesario para el POST.
function extractEnv(html) {
  const envjson = html.match(/<script[^>]+id="envjson"[^>]*>([\s\S]*?)<\/script>/);
  let envData = {};
  if (envjson) { try { envData = JSON.parse(envjson[1]); } catch { /* sigue */ } }

  return {
    lsd:
      envData.lsd ||
      html.match(/"LSD",\[\],\{"token":"([^"]+)"\}/)?.[1] ||
      html.match(/"lsd"\s*:\s*"([^"]+)"/)?.[1],
    routingNamespace:
      envData.routing_namespace ||
      html.match(/"routing_namespace"\s*:\s*"([^"]+)"/)?.[1],
    nonce:
      envData.sjsNonce ||
      html.match(/"sjsNonce"\s*:\s*"([^"]+)"/)?.[1],
    rev:
      envData.server_revision ||
      html.match(/"server_revision"\s*:\s*(\d+)/)?.[1]
  };
}

function getMeta(html, name) {
  const re1 = new RegExp(`<meta[^>]+(?:property|name)="${name}"[^>]+content="([^"]+)"`);
  const re2 = new RegExp(`<meta[^>]+content="([^"]+)"[^>]+(?:property|name)="${name}"`);
  return html.match(re1)?.[1] || html.match(re2)?.[1];
}

// Extrae medios del HTML: JSON embebido, metaetiquetas OG y regex de respaldo.
function extractFromHtml(html) {
  const videos = [];
  const images = [];
  const seen = new Set();

  const push = (list, raw, extra = {}) => {
    if (!raw || typeof raw !== 'string') return;
    const url = raw.replace(/\\\//g, '/').replace(/\\u002F/gi, '/');
    if (!/^https:\/\//.test(url) || seen.has(url)) return;
    seen.add(url);
    list.push({ url, ...extra });
  };

  // 1) JSON embebido en <script data-sjs>.
  for (const match of html.matchAll(/<script[^>]+data-sjs[^>]*>([\s\S]*?)<\/script>/g)) {
    const blob = match[1];
    for (const m of blob.matchAll(/"video_versions"\s*:\s*(\[[\s\S]*?\])(?=,|\s*\})/g)) {
      try {
        const list = JSON.parse(m[1]);
        for (const v of list) if (v?.url) push(videos, v.url, { width: v.width, height: v.height });
      } catch { /* sigue */ }
    }
    for (const m of blob.matchAll(/"video_url"\s*:\s*"([^"]+)"/g)) push(videos, m[1]);
    for (const m of blob.matchAll(/"display_url"\s*:\s*"([^"]+)"/g)) push(images, m[1]);
  }

  // 2) Metaetiquetas OG (garantizadas en toda publicación pública).
  const ogVideo = getMeta(html, 'og:video:secure_url') || getMeta(html, 'og:video');
  const ogImage = getMeta(html, 'og:image');
  if (ogVideo) push(videos, ogVideo);
  if (ogImage) push(images, ogImage);

  // 3) Regex de respaldo (acepta URL sin query).
  for (const m of html.matchAll(/https:(?:\\?\/){2}[^"'\\\s<>]+?\.mp4(?:\?[^"'\\\s<>]*)?/g)) {
    push(videos, m[0]);
  }
  for (const m of html.matchAll(/https:(?:\\?\/){2}[^"'\\\s<>]+?\.(?:jpg|jpeg|webp)(?:\?[^"'\\\s<>]*)?/gi)) {
    push(images, m[0]);
  }

  return { videos, images };
}

// --------------------------------------------------
// 1. Página del post
// --------------------------------------------------

async function fetchPostPage(type, shortcode, jar) {
  const pageUrl = `${ORIGIN}/${type}/${shortcode}/`;
  const response = await ig(pageUrl, jar, {
    headers: { accept: 'text/html,application/xhtml+xml' },
    timeout: PAGE_TIMEOUT
  });
  if (!response.ok) {
    throw new Error(`Instagram respondió HTTP ${response.status}.`);
  }
  const html = await readText(response);
  if (/\/accounts\/login|login_required|challenge_required/i.test(response.url || '')) {
    throw new Error('Instagram requiere sesión para esta publicación.');
  }
  if (/Please wait a few minutes|Try Again Later|rate limit/i.test(html)) {
    throw new Error('Instagram está limitando temporalmente las solicitudes.');
  }
  return { pageUrl, html, env: extractEnv(html) };
}

// --------------------------------------------------
// 2. route-definition (vía principal, mejor calidad)
// --------------------------------------------------

async function routeDefinition(env, type, shortcode, jar) {
  if (!env.lsd || !env.routingNamespace) {
    throw new Error(
      'No se pudo extraer lsd/routing_namespace del HTML. ' +
      'Abre la publicación en el navegador o prueba IG_DEBUG=1 para inspeccionar.'
    );
  }

  const body = buildForm([
    ['route_url', `/${type}/${shortcode}/`],
    ['routing_namespace', env.routingNamespace],
    ['__a', '1'],
    ['__d', 'www'],
    ['__user', '0'],
    ['__req', Math.random().toString(36).slice(2, 3)],
    ['__hs', HS],
    ['__ccg', 'EXCELLENT'],
    ['__rev', env.rev || ''],
    ['__comet_req', COMET],
    ['lsd', env.lsd],
    ['jazoest', calculateJazoest(env.lsd)],
    ['__spin_b', 'trunk'],
    ['__spin_t', String(Math.floor(Date.now() / 1000))],
    ['__crn', CRN_POST]
  ]);

  const headers = {
    'content-type': 'application/x-www-form-urlencoded',
    'origin': ORIGIN,
    'referer': `${ORIGIN}/${type}/${shortcode}/`,
    'x-fb-lsd': env.lsd
  };
  if (env.nonce) headers['x-fb-entry-nonce'] = env.nonce;

  const response = await ig(`${ORIGIN}/ajax/route-definition/`, jar, {
    method: 'POST',
    headers,
    body
  });

  const text = await readText(response);
  if (!response.ok) {
    throw new Error(`route-definition HTTP ${response.status}: ${text.slice(0, 200)}`);
  }

  let json;
  try { json = JSON.parse(stripPrefix(text)); }
  catch {
    throw new Error(`Respuesta no-JSON (${text.length} B): ${text.slice(0, 200)}`);
  }

  const error = json?.payload?.error ?? json?.payload?.payload?.error;
  if (error) throw new Error(`route-definition: ${JSON.stringify(error).slice(0, 250)}`);

  const videos = [];
  const images = [];
  const seen = new Set();

  (function walk(node) {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) return node.forEach(walk);
    if (Array.isArray(node.video_versions)) {
      for (const v of node.video_versions) {
        if (v?.url && !seen.has(v.url)) {
          seen.add(v.url);
          videos.push({ url: v.url, width: v.width, height: v.height });
        }
      }
    }
    if (typeof node.video_url === 'string' && !seen.has(node.video_url)) {
      seen.add(node.video_url);
      videos.push({ url: node.video_url });
    }
    if (typeof node.display_url === 'string' && !seen.has(node.display_url)) {
      seen.add(node.display_url);
      images.push({
        url: node.display_url,
        width: node.original_width,
        height: node.original_height
      });
    }
    for (const v of Object.values(node)) walk(v);
  })(json);

  return { videos, images };
}

// --------------------------------------------------
// 3. Descarga
// --------------------------------------------------

function createSizeLimiter(maxBytes) {
  let downloaded = 0;
  return new Transform({
    transform(chunk, _, callback) {
      downloaded += chunk.length;
      if (downloaded > maxBytes) {
        return callback(new Error(`El archivo supera el límite de ${MAX_SIZE_MB} MB.`));
      }
      callback(null, chunk);
    }
  });
}

function isMediaHost(value) {
  try {
    const host = new URL(value).hostname.toLowerCase();
    if (host === 'static.cdninstagram.com') return false;
    return (
      host === 'cdninstagram.com' || host.endsWith('.cdninstagram.com') ||
      host === 'fbcdn.net' || host.endsWith('.fbcdn.net')
    );
  } catch { return false; }
}

async function downloadMedia(url, outputPath, referer) {
  if (!isMediaHost(url)) throw new Error('Host de medios inválido.');

  const response = await axios.get(url, {
    responseType: 'stream',
    timeout: DOWNLOAD_TIMEOUT,
    maxContentLength: Infinity,
    maxBodyLength: Infinity,
    maxRedirects: 5,
    headers: {
      'User-Agent': USER_AGENT,
      'Referer': referer || `${ORIGIN}/`,
      'Accept': '*/*',
      'Accept-Encoding': 'identity'
    }
  });

  if (response.status !== 200) {
    response.data.destroy();
    throw new Error(`CDN respondió HTTP ${response.status}.`);
  }

  const contentType = String(response.headers['content-type'] || '').toLowerCase();
  if (
    contentType &&
    !contentType.startsWith('video/') &&
    !contentType.startsWith('image/') &&
    !contentType.includes('octet-stream')
  ) {
    response.data.destroy();
    throw new Error('Instagram devolvió un formato no compatible.');
  }

  const contentLength = Number(response.headers['content-length']);
  if (Number.isFinite(contentLength) && contentLength > MAX_SIZE_BYTES) {
    response.data.destroy();
    throw new Error(`El archivo supera el límite de ${MAX_SIZE_MB} MB.`);
  }

  await pipeline(
    response.data,
    createSizeLimiter(MAX_SIZE_BYTES),
    fs.createWriteStream(outputPath)
  );
  const stats = await fs.promises.stat(outputPath);
  if (!stats.size) throw new Error('El archivo descargado está vacío.');
  return stats.size;
}

// --------------------------------------------------
// 4. Reacciones
// --------------------------------------------------

async function safeReact(react, emoji) {
  try { if (typeof react === 'function') await react(emoji); } catch { /* ignora */ }
}

// --------------------------------------------------
// 5. Plugin
// --------------------------------------------------

export default {
  name: ['test'],
  description: 'Descarga videos e imágenes de Instagram.',
  category: 'owner',
  groupOnly: false,
  ownerOnly: true,
  async run({ sock, from, msg, args, usedPrefix, cmdName, reply, react }) {
    const tempFiles = [];
    try {
      const url = args?.[0]?.trim();
      if (!url) {
        return reply({
          text:
            `📸 *Descargador de Instagram*\n\n` +
            `Ingresa el enlace de un Reel o publicación pública.\n\n` +
            `*Ejemplo:*\n${usedPrefix}${cmdName} https://www.instagram.com/reel/XXXXXXXX/`
        });
      }
      if (!validateInstagramUrl(url)) {
        return reply({
          text:
            '❌ Enlace de Instagram inválido.\n\n' +
            '*Formatos compatibles:*\n' +
            '• instagram.com/reel/...\n' +
            '• instagram.com/reels/...\n' +
            '• instagram.com/p/...\n' +
            '• instagram.com/tv/...'
        });
      }

      const { type, shortcode } = parseInstagramUrl(url);

      await safeReact(react, '🔄');
      await reply({ text: '> ✎...Obteniendo contenido de Instagram.' });

      await fs.promises.mkdir(TEMP_DIR, { recursive: true });
      const jar = createCookieJar();

      // 1) Página del post → cookies + env.
      const { html, env } = await fetchPostPage(type, shortcode, jar);

      // 2) route-definition (mejor calidad; puede fallar).
      let rd = { videos: [], images: [] };
      try {
        rd = await routeDefinition(env, type, shortcode, jar);
        console.log(
          `[INSTAGRAM] route-definition: videos=${rd.videos.length} images=${rd.images.length}`
        );
      } catch (error) {
        console.error('[INSTAGRAM] route-definition falló:', error.message);
      }

      // 3) HTML como respaldo real (og:video / og:image / JSON embebido).
      const htmlMedia = extractFromHtml(html);
      console.log(
        `[INSTAGRAM] HTML: videos=${htmlMedia.videos.length} images=${htmlMedia.images.length}`
      );

      // 4) Merge por categoría: si route-definition trae vídeo, gana.
      const videos = rd.videos.length ? rd.videos : htmlMedia.videos;
      const images = rd.images.length ? rd.images : htmlMedia.images;

      if (!videos.length && !images.length) {
        throw new Error(
          'Instagram no devolvió ningún medio. La publicación puede ser privada o requerir sesión.'
        );
      }

      const byResolution = (a, b) =>
        (b.height || b.width || 0) - (a.height || a.width || 0);

      const selected = videos.length
        ? [...videos].sort(byResolution).slice(0, 1)          // mejor vídeo
        : [...images].sort(byResolution).slice(0, MAX_MEDIA); // o carrusel completo

      const referer = `${ORIGIN}/${type}/${shortcode}/`;
      let sent = 0;

      for (let i = 0; i < selected.length; i++) {
        const item = selected[i];
        const isVideo = /\.mp4(\?|$)/.test(item.url);

        const outputPath = path.join(
          TEMP_DIR,
          `ig_${crypto.randomBytes(8).toString('hex')}.${isVideo ? 'mp4' : 'jpg'}`
        );
        tempFiles.push(outputPath);

        await downloadMedia(item.url, outputPath, referer);

        const caption = i === 0
          ? `☑ *Contenido de Instagram descargado*\n` +
            `─╮\n   ╰━━━━━━(☆)━━━━━━─╮\n` +
            `*📸 Tipo:* ${type}\n` +
            `*🔗 Código:* ${shortcode}\n` +
            `*📁 Archivos:* ${selected.length}`
          : '';

        if (isVideo) {
          await sock.sendMessage(
            from,
            {
              video: { url: