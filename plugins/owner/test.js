import { randomUUID } from 'node:crypto';

const ORIGIN = 'https://www.instagram.com';
const MAX_MEDIA = 10;
const TIMEOUT = 25000;

const HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36',
  'Accept-Language': 'es-ES,es;q=0.9,en;q=0.8',
  'X-IG-App-ID': '936619743392459',
  'Referer': `${ORIGIN}/`
};

function decodeUrl(value) {
  if (!value || typeof value !== 'string') return null;

  try {
    return decodeURIComponent(
      value.replace(/\\u0026/g, '&')
        .replace(/\\u002F/g, '/')
        .replace(/\\\//g, '/')
        .replace(/&amp;/g, '&')
        .replace(/\\u003D/g, '=')
    );
  } catch {
    return value;
  }
}

function cleanUrl(value) {
  const decoded = decodeUrl(value);
  if (!decoded) return null;

  try {
    const url = new URL(decoded);

    if (url.protocol !== 'https:') return null;

    const host = url.hostname.toLowerCase();

    if (
      !host.endsWith('cdninstagram.com') &&
      !host.endsWith('fbcdn.net')
    ) {
      return null;
    }

    // Evita recursos internos de la interfaz de Instagram.
    if (
      host === 'static.cdninstagram.com' &&
      url.pathname.includes('/rsrc.php')
    ) {
      return null;
    }

    url.hash = '';
    return url.toString();
  } catch {
    return null;
  }
}

function parseTarget(input) {
  const match = String(input || '').match(
    /(?:instagram\.com\/(?:p|reel|reels|tv)\/)?([A-Za-z0-9_-]{5,})/
  );

  if (!match) {
    throw new Error('Enlace o código de Instagram no válido.');
  }

  return {
    shortcode: match[1],
    url: `${ORIGIN}/reel/${match[1]}/`
  };
}

function extractEnvironment(html) {
  const patterns = [
    /"lsd"\s*:\s*"([^"]+)"/,
    /"nonce"\s*:\s*"([^"]+)"/,
    /"rev"\s*:\s*(\d+)/,
    /"viewerId"\s*:\s*"([^"]+)"/
  ];

  const values = {};

  for (const [index, pattern] of patterns.entries()) {
    const match = html.match(pattern);
    if (match) {
      values[['lsd', 'nonce', 'rev', 'viewerId'][index]] = match[1];
    }
  }

  return values;
}

async function fetchPage(url) {
  const response = await fetch(url, {
    headers: HEADERS,
    signal: AbortSignal.timeout(TIMEOUT),
    redirect: 'follow'
  });

  if (!response.ok) {
    throw new Error(`Instagram respondió HTTP ${response.status}.`);
  }

  return response.text();
}

function collectMedia(value, results = [], seen = new Set()) {
  if (!value || typeof value !== 'object') return results;

  if (Array.isArray(value)) {
    for (const item of value) {
      collectMedia(item, results, seen);
    }
    return results;
  }

  const add = (type, rawUrl) => {
    const url = cleanUrl(rawUrl);
    if (!url || seen.has(url)) return;

    seen.add(url);
    results.push({ type, url });
  };

  // Estructuras habituales de vídeo.
  if (Array.isArray(value.video_versions)) {
    for (const version of value.video_versions) {
      add('video', version?.url);
    }
  }

  if (value.video_url) {
    add('video', value.video_url);
  }

  if (value.contentUrl) {
    add('video', value.contentUrl);
  }

  // Imágenes: solo desde objetos que parecen publicaciones.
  const looksLikePost =
    value.media_type !== undefined ||
    value.mediaType !== undefined ||
    value.pk !== undefined ||
    value.id !== undefined ||
    value.code !== undefined ||
    value.shortcode !== undefined;

  if (looksLikePost) {
    if (value.image_versions2?.candidates) {
      for (const candidate of value.image_versions2.candidates) {
        add('image', candidate?.url);
      }
    }

    if (value.display_url) {
      add('image', value.display_url);
    }

    if (value.carousel_media) {
      collectMedia(value.carousel_media, results, seen);
    }
  }

  for (const [key, child] of Object.entries(value)) {
    if (
      key === 'image_versions2' ||
      key === 'video_versions' ||
      key === 'carousel_media'
    ) {
      continue;
    }

    if (child && typeof child === 'object') {
      collectMedia(child, results, seen);
    }
  }

  return results;
}

async function routeDefinition(html, env) {
  const lsd = env.lsd;

  if (!lsd) {
    throw new Error('No se encontró el token LSD en la página.');
  }

  const form = new URLSearchParams({
    av: env.viewerId || '0',
    __d: 'www',
    __user: env.viewerId || '0',
    __a: '1',
    __req: '1',
    __hs: '',
    dpr: '3',
    __ccg: 'GOOD',
    __rev: env.rev || '0',
    lsd,
    jazoest: '22000',
    fb_dtsg: '',
    __spin_r: env.rev || '0',
    __spin_b: 'trunk',
    __spin_t: String(Math.floor(Date.now() / 1000)),
    server_timestamps: 'true',
    doc_id: '',
    variables: JSON.stringify({})
  });

  const response = await fetch(`${ORIGIN}/ajax/route-definition/`, {
    method: 'POST',
    headers: {
      ...HEADERS,
      'Content-Type': 'application/x-www-form-urlencoded',
      'X-FB-LSD': lsd,
      'X-ASBD-ID': '129477',
      'X-Requested-With': 'XMLHttpRequest',
      'Origin': ORIGIN
    },
    body: form,
    signal: AbortSignal.timeout(TIMEOUT)
  });

  if (!response.ok) {
    throw new Error(`Route definition respondió HTTP ${response.status}.`);
  }

  const text = await response.text();

  let data;

  try {
    data = JSON.parse(text.replace(/^for\s*\(\s*;\s*;\s*\)\s*;\s*/, ''));
  } catch {
    throw new Error('Route definition no devolvió JSON válido.');
  }

  const media = collectMedia(data).slice(0, MAX_MEDIA);

  if (!media.length) {
    throw new Error('Route definition no devolvió contenido multimedia.');
  }

  return media;
}

function extractFromHtml(html) {
  const results = [];
  const seen = new Set();

  const patterns = [
    /"video_url"\s*:\s*"([^"]+)"/gi,
    /"contentUrl"\s*:\s*"([^"]+)"/gi,
    /<meta[^>]+property=["']og:video(?::secure_url)?["'][^>]+content=["']([^"']+)["']/gi,
    /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:video(?::secure_url)?["']/gi
  ];

  for (const pattern of patterns) {
    for (const match of html.matchAll(pattern)) {
      const url = cleanUrl(match[1]);

      if (!url || seen.has(url)) continue;

      seen.add(url);
      results.push({
        type: 'video',
        url
      });
    }
  }

  return results.slice(0, MAX_MEDIA);
}

async function getInstagramMedia(input) {
  const target = parseTarget(input);

  const html = await fetchPage(target.url);
  const env = extractEnvironment(html);

  let media = [];
  let extractionMethod = 'route-definition';
  let routeError = null;

  try {
    media = await routeDefinition(html, env);
  } catch (error) {
    routeError = error.message;
  }

  if (!media.length) {
    extractionMethod = 'html-video-fallback';
    media = extractFromHtml(html);
  }

  if (!media.length) {
    throw new Error(
      `No se encontró contenido multimedia real. Route definition: ${routeError || 'Sin información'}. Fallback HTML: sin resultados.`
    );
  }

  return {
    target,
    media,
    extractionMethod,
    routeError
  };
}

function buildSuccessJSON(result) {
  return {
    status: true,
    platform: 'instagram',
    shortcode: result.target.shortcode,
    type: 'reel',
    extractionMethod: result.extractionMethod,
    routeError: result.routeError,
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
    error: error.message || 'Error desconocido',
    requestId: randomUUID()
  };
}

export default {
  name: ['test'],
  description: 'Obtiene los enlaces multimedia de publicaciones y Reels de Instagram.',
  category: 'owner',
  groupOnly: false,
  ownerOnly: true,

  async run({ args, reply, react }) {
    try {
      const input = args?.join(' ')?.trim();

      if (!input) {
        return reply('Pasa un enlace de Instagram.');
      }

      await react('⏳');

      const result = await getInstagramMedia(input);
      const output = buildSuccessJSON(result);

      await reply(JSON.stringify(output, null, 2));
      await react('✅');

    } catch (error) {
      const output = buildErrorJSON(error);

      await reply(JSON.stringify(output, null, 2));

      if (react) {
        await react('❌').catch(() => {});
      }
    }
  }
};
