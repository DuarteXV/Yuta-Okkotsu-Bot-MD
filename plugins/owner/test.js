
const ORIGIN = 'https://www.instagram.com';
const MAX_MEDIA = 10;

const HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Linux; Android 13; Mobile) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36',
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

  return {
    type: match[1] === 'reels' ? 'reel' : match[1],
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

  const fields = {
    rev: '__rev',
    hsi: '__hsi',
    dyn: '__dyn',
    csr: '__csr',
    hsdp: '__hsdp',
    hblp: '__hblp',
    sjsp: '__sjsp',
    lsd: 'lsd'
  };

  for (const [key, name] of Object.entries(fields)) {
    if (env[key]) form.set(name, env[key]);
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
      quality:
        Number(item?.width || 0) *
        Number(item?.height || 0)
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
      quality:
        Number(item?.width || 0) *
        Number(item?.height || 0)
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

/* -------------------- SCRAPER -------------------- */

async function getInstagramMedia(input) {
  const target = parseTarget(input);
  const jar = createCookieJar();

  const { html, env } = await fetchEnvironment(target, jar);

  let media = [];
  let extractionMethod = 'route-definition';
  let routeError = null;

  try {
    const data = await routeDefinition(target, env, jar);
    media = extractMedia(data);
  } catch (error) {
    routeError = error.message;
  }

  if (!media.length) {
    extractionMethod = 'html-fallback';
    media = extractFromHtml(html);
  }

  if (!media.length) {
    throw new Error(
      `No se encontró contenido descargable. ${
        routeError ? `Route definition: ${routeError}` : ''
      }`
    );
  }

  return {
    target,
    media,
    extractionMethod
  };
}

/* -------------------- JSON RESPONSE -------------------- */

function buildSuccessJSON(result) {
  return {
    status: true,
    platform: 'instagram',
    shortcode: result.target.shortcode,
    type: result.target.type,
    extractionMethod: result.extractionMethod,
    total: result.media.length,
    media: result.media.map((item, index) => ({
      index: index + 1,
      type: item.type,
      url: item.url
    }))
  };
}

function buildErrorJSON(error) {
  return {
    status: false,
    platform: 'instagram',
    error: error.message || 'Error desconocido'
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

export default {
  name: ['test'],
  description: 'Obtiene los enlaces de Instagram en formato JSON.',
  category: 'owner',
  groupOnly: false,
  ownerOnly: true,

  async run({ args, reply, react }) {
    const input = args?.join(' ').trim();

    if (!input) {
      return reply(
        'Pasa un enlace de Instagram.\n\nEjemplo: .test https://www.instagram.com/reel/XXXXXXXX/'
      );
    }

    await safeReact(react, '⏳');

    try {
      const result = await getInstagramMedia(input);
      const json = buildSuccessJSON(result);

      await safeReact(react, '✅');

      return reply(
        '```json\n' +
        JSON.stringify(json, null, 2) +
        '\n```'
      );

    } catch (error) {
      console.error('[Instagram JSON]', error);

      await safeReact(react, '❌');

      const json = buildErrorJSON(error);

      return reply(
        '```json\n' +
        JSON.stringify(json, null, 2) +
        '\n```'
      );
    }
  }
};
