import axios from 'axios'
import yts from 'yt-search'
import ffmpeg from 'fluent-ffmpeg'
import fs from 'fs'
import path from 'path'
import os from 'os'

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
    parse: data => {
      const downloadUrl = data?.data?.dl || data?.data?.url || data?.data?.download || data?.url || data?.dl
      const title = data?.data?.title || data?.title || 'Audio'
      
      return data?.status && downloadUrl
        ? { url: downloadUrl, title }
        : null
    }
  }
]

// Mantener la conversión exacta que ya funciona
const convertLinkToOpus = async (audioUrl) => {
  const tmpDir = os.tmpdir()
  const outputPath = path.join(tmpDir, `out_${Date.now()}_${Math.random().toString(36).substring(7)}.opus`)

  await new Promise((resolve, reject) => {
    ffmpeg(audioUrl)
      .inputOptions([
        '-reconnect', '1',
        '-reconnect_streamed', '1',
        '-reconnect_delay_max', '5'
      ])
      .toFormat('ogg')
      .audioCodec('libopus')
      .audioChannels(2)
      .audioBitrate('128k')
      .on('error', (err) => reject(err))
      .on('end', () => resolve())
      .save(outputPath)
  })

  return outputPath
}

// Mantener el fallback iterativo exacto
const fetchAndConvert = async (ytUrl) => {
  for (const api of APIS) {
    try {
      console.log(`[play] Probando API: ${api.name}`)
      const { data } = await axios.get(api.endpoint, {
        params: { url: ytUrl, apikey: api.apikey },
        timeout: api.timeout
      })

      const media = api.parse(data)
      if (!media?.url) {
        console.warn(`[play] ${api.name} no devolvió una estructura con URL válida.`)
        continue
      }

      console.log(`[play] URL obtenida de ${api.name}: ${media.url}`)
      const filePath = await convertLinkToOpus(media.url)
      return { filePath, title: media.title }

    } catch (e) {
      console.error(`[play] Falló la descarga/conversión con ${api.name}:`, e.message)
    }
  }

  return null
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
      const fileName = `${cleanFileName(finalTitle)}.opus`
      const isLong = sizeMB >= LIMIT_MB || (info?.seconds || 0) > LONG_AUDIO_SECONDS

      await sendImagePromise

      if (isLong) {
        await sock.sendMessage(
          from,
          {
            document: { url: tempFilePath },
            mimetype: 'audio/ogg; codecs=opus',
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
            // Cambiamos 'audio/ogg; codecs=opus' por 'audio/ogg' para que WhatsApp permita guardar el archivo
            mimetype: 'audio/ogg',
            fileName: `${cleanFileName(finalTitle)}.opus`,
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
