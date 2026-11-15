
const GRAPHQL_URL = 'https://www.instagram.com/graphql/query';
const TIMEOUT = 25000;
const MAX_MEDIA = 20;

// Identificadores de la consulta GraphQL observada en Instafetch.
const DOC_ID = '8845758582119845';
const APP_ID = '1217981644879628';

const HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Linux; Android 11; Mobile) AppleWebKit/537.36 Chrome/120.0.0.0 Mobile Safari/537.36',
  'Accept': '*/*',
  'Accept-Language': 'es-ES,es;q=0.9,en;q=0.8',
  'Content-Type': 'application/x-www-form-urlencoded',
  'X-FB-Friendly-Name': 'PolarisPostActionLoadPostQueryQuery',
  'X-IG-App-ID': APP_ID,
  'X-FB-LSD': 'AVrqPT0gJDo',
  'X-ASBD-ID': '359341',
  'Origin': 'https://www.instagram.com',
  'Referer': 'https://www.instagram.com/'
};

function extractShortcode(input) {
  const text = String(input || '').trim();

  if (/^[A-Za-z0-9_-]{5,}$/.test(text)) {
    return text;
  }

  const match = text.match(
    /(?:https?:\/\/)?(?:www\.)?instagram\.com\/(?:reel|p|tv)\/([A-Za-z0-9_-]+)\/?/i
  );

  return match?.[1] || null;
}

function cleanUrl(value) {
  if (typeof value !== 'string') return null;

  const url = value
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
      host.endsWith('fbcdn.net');

    if (!allowed) return null;

    return parsed.href;
  } catch {
    return null;
  }
}

function addMedia(output, type, value, extra = {}) {
  const url = cleanUrl(value);

  if (!url) return;
  if (output.some(item => item.url === url)) return;

  output.push({
    type,
    url,
    ...extra
  });
}

function extractMedia(media) {
  const output = [];

  if (!media || typeof media !== 'object') {
    return output;
  }

  // Video principal.
  if (media.video_url) {
    addMedia(output, 'video', media.video_url);
  }

  // Variantes de video.
  if (Array.isArray(media.video_versions)) {
    for (const item of media.video_versions) {
      addMedia(output, 'video', item?.url, {
        width: item?.width || null,
        height: item?.height || null
      });
    }
  }

  // Imagen principal.
  if (media.display_url) {
    addMedia(output, 'image', media.display_url);
  }

  if (media.display_uri) {
    addMedia(output, 'image', media.display_uri);
  }

  // Variantes de imagen.
  const candidates = media.image_versions2?.candidates;

  if (Array.isArray(candidates)) {
    for (const item of candidates) {
      addMedia(output, 'image', item?.url, {
        width: item?.width || null,
        height: item?.height || null
      });
    }
  }

  // Carrusel.
  if (Array.isArray(media.carousel_media)) {
    for (const child of media.carousel_media) {
      const childMedia = extractMedia(child);

      for (const item of childMedia) {
        addMedia(output, item.type, item.url, {
          width: item.width,
          height: item.height
        });
      }
    }
  }

  return output.slice(0, MAX_MEDIA);
}

function findMedia(data) {
  return (
    data?.data?.xdt_shortcode_media ||
    data?.data?.shortcode_media ||
    data?.graphql?.shortcode_media ||
    data?.xdt_shortcode_media ||
    data?.shortcode_media ||
    null
  );
}

function parseResponse(raw) {
  const cleaned = String(raw)
    .replace(/^\s*for\s*\(\s*;;\s*\)\s*;\s*/, '')
    .replace(/^\s*while\s*\(\s*1\s*\)\s*;\s*/, '')
    .trim();

  return JSON.parse(cleaned);
}

async function fetchGraphQL(shortcode) {
  const controller = new AbortController();

  const timer = setTimeout(
    () => controller.abort(),
    TIMEOUT
  );

  const variables = {
    shortcode,
    fetch_tagged_user_count: null,
    hoisted_comment_id: null,
    hoisted_reply_id: null
  };

  const body = new URLSearchParams({
    av: '0',
    __d: 'www',
    __user: '0',
    __a: '1',
    __req: 'b',
    __comet_req: '7',
    fb_api_caller_class: 'RelayModern',
    fb_api_req_friendly_name: 'PolarisPostActionLoadPostQueryQuery',
    variables: JSON.stringify(variables),
    server_timestamps: 'true',
    doc_id: DOC_ID
  });

  try {
    const response = await fetch(GRAPHQL_URL, {
      method: 'POST',
      headers: HEADERS,
      body: body.toString(),
      redirect: 'follow',
      signal: controller.signal
    });

    const raw = await response.text();

    let data;

    try {
      data = parseResponse(raw);
    } catch {
      throw new Error(
        `Instagram devolvió una respuesta que no es JSON (HTTP ${response.status}).`
      );
    }

    if (!response.ok) {
      throw new Error(`Instagram respondió HTTP ${response.status}.`);
    }

    if (data?.errors?.length) {
      throw new Error(
        data.errors[0]?.message || 'Error de GraphQL.'
      );
    }

    if (data?.error) {
      throw new Error(
        data.errorDescription ||
        data.errorSummary ||
        `Error de Instagram: ${data.error}`
      );
    }

    return data;
  } finally {
    clearTimeout(timer);
  }
}

function successResult(shortcode, media, post) {
  return {
    status: true,
    platform: 'instagram',
    shortcode,
    id: post?.id || post?.pk || null,
    type: post?.product_type || (
      post?.is_video ? 'video' : 'post'
    ),
    caption:
      post?.caption?.text ||
      post?.edge_media_to_caption?.edges?.[0]?.node?.text ||
      null,
    username:
      post?.owner?.username ||
      post?.user?.username ||
      null,
    total: media.length,
    media
  };
}

export default {
  name: ['test'],
  description: 'Obtiene los datos multimedia de Instagram mediante GraphQL.',
  category: 'owner',
  ownerOnly: true,
  groupOnly: false,

  async run({ args, reply, react }) {
    const safeReact = async emoji => {
      try {
        if (typeof react === 'function') {
          await react(emoji);
        }
      } catch {}
    };

    try {
      const input = Array.isArray(args)
        ? args.join(' ').trim()
        : String(args || '').trim();

      const shortcode = extractShortcode(input);

      if (!shortcode) {
        await safeReact('❌');

        return reply(JSON.stringify({
          status: false,
          platform: 'instagram',
          error: 'Enlace inválido. Envía un enlace /p/, /reel/ o /tv/.'
        }, null, 2));
      }

      await safeReact('🔎');

      const data = await fetchGraphQL(shortcode);
      const post = findMedia(data);

      if (!post) {
        await safeReact('❌');

        return reply(JSON.stringify({
          status: false,
          platform: 'instagram',
          shortcode,
          error: 'GraphQL respondió, pero no encontramos los datos de la publicación.',
          responseKeys: Object.keys(data || {}),
          dataKeys: Object.keys(data?.data || {})
        }, null, 2));
      }

      const media = extractMedia(post);

      if (!media.length) {
        await safeReact('❌');

        return reply(JSON.stringify({
          status: false,
          platform: 'instagram',
          shortcode,
          id: post.id || post.pk || null,
          error: 'Se encontró la publicación, pero no sus URL multimedia.'
        }, null, 2));
      }

      await safeReact('✅');

      return reply(JSON.stringify(
        successResult(shortcode, media, post),
        null,
        2
      ));

    } catch (error) {
      await safeReact('❌');

      return reply(JSON.stringify({
        status: false,
        platform: 'instagram',
        error: error.name === 'AbortError'
          ? 'Tiempo de espera agotado.'
          : error.message || 'Error inesperado.'
      }, null, 2));
    }
  }
};
