import { t } from '#locales'
import db from "#db"
import axios from "axios"
import { gotScraping } from 'got-scraping'
import { CookieJar } from 'tough-cookie'
import { getBuffer, buildLinkPreview, fetchSafe as fetch, enviarUrl, STREAM_OPTS, UPLOAD_TIMEOUT_MS } from '#serialize'

const YT_BASE = 'https://www.youtube.com'
const YT_API = `${YT_BASE}/youtubei/v1/search?prettyPrint=false`
const YT_CLIENT_VERSION = '2.20260820.01.00'
const YT_MAX_RESULTS = 20

const ytCookieJar = new CookieJar()

const ytHttp = gotScraping.extend({
  cookieJar: ytCookieJar,
  timeout: { request: 30000 },
  retry: { limit: 1 },
  throwHttpErrors: false,
  headerGeneratorOptions: {
    browsers: [{ name: 'chrome', minVersion: 120 }],
    devices: ['desktop'],
    operatingSystems: ['windows'],
    locales: ['es-419', 'es', 'en-US']
  }
})

// Configuración de APIs con fallback
const APIS = [
  {
    name: "lempi",
    timeout: 25000,
    build: (url) => `https://api.lempi.lat/dl/yta?apikey=Duarte-1311-2026&url=${encodeURIComponent(url)}`,
    parse: (data) => {
      if (!data?.status || !data?.datos?.url) return null
      return {
        title: data.titulo,
        thumbnail: data.miniatura,
        url: data.datos.url,
        calidad: data.datos.calidad,
        formato: data.datos.extension?.replace(".", "") || "mp3",
        fileName: data.datos.archivo,
      }
    },
  },
  {
    name: "alyacore",
    timeout: 20000,
    build: (url) => `https://api.alyacore.xyz/dl/ytmp3v2?apikey=Duarte-zz12&url=${encodeURIComponent(url)}`,
    parse: (data) => {
      if (!data?.status || !data?.data?.dl) return null
      const d = data.data
      return {
        title: d.title,
        thumbnail: d.thumbnail,
        url: d.dl,
        calidad: d.quality,
        formato: d.format || "mp3",
        fileName: null,
      }
    },
  },
]

async function getAudio(ytUrl) {
  const intentos = APIS.map(async (api) => {
    try {
      const res = await axios.get(api.build(ytUrl), { timeout: api.timeout })
      const audio = api.parse(res.data)
      if (audio?.url) return { ...audio, apiUsada: api.name }
      throw new Error(`${api.name}: respuesta sin URL de audio`)
    } catch (e) {
      console.error(`[play] ${api.name} falló:`, e?.message || e)
      throw e
    }
  })

  try {
    return await Promise.any(intentos)
  } catch (aggregateError) {
    const detalle = aggregateError.errors?.map((e) => e.message).join(" | ") || aggregateError.message
    throw new Error(`Ninguna API respondió: ${detalle}`)
  }
}

async function getAudioStream(downloadUrl) {
  const res = await axios.get(downloadUrl, {
    responseType: "stream",
    timeout: 60000,
    headers: { "User-Agent": "Mozilla/5.0" },
  })

  const contentType = res.headers["content-type"] || "desconocido"
  const contentLength = Number(res.headers["content-length"]) || 0

  const esAudio = contentType.startsWith("audio/") || contentType === "application/octet-stream"
  const muyChico = contentLength > 0 && contentLength < 5000

  if (!esAudio || muyChico) {
    throw new Error(`Respuesta inválida de la API (Type: ${contentType}, Size: ${contentLength}b)`)
  }

  return res.data
}

function ytRunsToText(node) {
  if (!node) return ''
  if (node.simpleText) return node.simpleText
  if (Array.isArray(node.runs)) return node.runs.map((r) => r.text || '').join('')
  return ''
}

function ytDurationToSeconds(d) {
  if (!d) return 0
  if (typeof d === 'number') return d
  return d.split(':').map((p) => parseInt(p, 10) || 0).reduce((acc, p) => acc * 60 + p, 0)
}

function ytParseViews(txt) {
  const n = String(txt || '').replace(/\D/g, '')
  return n ? parseInt(n, 10) : 0
}

function ytCollectVideos(root) {
  const found = []
  const walk = (node) => {
    if (!node || typeof node !== 'object') return
    if (Array.isArray(node)) { node.forEach(walk); return }
    if (node.videoRenderer?.videoId) found.push(node.videoRenderer)
    for (const key of Object.keys(node)) walk(node[key])
  }

  walk(root)

  const seen = new Set()
  const videos = []

  for (const v of found) {
    if (seen.has(v.videoId)) continue
    seen.add(v.videoId)

    const duration = v.lengthText?.simpleText || ''

    videos.push({
      videoId: v.videoId,
      url: `${YT_BASE}/watch?v=${v.videoId}`,
      title: ytRunsToText(v.title),
      duration,
      seconds: ytDurationToSeconds(duration),
      views: ytParseViews(v.viewCountText?.simpleText || ''),
      published: v.publishedTimeText?.simpleText || '',
      channel: ytRunsToText(v.ownerText) || ytRunsToText(v.longBylineText),
      thumbnail: `https://i.ytimg.com/vi/${v.videoId}/hqdefault.jpg`
    })
  }

  return videos
}

async function ytSearch(query) {
  const payload = {
    context: {
      client: {
        clientName: 'WEB',
        clientVersion: YT_CLIENT_VERSION,
        hl: 'es',
        gl: 'US',
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36,gzip(gfe)',
        originalUrl: YT_BASE,
        platform: 'DESKTOP'
      },
      user: { lockedSafetyMode: false },
      request: { useSsl: true }
    },
    query
  }

  const res = await ytHttp.post(YT_API, {
    headers: {
      'content-type': 'application/json',
      accept: '*/*',
      origin: YT_BASE,
      referer: `${YT_BASE}/`,
      'x-youtube-client-name': '1',
      'x-youtube-client-version': YT_CLIENT_VERSION
    },
    body: JSON.stringify(payload)
  })

  if (res.statusCode !== 200) throw new Error(`YouTube respondió HTTP ${res.statusCode}`)

  let data = null
  try { data = JSON.parse(String(res.body)) } catch {}
  if (!data) throw new Error('Respuesta inválida de YouTube')

  const videos = ytCollectVideos(data)
  if (!videos.length) throw new Error('No se encontraron videos')

  return videos.slice(0, YT_MAX_RESULTS)
}

function formatViews(views) {
  if (!views) return t('downloads:common.not_available')
  if (views >= 1_000_000_000) return `${(views / 1_000_000_000).toFixed(1)}B`
  if (views >= 1_000_000) return `${(views / 1_000_000).toFixed(1)}M`
  if (views >= 1_000) return `${(views / 1_000).toFixed(1)}k`
  return views.toString()
}

export default {
  command: ["play", "mp3", "ytmp3", "ytaudio", "playaudio"],
  category: "downloader",
  dlLimit: 'youtube',
  run: async ({ msg, sock, args }) => {
    try {
      if (!args[0]) {
        return msg.reply(t('downloads:youtube.no_query'))
      }

      await msg.react('🎧')

      const text = args.join(" ")
      const urlMatch = text.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/|shorts\/|live\/|v\/))([a-zA-Z0-9_-]{11})/)
      const urlDirecta = urlMatch ? `https://www.youtube.com/watch?v=${urlMatch[1]}` : null

      let video = null

      if (urlDirecta) {
        video = {
          videoId: urlMatch[1],
          url: urlDirecta,
          title: null,
          thumbnail: `https://i.ytimg.com/vi/${urlMatch[1]}/hqdefault.jpg`,
          seconds: 0
        }
      } else {
        try {
          const resultados = await ytSearch(text)
          video = resultados[0]
        } catch (e) {
          console.error('[dl:play] Búsqueda no disponible:', e?.message || e)
        }
      }

      if (!video) {
        await msg.react('✖️')
        return msg.reply(t('downloads:youtube.no_results'))
      }

      // Solicitamos la descarga a las APIs en segundo plano inmediatamente
      const descargaPromise = getAudio(video.url)

      const title = video.title || 'YouTube'
      const duration = video.duration || 'N/A'
      const image = video.thumbnail
      const ago = video.published || 'N/A'
      const vistas = video.views ? formatViews(video.views) : t('downloads:common.not_available')
      const canal = video.channel || t('downloads:common.unknown')

      const infoMessage = t('downloads:youtube.caption', {
        title,
        views: vistas,
        duration,
        ago,
        url: video.url,
        channel: canal
      }) + '\n\n' + t('downloads:common.preparing')

      const linkPreview = image
        ? await buildLinkPreview(sock, image, title || global.botname, global.dev, video.url)
        : undefined

      await sock.sendMessage(msg.chat, {
        text: infoMessage.trim(),
        linkPreview,
        contextInfo: { mentionedJid: [] }
      }, { quoted: msg })

      // Obtenemos los datos de la API que respondió primero
      const resDl = await descargaPromise
      const finalTitle = resDl.title || title
      const fileName = resDl.fileName || `${finalTitle}.${resDl.formato || 'mp3'}`
      
      // Creamos el stream asegurando su validez
      const stream = await getAudioStream(resDl.url)

      const esAudioLargo = video.seconds > 1800

      if (esAudioLargo) {
        await sock.sendMessage(
          msg.chat,
          {
            document: { stream },
            fileName,
            mimetype: 'audio/mpeg'
          },
          { quoted: msg, options: STREAM_OPTS, mediaUploadTimeoutMs: UPLOAD_TIMEOUT_MS }
        )
      } else {
        await sock.sendMessage(
          msg.chat,
          {
            audio: { stream },
            mimetype: 'audio/mpeg',
            ptt: false
          },
          { quoted: msg }
        )
      }

      await msg.react('✔️')
    } catch (e) {
      console.error('[dl:play]', e?.message || e)
      await msg.react('✖️')
      await msg.reply(global.msgglobal || e.message)
    }
  }
}
