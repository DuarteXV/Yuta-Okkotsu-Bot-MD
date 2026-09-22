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

// Descarga el audio a Buffer para garantizar que WhatsApp lo procese y reproduzca correctamente
const getAudioBuffer = async url => {
  const res = await axios.get(url, {
    responseType: 'arraybuffer',
    timeout: 60000,
    headers: { 'User-Agent': 'Mozilla/5.0' }
  })
  return Buffer.from(res.data)
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
  name: "play",
  description: "Descarga música de YouTube",
  category: "dl",
  ownerOnly: false,

  async run({ sock, from, msg, react, reply, text, args }) {
    try {
      const query = text || args.join(" ")
      if (!query?.trim()) {
        return reply({ text: '✧ Ingresa el nombre o link de la canción' })
      }

      await react('🕒')

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
        await react('✖️')
        return reply({ text: '❌ No se encontraron resultados' })
      }

      const url = info?.url || `https://www.youtube.com/watch?v=${id}`
      const title = info?.title || 'YouTube'
      const duration = info?.timestamp || 'N/A'
      const ago = info?.ago || 'N/A'
      const vistas = formatViews(info?.views)
      const canal = info?.author?.name || 'Desconocido'
      const thumbnail = info?.thumbnail ?? info?.image ?? `https://i.ytimg.com/vi/${id}/hqdefault.jpg`

      // Disparar la petición a las APIs de descarga en segundo plano
      const descargaPromise = fetchData(url)

      const captionText = 
        `📌 *Título:* ${title}\n` +
        `👤 *Canal:* ${canal}\n` +
        `⏱️ *Duración:* ${duration}\n` +
        `👁️ *Vistas:* ${vistas}\n` +
        `📅 *Subido:* ${ago}\n` +
        `🔗 *Link:* ${url}\n\n` +
        `⏳ *Preparando audio...*`

      // Envía la imagen con el diseño/caption
      await sock.sendMessage(from, {
        image: { url: thumbnail },
        caption: captionText.trim()
      }, { quoted: msg })

      const resDl = await descargaPromise

      if (!resDl?.url) {
        await react('✖️')
        return reply({ text: '❌ No se pudo obtener la descarga desde las APIs.' })
      }

      const finalTitle = resDl.title || title
      const fileName = `${cleanFileName(finalTitle)}.mp3`

      // Descargamos el buffer real para evitar audios corruptos / 0:00
      const audioBuffer = await getAudioBuffer(resDl.url)
      const sizeMB = audioBuffer.length / 1024 / 1024

      const asDocument = sizeMB >= LIMIT_MB || (info?.seconds || 0) > LONG_AUDIO_SECONDS

      if (asDocument) {
        await sock.sendMessage(
          from,
          { document: audioBuffer, fileName, mimetype: 'audio/mpeg' },
          { quoted: msg }
        )
      } else {
        await sock.sendMessage(
          from,
          { audio: audioBuffer, mimetype: 'audio/mpeg', ptt: false },
          { quoted: msg }
        )
      }

      await react('✔️')
    } catch (e) {
      console.error('[dl:play]', e?.message || e)
      await react('✖️')
      await reply({ text: `❌ Error: ${e.message}` })
    }
  }
}
