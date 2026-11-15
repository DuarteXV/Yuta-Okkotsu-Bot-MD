import axios from 'axios';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { pipeline } from 'stream/promises';
import { Transform } from 'stream';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const TEMP_DIR = path.resolve(__dirname, '../../tmp');

const MAX_DOWNLOAD_MB = 60;
const MAX_DOWNLOAD_BYTES = MAX_DOWNLOAD_MB * 1024 * 1024;
const MAX_MEDIA = 10;

const PAGE_TIMEOUT = 25000;
const GRAPHQL_TIMEOUT = 25000;
const DOWNLOAD_TIMEOUT = 120000;

const UA =
  'Mozilla/5.0 (Linux; Android 11; Mobile) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36';

const IG_APP_ID = '1217981644879628';
const ASBD_ID = '359341';

const COMET_REQ = '117';

const CRN =
  'comet.instagramwebloggedout.PolarisLoggedOutMobileVideoPostWithUpsellRoute';

const HS = '20772.HYP:instagram_web_logged_out_pkg.2.1...0';

const REV_DEFAULT = '1054706852';

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

    return /^\/(reel|reels|p|tv)\/[A-Za-z0-9_-]+\/?/.test(
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
// HTTP / COOKIES
// --------------------------------------------------

function createCookieJar() {
  const jar = {};

  return {
    absorb(response) {
      const cookies = response.headers['set-cookie'] || [];

      for (const cookie of cookies) {
        const pair = cookie.split(';')[0];
        const index = pair.indexOf('=');

        if (index > 0) {
          jar[pair.slice(0, index)] = pair.slice(index + 1);
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

      if (depth === 0) {
        return i;
      }
    }
  }

  return -1;
}

function extractPreloaders(html) {
  const results = [];
  const key = '"expectedPreloaders":';

  let index = 0;

  while ((index = html.indexOf(key, index)) !== -1) {
    const start = html.indexOf('[', index + key.length);

    if (start === -1) break;

    const end = extractBalancedEnd(html, start, '[', ']');

    if (end === -1) break;

    try {
      const parsed = JSON.parse(
        html.slice(start, end + 1)
      );

      for (const item of parsed) {
        if (item?.queryID && item?.queryName) {
          results.push(item);
        }
      }
    } catch {
      // Ignorar payloads inválidos.
    }

    index = end + 1;
  }

  return results;
}

function extractLsd(html) {
  const patterns = [
    /"lsd"\s*:\s*"([A-Za-z0-9_-]+)"/,
    /\\"lsd\\"\s*:\s*\\"([A-Za-z0-9_-]+)\\"/,
    /\blsd["']?\s*[:,=]\s*["']?([A-Za-z0-9_-]{8,})/i
  ];

  for (const pattern of patterns) {
    const match = html.match(pattern);

    if (match) return match[1];
  }

  return '';
}

function extractRevision(html) {
  return (
    html.match(/data-btmanifest="(\d+)_main"/)?.[1] ||
    REV_DEFAULT
  );
}

// --------------------------------------------------
// GRAPHQL RELAY
// --------------------------------------------------

async function relayQuery(target, lsd, revision, jar, referer) {
  const body = new URLSearchParams();

  body.set('av', '0');
  body.set('__d', 'www');
  body.set('__user', '0');
  body.set('__a', '1');
  body.set('__req', 'r');
  body.set('__hs', HS);
  body.set('dpr', '2');
  body.set('__ccg', 'GOOD');
  body.set('__rev', revision);
  body.set('__comet_req', COMET_REQ);
  body.set('lsd', lsd);
  body.set('jazoest', '22241');

  body.set('__spin_r', revision);
  body.set('__spin_b', 'trunk');
  body.set('__spin_t', String(Math.floor(Date.now() / 1000)));
  body.set('__crn', CRN);

  body.set('fb_api_caller_class', 'RelayModern');
  body.set('fb_api_req_friendly_name', target.queryName);
  body.set('doc_id', target.queryID);
  body.set('server_timestamps', 'true');
  body.set('variables', JSON.stringify(target.variables));

  const response = await axios.post(
    'https://www.instagram.com/api/graphql',
    body.toString(),
    {
      timeout: GRAPHQL_TIMEOUT,
      responseType: 'text',
      transformResponse: [(data) => data],
      headers: {
        'User-Agent': UA,
        Accept: '*/*',
        'Content-Type': 'application/x-www-form-urlencoded',
        'X-FB-Friendly-Name': target.queryName,
        'X-CSRFToken': jar.get('csrftoken'),
        'X-IG-App-ID': IG_APP_ID,
        'X-IG-Max-Touch-Points': '5',
        'X-FB-LSD': lsd,
        'X-ASBD-ID': ASBD_ID,
        Cookie: jar.header(),
        Origin: 'https://www.instagram.com',
        Referer: referer
      }
    }
  );

  const raw = String(response.data).replace(/^for \(;;\);/, '');

  const payload = JSON.parse(raw);

  if (!payload?.data) {
    throw new Error(
      'Instagram no devolvió información GraphQL.'
    );
  }

  return payload;
}

// --------------------------------------------------
// EXTRACCIÓN DE MEDIOS
// --------------------------------------------------

function collectMedia(root) {
  const videos = [];
  const images = [];

  const seenObjects = new WeakSet();

  function walk(node) {
    if (!node || typeof node !== 'object') return;

    if (seenObjects.has(node)) return;

    seenObjects.add(node);

    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }

    if (Array.isArray(node.video_versions)) {
      for (const version of node.video_versions) {
        if (version?.url) {
          videos.push({
            url: version.url,
            width: version.width,
            height: version.height,
            type: version.type
          });
        }
      }
    }

    if (typeof node.video_url === 'string') {
      videos.push({
        url: node.video_url
      });
    }

    if (typeof node.display_url === 'string') {
      images.push({
        url: node.display_url,
        width: node.dimensions?.width,
        height: node.dimensions?.height
      });
    }

    for (const value of Object.values(node)) {
      walk(value);
    }
  }

  walk(root);

  return {
    videos: uniqueMedia(videos),
    images: uniqueMedia(images)
  };
}

function uniqueMedia(items) {
  const seen = new Set();

  return items.filter((item) => {
    if (!item.url || seen.has(item.url)) return false;

    seen.add(item.url);

    return true;
  });
}

function decodeHtml(value) {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&#38;/g, '&')
    .replace(/\\u0026/g, '&')
    .replace(/\\\//g, '/')
    .replace(/&quot;/g, '"');
}

function extractMeta(html, property) {
  const escaped = property.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  const patterns = [
    new RegExp(
      `<meta[^>]+property=["']${escaped}["'][^>]+content=["']([^"']+)["']`,
      'i'
    ),
    new RegExp(
      `<meta[^>]+content=["']([^"']+)["'][^>]+property=["']${escaped}["']`,
      'i'
    )
  ];

  for (const pattern of patterns) {
    const match = html.match(pattern);

    if (match) return decodeHtml(match[1]);
  }

  return '';
}

function cdnUrlsFromHtml(html) {
  const videos = [];
  const images = [];

  for (const match of html.matchAll(
    /https:\/\/[^"'\\\s<>]+?\.mp4(?:\?[^"'\\\s<>]*)?/gi
  )) {
    videos.push({
      url: decodeHtml(match[0])
        .replace(/&amp;/g, '&')
        .replace(/&bytestart=\d+/g, '')
        .replace(/&byteend=\d+/g, '')
    });
  }

  for (const match of html.matchAll(
    /https:\/\/[^"'\\\s<>]+?\.jpg(?:\?[^"'\\\s<>]*)?/gi
  )) {
    images.push({
      url: decodeHtml(match[0])
    });
  }

  const ogVideo = extractMeta(html, 'og:video');

  const ogImage = extractMeta(html, 'og:image');

  if (ogVideo) {
    videos.push({ url: ogVideo });
  }

  if (ogImage) {
    images.push({ url: ogImage });
  }

  return {
    videos: uniqueMedia(videos),
    images: uniqueMedia(images)
  };
}

// --------------------------------------------------
// OBTENER INFORMACIÓN
// --------------------------------------------------

async function getInstagramData(url) {
  const { type, shortcode } = parseInstagramUrl(url);

  const referer =
    `https://www.instagram.com/${type}/${shortcode}/`;

  const jar = createCookieJar();

  const page = await axios.get(referer, {
    timeout: PAGE_TIMEOUT,
    maxRedirects: 5,
    headers: {
      'User-Agent': UA,
      Accept: 'text/html,application/xhtml+xml',
      'Accept-Language': 'es-CO,es;q=0.9,en;q=0.8'
    }
  });

  jar.absorb(page);

  const html = page.data;

  if (typeof html !== 'string') {
    throw new Error('Instagram devolvió una respuesta HTML inválida.');
  }

  if (
    /login_required|challenge_required|accounts\/login/i.test(
      page.request?.res?.responseUrl || ''
    )
  ) {
    throw new Error('Instagram requiere iniciar sesión para esta publicación.');
  }

  const preloaders = extractPreloaders(html);

  const target =
    preloaders.find(
      (item) =>
        /PostLandingPage/i.test(item.queryName) &&
        item.variables?.mediaId
    ) ||
    preloaders.find((item) => item.variables?.mediaId) ||
    preloaders[0];

  const lsd = extractLsd(html);
  const revision = extractRevision(html);

  let media = {
    videos: [],
    images: []
  };

  let source = 'none';

  // GraphQL
  if (target && lsd) {
    try {
      const result = await relayQuery(
        target,
        lsd,
        revision,
        jar,
        referer
      );

      media = collectMedia(result.data);

      if (media.videos.length || media.images.length) {
        source = 'graphql';
      }
    } catch (error) {
      console.warn(
        '[INSTAGRAM GRAPHQL]',
        error.message
      );
    }
  }

  // Fallback HTML
  if (!media.videos.length && !media.images.length) {
    const fallback = cdnUrlsFromHtml(html);

    media = fallback;

    if (media.videos.length || media.images.length) {
      source = 'html';
    }
  }

  if (!media.videos.length && !media.images.length) {
    throw new Error(
      'No se encontraron medios. La publicación puede requerir sesión o Instagram puede haber cambiado su estructura.'
    );
  }

  media.videos.sort(
    (a, b) => (b.width || 0) - (a.width || 0)
  );

  media.images.sort(
    (a, b) => (b.width || 0) - (a.width || 0)
  );

  return {
    shortcode,
    type,
    source,
    title:
      extractMeta(html, 'og:title') ||
      'Publicación de Instagram',
    thumbnail: extractMeta(html, 'og:image') || null,
    videos: media.videos,
    images: media.images
  };
}

// --------------------------------------------------
// DESCARGA
// --------------------------------------------------

function createSizeLimiter(maxBytes) {
  let downloaded = 0;

  return new Transform({
    transform(chunk, encoding, callback) {
      downloaded += chunk.length;

      if (downloaded > maxBytes) {
        return callback(
          new Error(
            `El archivo supera el límite de ${MAX_DOWNLOAD_MB} MB.`
          )
        );
      }

      callback(null, chunk);
    }
  });
}

async function downloadMedia(url, outputPath) {
  const response = await axios.get(url, {
    responseType: 'stream',
    timeout: DOWNLOAD_TIMEOUT,
    maxContentLength: Infinity,
    maxBodyLength: Infinity,
    headers: {
      'User-Agent': UA,
      Referer: 'https://www.instagram.com/',
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

    throw new Error('Instagram devolvió un formato multimedia no compatible.');
  }

  const contentLength = Number(
    response.headers['content-length']
  );

  if (
    Number.isFinite(contentLength) &&
    contentLength > MAX_DOWNLOAD_BYTES
  ) {
    response.data.destroy();

    throw new Error(
      `El archivo supera el límite de ${MAX_DOWNLOAD_MB} MB.`
    );
  }

  await pipeline(
    response.data,
    createSizeLimiter(MAX_DOWNLOAD_BYTES),
    fs.createWriteStream(outputPath)
  );

  const stats = await fs.promises.stat(outputPath);

  if (!stats.size) {
    throw new Error('El archivo descargado está vacío.');
  }

  return stats.size;
}

// --------------------------------------------------
// REACCIONES
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
// PLUGIN
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

      await safeReact(react, '🔄');

      await reply({
        text: '> ✎...Obteniendo contenido de Instagram.'
      });

      await fs.promises.mkdir(TEMP_DIR, {
        recursive: true
      });

      const result = await getInstagramData(url);

      console.log(
        `[INSTAGRAM] ${result.shortcode} | ${result.source}`
      );

      const media = [
        ...result.videos.slice(0, MAX_MEDIA).map((item) => ({
          ...item,
          kind: 'video'
        })),
        ...result.images.slice(0, MAX_MEDIA).map((item) => ({
          ...item,
          kind: 'image'
        }))
      ];

      if (!media.length) {
        throw new Error('No hay contenido multimedia disponible.');
      }

      // Priorizar videos. Si existen, no enviar la portada
      // adicional cuando también aparezca como imagen.
      const selected = result.videos.length
        ? result.videos.slice(0, MAX_MEDIA).map((item) => ({
            ...item,
            kind: 'video'
          }))
        : result.images.slice(0, MAX_MEDIA).map((item) => ({
            ...item,
            kind: 'image'
          }));

      let sent = 0;

      for (let i = 0; i < selected.length; i++) {
        const item = selected[i];

        const randomId = crypto.randomBytes(8).toString('hex');

        const extension = item.kind === 'video' ? 'mp4' : 'jpg';

        const filePath = path.join(
          TEMP_DIR,
          `ig_${randomId}.${extension}`
        );

        tempFiles.push(filePath);

        await downloadMedia(item.url, filePath);

        let caption = '';

        if (i === 0) {
          caption =
            `☑ *Contenido de Instagram descargado*\n` +
            `─╮\n` +
            `   ╰━━━━━━(☆)━━━━━━─╮\n` +
            `*📸 Tipo:* ${result.type}\n` +
            `*🔗 Código:* ${result.shortcode}\n` +
            `*📁 Archivo:* ${selected.length} elemento(s)`;
        }

        if (item.kind === 'video') {
          await sock.sendMessage(
            from,
            {
              video: {
                url: filePath
              },
              mimetype: 'video/mp4',
              fileName: `instagram_${result.shortcode}.mp4`,
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
                url: filePath
              },
              mimetype: 'image/jpeg',
              fileName: `instagram_${result.shortcode}.jpg`,
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
          // El archivo puede no existir.
        }
      }
    }
  }
};