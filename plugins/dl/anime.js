// ============================================================
//  PLUGIN ANIMEFLV PARA WHATSAPP BOT
//  Basado en: https://animeflv.or.at (página de episodio #3)
//  Usa la REST API de WordPress /wp-json/wp/v2/posts
// ============================================================

const BASE = 'https://animeflv.or.at';
const UA = 'Mozilla/5.0 (Linux; Android 11; moto g(9) play Build/RPXS31.Q2-58-17-7-3; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/155.0.8059.43 Mobile Safari/537.36';
const TIMEOUT = 15000;

// ---------- helpers ----------
async function fetchText(url) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT);
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': UA, 'Accept': 'text/html,application/json' },
      signal: ctrl.signal,
      redirect: 'follow'
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} en ${url}`);
    return await res.text();
  } finally { clearTimeout(t); }
}

async function fetchJSON(url) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT);
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': UA, 'Accept': 'application/json' },
      signal: ctrl.signal
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} en ${url}`);
    return await res.json();
  } finally { clearTimeout(t); }
}

// ---------- búsqueda de animes ----------
async function buscarAnime(nombre) {
  const html = await fetchText(`${BASE}/?s=${encodeURIComponent(nombre)}`);
  const resultados = [];
  const vistos = new Set();

  const regex = /<a[^>]+href="([^"]*\/anime\/([^\/?#"]+)\/?)"[^>]*>([\s\S]*?)<\/a>/gi;
  for (const m of html.matchAll(regex)) {
    const slug = decodeURIComponent(m[2]).toLowerCase().trim();
    if (!slug || slug === 'anime' || vistos.has(slug)) continue;

    let titulo = m[3].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    if (!titulo) titulo = slug.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

    vistos.add(slug);
    resultados.push({ slug, titulo, url: new URL(m[1], BASE).href });
  }
  return resultados;
}

// ---------- listar episodios vía wp-json ----------
async function listarEpisodios(titulo) {
  const query = titulo.replace(/-/g, ' ').trim();
  const episodios = [];
  let page = 1;
  const perPage = 100;

  while (true) {
    const url = `${BASE}/wp-json/wp/v2/posts` +
      `?search=${encodeURIComponent(query + ' episodio')}` +
      `&per_page=${perPage}&page=${page}&orderby=date&order=asc&_fields=link,title`;

    const posts = await fetchJSON(url);
    if (!Array.isArray(posts) || posts.length === 0) break;

    for (const p of posts) {
      const tituloPost = p.title?.rendered || '';
      const num = (tituloPost.match(/Episodio\s+(\d+)/i) || [])[1];
      if (!num) continue;
      episodios.push({ numero: num, titulo: tituloPost, url: p.link });
    }

    if (posts.length < perPage) break;
    page++;
  }
  return episodios;
}

// ---------- extraer opciones online (iframe) ----------
function extraerStreaming(html) {
  const online = [];
  const bloques = [...html.matchAll(/<div class="button-container">([\s\S]*?)<\/div>/gi)];

  for (const [, bloque] of bloques) {
    const nombre = bloque.match(/<span class="tooltip-text">([^<]+)<\/span>/i)?.[1]?.trim();
    const srcB64 = bloque.match(/<button[^>]*data-src="([^"]+)"/i)?.[1];
    const textoBtn = bloque.match(/<button[^>]*>([\s\S]*?)<\/button>/i)?.[1]?.replace(/<[^>]+>/g, '').trim();

    if (!srcB64) continue;
    try {
      const url = Buffer.from(srcB64, 'base64').toString('utf8');
      if (/^https?:\/\//i.test(url)) {
        online.push({ nombre: nombre || textoBtn || 'Opción', url });
      }
    } catch {}
  }
  return online;
}

// ---------- extraer descargas (tabla styled-table / aria-label) ----------
function extraerDescargas(html) {
  const descargas = [];
  const vistos = new Set();

  // Método 1: tabla .styled-table (verificado en la página real)
  const tablas = [...html.matchAll(/<table[^>]*class="[^"]*styled-table[^"]*"[^>]*>([\s\S]*?)<\/table>/gi)];
  for (const [, tabla] of tablas) {
    const filas = [...tabla.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)];
    for (const [, fila] of filas) {
      const celdas = [...fila.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)]
        .map(m => m[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim());
      const enlace = fila.match(/<a[^>]+href="([^"]+)"/i);
      if (!enlace || celdas.length < 3) continue;

      const url = enlace[1];
      if (!/^https?:\/\//i.test(url) || vistos.has(url)) continue;

      vistos.add(url);
      descargas.push({
        servidor: celdas[0] || 'Desconocido',
        tamaño: celdas[1] || '',
        formato: celdas[2] || '',
        url
      });
    }
    if (descargas.length) break;
  }

  // Método 2: enlaces con aria-label "Descargar desde X, formato Y"
  if (!descargas.length) {
    const enlaces = [...html.matchAll(/<a[^>]+href="([^"]+)"[^>]*aria-label="Descargar desde ([^"]+), formato ([^"]+)"[^>]*>/gi)];
    for (const [, url, servidor, formato] of enlaces) {
      if (!/^https?:\/\//i.test(url) || vistos.has(url)) continue;
      vistos.add(url);
      descargas.push({ servidor: servidor.trim(), tamaño: '', formato: formato.trim(), url });
    }
  }

  return descargas;
}

// ---------- mostrar enlaces de un episodio ----------
async function mostrarEnlaces(ctx, url) {
  const html = await fetchText(url);
  const online = extraerStreaming(html);
  const descargas = extraerDescargas(html);

  if (!online.length && !descargas.length) {
    return ctx.reply(`No encontré enlaces en:\n${url}`);
  }

  let msg = `📥 *Enlaces del episodio*\n${url}\n`;

  if (online.length) {
    msg += `\n🎬 *Online:*\n${online.map(o => `• ${o.nombre}: ${o.url}`).join('\n')}\n`;
  }

  if (descargas.length) {
    msg += `\n⬇️ *Descarga:*\n${descargas.map(d =>
      `• ${d.servidor}${d.tamaño ? ` | ${d.tamaño}` : ''}${d.formato ? ` | ${d.formato}` : ''}\n  ${d.url}`
    ).join('\n')}\n`;
  }

  msg += `\n_Algunos servidores requieren abrir la página en el navegador._`;

  if (msg.length > 4000) {
    await ctx.reply(msg.slice(0, 4000));
    if (msg.length > 4000) {
      await ctx.sock.sendMessage(ctx.from, { text: msg.slice(4000) });
    }
  } else {
    await ctx.reply(msg);
  }
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

      if (!args.length) {
        return ctx.reply(
          '📌 *Uso del comando anime:*\n\n' +
          '• `!anime buscar <nombre>` — buscar animes\n' +
          '• `!anime ep <slug>` — ver episodios\n' +
          '• `!anime links <url>` — enlaces de un episodio\n' +
          '• `!anime <nombre> [episodio]` — atajo (ej: `!anime one piece 3`)'
        );
      }

      const sub = args[0].toLowerCase();

      // --- buscar ---
      if (['buscar', 'search'].includes(sub)) {
        const query = args.slice(1).join(' ').trim();
        if (!query) return ctx.reply('Dame un nombre. Ej: `!anime buscar one piece`');
        await ctx.react('🔍');

        const animes = await buscarAnime(query);
        if (!animes.length) return ctx.reply(`No encontré animes para "${query}"`);

        const lines = animes.slice(0, 10).map((a, i) =>
          `${i + 1}. *${a.titulo}*\n   slug: \`${a.slug}\`\n   ${a.url}`
        );
        return ctx.reply(`*Resultados de "${query}":*\n\n${lines.join('\n\n')}\n\n_Para episodios: *!anime ep <slug>*_`);
      }

      // --- episodios ---
      if (['ep', 'episodios', 'eps'].includes(sub)) {
        const slug = args.slice(1).join(' ').trim();
        if (!slug) return ctx.reply('Dame el slug. Ej: `!anime ep dark-summoner-to-dekiteiru`');
        await ctx.react('📺');

        // Intentamos obtener el título real desde la página del anime
        let titulo = slug.replace(/-/g, ' ');
        try {
          const html = await fetchText(`${BASE}/anime/${slug}/`);
          const h1 = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1]?.replace(/<[^>]+>/g, '').trim();
          if (h1) titulo = h1;
        } catch {}

        const episodios = await listarEpisodios(titulo);
        if (!episodios.length) return ctx.reply(`No encontré episodios para "${slug}"`);

        const lines = episodios.map(e => `• Episodio ${e.numero}: ${e.titulo}\n  ${e.url}`);
        const resp = `*${titulo}* — ${episodios.length} episodios\n\n${lines.join('\n')}`;

        if (resp.length > 4000) {
          await ctx.reply(resp.slice(0, 4000));
          await ctx.sock.sendMessage(ctx.from, { text: resp.slice(4000) });
        } else {
          await ctx.reply(resp);
        }
        return;
      }

      // --- links directos ---
      if (['links', 'enlaces', 'descargar'].includes(sub)) {
        const url = args.slice(1).join(' ').trim();
        if (!url) return ctx.reply('Dame la URL del episodio. Ej: `!anime links https://animeflv.or.at/...`');
        if (!/^https?:\/\//i.test(url)) return ctx.reply('Eso no parece una URL válida.');
        await ctx.react('📥');
        return mostrarEnlaces(ctx, url);
      }

      // --- atajo: !anime <nombre> [episodio] ---
      await ctx.react('🔍');

      let query = text;
      let numEpisodio = null;

      if (args.length >= 2 && /^\d+$/.test(args[args.length - 1])) {
        numEpisodio = args[args.length - 1];
        query = args.slice(0, -1).join(' ');
      }

      const animes = await buscarAnime(query);
      if (!animes.length) return ctx.reply(`No encontré animes para "${query}"`);

      const anime = animes[0];

      if (!numEpisodio) {
        const lines = animes.slice(0, 5).map((a, i) =>
          `${i + 1}. *${a.titulo}*\n   ${a.url}`
        );
        return ctx.reply(
          `*Resultados:*\n\n${lines.join('\n\n')}\n\n` +
          `_Para ver episodios: *!anime ep ${anime.slug}*_\n` +
          `_Para enlaces directos: *!anime <nombre> <episodio>*_`
        );
      }

      const episodios = await listarEpisodios(anime.titulo);
      const ep = episodios.find(e => e.numero === numEpisodio);
      if (!ep) {
        return ctx.reply(
          `No encontré el episodio ${numEpisodio} de *${anime.titulo}*.\n` +
          `Disponibles: ${episodios.map(e => e.numero).join(', ')}`
        );
      }

      await ctx.reply(`📺 ${ep.titulo}\n${ep.url}`);
      return mostrarEnlaces(ctx, ep.url);

    } catch (e) {
      await ctx.react('❌');
      await ctx.reply(`⚠️ *Error:* ${e.message}`);
    }
  }
};