
const SAVEFROM = 'https://es.savefrom.net';
const WORKER = 'https://worker.savefrom.net/savefrom.php';

const TIMEOUT = 30000;
const MAX_PREVIEW = 1200;

const UA =
  'Mozilla/5.0 (Linux; Android 11; moto g(9) play Build/RPXS31.Q2-58-17-7-3; wv) ' +
  'AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/157.0.8103.40 Mobile Safari/537.36';

const HEADERS = {
  'User-Agent': UA,
  'Accept-Language': 'es-CO,es;q=0.9',
};

const RE_URL =
  /instagram\.com\/(p|reel|reels|tv)\/([A-Za-z0-9_-]+)/i;

function obtenerEntrada(args) {
  return String(args?.join(' ') || '').trim();
}

function extraerShortcode(entrada) {
  if (!entrada) return null;

  const match = entrada.match(RE_URL);

  if (match) {
    const ruta = match[1].toLowerCase();

    return {
      shortcode: match[2],
      tipoRuta: ruta === 'p' ? 'p' : ruta === 'tv' ? 'tv' : 'reel',
      url: `https://www.instagram.com/${ruta}/${match[2]}/`,
    };
  }

  if (/^[A-Za-z0-9_-]{5,20}$/.test(entrada)) {
    return {
      shortcode: entrada,
      tipoRuta: 'reel',
      url: `https://www.instagram.com/reel/${entrada}/`,
    };
  }

  return null;
}

function extraerCookies(headers) {
  const raw = headers.get('set-cookie');

  if (!raw) return '';

  return raw
    .split(/,(?=[^;,]+=)/)
    .map(cookie => cookie.split(';')[0])
    .filter(Boolean)
    .join('; ');
}

function extraerCampos(html) {
  const campos = {};

  const regex =
    /<input\b[^>]*name=["']([^"']+)["'][^>]*value=["']([^"']*)["'][^>]*>/gi;

  for (const match of html.matchAll(regex)) {
    campos[match[1]] = match[2];
  }

  return campos;
}

function extraerEnlaces(texto) {
  const encontrados = new Set();

  const regex =
    /https?:\\?\/\\?\/[^"'\\\s<>]+/gi;

  for (const match of texto.matchAll(regex)) {
    let url = match[0]
      .replace(/\\u0026/g, '&')
      .replace(/\\\//g, '/')
      .replace(/&amp;/g, '&')
      .replace(/\\x26/g, '&')
      .replace(/[\\]+$/g, '')
      .replace(/[),;]+$/g, '');

    try {
      const parsed = new URL(url);

      if (
        parsed.hostname === 'media.sf-converter.com' &&
        parsed.pathname === '/get'
      ) {
        encontrados.add(parsed.href);
      }
    } catch {}
  }

  return [...encontrados];
}

async function obtenerPagina(cookieJar) {
  const response = await fetch(
    `${SAVEFROM}/25-instagram-reels-download-2cR.html`,
    {
      headers: {
        ...HEADERS,
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
      redirect: 'follow',
      signal: AbortSignal.timeout(TIMEOUT),
    }
  );

  const html = await response.text();

  const cookies = extraerCookies(response.headers);

  if (cookies) {
    cookieJar.push(cookies);
  }

  if (!response.ok) {
    throw new Error(`SaveFrom respondió HTTP ${response.status} al abrir la página.`);
  }

  return {
    html,
    cookies: cookieJar.join('; '),
    status: response.status,
  };
}

async function consultarSaveFrom(url) {
  const cookieJar = [];

  const pagina = await obtenerPagina(cookieJar);
  const campos = extraerCampos(pagina.html);

  const ts = Date.now();

  const body = new URLSearchParams({
    ...campos,
    sf_url: url,
    sf_submit: '',
    new: '2',
    lang: 'es',
    app: '',
    country: 'co',
    os: 'Android',
    browser: 'Chrome WebView',
    channel: 'article',
    'sf-nomad': '1',
    url,
    ts: String(ts),
  });

  const response = await fetch(WORKER, {
    method: 'POST',
    headers: {
      ...HEADERS,
      Accept: 'application/json, text/plain, */*',
      'Content-Type': 'application/x-www-form-urlencoded',
      Origin: SAVEFROM,
      Referer: `${SAVEFROM}/25-instagram-reels-download-2cR.html`,
      Cookie: pagina.cookies,
    },
    body,
    redirect: 'follow',
    signal: AbortSignal.timeout(TIMEOUT),
  });

  const texto = await response.text();

  const enlaces = extraerEnlaces(texto);

  return {
    status: response.status,
    contentType: response.headers.get('content-type'),
    length: texto.length,
    isJavaScript: texto.trim().startsWith('/*js-response*/'),
    enlaces,
    preview: texto.slice(0, MAX_PREVIEW),
  };
}

export default {
  name: ['test'],
  description: 'Prueba el scraper de Instagram mediante SaveFrom.',
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

    try {
      if (typeof react === 'function') {
        await react('⏳');
      }

      const resultado = await consultarSaveFrom(datos.url);

      if (resultado.status !== 200) {
        return responder({
          ok: false,
          platform: 'instagram',
          provider: 'savefrom',
          shortcode: datos.shortcode,
          status: resultado.status,
          error: 'SaveFrom no aceptó la petición.',
          diagnostic: {
            contentType: resultado.contentType,
            responseLength: resultado.length,
            preview: resultado.preview,
          },
        });
      }

      if (resultado.enlaces.length) {
        return responder({
          ok: true,
          platform: 'instagram',
          provider: 'savefrom',
          shortcode: datos.shortcode,
          total: resultado.enlaces.length,
          media: resultado.enlaces.map(url => ({
            type: 'video',
            format: 'mp4',
            url,
          })),
        });
      }

      return responder({
        ok: false,
        platform: 'instagram',
        provider: 'savefrom',
        shortcode: datos.shortcode,
        status: resultado.status,
        error: resultado.isJavaScript
          ? 'SaveFrom respondió con JavaScript. Todavía falta procesar su respuesta para obtener el enlace MP4.'
          : 'No se encontró ningún enlace MP4 en la respuesta.',
        diagnostic: {
          contentType: resultado.contentType,
          responseLength: resultado.length,
          isJavaScript: resultado.isJavaScript,
          linksFound: resultado.enlaces.length,
          preview: resultado.preview,
        },
      });

    } catch (error) {
      return responder({
        ok: false,
        platform: 'instagram',
        provider: 'savefrom',
        shortcode: datos.shortcode,
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
