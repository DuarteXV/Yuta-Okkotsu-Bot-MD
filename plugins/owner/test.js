
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

const CANDIDATOS = [
  { kind: 'embed', build: sc => `${BASE}/p/${sc}/embed/captioned/` },
  { kind: 'embed', build: sc => `${BASE}/reel/${sc}/embed/captioned/` },
  { kind: 'embed', build: sc => `${BASE}/p/${sc}/embed/` },
  { kind: 'html', build: sc => `${BASE}/reel/${sc}/` },
  { kind: 'html', build: sc => `${BASE}/p/${sc}/` },
  { kind: 'json', build: sc => `${BASE}/p/${sc}/?__a=1&__d=disco` }
];

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

      if (named[name] !== undefined) return named[name];

      if (name[0] === '#') {
        const number = name[1] === 'x'
          ? parseInt(name.slice(2), 16)
          : parseInt(name.slice(1), 10);

        if (Number.isFinite(number) && number >= 0 && number <= 0x10ffff) {
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
    .replace(/\\u002f/gi, '/')
    .replace(/\\\//g, '/')
    .trim();

  try {
    const url = new URL(decoded);

    if (url.protocol !== 'https:') return null;

    const host = url.hostname.toLowerCase();

    if (
      !host.endsWith('cdninstagram.com') &&
      !host.endsWith('fbcdn.net')
    ) return null;

    if (UI_ASSET_RE.test(url.pathname)) return null;

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
      for (const value of current) stack.push(value);
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
  return (item?.width || 0) * (item?.height || 0);
}

function biggest(list) {
  const items = (list || []).filter(
    item => item && typeof item.url === 'string' && item.url
  );

  if (!items.length) return null;

  return items.reduce((a, b) => (
    area(b) > area(a) ? b : a
  ));
}

function pickVideoVersion(list) {
  const items = (list || []).filter(
    item => item && typeof item.url === 'string' && item.url
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

  throw new Error(
    'No encuentro un shortcode válido en el enlace.'
  );
}

async function fetchResp(url, kind) {
  const headers = {
    'User-Agent': UA,
    'Accept': kind === 'json'
      ? 'application/json, */*;q=0.1'
      : 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'es-CO,es;q=0.9,en;q=0.8',
    'Referer': BASE + '/'
  };

  if (COOKIE) {
    headers.Cookie = COOKIE;
  }

  return fetch(url, {
    headers,
    redirect: 'follow',
    signal: AbortSignal.timeout(TIMEOUT)
  });
}

function parseInstagramJson(raw) {
  const cleaned = String(raw)
    .replace(/^\s*for\s*\(\s*;;\s*\)\s*;\s*/, '')
    .replace(/^\s*while\s*\(\s*1\s*\)\s*;\s*/, '')
    .trim();

  return JSON.parse(cleaned);
}

function extractJsonAfter(text, marker) {
  const idx = text.indexOf(marker);

  if (idx === -1) return null;

  const tail = text.slice(
    idx + marker.length,
    idx + marker.length + 20
  );

  if (/^\s*=\s*function/.test(tail)) {
    return null;
  }

  const start = text.indexOf('{', idx);

  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < text.length; i++) {
    const c = text[i];

    if (inString) {
      if (escaped) {
        escaped = false;
        continue;
      }

      if (c === '\\') {
        escaped = true;
        continue;
      }

      if (c === '"') {
        inString = false;
      }

      continue;
    }

    if (c === '"') {
      inString = true;
      continue;
    }

    if (c === '{') {
      depth++;
    } else if (c === '}') {
      depth--;

      if (depth === 0) {
        try {
          return JSON.parse(text.slice(start, i + 1));
        } catch {
          return null;
        }
      }
    }
  }

  return null;
}

function extractEmbedJson(html) {
  let data = extractJsonAfter(
    html,
    '__additionalDataLoaded'
  );

  if (data) return data;

  data = extractJsonAfter(
    html,
    '"shortcode_media"'
  );

  if (data) return data;

  data = extractJsonAfter(
    html,
    'contextJSON'
  );

  if (data) return data;

  const match = /<script[^>]*type="application\/json"[^>]*>([\s\S]*?)<\/script>/i.exec(html);

  if (match) {
    try {
      return JSON.parse(match[1]);
    } catch {}
  }

  return null;
}

function parseMetas(html) {
  const output = {};
  const tags = html.match(META_RE) || [];

  for (const tag of tags) {
    const attrs = {};

    ATTR_RE.lastIndex = 0;

    let match;

    while ((match = ATTR_RE.exec(tag))) {
      attrs[match[1].toLowerCase()] = decodeEntities(match[2]);
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

function collect(obj, meta, add) {
  if (
    typeof obj.__isXIGPolarisMedia === 'string'
  ) {
    meta.typename = obj.__isXIGPolarisMedia;
  }

  if (
    typeof obj.__typename === 'string' &&
    obj.__typename.includes('XIGPolaris')
  ) {
    meta.typename = obj.__typename;
  }

  if (
    typeof obj.code === 'string' &&
    /^[A-Za-z0-9_-]{5,}$/.test(obj.code)
  ) {
    meta.code = obj.code;
  }

  if (
    Array.isArray(obj.video_versions) &&
    obj.video_versions.length
  ) {
    const best = pickVideoVersion(obj.video_versions);

    if (best) {
      add('video', best.url, 'video_versions', {
        width: best.width,
        height: best.height,
        vtype: best.type
      });
    }
  }

  if (typeof obj.video_url === 'string') {
    add('video', obj.video_url, 'video_url');
  }

  if (
    obj.image_versions2 &&
    Array.isArray(obj.image_versions2.candidates)
  ) {
    const best = biggest(obj.image_versions2.candidates);

    if (best) {
      add('image', best.url, 'image_versions2', {
        width: best.width,
        height: best.height
      });
    }
  }

  if (typeof obj.display_url === 'string') {
    add('image', obj.display_url, 'display_url');
  }

  if (typeof obj.display_uri === 'string') {
    add('image', obj.display_uri, 'display_uri');
  }

  if (
    obj.video_image &&
    typeof obj.video_image.uri === 'string'
  ) {
    add('image', obj.video_image.uri, 'video_image.uri', {
      width: obj.video_image.width,
      height: obj.video_image.height
    });
  }

  if (
    Array.isArray(obj.display_resources) &&
    obj.display_resources.length
  ) {
    const best = obj.display_resources
      .filter(r => r && typeof r.src === 'string')
      .reduce((a, b) => {
        const areaA =
          (a.config_width || 0) *
          (a.config_height || 0);

        const areaB =
          (b.config_width || 0) *
          (b.config_height || 0);

        return areaB > areaA ? b : a;
      }, {});

    if (best.src) {
      add('image', best.src, 'display_resources', {
        width: best.config_width,
        height: best.config_height
      });
    }
  }

  if (
    Array.isArray(obj.video_resources) &&
    obj.video_resources.length
  ) {
    const best = obj.video_resources
      .filter(r => r && typeof r.src === 'string')
      .reduce((a, b) => {
        const areaA =
          (a.config_width || 0) *
          (a.config_height || 0);

        const areaB =
          (b.config_width || 0) *
          (b.config_height || 0);

        return areaB > areaA ? b : a;
      }, {});

    if (best.src) {
      add('video', best.src, 'video_resources', {
        width: best.config_width,
        height: best.config_height
      });
    }
  }
}

function extractMedia(html, data) {
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

  if (html) {
    const metas = parseMetas(html);

    add(
      'image',
      metas['og:image'],
      'meta:og:image'
    );
  }

  if (html) {
    SCRIPT_RE.lastIndex = 0;

    let match;

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

      let parsed;

      try {
        parsed = JSON.parse(body);
      } catch {
        continue;
      }

      for (const item of walk(parsed)) {
        collect(item, meta, add);
      }
    }
  }

  if (data) {
    for (const item of walk(data)) {
      collect(item, meta, add);
    }
  }

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

function diagnoseResponse(response, html, data) {
  const raw = html || '';

  const markers = {
    login: /login_required|accounts\/login|Log in to Instagram/i.test(raw),
    checkpoint: /checkpoint_required|challenge_required|\/challenge\//i.test(raw),
    private: /This account is private|account_is_private/i.test(raw),
    consent: /consent_required|cookie consent/i.test(raw),
    rateLimit: /rate.?limit|Please wait a few minutes/i.test(raw),
    mediaPayload: /video_versions|video_url|image_versions2|shortcode_media|xig_polaris_media/i.test(raw)
  };

  return {
    httpStatus: response.status,
    contentType: response.headers.get('content-type'),
    finalUrl: response.url,
    bodyLength: raw.length,
    pageTitle: raw.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.slice(0, 120) || null,
    jsonKeys: data && typeof data === 'object'
      ? Object.keys(data).slice(0, 25)
      : [],
    markers
  };
}

async function igMedia(input) {
  const shortcode = resolveShortcode(input);
  const errors = [];

  for (const candidato of CANDIDATOS) {
    const url = candidato.build(shortcode);

    try {
      const response = await fetchResp(
        url,
        candidato.kind
      );

      if (!response.ok) {
        errors.push(
          `${url} → HTTP ${response.status}`
        );
        continue;
      }

      const contentType = (
        response.headers.get('content-type') || ''
      ).toLowerCase();

      let html = null;
      let data = null;

      if (
        candidato.kind === 'json' ||
        contentType.includes('application/json')
      ) {
        try {
          const raw = await response.text();
          data = parseInstagramJson(raw);
        } catch (error) {
          errors.push(
            `${url} → JSON inválido: ${error.message}`
          );
          continue;
        }
      } else {
        html = await response.text();

        if (candidato.kind === 'embed') {
          data = extractEmbedJson(html);
        }
      }

      const { media, meta } = extractMedia(html, data);

      if (!media.length) {
        const diagnostic = diagnoseResponse(
          response,
          html,
          data
        );

        errors.push(
          `${url} → sin media → ${JSON.stringify(diagnostic)}`
        );

        continue;
      }

      const notes = [];

      if (!media.some(item => item.type === 'video')) {
        notes.push(
          'No se encontró una URL de vídeo en el contenido recibido; solo se obtuvo imagen o portada.'
        );
      }

      if (
        meta.typename &&
        /Carousel/i.test(meta.typename)
      ) {
        notes.push(
          'Es un carrusel: cada slide puede contener su propia foto o vídeo.'
        );
      }

      return {
        status: true,
        platform: 'instagram',
        shortcode,
        url,
        source: candidato.kind,
        typename: meta.typename || null,
        total: media.length,
        media,
        notes,
        extractionMethod: `relay-preloader+${candidato.kind}`
      };
    } catch (error) {
      errors.push(
        `${url} → ${error.message || String(error)}`
      );
    }
  }

  return {
    status: false,
    platform: 'instagram',
    shortcode,
    error: errors.join(' | ') ||
      'No se encontró contenido multimedia.'
  };
}

export default {
  name: ['test'],
  description: 'Extrae vídeos e imágenes de Instagram en formato JSON.',
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
