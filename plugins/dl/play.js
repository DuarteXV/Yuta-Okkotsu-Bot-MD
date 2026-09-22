import axios from 'axios'
import yts from 'yt-search'

const LIMIT_MB = 50
const LONG_AUDIO_SECONDS = 1800
const ID_RE = /(?:youtu\.be\/|v=|shorts\/)([\w-]{11})/

const APIS = [
  {
    name: 'lempi',
    endpoint: 'https://api.lempi.lat/dl/yta',
    apikey: 'Duarte-1311-2026',
    timeout: 25000,
    parse: data =>
      data?.status && data?.datos?.url
        ? { url: data.datos.url, title: data.titulo }
        : null
  },
  {
    name: 'alyacore',
    endpoint: 'https://api.alyacore.xyz/dl/ytmp3v2',
    apikey: 'Duarte-zz12',
    timeout: 25000,
    parse: data =>
      data?.status && data?.data?.dl
        ? { url: data.data.dl, title: data.data.title }
        : null
  }
]

const fetchData = async url => {
  const requests = APIS.map(async api => {
    try {
      const { data } = await axios.get(api.endpoint, {
        params: { url, apikey: api.apikey },
        timeout: api.timeout
      })
      const media = api.parse(data)
      if (media?.url) return media
      throw new Error(`${api.name}: sin URL`)
    } catch (e) {
      console.error(`[play] ${api.name} falló:`, e.message)
      throw e
    }
  })

  try {
    return await Promise.any(requests)
  } catch {
    return null
  }
}

const cleanFileName = name =>
  String(name).replace(/[\\/:*?"<>|]/g, '').replace(/\s+/g, ' ').trim().slice(0, 100) || 'audio'

function formatViews(views) {
  if (!views) return 'No disponible'
  if (views >= 1_000_000_000) return `${(views / 1_000_000_000).toFixed(1)}B`
  if (views >= 1_000_000) return `${(views / 1_000_000).toFixed(1)}M`
  if (views >= 1_000) return `${(views / 1_000).toFixed(1)}k`
  return views.toString()
}

export default {
  name: "play",
  description: "Descarga música de YouTube",
  category: "dl",
  ownerOnly: false,

  async run({ sock, from, msg, react, reply, text, args }) {
    try {
      const query = text || args.join(" ")
      if (!query?.trim()) {
        return reply({ text: '⛧ escribe el nombre o link del video' })
      }

      await react('🎧')

      const id = query.match(ID_RE)?.[1]
      let info = null

      if (id) {
        info = await yts({ videoId: id }).catch(() => null)
      }

      if (!info) {
        const search = await yts(query).catch(() => null)
        info = search?.videos?.[0] || search?.all?.[0]
      }

      if (!info && !id) {
        await react('❌')
        return reply({ text: '⛧ no encontré resultados' })
      }

      const url = info?.url || `https://www.youtube.com/watch?v=${id}`
      const title = info?.title || 'Sin título'
      const duration = info?.timestamp || 'No disponible'
      const vistas = formatViews(info?.views)
      const thumbnail = info?.thumbnail ?? info?.image ?? `https://i.ytimg.com/vi/${id}/hqdefault.jpg`

      const captionText = 
        `⛧ ${title}\n\n` +
        `⛧ vistas › ${vistas}\n` +
        `⛧ duración › ${duration}\n` +
        `⛧ link › ${url}`

      const resDl = await fetchData(url)

      if (!resDl?.url) {
        await react('❌')
        return reply({ text: '⛧ no se pudo obtener el audio de las APIs' })
      }

      const finalTitle = resDl.title || title
      const fileName = `${cleanFileName(finalTitle)}.mp3`
      const isLong = (info?.seconds || 0) > LONG_AUDIO_SECONDS

      await Promise.all([
        sock.sendMessage(from, {
          image: { url: thumbnail },
          caption: captionText
        }, { quoted: msg }),
        isLong
          ? sock.sendMessage(from, {
              document: { url: resDl.url },
              mimetype: 'audio/mpeg',
              fileName,
              caption: '⛧ audio enviado como documento por duración/tamaño'
            }, { quoted: msg })
          : sock.sendMessage(from, {
              audio: { url: resDl.url },
              mimetype: 'audio/mpeg',
              seconds: info?.seconds || 0,
              ptt: false
            }, { quoted: msg })
      ])

      await react('✅')
    } catch (e) {
      console.error('[dl:play]', e?.message || e)
      await react('❌')
      await reply({ text: `⛧ error: ${e.message}` })
    }
  }
}
