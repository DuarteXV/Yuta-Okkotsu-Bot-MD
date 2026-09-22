import axios from 'axios'
import yts from 'yt-search'
import ffmpeg from 'fluent-ffmpeg'
import fs from 'fs'
import path from 'path'
import os from 'os'

const LIMIT_MB = 50
const LONG_AUDIO_SECONDS = 1800
const ID_RE = /(?:youtu\.be\/|v=|shorts\/)([\w-]{11})/
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

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
    parse: data => {
      if (!data) return null
      const downloadUrl =
        data?.data?.dl ||
        data?.data?.url ||
        data?.data?.download ||
        data?.result?.url ||
        data?.result?.dl ||
        data?.url ||
        data?.dl

      const title = data?.data?.title || data?.result?.title || data?.title || 'Audio'

      return downloadUrl ? { url: downloadUrl, title } : null
    }
  }
]

// Consulta las APIs EN PARALELO y devuelve la primera que responda
// con un link válido, en vez de esperar una por una (eso era lo que
// hacía más lento el comando cuando la primera API tardaba/fallaba).
const getDownloadLink = async (ytUrl) => {
  const intentos = APIS.map(async (api) => {
    const { data } = await axios.get(api.endpoint, {
      params: { url: ytUrl, apikey: api.apikey },
      timeout: api.timeout,
      headers: { 'User-Agent': UA }
    })

    const media = api.parse(data)
    if (!media?.url) throw new Error(`${api.name}: respuesta sin URL de audio`)

    return { ...media, apiUsada: api.name }
  })

  try {
    return await Promise.any(intentos)
  } catch {
    return null
  }
}

const convertLinkToMp3 = async (audioUrl) => {
  const tmpDir = os.tmpdir()
  const outputPath = path.join(tmpDir, `out_${Date.now()}_${Math.random().toString(36).substring(7)}.mp3`)

  await new Promise((resolve, reject) => {
    ffmpeg(audioUrl)
      .inputOptions([
        '-user_agent', UA,
        '-reconnect', '1',
        '-reconnect_streamed', '1',
        '-reconnect_delay_max', '5'
      ])
      .outputOptions([
        '-vn',
        '-ac', '2',
        '-ar', '44100',
        '-b:a', '128k'
      ])
      .toFormat('mp3')
      .audioCodec('libmp3lame')
      .on('error', (err) => reject(err))
      .on('end', () => resolve())
      .save(outputPath)
  })

  return outputPath
}

const fetchAndConvert = async (ytUrl) => {
  const media = await getDownloadLink(ytUrl)
  if (!media?.url) return null

  try {
    const filePath = await convertLinkToMp3(media.url)
    return { filePath, title: media.title, apiUsada: media.apiUsada }
  } catch (e) {
    console.error(`[play] conversión falló (${media.apiUsada}):`, e?.message || e)
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
    let tempFilePath = null

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

      const sendImagePromise = sock.sendMessage(from, {
        image: { url: thumbnail },
        caption: captionText
      }, { quoted: msg })

      const resDl = await fetchAndConvert(url)

      if (!resDl?.filePath) {
        await react('❌')
        return reply({ text: '⛧ no se pudo procesar el audio de ninguna API' })
      }

      tempFilePath = resDl.filePath
      const stats = fs.statSync(tempFilePath)
      const sizeMB = stats.size / 1024 / 1024

      const finalTitle = resDl.title || title
      const fileName = `${cleanFileName(finalTitle)}.mp3`
      const isLong = sizeMB >= LIMIT_MB || (info?.seconds || 0) > LONG_AUDIO_SECONDS

      await sendImagePromise

      if (isLong) {
        await sock.sendMessage(
          from,
          {
            document: { url: tempFilePath },
            mimetype: 'audio/mpeg',
            fileName,
            caption: '⛧ audio enviado como documento por duración/tamaño'
          },
          { quoted: msg }
        )
      } else {
        await sock.sendMessage(
          from,
          {
            audio: { url: tempFilePath },
            mimetype: 'audio/mp4',
            fileName: fileName,
            seconds: info?.seconds || 0,
            ptt: false
          },
          { quoted: msg }
        )
      }

      await react('✅')
    } catch (e) {
      console.error('[dl:play]', e?.message || e)
      await react('❌')
      await reply({ text: `⛧ error: ${e.message}` })
    } finally {
      if (tempFilePath && fs.existsSync(tempFilePath)) {
        fs.unlinkSync(tempFilePath)
      }
    }
  }
}
