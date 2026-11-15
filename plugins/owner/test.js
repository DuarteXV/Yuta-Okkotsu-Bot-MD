
const BASE = 'https://www.instagram.com';
const TIMEOUT = 30000;
const MAX_MEDIA = 20;

const UA =
  'Mozilla/5.0 (Linux; Android 11; moto g(9) play Build/RPXS31.Q2-58-17-7-3; wv) ' +
  'AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/157.0.8103.40 Mobile Safari/537.36';

const COOKIE = process.env.IG_COOKIE || '';

const SHORTCODE_RE =
  /instagram\.com\/(?:reel|reels|p|tv)\/([A-Za-z0-9_-]+)/i;

const SCRIPT_RE = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
const META_RE = /<meta\b[^>]*>/gi;
const ATTR_RE = /([\w:.-]+)\s*=\s*"([^"]*)"/g;
const UI_ASSET_RE = /\/rsrc\.php\//i;

function decodeEntities(value) {
  const named = {
    amp: '&',
    lt: '<',
    gt: '>',
    quot: '"',
    apos: "'",
    nbsp: ' '
  };

  return String(value).replace(
    /&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g,
    (match, key) => {
      const name = key.toLowerCase();

      if (named[name] !== undefined) {
        return named[name];
      }

      if (name[0] === '#') {
        const number = name[1] === 'x'
          ? parseInt(name.slice(2), 16)
          : parseInt(name.slice(1), 10);

        if (
          Number.isFinite(number) &&
          number >= 0 &&
          number <= 0x10FFFF
        ) {
          try {
            return String.fromCodePoint(number);
          } catch {}
        }
      }

      return match;
    }
  );
}

function cleanUrl(value) {
  if (typeof value !== 'string') return null;

  const decoded = decodeEntities(value)
    .replace(/\\u0026/gi, '&')
    .replace(/\\u002F/gi, '/')
    .replace(/\\\//g, '/')
    .trim();

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

    if (UI_ASSET_RE.test(url.pathname)) {
      return null;
    }

    url.hash = '';

    return url.toString();
  } catch {
    return null;
  }
}

function* walk(node) {
  const stack = [node];

  while (stack.length) {
    const current = stack.pop();

    if (Array.isArray(current)) {
      for (const value of current) {
        stack.push(value);
      }

      continue;
    }

    if (current && typeof current === 'object') {
      yield current;

      for (const value of Object.values(current)) {
        stack.push(value);
      }

      continue;
    }

    if (
      typeof current === 'string' &&
      current.length > 1 &&
      current.length < 8e6 &&
      (current[0] === '{' || current[0] === '[')
    ) {
      try {
        stack.push(JSON.parse(current));
      } catch {}
    }
  }
}

function area(item) {
  return (
    (item?.width || 0) *
    (item?.height || 0)
  );
}

function biggest(list) {
  const items = (list || []).filter(
    item => item &&
      typeof item.url === 'string' &&
      item.url
  );

  if (!items.length) return null;

  return items.reduce((a, b) =>
    area(b) > area(a) ? b : a
  );
}

function pickVideoVersion(list) {
  const items = (list || []).filter(
    item => item &&
      typeof item.url === 'string' &&
      item.url
  );

  if (!items.length) return null;

  const rank = item => {
    const type = String(
      item.type == null ? '' : item.type
    ).toUpperCase();

    if (type.includes('640_HIGH')) return 3;
    if (type.includes('480_HIGH')) return 2;
    if (type.includes('HIGH')) return 1;

    return 0;
  };

  return items.reduce((a, b) => {
    const difference = rank(b) - rank(a);

    if (difference !== 0) {
      return difference > 0 ? b : a;
    }

    return area(b) > area(a) ? b : a;
  });
}

function resolveShortcode(input) {
  const value = String(input || '').trim();
  const match = SHORTCODE_RE.exec(value);

  if (match) return match[1];

  if (/^[A-Za-z0-9_-]{5,}$/.test(value)) {
    return value;
  }

  throw new Error('No encuentro un shortcode válido en el enlace.');
}

async function fetchHtml(url) {
  const headers = {
    'User-Agent': UA,
    'Accept':
      'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'es-CO,es;q=0.9,en;q=0.8',
    'Referer': BASE + '/'
  };

  if (COOKIE) {
    headers.Cookie = COOKIE;
  }

  const response = await fetch(url, {
    headers,
    redirect: 'follow',
    signal: AbortSignal.timeout(TIMEOUT)
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} en ${url}`);
  }

  return response.text();
}

function parseMetas(html) {
  const output = {};
  const tags = html.match(META_RE) || [];

  for (const tag of tags) {
    const attrs = {};

    ATTR_RE.lastIndex = 0;

    let match;

    while ((match = ATTR_RE.exec(tag))) {
      attrs[match[1].toLowerCase()] =
        decodeEntities(match[2]);
    }

    const key = (
      attrs.property ||
      attrs.name ||
      ''
    ).toLowerCase();

    if (
      key &&
      attrs.content &&
      output[key] === undefined
    ) {
      output[key] = attrs.content;
    }
  }

  return output;
}

function extractMedia(html) {
  const media = [];
  const seen = new Set();
  const meta = {};

  const add = (type, rawUrl, source, extra) => {
    const url = cleanUrl(rawUrl);

    if (!url || seen.has(url)) return;

    seen.add(url);

    const item = {
      type,
      url,
      source
    };

    if (extra) {
      for (const key of Object.keys(extra)) {
        if (
          extra[key] !== undefined &&
          extra[key] !== null
        ) {
          item[key] = extra[key];
        }
      }
    }

    media.push(item);
  };

  // Portada de la publicación.
  const metas = parseMetas(html);

  add(
    'image',
    metas['og:image'],
    'meta:og:image'
  );

  // Datos JSON de Instagram.
  let match;

  SCRIPT_RE.lastIndex = 0;

  while ((match = SCRIPT_RE.exec(html))) {
    const attrs = match[1];
    const body = match[2];

    const isJson =
      /type\s*=\s*"application\/json"/i.test(attrs);

    if (
      !isJson &&
      !body.includes('__bbox') &&
      !body.includes('xig_polaris_media')
    ) {
      continue;
    }

    let data;

    try {
      data = JSON.parse(body);
    } catch {
      continue;
    }

    for (const item of walk(data)) {
      // Tipo de publicación.
      if (typeof item.__isXIGPolarisMedia === 'string') {
        meta.typename = item.__isXIGPolarisMedia;
      }

      if (
        typeof item.__typename === 'string' &&
        item.__typename.includes('XIGPolaris')
      ) {
        meta.typename = item.__typename;
      }

      if (
        typeof item.code === 'string' &&
        /^[A-Za-z0-9_-]{5,}$/.test(item.code)
      ) {
        meta.code = item.code;
      }

      // Vídeos.
      if (
        Array.isArray(item.video_versions) &&
        item.video_versions.length
      ) {
        const best = pickVideoVersion(
          item.video_versions
        );

        if (best) {
          add(
            'video',
            best.url,
            'video_versions',
            {
              width: best.width,
              height: best.height,
              vtype: best.type
            }
          );
        }
      }

      if (typeof item.video_url === 'string') {
        add(
          'video',
          item.video_url,
          'video_url'
        );
      }

      // Fotografías.
      if (
        item.image_versions2 &&
        Array.isArray(item.image_versions2.candidates)
      ) {
        const best = biggest(
          item.image_versions2.candidates
        );

        if (best) {
          add(
            'image',
            best.url,
            'image_versions2',
            {
              width: best.width,
              height: best.height
            }
          );
        }
      }

      if (typeof item.display_uri === 'string') {
        add(
          'image',
          item.display_uri,
          'display_uri'
        );
      }

      if (typeof item.display_url === 'string') {
        add(
          'image',
          item.display_url,
          'display_url'
        );
      }

      // Portada del vídeo.
      if (
        item.video_image &&
        typeof item.video_image.uri === 'string'
      ) {
        add(
          'image',
          item.video_image.uri,
          'video_image.uri',
          {
            width: item.video_image.width,
            height: item.video_image.height
          }
        );
      }
    }
  }

  // Los vídeos aparecen primero.
  media.sort((a, b) => {
    if (a.type !== b.type) {
      return a.type === 'video' ? -1 : 1;
    }

    return area(b) - area(a);
  });

  const limited = media.slice(0, MAX_MEDIA);

  limited.forEach((item, index) => {
    item.index = index + 1;
  });

  return {
    media: limited,
    meta
  };
}

async function igMedia(input) {
  const shortcode = resolveShortcode(input);
  let lastError = null;

  for (const kind of ['reel', 'p']) {
    const url = `${BASE}/${kind}/${shortcode}/`;

    try {
      const html = await fetchHtml(url);

      const {
        media,
        meta
      } = extractMedia(html);

      if (!media.length) {
        lastError =
          `HTTP 200, pero no se encontraron datos multimedia en ${url}`;

        continue;
      }

      const notes = [];

      if (!media.some(item => item.type === 'video')) {
        notes.push(
          'No se encontraron video_versions. Solo se obtuvo contenido de imagen o portada.'
        );
      }

      if (
        meta.typename &&
        /Carousel/i.test(meta.typename)
      ) {
        notes.push(
          'La publicación parece ser un carrusel.'
        );
      }

      return {
        status: true,
        platform: 'instagram',
        shortcode,
        url,
        typename: meta.typename || null,
        total: media.length,
        media,
        notes,
        extractionMethod: 'relay-preloader'
      };

    } catch (error) {
      lastError = error.message || String(error);
    }
  }

  return {
    status: false,
    platform: 'instagram',
    shortcode,
    error: lastError ||
      'No se encontró contenido multimedia.'
  };
}

export default {
  name: ['test'],
  description: 'Extrae vídeos e imágenes de Instagram.',
  category: 'owner',
  groupOnly: false,
  ownerOnly: true,

  async run({ args, reply, react }) {
    try {
      const input = args?.join(' ')?.trim();

      if (!input) {
        return reply('Pasa un enlace de Instagram.');
      }

      if (react) {
        await react('⏳');
      }

      const result = await igMedia(input);

      await reply(
        JSON.stringify(result, null, 2)
      );

      if (react) {
        await react(result.status ? '✅' : '⚠️');
      }

    } catch (error) {
      const result = {
        status: false,
        platform: 'instagram',
        error: error.message || 'Error desconocido'
      };

      await reply(
        JSON.stringify(result, null, 2)
      );

      if (react) {
        await react('❌').catch(() => {});
      }
    }
  }
};
