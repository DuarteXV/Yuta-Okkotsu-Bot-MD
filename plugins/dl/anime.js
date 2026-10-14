import axios from 'axios'

const BASE = 'https://animeflv.or.at/'
const UA =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/131.0 Safari/537.36'

const sessions = new Map()

const decode = value =>
  String(value ?? '').replace(
    /&(#x[\da-f]+|#\d+|[a-z]+);/gi,
    (full, entity) => {
      if (entity.startsWith('#')) {
        const n = entity[1]?.toLowerCase() === 'x'
          ? parseInt(entity.slice(2), 16)
          : parseInt(entity.slice(1), 10)

        return n > 0 && n <= 0x10ffff
          ? String.fromCodePoint(n)
          : full
      }

      return ({
        amp: '&', quot: '"', apos: "'", nbsp: ' ',
        lt: '<', gt: '>', ndash: '–', mdash: '—',
        hellip: '…'
      })[entity.toLowerCase()] ?? full
    }
  )

const clean = html =>
  decode(String(html ?? '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim())

const attr = (html, name) =>
  decode(
    String(html ?? '').match(
      new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, 'i')
    )?.slice(1).find(Boolean) ?? ''
  )

const element = (html, name, cls) =>
  html.match(
    new RegExp(
      `<${name}\\b(?=[^>]*\\bclass\\s*=\\s*["'][^"']*\\b${cls}\\b)[^>]*>([\\s\\S]*?)<\\/${name}>`,
      'i'
    )
  )?.[1] ?? ''

const tag = (html, name, cls) =>
  html.match(
    new RegExp(
      `<${name}\\b(?=[^>]*\\bclass\\s*=\\s*["'][^"']*\\b${cls}\\b)[^>]*>`,
      'i'
    )
  )?.[0] ?? ''

const absolute = (value, base = BASE) => {
  try {
    const url = new URL(decode(value), base)
    return ['http:', 'https:'].includes(url.protocol)
      ? url.href
      : null
  } catch {
    return null
  }
}

const request = async url => {
  const target = new URL(url, BASE)

  if (target.origin !== new URL(BASE).origin) {
    throw new Error('URL fuera del sitio configurado.')
  }

  const { data } = await axios.get(target.href, {
    timeout: 20000,
    maxRedirects: 5,
    headers: {
      'user-agent': UA,
      'accept-language': 'es-419,es;q=0.9',
      accept: 'text/html,application/xhtml+xml'
    }
  })

  if (typeof data !== 'string' || !/<html\b/i.test(data)) {
    throw new Error('Respuesta HTML inválida.')
  }

  return data
}

const search = async query => {
  const url = new URL(BASE)
  url.searchParams.set('s', query)

  const html = await request(url.href)

  const pattern =
    /<div\b[^>]*class=["'][^"']*\bsearch-series-card\b[^"']*["'][^>]*>\s*<a\b([^>]+)>([\s\S]*?)<\/a>/gi

  const results = [...html.matchAll(pattern)]
    .map(([, link, body]) => ({
      title: clean(element(body, 'h2', 'entry-title')),
      url: absolute(attr(link, 'href')),
      poster: absolute(attr(tag(body, 'img', 'anime-image'), 'src'))
    }))
    .filter(item => item.title && item.url)

  return [...new Map(results.map(item => [item.url, item])).values()]
}

const details = async url => {
  const html = await request(url)
  const title = clean(element(html, 'h1', 'anime-title'))

  if (!title) throw new Error('No se encontró la ficha del anime.')

  const raw = html.match(
    /<script\b(?=[^>]*\bclass\s*=\s*["'][^"']*\banimeflv-episodes-data\b)[^>]*>([\s\S]*?)<\/script>/i
  )?.[1]

  let episodes = []

  try {
    const data = JSON.parse(raw || '[]')

    if (Array.isArray(data)) {
      episodes = data
        .filter(ep => Number.isFinite(Number(ep.number)) && absolute(ep.permalink))
        .map(ep => ({
          number: Number(ep.number),
          url: absolute(ep.permalink)
        }))
        .sort((a, b) => a.number - b.number)
    }
  } catch {}

  return {
    title,
    url,
    synopsis: clean(element(html, 'div', 'anime-synopsis')),
    genres: [
      ...element(html, 'div', 'anime-genres').matchAll(
        /<span\b[^>]*class=["'][^"']*\bgenre-tag\b[^"']*["'][^>]*>([\s\S]*?)<\/span>/gi
      )
    ].map(([, value]) => clean(value)),
    episodes
  }
}

export default {
  name: ['animedl'],
  description: 'Busca anime y consulta episodios',
  category: 'dl',
  ownerOnly: false,

  async run({ from, react, reply, text }) {
    try {
      const input = String(text || '').trim()

      if (!input) {
        return reply(
          'Uso: .animedl nombre del anime\n' +
          'También puedes consultar una ficha usando su URL.'
        )
      }

      await react('🔍')

      // Si se proporciona una URL de ficha, listar episodios.
      if (/^https:\/\/animeflv\.or\.at\//i.test(input)) {
        const data = await details(input)

        sessions.set(from, {
          stage: 'episodes',
          title: data.title,
          items: data.episodes
        })

        const list = data.episodes.slice(0, 40)
          .map((ep, i) => `${i + 1}. Episodio ${ep.number}`)
          .join('\n')

        await react('✅')

        return reply(
          `「 ${data.title} 」\n\n` +
          `${data.synopsis || 'Sin sinopsis disponible.'}\n\n` +
          `Géneros: ${data.genres.join(', ') || 'N/D'}\n\n` +
          `${list || 'No se encontraron episodios.'}\n\n` +
          'Usa la URL de un episodio para consultar sus enlaces.'
        )
      }

      const results = await search(input)

      if (!results.length) {
        await react('❌')
        return reply('No encontré resultados.')
      }

      sessions.set(from, {
        stage: 'results',
        items: results.slice(0, 10)
      })

      const list = results.slice(0, 10)
        .map((item, i) => `${i + 1}. ${item.title}\n${item.url}`)
        .join('\n\n')

      await react('✅')

      return reply(
        `「 ANIMEDL 」\n\n${list}\n\n` +
        'Copia la URL de la ficha para ver sus episodios.'
      )
    } catch (error) {
      console.error('[animedl]', error)
      await react('❌')
      return reply(`Error: ${error.message}`)
    }
  }
}