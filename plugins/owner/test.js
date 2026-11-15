
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import axios from 'axios';
import { pipeline } from 'stream/promises';
import { Transform } from 'stream';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const TEMP_DIR = path.resolve(__dirname, '../../tmp');

const ORIGIN = 'https://www.instagram.com';

const MAX_SIZE_MB = 60;
const MAX_SIZE_BYTES = MAX_SIZE_MB * 1024 * 1024;
const MAX_MEDIA = 10;

const PAGE_TIMEOUT = 25000;
const REQUEST_TIMEOUT = 30000;
const DOWNLOAD_TIMEOUT = 120000;

const UA =
  'Mozilla/5.0 (Linux; Android 11; moto g(9) play Build/RPXS31.Q2-58-17-7-3; wv) ' +
  'AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/157.0.8103.40 Mobile Safari/537.36';

const ASBD_ID = '359341';
const HS = '20772.HYP:instagram_web_logged_out_pkg.2.1...0';
const COMET = '117';

const CRN =
  'comet.instagramwebloggedout.PolarisPostLandingPageFullyPerfOptimizedRoute';

const FALLBACK = {
  routingNamespace: 'igx_www_logged_out$a$87a091182d5bd65bcb043a2888004e09',
  nonce: 'ZA0wfSNZ',
  lsd: 'AdSHj0HtzF5aCm-TiZ658znd7hc',
  rev: '1054711067'
};

const CLIENT_STATE = {
  __dyn: '',
  __csr: '',
  __s: '',
  __hsi: '',
  __hblp: '',
  __sjsp: '',
  __hsdp: ''
};

// --------------------------------------------------
// VALIDACIÓN
// --------------------------------------------------

function validateInstagramUrl(value) {
  try {
    const parsed = new URL(value);

    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return false;
    }

    const hostname = parsed.hostname.toLowerCase();

    if (
      hostname !== 'instagram.com' &&
      !hostname.endsWith('.instagram.com')
    ) {
      return false;
    }

    return /^\/(reel|reels|p|tv)\/[A-Za-z0-9_-]+\/?$/.test(
      parsed.pathname
    );
  } catch {
    return false;
  }
}

function parseInstagramUrl(value) {
  const parsed = new URL(value);

  const match = parsed.pathname.match(
    /^\/(reel|reels|p|tv)\/([A-Za-z0-9_-]+)/
  );

  if (!match) {
    throw new Error('No se pudo identificar la publicación.');
  }

  return {
    type: match[1] === 'reels' ? 'reel' : match[1],
    shortcode: match[2]
  };
}

// --------------------------------------------------
// COOKIE JAR
// --------------------------------------------------

function createCookieJar() {
  const jar = {
    dpr: '2.012500047683716',
    wd: '358x312'
  };

  return {
    absorb(response) {
      let cookies = [];

      if (typeof response.headers.getSetCookie === 'function') {
        cookies = response.headers.getSetCookie();
      } else {
        const raw = response.headers.get('set-cookie');

        if (raw) {
          cookies = raw.split(/,(?=\s*[^;=]+=)/);
        }
      }

      for (const cookie of cookies) {
        const pair = cookie.split(';')[0];
        const index = pair.indexOf('=');

        if (index > 0) {
          jar[pair.slice(0, index).trim()] =
            pair.slice(index + 1).trim();
        }
      }
    },

    get(name) {
      return jar[name] || '';
    },

    header() {
      return Object.entries(jar)
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
    signal: AbortSignal.timeout(
      init.timeout || REQUEST_TIMEOUT
    ),
    headers: {
      'user-agent': UA,
      'accept': '*/*',
      'accept-language': 'es-CO,es;q=0.9,en;q=0.8',
      'accept-encoding': 'gzip, deflate',
      'cookie': jar.header(),
      ...(init.headers || {})
    }
  });

  jar.absorb(response);

  return response;
}

// --------------------------------------------------
// UTILIDADES
// --------------------------------------------------

function extractBalancedEnd(source, start, open, close) {
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < source.length; i++) {
    const char = source[i];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }

      continue;
    }

    if (char === '"') {
      inString = true;
      continue;
    }

    if (char === open) {
      depth++;
    } else if (char === close) {
      depth--;

      if (depth === 0) return i;
    }
  }

  return -1;
}

function matchAny(text, patterns, fallback = '') {
  for (const pattern of patterns) {
    const match = text.match(pattern);

    if (match) return match[1];
  }

  return fallback;
}

function calculateJazoest(lsd) {
  return '2' + [...lsd].reduce(
    (total, char) => total + char.charCodeAt(0),
    0
  );
}

function stripPrefix(text) {
  return text.replace(/^\s*for \(;;\);/, '');
}

// --------------------------------------------------
// 1. OBTENER ENVIRONMENT
// --------------------------------------------------

async function getInstagramEnv(type, shortcode, jar) {
  const pageUrl = `${ORIGIN}/${type}/${shortcode}/?l=1`;

  const response = await ig(pageUrl, jar, {
    headers: {
      accept: 'text/html,application/xhtml+xml'
    },
    timeout: PAGE_TIMEOUT
  });

  if (!response.ok) {
    throw new Error(
      `Instagram respondió HTTP ${response.status} al obtener la publicación.`
    );
  }

  const html = await response.text();

  if (
    /\/accounts\/login|login_required|challenge_required/i.test(
      response.url
    )
  ) {
    throw new Error(
      'Instagram requiere iniciar sesión para acceder a esta publicación.'
    );
  }

  if (
    /Please wait a few minutes|Try Again Later|rate limit/i.test(html)
  ) {
    throw new Error(
      'Instagram está limitando temporalmente las solicitudes.'
    );
  }

  const env = {
    pageUrl,
    html,

    routingNamespace: matchAny(
      html,
      [/"routing_namespace"\s*:\s*"([^"]+)"/],
      FALLBACK.routingNamespace
    ),

    nonce: matchAny(
      html,
      [/"sjsNonce"\s*:\s*"([^"]+)"/],
      FALLBACK.nonce
    ),

    lsd: matchAny(
      html,
      [
        /\["LSD",\[\],\{"token":"([^"]+)"\}/,
        /"lsd"\s*:\s*"([^"]+)"/
      ],
      FALLBACK.lsd
    ),

    rev: matchAny(
      html,
      [/"server_revision"\s*:\s*(\d+)/],
      FALLBACK.rev
    )
  };

  if (!env.lsd || !env.routingNamespace || !env.nonce) {
    throw new Error(
      'No se pudieron obtener los parámetros necesarios de Instagram.'
    );
  }

  return env;
}

// --------------------------------------------------
// 2. ROUTE DEFINITION
// --------------------------------------------------

async function routeDefinition(env, type, shortcode, jar) {
  const body = new URLSearchParams();

  body.set('client_previous_actor_id', '');
  body.set('route_url', `/${type}/${shortcode}/?l=1`);
  body.set('routing_namespace', env.routingNamespace);
  body.set('trace_policy', '');

  body.set('__d', 'www');
  body.set('__user', '0');
  body.set('__a', '1');
  body.set('__req', 'r');
  body.set('__hs', HS);
  body.set('dpr', '3');
  body.set('__ccg', 'EXCELLENT');
  body.set('__rev', env.rev);
  body.set('__comet_req', COMET);
  body.set('lsd', env.lsd);
  body.set('jazoest', calculateJazoest(env.lsd));

  body.set('__spin_r', env.rev);
  body.set('__spin_b', 'trunk');
  body.set('__spin_t', String(Math.floor(Date.now() / 1000)));
  body.set('__crn', CRN);

  for (const [key, value] of Object.entries(CLIENT_STATE)) {
    if (value) body.set(key, value);
  }

  const response = await ig(
    `${ORIGIN}/ajax/route-definition/`,
    jar,
    {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        origin: ORIGIN,
        referer: `${ORIGIN}/${type}/${shortcode}/`,
        'x-fb-entry-nonce': env.nonce,
        'x-fb-lsd': env.lsd,
        'x-asbd-id': ASBD_ID,
        'x-ig-d': 'www',
        'x-ig-max-touch-points': '5'
      },
      body: body.toString()
    }
  );

  const text = await response.text();

  if (!response.ok) {
    throw new Error(
      `route-definition HTTP ${response.status}: ${text.slice(0, 250)}`
    );
  }

  let json;

  try {
    json = JSON.parse(stripPrefix(text));
  } catch {
    throw new Error(
      `Instagram devolvió una respuesta no válida: ${text.slice(0, 200)}`
    );
  }

  const error =
    json?.payload?.error ??
    json?.payload?.payload?.error;

  if (error) {
    throw new Error(
      `route-definition: ${JSON.stringify(error).slice(0, 250)}`
    );
  }

  return json;
}

// --------------------------------------------------
// 3. EXTRAER MEDIOS
// --------------------------------------------------

function collectMedia(root) {
  const videos = [];
  const images = [];

  const seen = new WeakSet();
  const urls = new Set();

  function walk(node) {
    if (!node || typeof node !== 'object') return;

    if (seen.has(node)) return;

    seen.add(node);

    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }

    if (Array.isArray(node.video_versions)) {
      for (const version of node.video_versions) {
        if (version?.url && !urls.has(version.url)) {
          urls.add(version.url);

          videos.push({
            url: version.url,
            type: version.type,
            width: version.width,
            height: version.height
          });
        }
      }
    }

    if (
      typeof node.video_url === 'string' &&
      node.video_url &&
      !urls.has(node.video_url)
    ) {
      urls.add(node.video_url);

      videos.push({
        url: node.video_url
      });
    }

    if (
      typeof node.display_url === 'string' &&
      node.display_url &&
      !urls.has(node.display_url)
    ) {
      urls.add(node.display_url);

      images.push({
        url: node.display_url,
        width: node.original_width,
        height: node.original_height
      });
    }

    for (const value of Object.values(node)) {
      walk(value);
    }
  }

  walk(root);

  return {
    videos,
    images
  };
}

// --------------------------------------------------
// 4. VALIDAR CDN
// --------------------------------------------------

function isValidMediaUrl(value) {
  try {
    const url = new URL(value);

    if (url.protocol !== 'https:') return false;

    const host = url.hostname.toLowerCase();

    return (
      host === 'cdninstagram.com' ||
      host.endsWith('.cdninstagram.com') ||
      host === 'fbcdn.net' ||
      host.endsWith('.fbcdn.net')
    );
  } catch {
    return false;
  }
}

// --------------------------------------------------
// 5. DESCARGA
// --------------------------------------------------

function createSizeLimiter(maxBytes) {
  let downloaded = 0;

  return new Transform({
    transform(chunk, encoding, callback) {
      downloaded += chunk.length;

      if (downloaded > maxBytes) {
        return callback(
          new Error(
            `El archivo supera el límite de ${MAX_SIZE_MB} MB.`
          )
        );
      }

      callback(null, chunk);
    }
  });
}

async function downloadMedia(url, outputPath) {
  if (!isValidMediaUrl(url)) {
    throw new Error('El servidor multimedia no es válido.');
  }

  const response = await axios.get(url, {
    responseType: 'stream',
    timeout: DOWNLOAD_TIMEOUT,
    maxContentLength: Infinity,
    maxBodyLength: Infinity,
    maxRedirects: 5,
    headers: {
      'User-Agent': UA,
      Referer: ORIGIN,
      Accept: '*/*'
    }
  });

  if (response.status !== 200) {
    response.data.destroy();

    throw new Error(
      `El servidor multimedia respondió HTTP ${response.status}.`
    );
  }

  const contentType = String(
    response.headers['content-type'] || ''
  ).toLowerCase();

  if (
    contentType &&
    !contentType.startsWith('video/') &&
    !contentType.startsWith('image/') &&
    !contentType.includes('octet-stream')
  ) {
    response.data.destroy();

    throw new Error('Instagram devolvió un formato no compatible.');
  }

  const contentLength = Number(
    response.headers['content-length']
  );

  if (
    Number.isFinite(contentLength) &&
    contentLength > MAX_SIZE_BYTES
  ) {
    response.data.destroy();

    throw new Error(
      `El archivo supera el límite de ${MAX_SIZE_MB} MB.`
    );
  }

  await pipeline(
    response.data,
    createSizeLimiter(MAX_SIZE_BYTES),
    fs.createWriteStream(outputPath)
  );

  const stats = await fs.promises.stat(outputPath);

  if (!stats.size) {
    throw new Error('El archivo descargado está vacío.');
  }

  return stats.size;
}

// --------------------------------------------------
// 6. REACCIONES
// --------------------------------------------------

async function safeReact(react, emoji) {
  try {
    if (typeof react === 'function') {
      await react(emoji);
    }
  } catch {
    // Ignorar errores de reacción.
  }
}

// --------------------------------------------------
// 7. PLUGIN
// --------------------------------------------------

export default {
  name: ['test'],
  description: 'Descarga videos e imágenes de Instagram.',
  category: 'owner',
  groupOnly: false,
  ownerOnly: true,
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
    const tempFiles = [];

    try {
      const url = args?.[0]?.trim();

      if (!url) {
        return reply({
          text:
            `📸 *Descargador de Instagram*\n\n` +
            `Ingresa el enlace de un Reel o publicación pública.\n\n` +
            `*Ejemplo:*\n` +
            `${usedPrefix}${cmdName} https://www.instagram.com/reel/XXXXXXXX/`
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

      await reply({
        text: '> ✎...Obteniendo contenido de Instagram.'
      });

      await fs.promises.mkdir(TEMP_DIR, {
        recursive: true
      });

      // 1. Cookies y parámetros dinámicos.
      const jar = createCookieJar();

      const env = await getInstagramEnv(
        type,
        shortcode,
        jar
      );

      // 2. Obtener definición de ruta.
      const data = await routeDefinition(
        env,
        type,
        shortcode,
        jar
      );

      // 3. Extraer videos e imágenes.
      const { videos, images } = collectMedia(data);

      console.log(
        `[INSTAGRAM] ${shortcode} | videos=${videos.length} | images=${images.length}`
      );

      if (!videos.length && !images.length) {
        throw new Error(
          'La respuesta de route-definition no contiene medios compatibles.'
        );
      }

      const selected = videos.length
        ? [...videos]
        : [...images];

      selected.sort(
        (a, b) =>
          (b.height || b.width || 0) -
          (a.height || a.width || 0)
      );

      const media = selected
        .filter((item) => isValidMediaUrl(item.url))
        .slice(0, MAX_MEDIA);

      if (!media.length) {
        throw new Error('No se encontraron URLs multimedia válidas.');
      }

      let sent = 0;

      // 4. Descargar y enviar.
      for (let i = 0; i < media.length; i++) {
        const item = media[i];

        const isVideo = videos.length > 0;

        const randomId = crypto
          .randomBytes(8)
          .toString('hex');

        const extension = isVideo ? 'mp4' : 'jpg';

        const outputPath = path.join(
          TEMP_DIR,
          `ig_${randomId}.${extension}`
        );

        tempFiles.push(outputPath);

        await downloadMedia(item.url, outputPath);

        let caption = '';

        if (i === 0) {
          caption =
            `☑ *Contenido de Instagram descargado*\n` +
            `─╮\n` +
            `   ╰━━━━━━(☆)━━━━━━─╮\n` +
            `*📸 Tipo:* ${type}\n` +
            `*🔗 Código:* ${shortcode}\n` +
            `*📁 Archivos:* ${media.length}`;
        }

        if (isVideo) {
          await sock.sendMessage(
            from,
            {
              video: {
                url: outputPath
              },
              mimetype: 'video/mp4',
              fileName: `instagram_${shortcode}.mp4`,
              caption
            },
            {
              quoted: msg
            }
          );
        } else {
          await sock.sendMessage(
            from,
            {
              image: {
                url: outputPath
              },
              mimetype: 'image/jpeg',
              fileName: `instagram_${shortcode}.jpg`,
              caption
            },
            {
              quoted: msg
            }
          );
        }

        sent++;
      }

      if (!sent) {
        throw new Error('No se pudo enviar ningún archivo.');
      }

      await safeReact(react, '✅');

    } catch (error) {
      console.error(
        '[INSTAGRAM DOWNLOAD ERROR]',
        error
      );

      await safeReact(react, '❌');

      await reply({
        text:
          `❌ Error al procesar Instagram:\n${error.message}`
      });

    } finally {
      for (const file of tempFiles) {
        try {
          await fs.promises.unlink(file);
        } catch {
          // Archivo inexistente o ya eliminado.
        }
      }
    }
  }
};
