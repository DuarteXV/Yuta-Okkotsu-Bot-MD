
const ORIGIN = 'https://www.instagram.com';
const TIMEOUT = 25000;
const MAX_MEDIA = 10;

const HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36',
  'Accept':
    'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'es-ES,es;q=0.9,en;q=0.8',
  'X-IG-App-ID': '936619743392459',
  'Referer': `${ORIGIN}/`
};

function parseTarget(input) {
  const value = String(input || '').trim();

  const match = value.match(
    /instagram\.com\/(p|reel|reels|tv)\/([A-Za-z0-9_-]+)/i
  );

  if (match) {
    return {
      type: match[1].toLowerCase(),
      shortcode: match[2]
    };
  }

  if (/^[A-Za-z0-9_-]{5,}$/.test(value)) {
    return {
      type: 'reel',
      shortcode: value
    };
  }

  throw new Error('Enlace o código de Instagram no válido.');
}

function decodeUrl(value) {
  if (!value || typeof value !== 'string') return null;

  return value
    .replace(/\\u0026/gi, '&')
    .replace(/\\u002F/gi, '/')
    .replace(/\\\//g, '/')
    .replace(/\\u003D/gi, '=')
    .replace(/&amp;/g, '&')
    .replace(/\\u0025/gi, '%')
    .replace(/\\n/g, '')
    .replace(/\\r/g, '')
    .trim();
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

function extractFromHtml(html) {
  const results = [];
  const seen = new Set();

  const add = (rawUrl, type = 'video') => {
    const url = cleanUrl(rawUrl);

    if (!url || seen.has(url)) return;

    seen.add(url);

    results.push({
      type,
      url
    });
  };

  const patterns = [
    /"video_url"\s*:\s*"([^"]+)"/gi,
    /"contentUrl"\s*:\s*"([^"]+)"/gi,
    /"playable_url"\s*:\s*"([^"]+)"/gi,
    /"src"\s*:\s*"(https?:\\?\/\\?\/[^"]+\.mp4[^"]*)"/gi,
    /<meta[^>]+property=["']og:video(?::secure_url)?["'][^>]+content=["']([^"']+)["']/gi,
    /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:video(?::secure_url)?["']/gi
  ];

  for (const pattern of patterns) {
    for (const match of html.matchAll(pattern)) {
      add(match[1]);
    }
  }

  // Busca variantes de vídeo dentro de estructuras JSON.
  const versionPattern =
    /"video_versions"\s*:\s*\[([\s\S]*?)\]/gi;

  for (const match of html.matchAll(versionPattern)) {
    const block = match[1];

    const urlPattern = /"url"\s*:\s*"([^"]+)"/gi;

    for (const item of block.matchAll(urlPattern)) {
      add(item[1]);
    }
  }

  return results.slice(0, MAX_MEDIA);
}

async function fetchEmbed(target) {
  const url =
    `${ORIGIN}/${target.type}/${target.shortcode}/embed/captioned/`;

  const response = await fetch(url, {
    method: 'GET',
    headers: HEADERS,
    redirect: 'follow',
    signal: AbortSignal.timeout(TIMEOUT)
  });

  if (!response.ok) {
    throw new Error(
      `Instagram Embed respondió HTTP ${response.status}.`
    );
  }

  const html = await response.text();

  if (
    /accounts\/login|login_required|Log in to Instagram/i.test(html)
  ) {
    throw new Error(
      'Instagram requiere iniciar sesión para mostrar este contenido.'
    );
  }

  return html;
}

async function getInstagramMedia(input) {
  const target = parseTarget(input);

  const html = await fetchEmbed(target);

  const media = extractFromHtml(html);

  if (!media.length) {
    throw new Error(
      'Instagram Embed respondió, pero no expuso enlaces multimedia. Puede que el contenido sea privado o que Instagram haya cambiado su estructura.'
    );
  }

  return {
    target,
    media,
    extractionMethod: 'instagram-embed'
  };
}

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
    error: error?.message || 'Error desconocido'
  };
}

export default {
  name: ['test'],
  description: 'Extrae enlaces multimedia de Instagram.',
  category: 'owner',
  groupOnly: false,
  ownerOnly: true,

  async run({ args, reply, react }) {
    try {
      const input = args?.join(' ')?.trim();

      if (!input) {
        return reply('Pasa un enlace de Instagram.');
      }

      if (react) await react('⏳');

      const result = await getInstagramMedia(input);
      const output = buildSuccessJSON(result);

      await reply(JSON.stringify(output, null, 2));

      if (react) await react('✅');

    } catch (error) {
      const output = buildErrorJSON(error);

      await reply(JSON.stringify(output, null, 2));

      if (react) {
        await react('❌').catch(() => {});
      }
    }
  }
};
