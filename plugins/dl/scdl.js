import axios from 'axios'
import { spawn } from 'child_process'

let cachedClientId = null
let cacheTime = 0

async function getClientId() {
  if (cachedClientId && Date.now() - cacheTime < 3600000) return cachedClientId

  const html = await axios.get('https://soundcloud.com', {
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
    timeout: 10000
  }).then(r => r.data)

  const scripts = [...html.matchAll(/src="(https:\/\/a-v2\.sndcdn\.com\/assets\/[^"]+\.js)"/g)].map(m => m[1])

  for (const script of scripts.slice(-3)) {
    try {
      const js = await axios.get(script).then(r => r.data)
      const match = js.match(/client_id:"([a-zA-Z0-9]+)"/)
      if (match) {
        cachedClientId = match[1]
        cacheTime = Date.now()
        return cachedClientId
      }
    } catch {}
  }
  throw new Error('No se pudo obtener el client_id de SoundCloud')
}

function msToTime(ms) {
  const m = Math.floor(ms / 60000)
  const s = Math.floor((ms % 60000) / 1000).toString().padStart(2, '0')
  return `${m}:${s}`
}

const getBuf = (url) =>
  axios.get(url, { responseType: 'arraybuffer', timeout: 30000 }).then(r => Buffer.from(r.data))

// Descarga un stream HLS: lee la playlist, baja los segmentos y los une
async function descargarHls(m3u8Url) {
  const playlist = (await axios.get(m3u8Url, { timeout: 15000 })).data
  const base = new URL(m3u8Url)
  const lines = String(playlist).split('\n').map(l => l.trim()).filter(Boolean)

  const segmentos = lines.filter(l => !l.startsWith('#')).map(l => new URL(l, base).href)
  if (!segmentos.length) throw new Error('La playlist HLS no trae segmentos')

  // Los streams AAC (fMP4) traen un segmento de inicio aparte
  const initUri = lines.find(l => l.startsWith('#EXT-X-MAP'))?.match(/URI="([^"]+)"/)?.[1]

  const partes = []
  if (initUri) partes.push(await getBuf(new URL(initUri, base).href))

  // Baja los segmentos de 6 en 6, manteniendo el orden
  for (let i = 0; i < segmentos.length; i += 6) {
    const lote = await Promise.all(segmentos.slice(i, i + 6).map(getBuf))
    partes.push(...lote)
  }

  return Buffer.concat(partes)
}

// Convierte cualquier audio a mp3 con ffmpeg (si está instalado)
function aMp3(buffer) {
  return new Promise((resolve, reject) => {
    const ff = spawn('ffmpeg', ['-i', 'pipe:0', '-vn', '-c:a', 'libmp3lame', '-b:a', '128k', '-f', 'mp3', 'pipe:1'])
    const out = []
    ff.stdout.on('data', d => out.push(d))
    ff.on('error', reject)
    ff.on('close', code => (code === 0 && out.length ? resolve(Buffer.concat(out)) : reject(new Error('ffmpeg falló'))))
    ff.stdin.on('error', () => {})
    ff.stdin.end(buffer)
  })
}

function mimeEnvio(mime = '') {
  if (mime.startsWith('audio/mpeg')) return 'audio/mpeg'
  if (mime.startsWith('audio/ogg')) return 'audio/ogg; codecs=opus'
  return 'audio/mp4'
}

export default {
  name: ['scdl', 'sc'],
  description: 'Descarga canción de SoundCloud por URL',
  category: 'dl',
  ownerOnly: false,

  async run({ sock, from, msg, text, usedPrefix, react, reply }) {
    try {
      await react('⏳')

      if (!text) return await reply({
        text: `❌ Pega la URL de SoundCloud.\n\n💡 *${usedPrefix}scdl https://soundcloud.com/artista/cancion*`
      })

      if (!text.includes('soundcloud.com')) return await reply({
        text: `❌ La URL debe ser de SoundCloud.\n\n💡 *${usedPrefix}scsearch nombre* para buscar primero`
      })

      const clientId = await getClientId()

      const trackRes = await axios.get('https://api-v2.soundcloud.com/resolve', {
        params: { url: text.trim(), client_id: clientId },
        timeout: 10000
      })

      const track = trackRes.data
      if (!track || track.kind !== 'track') throw new Error('No se encontró el track en esa URL')

      // Orden de preferencia: mp3 progresivo > mp3 HLS > cualquier HLS
      const transcodings = track.media?.transcodings || []
      const esMp3 = t => t.format?.mime_type?.startsWith('audio/mpeg')
      const transcoding =
        transcodings.find(t => esMp3(t) && t.format?.protocol === 'progressive') ||
        transcodings.find(t => esMp3(t) && t.format?.protocol === 'hls') ||
        transcodings.find(t => t.format?.protocol === 'hls')

      if (!transcoding) throw new Error('No hay stream disponible')

      const streamRes = await axios.get(transcoding.url, {
        params: { client_id: clientId, track_authorization: track.track_authorization },
        timeout: 10000
      })

      const streamUrl = streamRes.data?.url
      if (!streamUrl) throw new Error('SoundCloud no devolvió la URL del stream')

      let audioBuffer = transcoding.format.protocol === 'hls'
        ? await descargarHls(streamUrl)
        : await getBuf(streamUrl)

      let mimetype = mimeEnvio(transcoding.format.mime_type)

      // Si no es mp3, intenta convertirlo para que WhatsApp lo reproduzca bien
      if (mimetype !== 'audio/mpeg') {
        try {
          audioBuffer = await aMp3(audioBuffer)
          mimetype = 'audio/mpeg'
        } catch {}
      }

      const thumb = track.artwork_url?.replace('large', 't500x500') || null

      const caption =
        `🎵 *${track.title}*\n` +
        `👤 *Artista:* ${track.user.username}\n` +
        `⏱️ *Duración:* ${msToTime(track.duration)}\n` +
        `▶️ *Plays:* ${track.playback_count?.toLocaleString() || 'N/A'}\n` +
        `❤️ *Likes:* ${track.likes_count?.toLocaleString() || 'N/A'}\n\n` +
        `⚔️ _Yuta Okotsu MD | DuarteXV_`

      if (thumb) {
        await sock.sendMessage(from, {
          image: { url: thumb },
          caption
        }, { quoted: msg })
      }

      await sock.sendMessage(from, {
        audio: audioBuffer,
        mimetype,
        ptt: false
      }, { quoted: msg })

      await react('✅')

    } catch (error) {
      await react('❌')
      await reply({ text: `❌ Error: ${error.message}` })
      console.error('Error en scdl:', error)
    }
  }
}