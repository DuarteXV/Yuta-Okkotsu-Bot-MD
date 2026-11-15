
const IG = 'https://www.instagram.com';
const TIMEOUT = 20000;
const MAX_MEDIA = 20;

const UA =
  'Mozilla/5.0 (Linux; Android 11; moto g(9) play Build/RPXS31.Q2-58-17-7-3; wv) ' +
  'AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/157.0.8103.40 Mobile Safari/537.36';

const ACCEPT =
  'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8';

const HEADERS = {
  'user-agent': UA,
  accept: ACCEPT,
  dpr: '2.012500047683716',
  'viewport-width': '980',
};

const RE_URL = /instagram\.com\/(p|reel|reels|tv)\/([A-Za-z0-9_-]+)/i;
const RE_SCRIPT = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;

function obtenerEntrada(args, text) {
  return String(text || args?.join(' ') || '').trim();
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
    return { shortcode: entrada, tipoRuta: 'reel' };
  }

  return null;
}

async function obtenerCookiesAnonimas() {
  try {
    const response = await fetch(`${IG}/`, {
      headers: HEADERS,
      redirect: 'follow',
      signal: AbortSignal.timeout(15000),
    });

    const cookies = typeof response.headers.getSetCookie === 'function'
      ? response.headers.getSetCookie()
      : (response.headers.get('set-cookie') || '')
          .split(/,(?=\s*[A-Za-z0-9_-]+=)/);

    return cookies
      .map(cookie => cookie.split(';')[0].trim())
      .filter(Boolean)
      .join('; ');
  } catch {
    return '';
  }
}

async function obtenerHTML(shortcode, tipoRuta, cookies) {
  const url = `${IG}/${tipoRuta}/${shortcode}/`;
  const headers = { ...HEADERS };

  if (cookies) headers.cookie = cookies;

  const response = await fetch(url, {
    headers,
    redirect: 'follow',
    signal: AbortSignal.timeout(TIMEOUT),
  });

  return {
    url,
    status: response.status,
    html: await response.text(),
  };
}

function* obtenerScriptsJSON(html) {
  RE_SCRIPT.lastIndex = 0;

  let match;

  while ((match = RE_SCRIPT.exec(html)) !== null) {
    const atributos = match[1] || '';

    if (!/data-sjs/i.test(atributos)) continue;
    if (!/application\/json/i.test(atributos)) continue;

    const contenido = (match[2] || '').trim();
    if (!contenido) continue;

    try {
      yield JSON.parse(contenido);
    } catch {}
  }
}

function recorrer(nodo, visitar, vistos = new Set()) {
  if (!nodo || typeof nodo !== 'object' || vistos.has(nodo)) return;

  vistos.add(nodo);

  if (Array.isArray(nodo)) {
    for (const elemento of nodo) {
      recorrer(elemento, visitar, vistos);
    }
    return;
  }

  visitar(nodo);

  for (const clave of Object.keys(nodo)) {
    recorrer(nodo[clave], visitar, vistos);
  }
}

function mejorVideo(lista) {
  if (!Array.isArray(lista)) return null;

  return lista
    .filter(item => item && typeof item.url === 'string')
    .sort((a, b) =>
      ((b.width || 0) * (b.height || 0)) -
      ((a.width || 0) * (a.height || 0))
    )[0] || null;
}

function mejorImagen(lista) {
  if (!Array.isArray(lista)) return null;

  return lista
    .filter(item => item && typeof item.url === 'string')
    .sort((a, b) =>
      ((b.width || 0) * (b.height || 0)) -
      ((a.width || 0) * (a.height || 0))
    )[0] || null;
}

function limpiarURL(url) {
  if (typeof url !== 'string') return null;

  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();

    const permitido =
      host === 'cdninstagram.com' ||
      host.endsWith('.cdninstagram.com') ||
      host === 'fbcdn.net' ||
      host.endsWith('.fbcdn.net');

    if (!permitido) return null;
    if (/\/(?:rsrc\.php|static)\//i.test(parsed.pathname)) return null;

    return parsed.href;
  } catch {
    return null;
  }
}

function obtenerItem(nodo) {
  if (!nodo || typeof nodo !== 'object') return null;

  const video = mejorVideo(nodo.video_versions);
  const imagen = mejorImagen(nodo.image_versions2?.candidates);

  if (video) {
    const url = limpiarURL(video.url);
    if (!url) return null;

    return {
      tipo: 'video',
      url,
      ancho: video.width ?? null,
      alto: video.height ?? null,
      imagen_previa: limpiarURL(imagen?.url),
    };
  }

  if (imagen) {
    const url = limpiarURL(imagen.url);
    if (!url) return null;

    return {
      tipo: 'imagen',
      url,
      ancho: imagen.width ?? null,
      alto: imagen.height ?? null,
    };
  }

  return null;
}

function extraerMedios(html) {
  const meta = {
    code: null,
    media_id: null,
    autor: null,
    typename: null,
  };

  const medios = [];
  const urlsVistas = new Set();
  let carrusel = null;

  function agregar(item) {
    if (!item?.url || urlsVistas.has(item.url)) return;
    if (medios.length >= MAX_MEDIA) return;

    urlsVistas.add(item.url);
    medios.push(item);
  }

  for (const payload of obtenerScriptsJSON(html)) {
    recorrer(payload, nodo => {
      if (!nodo || typeof nodo !== 'object') return;

      if (
        nodo.__typename?.startsWith?.('XIGPolaris') ||
        nodo.if_not_gated_logged_out != null
      ) {
        meta.code ||= typeof nodo.code === 'string' ? nodo.code : null;
        meta.media_id ||= nodo.media_id != null ? String(nodo.media_id) : null;
        meta.autor ||= nodo.user?.username || null;
        meta.typename ||= nodo.__typename || null;

        if (
          !carrusel &&
          Array.isArray(nodo.carousel_media) &&
          nodo.carousel_media.length
        ) {
          carrusel = nodo.carousel_media;
        }
      }

      if (nodo.video_versions || nodo.image_versions2) {
        agregar(obtenerItem(nodo));
      }
    });
  }

  if (carrusel?.length) {
    const elementos = carrusel
      .map(obtenerItem)
      .filter(Boolean)
      .slice(0, MAX_MEDIA);

    if (elementos.length) {
      return { meta, tipo: 'carrusel', medios: elementos };
    }
  }

  if (medios.length) {
    return {
      meta,
      tipo: medios.length > 1 ? 'carrusel' : medios[0].tipo,
      medios,
    };
  }

  const og = html.match(
    /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i
  );

  if (og) {
    const url = limpiarURL(og[1].replace(/&amp;/g, '&'));

    if (url) {
      return {
        meta,
        tipo: 'imagen',
        medios: [{
          tipo: 'imagen',
          url,
          ancho: null,
          alto: null,
        }],
      };
    }
  }

  return { meta, tipo: null, medios: [] };
}

export default {
  name: ['test'],
  description: 'Extrae URLs multimedia de publicaciones públicas de Instagram.',
  category: 'owner',
  ownerOnly: true,
  groupOnly: false,

  async run({ sock, from, msg, args, reply, react }) {
    const entrada = obtenerEntrada(args);
    const datos = extraerShortcode(entrada);

    const responder = async objeto => {
      const json = JSON.stringify(objeto, null, 2);

      if (typeof reply === 'function') return reply(json);

      return sock.sendMessage(from, { text: json }, { quoted: msg });
    };

    if (!datos) {
      return responder({
        ok: false,
        platform: 'instagram',
        error: 'URL o shortcode inválido.',
        ejemplo: '.test https://www.instagram.com/reel/SHORTCODE/',
      });
    }

    const { shortcode, tipoRuta } = datos;

    try {
      if (typeof react === 'function') await react('⏳');

      const cookies = await obtenerCookiesAnonimas();
      const resultado = await obtenerHTML(shortcode, tipoRuta, cookies);

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
          error: 'No se encontraron datos multimedia en el HTML.',
          diagnostic: {
            htmlLength: resultado.html.length,
            hasDataSjs: /data-sjs/i.test(resultado.html),
            hasPolaris: /xig_polaris_media|XIGPolaris/i.test(resultado.html),
            possibleLoginWall: /login_required|accounts\/login/i.test(resultado.html),
          },
        });
      }

      return responder({
        ok: true,
        platform: 'instagram',
        shortcode: extraido.meta.code || shortcode,
        type: extraido.tipo,
        author: extraido.meta.autor,
        media_id: extraido.meta.media_id,
        typename: extraido.meta.typename,
        total: extraido.medios.length,
        media: extraido.medios,
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
