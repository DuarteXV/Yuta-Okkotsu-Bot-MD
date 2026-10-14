import axios from 'axios'
import { prepareWAMessageMedia } from '@whiskeysockets/baileys'

const FRAME_ORIGIN = 'https://frame.y2meta-uk.com'
const API_BASE = 'https://cnv.cx/v2'
const SEARCH_URL = 'https://api.alyacore.xyz/search/yt'
const API_KEY = 'Duarte-zz12'
const LIMIT_MB = 80
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
const ID_RE = /(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/|shorts\/|live\/|v\/))([\w-]{11})/

const MEDIA_OPTS = {
  options: { timeout: 0, maxRedirects: 10, maxContentLength: Infinity, maxBodyLength: Infinity, headers: { 'user-agent': 'Mozilla/5.0' } },
  mediaUploadTimeoutMs: 1000 * 60 * 60
}

const toNumber = v => parseInt(String(v || '').replace(/\D/g, ''), 10) || 0

// ===== y2meta: key + túnel de descarga =====
async function obtenerKey(videoId) {
  const res = await fetch(`${API_BASE}/sanity/key?id=${encodeURIComponent(videoId)}`, {
    headers: {
      'Origin': FRAME_ORIGIN,
      'Referer': FRAME_ORIGIN + '/',
      'Accept': '*/*',
      'Content-Type': 'application/json',
      'User-Agent': UA
    }
  })
  if (!res.ok) throw new Error(`sanity/key respondió ${res.status}`)
  const data = await res.json()
  if (!data.key) throw new Error('sanity/key no devolvió key')
  return data.key
}

async function obtenerAudio(videoId) {
  const key = await obtenerKey(videoId)

  const body = new URLSearchParams({
    link: `https://youtu.be/${videoId}`,
    format: 'mp3',
    audioBitrate: '128',
    videoQuality: '720',
    filenameStyle: 'pretty',
    vCodec: 'h264'
  })

  const res = await fetch(`${API_BASE}/converter`, {
    method: 'POST',
    headers: {
      'Origin': FRAME_ORIGIN,
      'Referer': FRAME_ORIGIN + '/',
      'Accept': '*/*',
      'Content-Type': 'application/x-www-form-urlencoded',
      'key': key,
      'User-Agent': UA
    },
    body
  })
  if (!res.ok) throw new Error(`converter respondió ${res.status}`)

  const data = await res.json()
  if (!data.url) throw new Error('converter no devolvió url')
  return { url: data.url, filename: data.filename || `${videoId}.mp3` }
}

// ===== Descarga del túnel con los headers de la página =====
async function descargarBuffer(url) {
  const res = await axios.get(url, {
    responseType: 'arraybuffer',
    timeout: 0,
    maxRedirects: 10,
    maxContentLength: Infinity,
    maxBodyLength: Infinity,
    headers: {
      'User-Agent': UA,
      'Origin': FRAME_ORIGIN,
      'Referer': FRAME_ORIGIN + '/',
      'Accept': '*/*'
    }
  })
  return Buffer.from(res.data)
}

// ===== Info del video (para el preview) =====
async function buscarVideo(query, id) {
  try {
    const { data } = await axios.get(SEARCH_URL, { params: { query: id || query, key: API_KEY }, timeout: 30000 })
    const results = data?.status && Array.isArray(data.result) ? data.result : []
    const v = id ? results.find(r => r.url?.includes(id)) : results[0]
    if (!v) return null
    return {
      url: v.url,
      title: v.title,
      timestamp: v.duration,
      views: toNumber(v.views),
      thumbnail: v.banner,
      author: { name: v.autor?.trim() }
    }
  } catch {
    return null
  }
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
  name: 'y2mate',
  description: 'Descarga audio de YouTube con y2mate',
  category: 'dl',
  ownerOnly: false,

  async run({ sock, from, msg, react, reply, text, args }) {
    try {
      const query = (text || args.join(' ')).trim()
      if (!query) {
        return reply({ text: '⛧ escribe el nombre o link del video' })
      }

      await react('🎧')

      const idDirecto = query.match(ID_RE)?.[1]

      // Si ya hay link, arranca la descarga en paralelo mientras busca la info
      let descarga = null
      if (idDirecto) {
        descarga = obtenerAudio(idDirecto)
        descarga.catch(() => {})
      }

      const info = await buscarVideo(query, idDirecto)

      if (!info && !idDirecto) {
        await react('❌')
        return reply({ text: '⛧ no encontré resultados' })
      }

      const url = info?.url || `https://youtu.be/${idDirecto}`
      const id = idDirecto || url.match(ID_RE)?.[1]
      if (!id) {
        await react('❌')
        return reply({ text: '⛧ no pude sacar el ID del video' })
      }

      const title = info?.title || 'Sin título'
      const duration = info?.timestamp || 'No disponible'
      const vistas = formatViews(info?.views)
      const thumbnail = info?.thumbnail || `https://i.ytimg.com/vi/${id}/hqdefault.jpg`

      if (!descarga) {
        descarga = obtenerAudio(id)
        descarga.catch(() => {})
      }

      const captionText =
        `⛧ ${title}\n\n` +
        `⛧ vistas › ${vistas}\n` +
        `⛧ duración › ${duration}\n` +
        `⛧ link › ${url}`

      const linkPreview = await buildLinkPreview(sock, thumbnail, title, info?.author?.name || 'YouTube', url)

      await sock.sendMessage(from, { text: captionText, linkPreview }, { quoted: msg })

      const resDl = await descarga
      const dl = resDl?.url
      if (!dl) {
        await react('❌')
        return reply({ text: '⛧ error: no se obtuvo el link de audio' })
      }

      const fileName = `${cleanFileName(title !== 'Sin título' ? title : resDl.filename.replace(/\.mp3$/i, ''))}.mp3`

      const buffer = await descargarBuffer(dl)
      const sizeMB = buffer.length / 1024 / 1024

      if (sizeMB >= LIMIT_MB) {
        await sock.sendMessage(from, {
          document: buffer,
          mimetype: 'audio/mpeg',
          fileName,
          caption: '⛧ audio enviado como documento por peso'
        }, { quoted: msg, ...MEDIA_OPTS })
      } else {
        await sock.sendMessage(from, {
          audio: buffer,
          mimetype: 'audio/mpeg',
          fileName,
          ptt: false
        }, { quoted: msg, ...MEDIA_OPTS })
      }

      await react('✅')
    } catch (e) {
      console.error('[dl:y2mate]', e?.message || e)
      await react('❌')
      await reply({ text: `⛧ error: ${e.message}` })
    }
  }
}