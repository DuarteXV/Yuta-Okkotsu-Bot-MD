import axios from 'axios'
import yts from 'yt-search'

const LIMIT_MB = 50
const LONG_AUDIO_SECONDS = 1800 // 30 minutos
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

// Petición rápida en paralelo
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

const getSize = async url => {
  try {
    const head = await axios.head(url, { timeout: 3500, maxRedirects: 5 })
    return Number(head.headers['content-length']) || 0
  } catch {
    return 0
  }
}

const cleanFileName = name =>
  String(name).replace(/[\\/:*?"<>|]/g, '').replace(/\s+/g, ' ').trim().slice(0, 100) || 'audio'

function formatViews(views) {
  if (!views) return 'No disponible'
  if (views >= 1_000_000_000) return `${(views / 1_000_000_000).toFixed(1)}B (${views.toLocaleString()})`
  if (views >= 1_000_000) return `${(views / 1_000_000).toFixed(1)}M (${views.toLocaleString()})`
  if (views >= 1_000) return `${(views / 1_000).toFixed(1)}k (${views.toLocaleString()})`
  return views.toString()
}

export default {
  command: ["play", "mp3", "ytmp3", "ytaudio", "playaudio"],
  category: "downloader",
  dlLimit: 'youtube',
  run: async ({ msg, sock, args }) => {
    try {
      if (!args[0]) {
        return msg.reply('✧ Ingresa el nombre o link de la canción')
      }

      await msg.react('🕒')

      const text = args.join(" ")
      const id = text.match(ID_RE)?.[1]
      let info = null

      if (id) {
        info = await yts({ videoId: id }).catch(() => null)
      }

      if (!info) {
        const search = await yts(text).catch(() => null)
        info = search?.videos?.[0] || search?.all?.[0]
      }

      if (!info && !id) {
        await msg.react('✖️')
        return msg.reply('❌ No se encontraron resultados')
      }

      const url = info?.url || `https://www.youtube.com/watch?v=${id}`
      const title = info?.title || 'YouTube'
      const duration = info?.timestamp || 'N/A'
      const ago = info?.ago || 'N/A'
      const vistas = formatViews(info?.views)
      const canal = info?.author?.name || 'Desconocido'

      // Disparamos la búsqueda de descarga inmediatamente
      const descargaPromise = fetchData(url)

      const infoMessage = 
        `📌 *Título:* ${title}\n` +
        `👤 *Canal:* ${canal}\n` +
        `⏱️ *Duración:* ${duration}\n` +
        `👁️ *Vistas:* ${vistas}\n` +
        `📅 *Subido:* ${ago}\n` +
        `🔗 *Link:* ${url}\n\n` +
        `⏳ *Preparando audio...*`

      await sock.sendMessage(msg.chat, {
        text: infoMessage.trim()
      }, { quoted: msg })

      const resDl = await descargaPromise

      if (!resDl?.url) {
        await msg.react('✖️')
        return msg.reply('❌ No se pudo descargar el audio desde las APIs.')
      }

      const mp3 = resDl.url
      const finalTitle = resDl.title || title
      const fileName = `${cleanFileName(finalTitle)}.mp3`

      const size = await getSize(mp3)
      const sizeMB = size / 1024 / 1024

      const asDocument = size
        ? sizeMB >= LIMIT_MB
        : (info?.seconds || 0) > LONG_AUDIO_SECONDS

      if (asDocument) {
        await sock.sendMessage(
          msg.chat,
          { document: { url: mp3 }, fileName, mimetype: 'audio/mpeg' },
          { quoted: msg }
        )
      } else {
        await sock.sendMessage(
          msg.chat,
          { audio: { url: mp3 }, mimetype: 'audio/mpeg', ptt: false },
          { quoted: msg }
        )
      }

      await msg.react('✔️')
    } catch (e) {
      console.error('[dl:play]', e?.message || e)
      await msg.react('✖️')
      await msg.reply(global.msgglobal || e?.message)
    }
  }
}
