import axios from 'axios'
import yts from 'yt-search'
import { prepareWAMessageMedia } from '@whiskeysockets/baileys'

const API_URL = 'https://api.alyacore.xyz/dl/ytmp3v2'
const API_KEY = 'Duarte-zz12'
const LIMIT_BYTES = 50 * 1024 * 1024
const LONG_AUDIO_SECONDS = 1800
const ID_RE = /(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/|shorts\/|live\/|v\/))([\w-]{11})/

const MEDIA_OPTS = {
  options: { timeout: 0, maxRedirects: 10, maxContentLength: Infinity, maxBodyLength: Infinity, headers: { 'user-agent': 'Mozilla/5.0' } },
  mediaUploadTimeoutMs: 1000 * 60 * 60
}

const pedirDescarga = (url) => {
  const p = axios.get(API_URL, { params: { url, apikey: API_KEY }, timeout: 60000 }).then(r => r.data)
  p.catch(() => {})
  return p
}

async function buscarVideo(query, id) {
  if (id) {
    const info = await yts({ videoId: id }).catch(() => null)
    if (info) return info
  }
  const search = await yts(query).catch(() => null)
  return search?.videos?.[0] || null
}

async function buildLinkPreview(sock, imagen, title, description, url) {
  try {
    const { imageMessage } = await prepareWAMessageMedia(
      { image: { url: imagen } },
      { upload: sock.waUploadToServer, mediaTypeOverride: 'thumbnail-link' }
    )
    return {
      'canonical-url': url,
      'matched-text': url,
      title,
      description,
      jpegThumbnail: imageMessage?.jpegThumbnail ? Buffer.from(imageMessage.jpegThumbnail) : undefined,
      highQualityThumbnail: imageMessage || undefined
    }
  } catch {
    return undefined
  }
}

async function pesoRemoto(url) {
  try {
    const res = await axios.head(url, { timeout: 10000, maxRedirects: 10 })
    return parseInt(res.headers['content-length'] || '0', 10) || 0
  } catch {
    return 0
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
      const query = (text || args.join(" ")).trim()
      if (!query) {
        return reply({ text: '⛧ escribe el nombre o link del video' })
      }

      await react('🎧')

      const id = query.match(ID_RE)?.[1]
      const urlDirecta = id ? `https://youtu.be/${id}` : null

      let descarga = urlDirecta ? pedirDescarga(urlDirecta) : null

      const info = await buscarVideo(query, id)

      if (!info && !urlDirecta) {
        await react('❌')
        return reply({ text: '⛧ no encontré resultados' })
      }

      const url = info?.url || urlDirecta
      const title = info?.title || 'Sin título'
      const duration = info?.timestamp || 'No disponible'
      const vistas = formatViews(info?.views)
      const thumbnail = info?.thumbnail || info?.image || `https://i.ytimg.com/vi/${id}/hqdefault.jpg`

      descarga ??= pedirDescarga(url)

      const captionText =
        `⛧ ${title}\n\n` +
        `⛧ vistas › ${vistas}\n` +
        `⛧ duración › ${duration}\n` +
        `⛧ link › ${url}`

      const linkPreview = await buildLinkPreview(sock, thumbnail, title, info?.author?.name || 'YouTube', url)

      await sock.sendMessage(from, { text: captionText, linkPreview }, { quoted: msg })

      const resDl = await descarga.catch(() => null)
      const dl = resDl?.data?.dl || resDl?.data?.url || resDl?.result?.url || resDl?.url
      if (!dl) {
        await react('❌')
        return reply({ text: '⛧ error: la API no dio un link de audio' })
      }

      const fileName = `${cleanFileName(resDl?.data?.title || title)}.mp3`
      const isLong = (info?.seconds || 0) > LONG_AUDIO_SECONDS || (await pesoRemoto(dl)) >= LIMIT_BYTES

      if (isLong) {
        await sock.sendMessage(from, {
          document: { url: dl },
          mimetype: 'audio/mpeg',
          fileName,
          caption: '⛧ audio enviado como documento por duración/tamaño'
        }, { quoted: msg, ...MEDIA_OPTS })
      } else {
        await sock.sendMessage(from, {
          audio: { url: dl },
          mimetype: 'audio/mpeg',
          fileName,
          ptt: false
        }, { quoted: msg, ...MEDIA_OPTS })
      }

      await react('✅')
    } catch (e) {
      console.error('[dl:play]', e?.message || e)
      await react('❌')
      await reply({ text: `⛧ error: ${e.message}` })
    }
  }
}
