
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const ORIGIN = 'https://www.instagram.com';
const TEMP_DIR = path.resolve(__dirname, '../../tmp');
const MAX_MEDIA = 10;
const MAX_FILE_SIZE = 100 * 1024 * 1024;

const USER_AGENT =
  'Mozilla/5.0 (Linux; Android 13; Mobile) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36';

const HEADERS = {
  'User-Agent': USER_AGENT,
  'Accept-Language': 'es-ES,es;q=0.9,en;q=0.8',
  'X-IG-App-ID': '936619743392459',
  'X-Requested-With': 'XMLHttpRequest',
  'Origin': ORIGIN,
  'Referer': `${ORIGIN}/`
};

/* -------------------- COOKIES -------------------- */

function createCookieJar() {
  const cookies = new Map();

  function absorb(headers) {
    let values = [];

    if (typeof headers.getSetCookie === 'function') {
      values = headers.getSetCookie();
    } else {
      const cookie = headers.get('set-cookie');
      if (cookie) values = cookie.split(/,(?=\s*[^;,]+=)/);
    }

    for (const value of values) {
      const first = value.split(';')[0];
      const index = first.indexOf('=');

      if (index <= 0) continue;

      const name = first.slice(0, index).trim();
      const content = first.slice(index + 1).trim();

      if (name) cookies.set(name, content);
    }
  }

  function header() {
    return [...cookies.entries()]
      .map(([name, value]) => `${name}=${value}`)
      .join('; ');
  }

  return { absorb, header };
}

function extractValue(html, patterns) {
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match?.[1]) return match[1];
  }

  return '';
}

/* -------------------- INSTAGRAM REQUEST -------------------- */

async function ig(url, options = {}, jar) {
  const headers = {
    ...HEADERS,
    ...(options.headers || {})
  };

  const cookie = jar?.header();
  if (cookie) headers.Cookie = cookie;

  const response = await fetch(url, {
    ...options,
    headers,
    redirect: 'follow'
  });

  jar?.absorb(response.headers);

  return response;
}

/* -------------------- URL PARSER -------------------- */

function parseTarget(input) {
  const value = String(input || '').trim();

  if (!value) {
    throw new Error('Envía un enlace de Instagram.');
  }

  const normalized = value.startsWith('http')
    ? value
    : `https://${value}`;

  let url;

  try {
    url = new URL(normalized);
  } catch {
    throw new Error('El enlace de Instagram no es válido.');
  }

  const hostname = url.hostname.toLowerCase();

  if (
    hostname !== 'instagram.com' &&
    hostname !== 'www.instagram.com' &&
    hostname !== 'm.instagram.com'
  ) {
    throw new Error('El enlace no pertenece a Instagram.');
  }

  const match = url.pathname.match(
    /^\/(p|reel|reels|tv)\/([A-Za-z0-9_-]+)/
  );

  if (!match) {
    throw new Error('No pude identificar el código de la publicación.');
  }

  return {
    type: match[1] === 'reels' ? 'reel' : match[1],
    shortcode: match[2],
    url: `${ORIGIN}/${match[1]}/${match[2]}/`
  };
}

/* -------------------- PAGE ENVIRONMENT -------------------- */

function extractEnv(html) {
  return {
    lsd: extractValue(html, [
      /"lsd"\s*:\s*"([^"]+)"/,
      /name="lsd"\s+value="([^"]+)"/
    ]),

    csrf: extractValue(html, [
      /"csrf_token"\s*:\s*"([^"]+)"/,
      /csrftoken=([^;"]+)/
    ]),

    rev: extractValue(html, [
      /"__rev"\s*:\s*(\d+)/,
      /"rev"\s*:\s*(\d+)/
    ]),

    hsi: extractValue(html, [
      /"hsi"\s*:\s*"([^"]+)"/,
      /"__hsi"\s*:\s*"([^"]+)"/
    ]),

    dyn: extractValue(html, [
      /"__dyn"\s*:\s*"([^"]+)"/
    ]),

    csr: extractValue(html, [
      /"__csr"\s*:\s*"([^"]+)"/
    ]),

    hsdp: extractValue(html, [
      /"__hsdp"\s*:\s*"([^"]+)"/
    ]),

    hblp: extractValue(html, [
      /"__hblp"\s*:\s*"([^"]+)"/
    ]),

    sjsp: extractValue(html, [
      /"__sjsp"\s*:\s*"([^"]+)"/
    ]),

    routingNamespace: extractValue(html, [
      /"routing_namespace"\s*:\s*"([^"]+)"/
    ])
  };
}

async function fetchEnvironment(target, jar) {
  const response = await ig(target.url, {}, jar);

  if (!response.ok) {
    throw new Error(`Instagram respondió con HTTP ${response.status}.`);
  }

  const html = await response.text();

  if (
    response.url.includes('/accounts/login') ||
    /login_required|challenge_required/i.test(html)
  ) {
    throw new Error(
      'Instagram está solicitando iniciar sesión o verificar el acceso.'
    );
  }

  return {
    html,
    env: extractEnv(html)
  };
}

/* -------------------- ROUTE DEFINITION -------------------- */

function buildRouteForm(target, env) {
  const form = new URLSearchParams();

  form.set('route_url', `/${target.type}/${target.shortcode}/`);
  form.set('route_parameters', JSON.stringify({
    shortcode: target.shortcode
  }));

  form.set('route_name', `${target.type}_page`);
  form.set('routing_namespace', env.routingNamespace || 'instagram');

  form.set('__user', '0');
  form.set('__a', '1');
  form.set('__req', '1');
  form.set('__hs', '1');
  form.set('dpr', '3');
  form.set('__ccg', 'UNKNOWN');

  if (env.rev) form.set('__rev', env.rev);
  if (env.hsi) form.set('__hsi', env.hsi);
  if (env.dyn) form.set('__dyn', env.dyn);
  if (env.csr) form.set('__csr', env.csr);
  if (env.hsdp) form.set('__hsdp', env.hsdp);
  if (env.hblp) form.set('__hblp', env.hblp);
  if (env.sjsp) form.set('__sjsp', env.sjsp);
  if (env.lsd) form.set('lsd', env.lsd);

  return form;
}

function parseResponseText(text) {
  const cleaned = text.replace(/^for\s*\(;;\);?\s*/, '');

  try {
    return JSON.parse(cleaned);
  } catch {
    return null;
  }
}

async function routeDefinition(target, env, jar) {
  const form = buildRouteForm(target, env);

  const response = await ig(
    `${ORIGIN}/ajax/route-definition/`,
    {
      method: 'POST',
      headers: {
        ...HEADERS,
        'Content-Type': 'application/x-www-form-urlencoded',
        'X-FB-LSD': env.lsd || '',
        'X-CSRFToken': env.csrf || ''
      },
      body: form.toString()
    },
    jar
  );

  const text = await response.text();

  if (!response.ok) {
    throw new Error(`Route definition respondió HTTP ${response.status}.`);
  }

  const data = parseResponseText(text);

  if (!data) {
    throw new Error('Instagram devolvió una respuesta que no es JSON.');
  }

  return data;
}

/* -------------------- MEDIA EXTRACTION -------------------- */

function isMediaHost(hostname) {
  const host = hostname.toLowerCase();

  return (
    host === 'cdninstagram.com' ||
    host.endsWith('.cdninstagram.com') ||
    host === 'fbcdn.net' ||
    host.endsWith('.fbcdn.net')
  );
}

function cleanUrl(value) {
  if (typeof value !== 'string') return null;

  const cleaned = value
    .replace(/&amp;/g, '&')
    .replace(/\\u0026/g, '&')
    .replace(/\\\//g, '/');

  try {
    const url = new URL(cleaned);

    if (url.protocol !== 'https:' || !isMediaHost(url.hostname)) {
      return null;
    }

    url.searchParams.delete('bytestart');
    url.searchParams.delete('byteend');

    return url.toString();
  } catch {
    return null;
  }
}

function getBestVideo(versions) {
  if (!Array.isArray(versions)) return null;

  const valid = versions
    .map(item => ({
      url: cleanUrl(item?.url),
      width: Number(item?.width || 0),
      height: Number(item?.height || 0)
    }))
    .filter(item => item.url);

  valid.sort((a, b) =>
    (b.width * b.height) - (a.width * a.height)
  );

  return valid[0]?.url || null;
}

function getBestImage(candidates) {
  if (!Array.isArray(candidates)) return null;

  const valid = candidates
    .map(item => ({
      url: cleanUrl(item?.url),
      width: Number(item?.width || 0),
      height: Number(item?.height || 0)
    }))
    .filter(item => item.url);

  valid.sort((a, b) =>
    (b.width * b.height) - (a.width * a.height)
  );

  return valid[0]?.url || null;
}

function extractMedia(data) {
  const results = [];
  const visited = new WeakSet();

  function walk(value) {
    if (!value || typeof value !== 'object') return;
    if (visited.has(value)) return;

    visited.add(value);

    if (Array.isArray(value)) {
      for (const item of value) walk(item);
      return;
    }

    const video =
      getBestVideo(value.video_versions) ||
      cleanUrl(value.video_url);

    const image =
      getBestImage(value.image_versions2?.candidates) ||
      cleanUrl(value.display_url) ||
      cleanUrl(value.thumbnail_url);

    if (video) {
      results.push({
        type: 'video',
        url: video,
        id: value.pk || value.id || null
      });
    } else if (image) {
      results.push({
        type: 'image',
        url: image,
        id: value.pk || value.id || null
      });
    }

    for (const [key, child] of Object.entries(value)) {
      if (
        key === 'video_versions' ||
        key === 'image_versions2' ||
        key === 'display_url' ||
        key === 'video_url' ||
        key === 'thumbnail_url'
      ) {
        continue;
      }

      walk(child);
    }
  }

  walk(data);

  const unique = [];
  const seen = new Set();

  for (const item of results) {
    if (seen.has(item.url)) continue;

    seen.add(item.url);
    unique.push(item);
  }

  return unique.slice(0, MAX_MEDIA);
}

function extractFromHtml(html) {
  const results = [];
  const patterns = [
    /https?:\\?\/\\?\/[^"'\\\s]+?\.mp4[^"'\\\s]*/gi,
    /https?:\\?\/\\?\/[^"'\\\s]+?\.jpg[^"'\\\s]*/gi,
    /https?:\\?\/\\?\/[^"'\\\s]+?\.webp[^"'\\\s]*/gi
  ];

  for (const pattern of patterns) {
    for (const match of html.matchAll(pattern)) {
      const url = cleanUrl(match[0]);

      if (!url) continue;

      results.push({
        type: /\.mp4/i.test(url) ? 'video' : 'image',
        url
      });
    }
  }

  return results.filter((item, index, array) =>
    array.findIndex(other => other.url === item.url) === index
  ).slice(0, MAX_MEDIA);
}

/* -------------------- DOWNLOAD -------------------- */

async function downloadMedia(media, index, jar) {
  const response = await ig(media.url, {
    headers: {
      'Accept': '*/*',
      'Referer': ORIGIN
    }
  }, jar);

  if (!response.ok) {
    throw new Error(`No se pudo descargar el archivo (${response.status}).`);
  }

  const finalUrl = new URL(response.url);

  if (!isMediaHost(finalUrl.hostname)) {
    throw new Error('Instagram redirigió a un servidor no permitido.');
  }

  const contentType = (
    response.headers.get('content-type') || ''
  ).toLowerCase();

  if (
    contentType.includes('text/html') ||
    contentType.includes('application/json')
  ) {
    throw new Error('Instagram devolvió una página en lugar del archivo.');
  }

  const buffer = Buffer.from(await response.arrayBuffer());

  if (!buffer.length) {
    throw new Error('El archivo descargado está vacío.');
  }

  if (buffer.length > MAX_FILE_SIZE) {
    throw new Error('El archivo supera el límite de 100 MB.');
  }

  const isVideo =
    media.type === 'video' ||
    contentType.includes('video');

  const extension = isVideo
    ? 'mp4'
    : contentType.includes('webp')
      ? 'webp'
      : contentType.includes('png')
        ? 'png'
        : 'jpg';

  await fs.mkdir(TEMP_DIR, { recursive: true });

  const filename = `instagram_${Date.now()}_${index}.${extension}`;
  const filepath = path.join(TEMP_DIR, filename);

  await fs.writeFile(filepath, buffer);

  return {
    filepath,
    filename,
    type: isVideo ? 'video' : 'image'
  };
}

/* -------------------- MAIN SCRAPER -------------------- */

async function getInstagramMedia(input) {
  const target = parseTarget(input);
  const jar = createCookieJar();

  const { html, env } = await fetchEnvironment(target, jar);

  let media = [];

  try {
    const data = await routeDefinition(target, env, jar);
    media = extractMedia(data);
  } catch {
    // Se utiliza el HTML como alternativa si route-definition falla.
  }

  if (!media.length) {
    media = extractFromHtml(html);
  }

  if (!media.length) {
    throw new Error(
      'No encontré contenido descargable. La publicación podría ser privada o Instagram pudo cambiar su respuesta.'
    );
  }

  return {
    target,
    media: media.slice(0, MAX_MEDIA),
    jar
  };
}

/* -------------------- PLUGIN -------------------- */

async function safeReact(react, emoji) {
  try {
    if (typeof react === 'function') {
      await react(emoji);
    }
  } catch {}
}

async function removeTempFiles(files) {
  await Promise.allSettled(
    files.map(file => fs.unlink(file.filepath))
  );
}

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
    reply,
    react
  }) {
    const input = args?.join(' ').trim();

    if (!input) {
      return reply(
        'Pasa un enlace de Instagram.\n\nEjemplo: .test https://www.instagram.com/reel/XXXXXXXX/'
      );
    }

    await safeReact(react, '⏳');

    const downloaded = [];

    try {
      const result = await getInstagramMedia(input);

      for (let i = 0; i < result.media.length; i++) {
        const file = await downloadMedia(
          result.media[i],
          i + 1,
          result.jar
        );

        downloaded.push(file);
      }

      for (const file of downloaded) {
        const options = msg ? { quoted: msg } : {};

        if (file.type === 'video') {
          await sock.sendMessage(
            from,
            {
              video: { url: file.filepath },
              mimetype: 'video/mp4',
              fileName: file.filename
            },
            options
          );
        } else {
          await sock.sendMessage(
            from,
            {
              image: { url: file.filepath },
              mimetype: file.filename.endsWith('.png')
                ? 'image/png'
                : file.filename.endsWith('.webp')
                  ? 'image/webp'
                  : 'image/jpeg'
            },
            options
          );
        }
      }

      await safeReact(react, '✅');

    } catch (error) {
      await safeReact(react, '❌');

      return reply(
        `No pude descargar el contenido.\n\n${error.message || 'Error desconocido.'}`
      );

    } finally {
      await removeTempFiles(downloaded);
    }
  }
};
