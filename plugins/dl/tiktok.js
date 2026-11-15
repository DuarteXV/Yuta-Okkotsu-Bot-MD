
import axios from 'axios'
import { fileTypeFromBuffer } from 'file-type'

const API = 'https://btch-downloader-api-green.vercel.app/api/download/tiktok'

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36'

async function getTikTokData(url) {
  const { data } = await axios.get(API, {
    params: { url },
    timeout: 45000,
    headers: {
      'User-Agent': USER_AGENT,
      Accept: 'application/json'
    }
  })

  if (!data?.success) {
    throw new Error(
      data?.message || data?.error || 'La API no pudo procesar el video.'
    )
  }

  const media = data.normalized?.media

  if (!Array.isArray(media) || !media.length) {
    throw new Error('La API no devolvió archivos multimedia.')
  }

  const video = media.find(item =>
    item.type === 'video' &&
    typeof item.url === 'string' &&
    item.url.startsWith('http')
  )

  const audio = media.find(item =>
    item.type === 'audio' &&
    typeof item.url === 'string' &&
    item.url.startsWith('http')
  )

  return {
    title: data.normalized.title || 'TikTok',
    thumbnail: data.normalized.thumbnail,
    video,
    audio
  }
}

async function downloadMedia(url) {
  const response = await axios.get(url, {
    responseType: 'arraybuffer',
    timeout: 90000,
    maxContentLength: 100 * 1024 * 1024,
    maxBodyLength: 100 * 1024 * 1024,
    headers: {
      'User-Agent': USER_AGENT,
      Referer: 'https://www.tiktok.com/'
    }
  })

  const buffer = Buffer.from(response.data)

  if (!buffer.length) {
    throw new Error('El archivo descargado está vacío.')
  }

  const detected = await fileTypeFromBuffer(buffer)

  return {
    buffer,
    mime: detected?.mime || response.headers['content-type'] || ''
  }
}

export default {
  name: ['tiktok', 'tt', 'tiktokdl'],
  description: 'Descarga videos de TikTok sin marca de agua.',
  category: 'download',

  async run({ sock, from, msg, args, react, reply }) {
    try {
      const url = args.join(' ').trim()

      if (!url) {
        return reply({
          text: '「 ✦ 」 *TikTok Downloader*\n\nProporciona un enlace de TikTok.\n\n*Ejemplo:* .tiktok https://vt.tiktok.com/xxxx/'
        })
      }

      if (!/^https?:\/\/(www\.|vm\.|vt\.)?tiktok\.com\//i.test(url)) {
        return reply({
          text: '❌ El enlace proporcionado no parece ser de TikTok.'
        })
      }

      await react('⏳')

      await reply({
        text: '「 ✦ 」 Procesando video de TikTok...'
      })

      const data = await getTikTokData(url)

      if (!data.video) {
        throw new Error('No se encontró un enlace de video disponible.')
      }

      const { buffer, mime } = await downloadMedia(data.video.url)

      if (!mime.startsWith('video/')) {
        throw new Error('El servidor no devolvió un archivo de video válido.')
      }

      await sock.sendMessage(from, {
        video: buffer,
        mimetype: mime,
        caption: `「 ✦ 」 *TikTok Downloader*\n\n${data.title}\n\n> Video sin marca de agua`
      }, { quoted: msg })

      await react('✅')

    } catch (error) {
      console.error('[TIKTOK DOWNLOAD]', error)

      await react('❌')

      let message = error.message || 'Error desconocido.'

      if (error.code === 'ECONNABORTED') {
        message = 'La petición tardó demasiado tiempo.'
      } else if (error.response) {
        message = `El servidor respondió con HTTP ${error.response.status}.`
      } else if (error.code === 'EPROTO') {
        message = 'Error de conexión SSL con el servidor.'
      }

      await reply({
        text: `❌ *Error al descargar TikTok:*\n${message}`
      })
    }
  }
}
