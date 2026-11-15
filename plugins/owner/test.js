
const BASE = 'https://www.instagram.com';
const TIMEOUT = 25000;
const MAX_MEDIA = 20;

const UA =
  'Mozilla/5.0 (Linux; Android 11; moto g(9) play) ' +
  'AppleWebKit/537.36 (KHTML, like Gecko) ' +
  'Chrome/120.0.0.0 Mobile Safari/537.36';

const HEADERS = {
  'User-Agent': UA,
  'Accept': 'text/html,application/xhtml+xml,application/json,*/*',
  'Accept-Language': 'es-ES,es;q=0.9,en;q=0.8',
  'Referer': `${BASE}/`,
  'X-Requested-With': 'XMLHttpRequest'
};

const CANDIDATOS = [
  {
    kind: 'embed',
    build: sc => `${BASE}/p/${sc}/embed/captioned/`
  },
  {
    kind: 'embed',
    build: sc => `${BASE}/reel/${sc}/embed/captioned/`
  },
  {
    kind: 'embed',
    build: sc => `${BASE}/p/${sc}/embed/`
  },
  {
    kind: 'html',
    build: sc => `${BASE}/reel/${sc}/`
  },
  {
    kind: 'html',
    build: sc => `${BASE}/p/${sc}/`
  },
  {
    kind: 'json',
    build: sc => `${BASE}/p/${sc}/?__a=1&__d=disco`
  }
];

function cleanUrl(value) {
  if (typeof value !== 'string') return null;

  let url = value
    .replace(/&amp;/g, '&')
    .replace(/\\u0026/g, '&')
    .replace(/\\\//g, '/')
    .trim();

  if (!/^https?:\/\//i.test(url)) return null;

  try {
    const parsed = new URL(url);

    const host = parsed.hostname.toLowerCase();

    const allowed =
      host.endsWith('cdninstagram.com') ||
      host.endsWith('fbcdn.net') ||
      host === 'instagram.com' ||
      host.endsWith('.instagram.com');

    if (!allowed) return null;

    if (
      parsed.pathname.includes('/rsrc.php/') ||
      parsed.pathname.includes('/static/')
    ) {
      return null;
    }

    return parsed.href;
  } catch {
    return null;
  }
}

function parseInstagramJson(raw) {
  const cleaned = String(raw)
    .replace(/^\s*for\s*\(\s*;;\s*\)\s*;\s*/, '')
    .replace(/^\s*while\s*\(\s*1\s*\)\s*;\s*/, '')
    .trim();

  return JSON.parse(cleaned);
}

function extractShortcode(input) {
  const text = String(input || '').trim();

  const match = text.match(
    /(?:instagram\.com\/(?:reel|p|tv)\/|^)([A-Za-z0-9_-]{5,})/
  );

  return match?.[1] || null;
}

function addMedia(output, type, value) {
  const url = cleanUrl(value);

  if (!url) return;

  if (output.some(item => item.url === url)) return;

  output.push({
    type,
    url
  });
}

function walk(value, output, depth = 0) {
  if (!value || depth > 18 || output.length >= MAX_MEDIA) return;

  if (typeof value === 'string') {
    if (
      value.length > 20 &&
      value.length < 200000 &&
      /^[\[{]/.test(value.trim())
    ) {
      try {
        walk(JSON.parse(value), output, depth + 1);
      } catch {}
    }

    return;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      walk(item, output, depth + 1);
      if (output.length >= MAX_MEDIA) break;
    }

    return;
  }

  if (typeof value !== 'object') return;

  if (Array.isArray(value.video_versions)) {
    for (const item of value.video_versions) {
      addMedia(output, 'video', item?.url);
    }
  }

  if (value.video_url) {
    addMedia(output, 'video', value.video_url);
  }

  if (value.contentUrl) {
    addMedia(output, 'video', value.contentUrl);
  }

  if (Array.isArray(value.image_versions2?.candidates)) {
    for (const item of value.image_versions2.candidates) {
      addMedia(output, 'image', item?.url);
    }
  }

  if (value.display_url) {
    addMedia(output, 'image', value.display_url);
  }

  if (value.display_uri) {
    addMedia(output, 'image', value.display_uri);
  }

  if (value.video_image?.uri) {
    addMedia(output, 'image', value.video_image.uri);
  }

  if (Array.isArray(value.display_resources)) {
    for (const item of value.display_resources) {
      addMedia(output, 'image', item?.src || item?.url);
    }
  }

  if (Array.isArray(value.video_resources)) {
    for (const item of value.video_resources) {
      addMedia(output, 'video', item?.src || item?.url);
    }
  }

  if (Array.isArray(value.carousel_media)) {
    for (const item of value.carousel_media) {
      walk(item, output, depth + 1);
    }
  }

  for (const [key, child] of Object.entries(value)) {
    if (
      key === 'video_versions' ||
      key === 'image_versions2' ||
      key === 'display_resources' ||
      key === 'video_resources' ||
      key === 'carousel_media'
    ) {
      continue;
    }

    walk(child, output, depth + 1);

    if (output.length >= MAX_MEDIA) break;
  }
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
    if (match?.[1]) return match[1];
  }

  return null;
}

function extractFromHtml(html) {
  const output = [];

  const videoMeta =
    extractMeta(html, 'og:video') ||
    extractMeta(html, 'og:video:url') ||
    extractMeta(html, 'og:video:secure_url');

  const imageMeta = extractMeta(html, 'og:image');

  if (videoMeta) addMedia(output, 'video', videoMeta);
  if (imageMeta) addMedia(output, 'image', imageMeta);

  const scripts = html.match(
    /<script\b[^>]*>([\s\S]*?)<\/script>/gi
  ) || [];

  for (const script of scripts) {
    const content = script
      .replace(/^<script\b[^>]*>/i, '')
      .replace(/<\/script>$/i, '')
      .trim();

    if (!content) continue;

    try {
      walk(JSON.parse(content), output);
    } catch {
      const markers = [
        '"shortcode_media"',
        '"xig_polaris_media"',
        '"video_versions"',
        '"image_versions2"',
        '"__bbox"'
      ];

      for (const marker of markers) {
        const position = content.indexOf(marker);
        if (position === -1) continue;

        const start = content.indexOf('{', position);

        if (start === -1) continue;

        let depth = 0;
        let inString = false;
        let escaped = false;

        for (let i = start; i < content.length; i++) {
          const char = content[i];

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
          } else if (char === '{') {
            depth++;
          } else if (char === '}') {
            depth--;

            if (depth === 0) {
              try {
                walk(JSON.parse(content.slice(start, i + 1)), output);
              } catch {}

              break;
            }
          }
        }
      }
    }

    if (output.length >= MAX_MEDIA) break;
  }

  return output.slice(0, MAX_MEDIA);
}

function extractMedia(data, html = '') {
  const output = [];

  if (data) walk(data, output);

  if (html) {
    for (const item of extractFromHtml(html)) {
      if (!output.some(existing => existing.url === item.url)) {
        output.push(item);
      }
    }
  }

  return output.slice(0, MAX_MEDIA);
}

function diagnoseResponse(response, body, data) {
  const raw = String(body || '');

  let serialized = '';

  try {
    serialized = data ? JSON.stringify(data) : '';
  } catch {}

  const searchable = `${raw}\n${serialized}`;

  const title =
    raw.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]
      ?.replace(/\s+/g, ' ')
      .slice(0, 120) || null;

  const error = data?.error ?? null;
  const errorSummary = data?.errorSummary ?? null;
  const errorDescription = data?.errorDescription ?? null;

  return {
    httpStatus: response.status,
    contentType: response.headers.get('content-type'),
    finalUrl: response.url,
    bodyLength: raw.length,
    pageTitle: title,

    jsonKeys:
      data && typeof data === 'object'
        ? Object.keys(data).slice(0, 25)
        : [],

    jsonError: error,
    errorSummary,
    errorDescription,

    payloadKeys:
      data?.payload && typeof data.payload === 'object'
        ? Object.keys(data.payload).slice(0, 20)
        : [],

    markers: {
      login: /login_required|accounts\/login|Log in to Instagram/i.test(searchable),
      checkpoint: /checkpoint_required|challenge_required|\/challenge\//i.test(searchable),
      private: /This account is private|account_is_private/i.test(searchable),
      consent: /consent_required|cookie consent/i.test(searchable),
      rateLimit: /rate.?limit|Please wait a few minutes|try again later/i.test(searchable),
      mediaPayload: /video_versions|video_url|image_versions2|shortcode_media|xig_polaris_media/i.test(searchable)
    }
  };
}

function buildError(shortcode, errors) {
  return {
    status: false,
    platform: 'instagram',
    shortcode,
    error: errors.join(' | ')
  };
}

function buildSuccess(shortcode, media, source) {
  return {
    status: true,
    platform: 'instagram',
    shortcode,
    extractionMethod: source,
    total: media.length,
    media
  };
}

async function fetchWithTimeout(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT);

  try {
    return await fetch(url, {
      method: 'GET',
      headers: {
        ...HEADERS,
        ...(process.env.IG_COOKIE
          ? { Cookie: process.env.IG_COOKIE }
          : {})
      },
      redirect: 'follow',
      signal: controller.signal
    });
  } finally {
    clearTimeout(timer);
  }
}

async function getCandidate(candidate, shortcode) {
  const url = candidate.build(shortcode);
  const response = await fetchWithTimeout(url);
  const body = await response.text();

  let data = null;

  if (candidate.kind === 'json') {
    try {
      data = parseInstagramJson(body);
    } catch {
      return {
        url,
        response,
        body,
        data: null,
        parseError: 'JSON inválido'
      };
    }
  }

  const media = extractMedia(data, candidate.kind === 'json' ? '' : body);

  return {
    url,
    response,
    body,
    data,
    media
  };
}

export default {
  name: ['test'],
  description: 'Diagnóstico y extracción de medios públicos de Instagram.',
  category: 'owner',
  ownerOnly: true,
  groupOnly: false,

  async run({ args, reply, react }) {
    try {
      const input = Array.isArray(args)
        ? args.join(' ').trim()
        : String(args || '').trim();

      const shortcode = extractShortcode(input);

      if (!shortcode) {
        return reply(JSON.stringify({
          status: false,
          platform: 'instagram',
          error: 'Envía un enlace válido de Instagram.'
        }, null, 2));
      }

      await react?.('🔎');

      const errors = [];

      for (const candidate of CANDIDATOS) {
        try {
          const result = await getCandidate(candidate, shortcode);

          if (result.media?.length) {
            await react?.('✅');

            return reply(JSON.stringify(
              buildSuccess(
                shortcode,
                result.media,
                candidate.kind
              ),
              null,
              2
            ));
          }

          const diagnostic = diagnoseResponse(
            result.response,
            result.body,
            result.data
          );

          const reason = result.parseError
            ? result.parseError
            : 'sin media';

          errors.push(
            `${result.url} → ${reason} → ${JSON.stringify(diagnostic)}`
          );
        } catch (error) {
          errors.push(
            `${candidate.build(shortcode)} → ${error.name === 'AbortError'
              ? 'timeout'
              : error.message}`
          );
        }
      }

      await react?.('❌');

      return reply(JSON.stringify(
        buildError(shortcode, errors),
        null,
        2
      ));

    } catch (error) {
      await react?.('❌').catch?.(() => {});

      return reply(JSON.stringify({
        status: false,
        platform: 'instagram',
        error: error.message || 'Error inesperado.'
      }, null, 2));
    }
  }
};
