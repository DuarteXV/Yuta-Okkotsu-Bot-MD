// ============================================================
//  PLUGIN ANIMEFLV PARA WHATSAPP BOT
//  Base: https://animeflv.or.at (WordPress REST API wp/v2)
// ============================================================

const BASE = 'https://animeflv.or.at';
const UA = 'Mozilla/5.0 (Linux; Android 11; moto g(9) play Build/RPXS31.Q2-58-17-7-3; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/155.0.8059.43 Mobile Safari/537.36';
const TIMEOUT = 15000;
const MAX_MSG = 4000; // límite seguro por mensaje de WhatsApp (4096)
const MAX_PAGINAS = 20;

const USO =
  '📌 *Uso del comando anime:*\n\n' +
  '• `!anime <nombre>` — buscar anime\n' +
  '• `!anime <nombre> <episodio>` — enlaces del episodio (ej: `!anime one piece 3`)\n' +
  '• `!anime ep <slug>` — lista de episodios (ej: `!anime ep one-piece`)\n' +
  '• `!anime links <url>` — enlaces de una página de episodio';

// ============================================================
//  HELPERS DE RED (con reintento)
// ============================================================
async function pedir(url, tipo) { // tipo: 'text' | 'json'
  let ultimoError;
  for (let intento = 0; intento < 2; intento++) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), TIMEOUT);
    try {
      const res = await fetch(url, {
        headers: {
          'User-Agent': UA,
          'Accept': tipo === 'json'
            ? 'application/json'
            : 'text/html,application/json;q=0.9,*/*;q=0.8',
          'Accept-Language': 'es-ES,es;q=0.9'
        },
        signal: ctrl.signal,
        redirect: 'follow'
      });
      if (!res.ok) throw new Error(`HTTP ${res.status} en ${url}`);
      return tipo === 'json' ? await res.json() : await res.text();
    } catch (e) {
      ultimoError = e;
    } finally {
      clearTimeout(t);
    }
  }
  throw ultimoError;
}
const fetchText = (u) => pedir(u, 'text');
const fetchJSON = (u) => pedir(u, 'json');

// igual que fetchJSON pero devuelve null en vez de lanzar (para bucles de paginación)
async function fetchJSONSafe(u) {
  try { return await fetchJSON(u); } catch { return null; }
}

// ============================================================
//  HELPERS DE TEXTO / URL
// ============================================================
function decodeEntidades(s = '') {
  return String(s)
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&apos;|&#039;/g, "'")
    .replace(/&nbsp;/g, ' ');
}

function limpiarHtml(s = '') {
  return decodeEntidades(String(s).replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
}

function hostDe(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return 'Desconocido'; }
}

// Decodifica un valor de data-src: puede ser URL directa, protocol-relative,
// base64 o URL-encoded.
function decodeSrc(valor) {
  if (!valor) return null;
  const v = String(valor).trim();
  if (/^https?:\/\//i.test(v)) return v;
  if (v.startsWith('//')) return 'https:' + v;
  if (/^[A-Za-z0-9+/_=-]{8,}$/.test(v)) {
    try {
      const b64 = v.replace(/-/g, '+').replace(/_/g, '/');
      const decoded = (typeof Buffer !== 'undefined')
        ? Buffer.from(b64, 'base64').toString('utf8')
        : (typeof atob === 'function' ? atob(b64) : null);
      if (decoded && /^https?:\/\//i.test(decoded.trim())) return decoded.trim();
    } catch {}
  }
  try {
    const d = decodeURIComponent(v);
    if (/^https?:\/\//i.test(d)) return d;
  } catch {}
  return null;
}

// ============================================================
//  BÚSQUEDA DE ANIMES
//  Método 1 (verificado en vivo): cada anime = categoría de WP
//  Método 2 (fallback): HTML de /?s=
// ============================================================
async function buscarAnime(nombre) {
  try {
    const cats = await fetchJSON(
      `${BASE}/wp-json/wp/v2/categories?search=${encodeURIComponent(nombre)}` +
      `&exclude=1&per_page=10&_fields=id,name,slug,count`
    );
    if (Array.isArray(cats) && cats.length) {
      return cats.map(c => ({
        id: c.id,
        slug: c.slug,
        titulo: decodeEntidades(c.name),
        count: c.count || 0,
        url: `${BASE}/anime/${c.slug}/`
      }));
    }
  } catch {}

  // Fallback: página de resultados HTML
  const html = await fetchText(`${BASE}/?s=${encodeURIComponent(nombre)}`);
  const resultados = [];
  const vistos = new Set();
  for (const m of html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
    const attrs = m[1];
    const href = (attrs.match(/\bhref="([^"]+)"/i) || [])[1];
    if (!href || !/\/anime\/[^\/?#"]+/i.test(href)) continue;
    const slugRaw = (href.match(/\/anime\/([^\/?#"]+)/i) || [])[1];
    const slug = decodeURIComponent(slugRaw).toLowerCase();
    if (!slug || vistos.has(slug)) continue;
    let titulo = limpiarHtml(m[2]);
    if (!titulo) titulo = limpiarHtml((attrs.match(/\btitle="([^"]*)"/i) || [])[1] || '');
    if (!titulo) titulo = slug.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    vistos.add(slug);
    resultados.push({ id: null, slug, titulo, count: 0, url: new URL(href, BASE).href });
  }
  return resultados;
}

// Resuelve "one-piece" (slug) o "one piece" (nombre) a un solo anime
async function resolverAnime(query) {
  const q = query.trim();
  if (!q) return null;

  if (/^[a-z0-9-]+$/i.test(q)) {
    try {
      const cats = await fetchJSON(
        `${BASE}/wp-json/wp/v2/categories?slug=${encodeURIComponent(q.toLowerCase())}` +
        `&_fields=id,name,slug,count`
      );
      if (Array.isArray(cats) && cats.length) {
        const c = cats[0];
        return { id: c.id, slug: c.slug, titulo: decodeEntidades(c.name), count: c.count || 0, url: `${BASE}/anime/${c.slug}/` };
      }
    } catch {}
  }

  let animes = await buscarAnime(q);
  if (!animes.length && q.includes('-')) animes = await buscarAnime(q.replace(/-/g, ' '));
  return animes.length ? elegirAnime(animes, q) : null;
}

function elegirAnime(animes, query) {
  const q = query.trim().toLowerCase();
  const qSlug = q.replace(/\s+/g, '-');
  return animes.find(a => a.titulo.toLowerCase() === q)
    || animes.find(a => a.slug === qSlug)
    || animes[0];
}

// ============================================================
//  LISTAR EPISODIOS
//  Método 1 (verificado en vivo): posts por categoría del anime
//  Método 2 (fallback): búsqueda por título, filtrado y sin duplicados
// ============================================================
function parseNumero(titulo) {
  const m = String(titulo).match(/episodio\s*(\d+)/i) || String(titulo).match(/\bep\.?\s*(\d+)/i);
  return m ? m[1] : null;
}

async function listarEpisodios(anime) {
  const episodios = [];
  const vistos = new Set();

  const agregar = (p) => {
    const titulo = decodeEntidades(p?.title?.rendered || '');
    const numero = parseNumero(titulo);
    if (!numero || vistos.has(numero)) return;
    vistos.add(numero);
    episodios.push({ numero, titulo, url: p.link });
  };

  // 1) por categoría (rápido y exacto)
  if (anime.id) {
    for (let page = 1; page <= MAX_PAGINAS; page++) {
      const posts = await fetchJSONSafe(
        `${BASE}/wp-json/wp/v2/posts?categories=${anime.id}` +
        `&per_page=100&page=${page}&orderby=date&order=asc&_fields=link,title`
      );
      if (!Array.isArray(posts) || !posts.length) break;
      posts.forEach(agregar);
      if (posts.length < 100) break;
    }
  }

  // 2) fallback por título (solo episodios de ESTE anime)
  if (!episodios.length) {
    const query = (anime.titulo || anime.slug || '').replace(/-/g, ' ').trim();
    if (!query) return episodios;
    const qLow = query.toLowerCase();
    for (let page = 1; page <= MAX_PAGINAS; page++) {
      const posts = await fetchJSONSafe(
        `${BASE}/wp-json/wp/v2/posts?search=${encodeURIComponent(query + ' episodio')}` +
        `&per_page=100&page=${page}&orderby=date&order=asc&_fields=link,title`
      );
      if (!Array.isArray(posts) || !posts.length) break;
      for (const p of posts) {
        const t = decodeEntidades(p?.title?.rendered || '');
        if (t.toLowerCase().startsWith(qLow)) agregar(p);
      }
      if (posts.length < 100) break;
    }
  }

  episodios.sort((a, b) => Number(a.numero) - Number(b.numero));
  return episodios;
}

// ============================================================
//  EXTRACCIÓN DE ENLACES DE LA PÁGINA DEL EPISODIO
// ============================================================
function extraerStreaming(html) {
  const online = [];
  const vistos = new Set();

  const add = (src, nombre) => {
    const url = decodeSrc(src);
    if (!url || vistos.has(url)) return;
    vistos.add(url);
    const nombreLimpio = limpiarHtml(nombre || '').slice(0, 40);
    online.push({ nombre: nombreLimpio || 'Opción', url });
  };

  // 1) bloques .button-container: tooltip (servidor) + botón con data-src
  for (const m of html.matchAll(/<div[^>]*class="[^"]*button-container[^"]*"[^>]*>([\s\S]{0,2000})/gi)) {
    const bloque = m[1];
    const nombre = (bloque.match(/<span[^>]*class="[^"]*tooltip-text[^"]*"[^>]*>([^<]+)<\/span>/i) || [])[1]
      || (bloque.match(/<span[^>]*>([^<]{2,40})<\/span>/i) || [])[1]
      || (bloque.match(/<button[^>]*>([\s\S]*?)<\/button>/i) || [])[1];
    const src = (bloque.match(/\bdata-(?:src|video|url|embed)="([^"]+)"/i) || [])[1]
      || (bloque.match(/<iframe[^>]+src="([^"]+)"/i) || [])[1];
    if (src) add(src, nombre);
  }

  // 2) cualquier botón/enlace con data-src (por si cambia la clase)
  if (!online.length) {
    for (const m of html.matchAll(/<(?:button|a)\b[^>]*\bdata-(?:src|video|url|embed)="([^"]+)"[^>]*>([\s\S]*?)<\/(?:button|a)>/gi)) {
      add(m[1], m[2]);
    }
  }

  // 3) último recurso: iframes del reproductor
  if (!online.length) {
    for (const m of html.matchAll(/<iframe[^>]+src="(https?:[^"]+)"/gi)) add(m[1], 'Reproductor');
  }

  return online;
}

function extraerDescargas(html) {
  const descargas = [];
  const vistos = new Set();

  const add = (d) => {
    if (!d.url || !/^https?:\/\//i.test(d.url) || vistos.has(d.url)) return;
    vistos.add(d.url);
    descargas.push(d);
  };

  const celdasDe = (fragmento) =>
    [...fragmento.matchAll(/<t[hd]\b[^>]*>([\s\S]*?)<\/t[hd]>/gi)].map(c => ({
      texto: limpiarHtml(c[1]),
      href: (c[1].match(/<a[^>]+href="([^"]+)"/i) || [])[1]
    }));

  // 1) tablas de descarga (styled-table o tabla con encabezado SERVIDOR/DESCARGAR)
  for (const m of html.matchAll(/<table\b([^>]*)>([\s\S]*?)<\/table>/gi)) {
    const attrs = m[1];
    const tabla = m[2];
    const primeraFila = (tabla.match(/<tr\b[^>]*>([\s\S]*?)<\/tr>/i) || [])[1] || '';
    const cols = celdasDe(primeraFila).map(c => c.texto.toUpperCase());
    const esTablaDescarga = /styled-table/i.test(attrs)
      || cols.some(c => /SERVIDOR|DESCARGAR|DOWNLOAD/.test(c));
    if (!esTablaDescarga) continue;

    const filas = [...tabla.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)];
    filas.forEach((f, i) => {
      if (i === 0 && cols.length) return; // cabecera
      const celdas = celdasDe(f[1]);
      const conEnlace = celdas.filter(c => c.href && /^https?:\/\//i.test(c.href));
      if (!conEnlace.length || celdas.length < 2) return;

      const obtener = (nombre) => {
        const idx = cols.findIndex(c => c.includes(nombre));
        return idx >= 0 ? (celdas[idx]?.texto || '') : '';
      };
      const url = (celdas.find(c => /DESCARGAR|DOWNLOAD/i.test(c.texto))?.href)
        || conEnlace[0].href;
      const textos = celdas.slice(1).map(c => c.texto).filter(t => t && !/descargar|download/i.test(t));

      add({
        servidor: obtener('SERVIDOR') || celdas[0].texto || hostDe(url),
        tamaño: obtener('TAMAÑO') || textos[0] || '',
        formato: obtener('FORMATO') || textos[1] || '',
        url
      });
    });
    if (descargas.length) break;
  }

  // 2) enlaces con aria-label "Descargar desde X, formato Y"
  if (!descargas.length) {
    for (const m of html.matchAll(/<a[^>]+href="([^"]+)"[^>]*aria-label="Descargar desde ([^"]+), formato ([^"]+)"/gi)) {
      add({ servidor: m[2].trim(), tamaño: '', formato: m[3].trim(), url: m[1] });
    }
  }

  // 3) último recurso: enlaces cuyo texto dice DESCARGAR
  if (!descargas.length) {
    for (const m of html.matchAll(/<a\b[^>]*href="(https?:[^"]+)"[^>]*>([\s\S]*?)<\/a>/gi)) {
      if (/\b(descargar|download)\b/i.test(m[2])) {
        add({ servidor: hostDe(m[1]), tamaño: '', formato: '', url: m[1] });
      }
    }
  }

  return descargas;
}

// ============================================================
//  ENVÍO DE MENSAJES LARGOS (parte en trozos de a 4000)
// ============================================================
async function enviarLargo(ctx, texto) {
  if (!texto) return;
  for (let i = 0; i < texto.length; i += MAX_MSG) {
    const parte = texto.slice(i, i + MAX_MSG);
    if (i === 0) {
      await ctx.reply(parte);
    } else if (ctx.sock?.sendMessage) {
      await ctx.sock.sendMessage(ctx.from || ctx.chat, { text: parte });
    } else {
      await ctx.reply(parte);
    }
  }
}

async function reaccionar(ctx, emoji) {
  try { if (typeof ctx.react === 'function') await ctx.react(emoji); } catch {}
}

// ============================================================
//  MOSTRAR ENLACES DE UN EPISODIO
// ============================================================
async function mostrarEnlaces(ctx, url) {
  const html = await fetchText(url);
  const online = extraerStreaming(html);
  const descargas = extraerDescargas(html);

  if (!online.length && !descargas.length) {
    return ctx.reply(`No encontré enlaces en:\n${url}`);
  }

  let msg = `📥 *Enlaces del episodio*\n${url}\n`;

  if (descargas.length) {
    msg += `\n⬇️ *Descarga:*\n` + descargas.map(d =>
      `• ${d.servidor}${d.tamaño ? ` | ${d.tamaño}` : ''}${d.formato ? ` | ${d.formato}` : ''}\n  ${d.url}`
    ).join('\n') + '\n';
  }

  if (online.length) {
    msg += `\n🎬 *Online:*\n` + online.map(o => `• ${o.nombre}: ${o.url}`).join('\n') + '\n';
  }

  msg += `\n_Algunos servidores requieren abrir la página en el navegador._`;
  await enviarLargo(ctx, msg);
}

// Mostrar lista de episodios (con troceado seguro)
async function mostrarEpisodios(ctx, anime, episodios) {
  const lines = episodios.map(e => `• Ep. ${e.numero}: ${e.titulo}\n  ${e.url}`);
  await enviarLargo(ctx, `*${anime.titulo}* — ${episodios.length} episodios\n\n${lines.join('\n')}`);
}

function numerosDisponibles(episodios) {
  const nums = episodios.map(e => e.numero);
  return nums.length > 40
    ? `${nums.slice(0, 20).join(', ')} … ${nums.slice(-20).join(', ')}`
    : nums.join(', ');
}

// ============================================================
//  EXPORT DEL PLUGIN
// ============================================================
export default {
  name: 'anime',
  commands: ['anime', 'descargar'],

  async run(ctx) {
    try {
      const args = ctx.args || [];
      const text = (ctx.text || '').trim();

      if (!args.length) return ctx.reply(USO);

      const sub = args[0].toLowerCase();

      // --- URL directa: !anime <url> ---
      if (/^https?:\/\//i.test(args[0])) {
        await reaccionar(ctx, '📥');
        return mostrarEnlaces(ctx, args[0]);
      }

      // --- buscar ---
      if (['buscar', 'search'].includes(sub)) {
        const query = args.slice(1).join(' ').trim();
        if (!query) return ctx.reply('Dame un nombre. Ej: `!anime buscar one piece`');
        await reaccionar(ctx, '🔍');

        const animes = await buscarAnime(query);
        if (!animes.length) return ctx.reply(`No encontré animes para "${query}"`);

        const lines = animes.slice(0, 10).map((a, i) =>
          `${i + 1}. *${a.titulo}*\n   slug: \`${a.slug}\`\n   ${a.url}`
        );
        return ctx.reply(
          `*Resultados de "${query}":*\n\n${lines.join('\n\n')}\n\n_Para episodios: *!anime ep <slug>*_`
        );
      }

      // --- episodios ---
      if (['ep', 'episodios', 'eps'].includes(sub)) {
        const query = args.slice(1).join(' ').trim();
        if (!query) return ctx.reply('Dame el nombre o slug. Ej: `!anime ep one-piece`');
        await reaccionar(ctx, '📺');

        const anime = await resolverAnime(query);
        if (!anime) return ctx.reply(`No encontré "${query}"`);

        const episodios = await listarEpisodios(anime);
        if (!episodios.length) return ctx.reply(`No encontré episodios de *${anime.titulo}*.`);

        return mostrarEpisodios(ctx, anime, episodios);
      }

      // --- links directos ---
      if (['links', 'enlaces', 'descargar'].includes(sub)) {
        const url = args.slice(1).join(' ').trim();
        if (!url) return ctx.reply('Dame la URL del episodio. Ej: `!anime links https://animeflv.or.at/...`');
        if (!/^https?:\/\//i.test(url)) return ctx.reply('Eso no parece una URL válida.');
        await reaccionar(ctx, '📥');
        return mostrarEnlaces(ctx, url);
      }

      // --- atajo: !anime <nombre> [episodio] ---
      await reaccionar(ctx, '🔍');

      let query = text;
      let numEpisodio = null;
      if (args.length >= 2 && /^\d+$/.test(args[args.length - 1])) {
        numEpisodio = args[args.length - 1];
        query = args.slice(0, -1).join(' ');
      }
      if (!query.trim()) return ctx.reply(USO);

      const animes = await buscarAnime(query);
      if (!animes.length) return ctx.reply(`No encontré animes para "${query}"`);

      const anime = elegirAnime(animes, query);

      // Sin número de episodio: si hay un único resultado, listamos sus episodios
      if (!numEpisodio) {
        if (animes.length === 1) {
          const episodios = await listarEpisodios(anime);
          if (!episodios.length) return ctx.reply(`No encontré episodios de *${anime.titulo}*.`);
          return mostrarEpisodios(ctx, anime, episodios);
        }
        const lines = animes.slice(0, 5).map((a, i) =>
          `${i + 1}. *${a.titulo}*\n   slug: \`${a.slug}\`\n   ${a.url}`
        );
        return ctx.reply(
          `*Resultados:*\n\n${lines.join('\n\n')}\n\n` +
          `_Episodios: *!anime ep ${anime.slug}*_\n` +
          `_Descarga directa: *!anime <nombre> <episodio>*_`
        );
      }

      const episodios = await listarEpisodios(anime);
      const ep = episodios.find(e => e.numero === numEpisodio);
      if (!ep) {
        return ctx.reply(
          `No encontré el episodio ${numEpisodio} de *${anime.titulo}*.\n` +
          `Disponibles: ${episodios.length ? numerosDisponibles(episodios) : '(ninguno)'}`
        );
      }

      await reaccionar(ctx, '📥');
      await ctx.reply(`📺 ${ep.titulo}\n${ep.url}`);
      return mostrarEnlaces(ctx, ep.url);

    } catch (e) {
      await reaccionar(ctx, '❌');
      await ctx.reply(`⚠️ *Error:* ${e.message}`);
    }
  }
};