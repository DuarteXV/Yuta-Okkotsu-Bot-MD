import axios from 'axios'

const BASE = 'https://animeflv.or.at/'
const UA =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/131.0 Safari/537.36'

const MAX_RESULTS = 10
const MAX_EPISODES = 30
const MAX_FILE_MB = 80

const sessions = new Map()

const decode = value =>
  String(value ?? '').replace(
    /&(#x[\da-f]+|#\d+|[a-z]+);/gi,
    (full, entity) => {
      if (entity.startsWith('#')) {
        const code = entity[1]?.toLowerCase() === 'x'
          ? parseInt(entity.slice(2), 16)
          : parseInt(entity.slice(1), 10)

        return Number.isInteger(code) &&
          code > 0 &&
          code <= 0x10ffff
          ? String.fromCodePoint(code)
          : full
      }

      return ({
        amp: '&',
        quot: '"',
        apos: "'",
        nbsp: ' ',
        lt: '<',
        gt: '>',
        ndash: '–',
        mdash: '—',
        hellip: '…'
      })[entity.toLowerCase()] ?? full
    }
  )

const clean = html =>
  decode(String(html ?? '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim())

const attr = (html, name) => {
  const match = String(html ?? '').match(
    new RegExp(
      `\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`,
      'i'
    )
  )

  return decode(match?.[1] ?? match?.[2] ?? '')
}

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

const absolute = (input, base = BASE) => {
  if (!input) return null

  try {
    const url = new URL(decode(input), base)

    return ['http:', 'https:'].includes(url.protocol)
      ? url.href
      : null
  } catch {
    return null
  }
}

const unique = (items, key = 'url') =>
  [...new Map(
    items
      .filter(item => item[key])
      .map(item => [item[key], item])
  ).values()]

const cleanFileName = name =>
  String(name)
    .replace(/[\\/:*?"<>|]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 100) || 'anime'

const getPage = async url => {
  const response = await axios.get(url, {
    timeout: 20000,
    maxRedirects: 5,
    headers: {
      'user-agent': UA,
      'accept-language': 'es-419,es;q=0.9',
      accept: 'text/html,application/xhtml+xml'
    }
  })

  if (typeof response.data !== 'string') {
    throw new Error('La página no devolvió HTML.')
  }

  return response.data
}

const searchAnime = async query => {
  const url = new URL(BASE)
  url.searchParams.set('s', query)

  const html = await getPage(url.href)

  const pattern =
    /<div\b[^>]*class=["'][^"']*\bsearch-series-card\b[^"']*["'][^>]*>\s*<a\b([^>]+)>([\s\S]*?)<\/a>/gi

  const results = [...html.matchAll(pattern)]
    .map(([, link, body]) => ({
      title: clean(element(body, 'h2', 'entry-title')),
      url: absolute(attr(link, 'href')),
      poster: absolute(
        attr(tag(body, 'img', 'anime-image'), 'src')
      )
    }))
    .filter(item => item.title && item.url)

  return unique(results)
}

const parseEpisodes = html => {
  const raw = html.match(
    /<script\b(?=[^>]*\bclass\s*=\s*["'][^"']*\banimeflv-episodes-data\b)[^>]*>([\s\S]*?)<\/script>/i
  )?.[1]

  if (!raw) return []

  try {
    const entries = JSON.parse(raw)

    if (!Array.isArray(entries)) return []

    return entries
      .filter(item =>
        Number.isFinite(Number(item.number)) &&
        absolute(item.permalink)
      )
      .map(item => ({
        number: Number(item.number),
        url: absolute(item.permalink),
        id: item.post_id ?? null
      }))
      .sort((a, b) => a.number - b.number)
  } catch {
    return []
  }
}

const getDetails = async input => {
  const url = new URL(input)

  if (url.origin !== new URL(BASE).origin) {
    throw new Error('La ficha debe pertenecer al sitio configurado.')
  }

  const html = await getPage(url.href)
  const title = clean(element(html, 'h1', 'anime-title'))

  if (!title) {
    throw new Error('No se encontró una ficha de anime.')
  }

  const synopsis = clean(
    element(html, 'div', 'anime-synopsis')
      .replace(/^\s*<h3[^>]*>[\s\S]*?<\/h3>/i, '')
  )

  const genres = [
    ...element(html, 'div', 'anime-genres').matchAll(
      /<span\b[^>]*class=["'][^"']*\bgenre-tag\b[^"']*["'][^>]*>([\s\S]*?)<\/span>/gi
    )
  ].map(([, name]) => clean(name))

  return {
    title,
    url: url.href,
    poster: absolute(
      attr(tag(html, 'img', 'poster-image'), 'src')
    ),
    synopsis,
    rating:
      Number.parseFloat(
        clean(element(html, 'div', 'rating-score'))
      ) || null,
    genres,
    episodes: parseEpisodes(html)
  }
}

// Comprueba si la URL devuelve un vídeo directo.
// No descarga ni transforma manifiestos de streaming.
const inspectVideo = async url => {
  const parsed = new URL(url)

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('Protocolo no permitido.')
  }

  const response = await axios.get(parsed.href, {
    responseType: 'stream',
    timeout: 15000,
    maxRedirects: 5,
    headers: {
      'user-agent': UA,
      range: 'bytes=0-0'
    },
    validateStatus: status =>
      status === 200 || status === 206
  })

  const type = String(
    response.headers['content-type'] || ''
  ).toLowerCase()

  const length = Number(
    response.headers['content-length'] || 0
  )

  response.data.destroy()

  return {
    type,
    size: length,
    isVideo: type.includes('video/mp4')
  }
}

const sendAuthorizedVideo = async ({
  sock,
  from,
  msg,
  url,
  title,
  reply
}) => {
  const info = await inspectVideo(url)

  if (!info.isVideo) {
    return reply({
      text:
        'La URL no devolvió un MP4 directo. ' +
        'Puede ser una página web o un manifiesto de streaming.'
    })
  }

  if (info.size && info.size > MAX_FILE_MB * 1024 * 1024) {
    return reply({
      text: `El archivo supera el límite configurado de ${MAX_FILE_MB} MB.`
    })
  }

  await sock.sendMessage(
    from,
    {
      document: { url },
      mimetype: 'video/mp4',
      fileName: `${cleanFileName(title)}.mp4`,
      caption: `> ${title}`
    },
    { quoted: msg }
  )
}

export default {
  name: ['animedl'],
  description: 'Busca anime y consulta episodios',
  category: 'dl',
  ownerOnly: false,

  async run({ sock, from, msg, react, reply, text }) {
    try {
      const input = String(text || '').trim()

      if (!input) {
        return reply({
          text:
            'Uso:\n' +
            '• .animedl nombre del anime\n' +
            '• Responde con el número del resultado\n' +
            '• Después elige un episodio'
        })
      }

      // Elegir un resultado o episodio de una búsqueda anterior.
      const session = sessions.get(from)

      if (session && /^\d+$/.test(input)) {
        const choice = Number(input) - 1

        if (session.stage === 'results') {
          const anime = session.items[choice]

          if (!anime) {
            return reply({ text: 'Número de anime inválido.' })
          }

          await react('🔎')

          const details = await getDetails(anime.url)

          sessions.set(from, {
            stage: 'episodes',
            items: details.episodes,
            title: details.title
          })

          const episodes = details.episodes
            .slice(0, MAX_EPISODES)
            .map((ep, i) => `${i + 1}. Episodio ${ep.number}`)
            .join('\n')

          await react('✅')

          return reply({
            text:
              `「 ${details.title} 」\n\n` +
              `${details.synopsis || 'Sin sinopsis disponible.'}\n\n` +
              `Géneros: ${details.genres.join(', ') || 'N/D'}\n\n` +
              `${episodes || 'No se encontraron episodios.'}\n\n` +
              'Responde con el número del episodio.'
          })
        }

        if (session.stage === 'episodes') {
          const ep = session.items[choice]

          if (!ep) {
            return reply({ text: 'Número de episodio inválido.' })
          }

          return reply({
            text:
              `Episodio ${ep.number}\n${ep.url}\n\n` +
              'Abre el enlace para consultar las opciones publicadas. ' +
              'La descarga automática solo se admite para fuentes autorizadas.'
          })
        }
      }

      await react('🔍')

      const results = await searchAnime(input)

      if (!results.length) {
        await react('❌')
        return reply({ text: 'No encontré resultados para ese anime.' })
      }

      const items = results.slice(0, MAX_RESULTS)

      sessions.set(from, {
        stage: 'results',
        items
      })

      const list = items
        .map((item, i) => `${i + 1}. ${item.title}`)
        .join('\n')

      await react('✅')

      return reply({
        text:
          `「 ANIMEDL 」\n` +
          `Búsqueda: ${input}\n\n` +
          `${list}\n\n` +
          'Responde con el número del anime que quieres consultar.'
      })
    } catch (error) {
      console.error('[animedl]', error)

      await react('❌')

      return reply({
        text: `Error: ${error.message || 'No se pudo procesar la solicitud.'}`
      })
    }
  }
}
Puto gpt no termina la chamba