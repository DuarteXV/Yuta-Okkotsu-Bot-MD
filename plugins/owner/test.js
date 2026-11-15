
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
  Origin: ORIGIN,
  Referer: `${ORIGIN}/`
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

      cookies.set(
        first.slice(0, index).trim(),
        first.slice(index + 1).trim()
      );
    }
  }

  function header() {
    return [...cookies.entries()]
      .map(([name, value]) => `${name}=${value}`)
      .join('; ');
  }

  return { absorb, header };
}

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

/* -------------------- URL -------------------- */

function parseTarget(input) {
  const normalized = input.startsWith('http')
    ? input
    : `https://${input}`;

  let url;

  try {
    url = new URL(normalized);
  } catch {
    throw new Error('El enlace no es válido.');
  }

  const hostname = url.hostname.toLowerCase();

  if (
    !['instagram.com', 'www.instagram.com', 'm.instagram.com'].includes(hostname)
  ) {
    throw new Error('El enlace no pertenece a Instagram.');
  }

  const match = url.pathname.match(
    /^\/(p|reel|reels|tv)\/([A-Za-z0-9_-]+)/
  );

  if (!match) {
    throw new Error('No pude identificar la publicación.');
  }

  const type = match[1] === 'reels' ? 'reel' : match[1];

  return {
    type,
    shortcode: match[2],
    url: `${ORIGIN}/${match[1]}/${match[2]}/`
  };
}

/* -------------------- ENVIRONMENT -------------------- */

function extractValue(html, patterns) {
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match?.[1]) return match[1];
  }

  return '';
}

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
    throw new Error(`Instagram respondió HTTP ${response.status}.`);
  }

  const html = await response.text();

  if (response.url.includes('/accounts/login')) {
    throw new Error('Instagram está solicitando iniciar sesión.');
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

  for (const key of [
    'rev',
    'hsi',
    'dyn',
    'csr',
    'hsdp',
    'hblp',
    'sjsp',
    'lsd'
  ]) {
    if (env[key]) {
      const name = key === 'rev' ? '__rev' :
        key === 'hsi' ? '__hsi' :
        key === 'dyn' ? '__dyn' :
        key === 'csr' ? '__csr' :
        key === 'hsdp' ? '__hsdp' :
        key === 'hblp' ? '__hblp' :
        key === 'sjsp' ? '__sjsp' : key;

      form.set(name, env[key]);
    }
  }

  return form;
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

  try {
    return JSON.parse(text.replace(/^for\s*\(;;\);?\s*/, ''));
  } catch {
    throw new Error('Instagram devolvió una respuesta no válida.');
  }
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

    if (
      url.protocol !== 'https:' ||
      !isMediaHost(url.hostname)
    ) {
      return null;
    }

    url.searchParams.delete('bytestart');
    url.searchParams.delete('byteend');

    return url.toString();
  } catch {
    return null;
  }
}

function bestVideo(versions) {
  if (!Array.isArray(versions)) return null;

  const valid = versions
    .map(item => ({
      url: cleanUrl(item?.url),
      quality: Number(item?.width || 0) * Number(item?.height || 0)
    }))
    .filter(item => item.url)
    .sort((a, b) => b.quality - a.quality);

  return valid[0]?.url || null;
}

function bestImage(candidates) {
  if (!Array.isArray(candidates)) return null;

  const valid = candidates
    .map(item => ({
      url: cleanUrl(item?.url),
      quality: Number(item?.width || 0) * Number(item?.height || 0)
    }))
    .filter(item => item.url)
    .sort((a, b) => b.quality - a.quality);

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
      bestVideo(value.video_versions) ||
      cleanUrl(value.video_url);

    const image =
      bestImage(value.image_versions2?.candidates) ||
      cleanUrl(value.display_url) ||
      cleanUrl(value.thumbnail_url);

    if (video) {
      results.push({
        type: 'video',
        url: video
      });
    } else if (image) {
      results.push({
        type: 'image',
        url: image
      });
    }

    for (const [key, child] of Object.entries(value)) {
      if ([
        'video_versions',
        'image_versions2',
        'display_url',
        'video_url',
        'thumbnail_url'
      ].includes(key)) continue;

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
  const response = await ig(
    media.url,
    {
      headers: {
        Accept: '*/*',
        Referer: ORIGIN
      }
    },
    jar
  );

  if (!response.ok) {
    throw new Error(`Error descargando archivo: HTTP ${response.status}.`);
  }

  const finalUrl = new URL(response.url);

  if (!isMediaHost(finalUrl.hostname)) {
    throw new Error('Redirección a un servidor no permitido.');
  }

  const contentType = (
    response.headers.get('content-type') || ''
  ).toLowerCase();

  if (
    contentType.includes('text/html') ||
    contentType.includes('application/json')
  ) {
    throw new Error('Instagram devolvió una página y no el archivo.');
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
    type: isVideo ? 'video' : 'image',
    mimetype: isVideo
      ? 'video/mp4'
      : extension === 'webp'
        ? 'image/webp'
        : extension === 'png'
          ? 'image/png'
          : 'image/jpeg',
    buffer
  };
}

/* -------------------- SCRAPER -------------------- */

async function getInstagramMedia(input) {
  const target = parseTarget(input);
  const jar = createCookieJar();

  const { html, env } = await fetchEnvironment(target, jar);

  let media = [];

  try {
    const data = await routeDefinition(target, env, jar);
    media = extractMedia(data);
  } catch (error) {
    console.error('[Instagram] Route definition:', error.message);
  }

  if (!media.length) {
    media = extractFromHtml(html);
  }

  if (!media.length) {
    throw new Error(
      'No encontré contenido descargable. Puede ser una publicación privada o Instagram cambió su respuesta.'
    );
  }

  return {
    target,
    media,
    jar
  };
}

/* -------------------- HELPERS -------------------- */

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

/* -------------------- PLUGIN -------------------- */

export default {
  name: ['test'],
  description: 'Descarga videos e imágenes de Instagram.',
  category: 'owner',
  groupOnly: false,
  ownerOnly: true,

  async run({ sock, from, msg, args, reply, react }) {
    const input = args?.join(' ').trim();

    if (!input) {
      return reply(
        'Pasa un enlace de Instagram.\n\nEjemplo: .test https://www.instagram.com/reel/XXXXXXXX/'
      );
    }

    const downloaded = [];

    await safeReact(react, '⏳');

    try {
      const result = await getInstagramMedia(input);

      console.log(
        `[Instagram] Encontrados ${result.media.length} archivos.`
      );

      for (let i = 0; i < result.media.length; i++) {
        const file = await downloadMedia(
          result.media[i],
          i + 1,
          result.jar
        );

        downloaded.push(file);

        console.log(
          `[Instagram] Descargado: ${file.filename} (${file.buffer.length} bytes)`
        );
      }

      for (const file of downloaded) {
        const options = msg ? { quoted: msg } : {};

        const content = file.type === 'video'
          ? {
              video: file.buffer,
              mimetype: 'video/mp4',
              fileName: file.filename
            }
          : {
              image: file.buffer,
              mimetype: file.mimetype
            };

        console.log(
          `[Instagram] Enviando ${file.filename} a ${from}...`
        );

        const sent = await sock.sendMessage(
          from,
          content,
          options
        );

        if (!sent?.key?.id) {
          throw new Error(
            `Baileys no confirmó el envío de ${file.filename}.`
          );
        }

        console.log(
          `[Instagram] Enviado correctamente: ${sent.key.id}`
        );
      }

      await safeReact(react, '✅');

    } catch (error) {
      console.error('[Instagram Plugin]', error);

      await safeReact(react, '❌');

      return reply(
        `Error al procesar Instagram:\n${error.message || 'Error desconocido.'}`
      );

    } finally {
      await removeTempFiles(downloaded);
    }
  }
};
