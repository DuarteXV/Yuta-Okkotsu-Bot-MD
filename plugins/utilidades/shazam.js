import acrcloud from 'acrcloud'
import { downloadContentFromMessage } from '@whiskeysockets/baileys'

const acr = new acrcloud({
  host: process.env.ACR_HOST || 'identify-ap-southeast-1.acrcloud.com',
  access_key: process.env.ACR_KEY,
  access_secret: process.env.ACR_SECRET
})

const THUMB = 'https://raw.githubusercontent.com/danielalejandrobasado-glitch/Yotsuba-MD-Premium/main/uploads/f3eb34db7d25a0c1.jpg'

function unwrap(m) {
  return m?.ephemeralMessage?.message || m?.viewOnceMessage?.message || m
}

async function bajarMedia(media, tipo) {
  const stream = await downloadContentFromMessage(media, tipo)
  const chunks = []
  for await (const c of stream) chunks.push(c)
  return Buffer.concat(chunks)
}

function toTime(ms) {
  const m = Math.floor(ms / 60000) % 60
  const s = Math.floor(ms / 1000) % 60
  return [m, s].map(v => v.toString().padStart(2, '0')).join(':')
}

async function whatmusic(buffer) {
  const res = await acr.identify(buffer)
  const music = res?.metadata?.music
  if (!music?.length) return []

  return music.map(a => {
    const ext = a.external_metadata || {}
    const urls = []
    if (ext.youtube?.vid) urls.push('https://youtu.be/' + ext.youtube.vid)
    if (ext.deezer?.track?.id) urls.push('https://www.deezer.com/us/track/' + ext.deezer.track.id)
    if (ext.spotify?.track?.id) urls.push('https://open.spotify.com/track/' + ext.spotify.track.id)

    return {
      title: a.title,
      artist: a.artists?.[0]?.name || 'Desconocido',
      duration: toTime(a.duration_ms || 0),
      url: urls
    }
  })
}

export default {
  name: ['whatmusic', 'shazam'],
  description: 'Identifica una canción a partir de un audio',
  category: 'utils',

  async run({ sock, from, msg, reply, react }) {
    const body = unwrap(msg.message)
    const quoted = unwrap(body?.extendedTextMessage?.contextInfo?.quotedMessage)

    const audio = quoted?.audioMessage
    const video = quoted?.videoMessage
    const media = audio || video

    if (!media) {
      return await reply({ text: '🌾 Responde a un audio (o video) con *.shazam* para identificar la canción.' })
    }

    await react('🍁')

    try {
      let buffer = await bajarMedia(media, audio ? 'audio' : 'video')
      buffer = buffer.subarray(0, 1024 * 1024) // ACRCloud solo necesita unos segundos

      const data = await whatmusic(buffer)
      if (!data.length) {
        await react('❌')
        return await reply({ text: '🍂 No se encontraron datos de la canción.' })
      }

      let cap = '🌾 *IDENTIFICADOR DE MÚSICA* 🎵\n\n'
      for (const r of data) {
        cap += `🪴 *Título:* ${r.title}\n`
        cap += `🍁 *Artista:* ${r.artist}\n`
        cap += `🌿 *Duración:* ${r.duration}\n`
        if (r.url.length) cap += `🍃 *Enlaces:*${r.url.map(u => `\n${u}`).join('')}\n`
        cap += '\n'
      }

      let thumbnail
      try {
        thumbnail = Buffer.from(await (await fetch(THUMB)).arrayBuffer())
      } catch {}

      await sock.sendMessage(from, {
        text: cap.trim(),
        contextInfo: {
          externalAdReply: {
            title: '🌾 Identificador de música 🍁',
            body: 'Descubre qué canción es',
            mediaType: 1,
            renderLargerThumbnail: true,
            thumbnail,
            sourceUrl: ''
          }
        }
      }, { quoted: msg })

      await react('✅')
    } catch (e) {
      console.error('Error whatmusic:', e)
      await react('❌')
      await reply({ text: '⚠︎ Ocurrió un error al identificar la canción.' })
    }
  }
}