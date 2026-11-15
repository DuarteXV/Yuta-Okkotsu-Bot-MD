
const IG = 'https://www.instagram.com';
const TIMEOUT = 30000;
const MAX_VIDEOS = 20;

const UA =
  'Mozilla/5.0 (Linux; Android 11; moto g(9) play Build/RPXS31.Q2-58-17-7-3; wv) ' +
  'AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/157.0.8103.40 Mobile Safari/537.36';

const HEADERS = {
  'User-Agent': UA,
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'es-CO,es;q=0.9',
};

const RE_URL = /instagram\.com\/(p|reel|reels|tv)\/([A-Za-z0-9_-]+)/i;

const RE_VERSIONS =
  /"video_versions"\s*:\s*(\[.*?\])\s*,\s*"is_dash_eligible"/gs;

const RE_DASH =
  /"video_dash_manifest"\s*:\s*"((?:[^"\\]|\\.)*)"/s;

const RE_VIDEO_URL =
  /"video_url"\s*:\s*"((?:[^"\\]|\\.)*)"/s;

function obtenerEntrada(args) {
  return String(args?.join(' ') || '').trim();
}

function extraerShortcode(entrada) {
  if (!entrada) return null;

  const match = entrada.match(RE_URL);

  if (match) {
    return {
      shortcode: match[2],
      tipoRuta: match[1].toLowerCase() === 'p'
        ? 'p'
        : match[1].toLowerCase() === 'tv'
          ? 'tv'
          : 'reel',
    };
  }

  if (/^[A-Za-z0-9_-]{5,20}$/.test(entrada)) {
    return {
      shortcode: entrada,
      tipoRuta: 'reel',
    };
  }

  return null;
}

async function obtenerHTML(shortcode, tipoRuta) {
  const url = `${IG}/${tipoRuta}/${shortcode}/`;

  const response = await fetch(url, {
    method: 'GET',
    headers: HEADERS,
    redirect: 'follow',
    signal: AbortSignal.timeout(TIMEOUT),
  });

  const html = await response.text();

  return {
    url,
    status: response.status,
    html,
  };
}

function decodificarString(valor) {
  try {
    return JSON.parse(`"${valor}"`);
  } catch {
    return null;
  }
}

function limpiarURL(url) {
  if (typeof url !== 'string') return null;

  try {
    const parsed = new URL(
      url.replace(/&amp;/g, '&')
    );

    const host = parsed.hostname.toLowerCase();

    const permitido =
      host === 'cdninstagram.com' ||
      host.endsWith('.cdninstagram.com') ||
      host === 'fbcdn.net' ||
      host.endsWith('.fbcdn.net');

    if (!permitido) return null;

    return parsed.href;
  } catch {
    return null;
  }
}

function extraerVersiones(html) {
  let mejores = [];

  RE_VERSIONS.lastIndex = 0;

  for (const match of html.matchAll(RE_VERSIONS)) {
    try {
      const versiones = JSON.parse(match[1]);

      if (
        Array.isArray(versiones) &&
        versiones.length > mejores.length
      ) {
        mejores = versiones;
      }
    } catch {}
  }

  return mejores
    .map(video => ({
      tipo: video.type ?? null,
      ancho: video.width ?? null,
      alto: video.height ?? null,
      url: limpiarURL(video.url),
    }))
    .filter(video => video.url)
    .slice(0, MAX_VIDEOS);
}

function extraerDASH(html) {
  const match = html.match(RE_DASH);

  if (!match) return null;

  return decodificarString(match[1]);
}

function extraerVideoURL(html) {
  const match = html.match(RE_VIDEO_URL);

  if (!match) return null;

  return limpiarURL(decodificarString(match[1]));
}

function extraerMedios(html) {
  const versiones = extraerVersiones(html);

  const dash = extraerDASH(html);

  if (versiones.length) {
    return {
      tipo: 'video',
      medios: versiones,
      dash_manifest: dash
        ? dash.slice(0, 200)
        : null,
    };
  }

  const videoURL = extraerVideoURL(html);

  if (videoURL) {
    return {
      tipo: 'video',
      medios: [{
        tipo: null,
        ancho: null,
        alto: null,
        url: videoURL,
      }],
      dash_manifest: dash
        ? dash.slice(0, 200)
        : null,
    };
  }

  return {
    tipo: null,
    medios: [],
    dash_manifest: null,
  };
}

export default {
  name: ['test'],
  description: 'Extrae las URL directas de vídeos de Instagram.',
  category: 'owner',
  ownerOnly: true,
  groupOnly: false,

  async run({ sock, from, msg, args, reply, react }) {
    const entrada = obtenerEntrada(args);
    const datos = extraerShortcode(entrada);

    const responder = async objeto => {
      const json = JSON.stringify(objeto, null, 2);

      if (typeof reply === 'function') {
        return reply(json);
      }

      return sock.sendMessage(
        from,
        { text: json },
        { quoted: msg }
      );
    };

    if (!datos) {
      return responder({
        ok: false,
        platform: 'instagram',
        error: 'URL o shortcode inválido.',
        example: '.test https://www.instagram.com/reel/SHORTCODE/',
      });
    }

    const { shortcode, tipoRuta } = datos;

    try {
      if (typeof react === 'function') {
        await react('⏳');
      }

      const resultado = await obtenerHTML(
        shortcode,
        tipoRuta
      );

      if (resultado.status !== 200) {
        return responder({
          ok: false,
          platform: 'instagram',
          shortcode,
          status: resultado.status,
          error: `Instagram respondió HTTP ${resultado.status}.`,
        });
      }

      const extraido = extraerMedios(resultado.html);

      if (!extraido.medios.length) {
        return responder({
          ok: false,
          platform: 'instagram',
          shortcode,
          status: resultado.status,
          error: 'No se encontraron video_versions ni video_url en el HTML.',
          diagnostic: {
            htmlLength: resultado.html.length,
            hasVideoVersions: /"video_versions"/.test(resultado.html),
            hasVideoUrl: /"video_url"/.test(resultado.html),
            hasDashManifest: /"video_dash_manifest"/.test(resultado.html),
          },
        });
      }

      return responder({
        ok: true,
        platform: 'instagram',
        shortcode,
        type: extraido.tipo,
        total: extraido.medios.length,
        media: extraido.medios,
        dash_manifest: extraido.dash_manifest,
      });

    } catch (error) {
      return responder({
        ok: false,
        platform: 'instagram',
        shortcode,
        error: String(error?.message || error),
      });
    } finally {
      if (typeof react === 'function') {
        try {
          await react('✅');
        } catch {}
      }
    }
  },
};
