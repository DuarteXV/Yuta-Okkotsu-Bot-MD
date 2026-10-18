import axios from 'axios'
import { spawn } from 'child_process'

const DEBUG = true // true: manda el debug al chat (en éxito y en error). Ponlo en false cuando ya funcione.

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
const http = axios.create({ headers: { 'User-Agent': UA } })

let cachedClientId = null
let cacheTime = 0

const host = (u) => {
  try { return new URL(u).host } catch { return '?' }
}

const snippet = (data) => {
  if (data == null) return ''
  let s = Buffer.isBuffer(data) ? data.toString('utf8') : typeof data === 'string' ? data : JSON.stringify(data)
  return s.replace(/\s+/g, ' ').slice(0, 150)
}

// Ejecuta un paso, lo anota en el debug y, si falla, dice cuál fue y con qué código HTTP
async function paso(nombre, fn, log) {
  const t0 = Date.now()
  try {
    const r = await fn()
    log(`✔ ${nombre} (${Date.now() - t0}ms)`)
    return r
  } catch (e) {
    const code = e.response?.status
    const body = snippet(e.response?.data)
    log(`✖ ${nombre}${code ? ` HTTP ${code}` : ''}: ${e.message}${body ? ` | ${body}` : ''}`)
    throw new Error(`${nombre}${code ? ` (HTTP ${code})` : ''}: ${e.message}`)
  }
}

async function getClientId(log) {
  if (cachedClientId && Date.now() - cacheTime < 3600000) {
    log(`ℹ client_id en caché: ${cachedClientId.slice(0, 4)}…`)
    return cachedClientId
  }

  const html = await http.get('https://soundcloud.com', { timeout: 10000 }).then(r => r.data)
  const scripts = [...html.matchAll(/src="(https:\/\/a-v2\.sndcdn\.com\/assets\/[^"]+\.js)"/g)].map(m => m[1])
  log(`ℹ scripts encontrados en soundcloud.com: ${scripts.length}`)

  for (const script of scripts.slice(-3)) {
    try {
      const js = await http.get(script).then(r => r.data)
      const match = js.match(/client_id:"([a-zA-Z0-9]+)"/)
      if (match) {
        cachedClientId = match[1]
        cacheTime = Date.now()
        log(`ℹ client_id nuevo: ${cachedClientId.slice(0, 4)}…`)
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
  http.get(url, { responseType: 'arraybuffer', timeout: 30000 }).then(r => Buffer.from(r.data))

// Descarga un stream HLS: lee la playlist, baja los segmentos y los une
async function descargarHls(m3u8Url, log) {
  const playlist = await paso('playlist HLS', () => http.get(m3u8Url, { timeout: 15000 }).then(r => r.data), log)
  const base = new URL(m3u8Url)
  const lines = String(playlist).split('\n').map(l => l.trim()).filter(Boolean)

  const segmentos = lines.filter(l => !l.startsWith('#')).map(l => new URL(l, base).href)
  log(`ℹ playlist: ${segmentos.length} segmentos, host ${host(segmentos[0] || m3u8Url)}`)
  if (!segmentos.length) throw new Error('La playlist HLS no trae segmentos')

  // Los streams AAC (fMP4) traen un segmento de inicio aparte
  const initUri = lines.find(l => l.startsWith('#EXT-X-MAP'))?.match(/URI="([^"]+)"/)?.[1]

  const partes = []
  if (initUri) partes.push(await paso('segmento inicial', () => getBuf(new URL(initUri, base).href), log))

  // Baja los segmentos de 6 en 6, manteniendo el orden
  for (let i = 0; i < segmentos.length; i += 6) {
    const lote = await paso(`segmentos ${i + 1}-${Math.min(i + 6, segmentos.length)}`, () =>
      Promise.all(segmentos.slice(i, i + 6).map(getBuf)), log
    )
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

// Intenta bajar un transcoding concreto
async function bajarTranscoding(t, track, clientId, log) {
  const streamRes = await paso('URL del stream', () =>
    http.get(t.url, {
      params: { client_id: clientId, track_authorization: track.track_authorization },
      timeout: 10000
    }), log
  )

  const streamUrl = streamRes.data?.url
  if (!streamUrl) throw new Error('SoundCloud no devolvió la URL del stream')
  log(`ℹ stream host: ${host(streamUrl)}`)

  const buffer = t.format.protocol === 'hls'
    ? await descargarHls(streamUrl, log)
    : await paso('descarga del audio', () => getBuf(streamUrl), log)

  log(`ℹ descargado: ${(buffer.length / 1024 / 1024).toFixed(2)} MB`)
  return { buffer, mime: t.format.mime_type }
}

export default {
  name: ['scdl', 'sc'],
  description: 'Descarga canción de SoundCloud por URL',
  category: 'dl',
  ownerOnly: false,

  async run({ sock, from, msg, text, usedPrefix, react, reply }) {
    const dbg = []
    const log = (m) => dbg.push(m)
    const enviarDebug = async () => {
      if (!DEBUG || !dbg.length) return
      await reply({ text: `🐞 *debug scdl*\n${dbg.join('\n')}`.slice(0, 3500) })
    }

    try {
      await react('⏳')

      if (!text) return await reply({
        text: `❌ Pega la URL de SoundCloud.\n\n💡 *${usedPrefix}scdl https://soundcloud.com/artista/cancion*`
      })

      if (!text.includes('soundcloud.com')) return await reply({
        text: `❌ La URL debe ser de SoundCloud.\n\n💡 *${usedPrefix}scsearch nombre* para buscar primero`
      })

      const clientId = await paso('client_id', () => getClientId(log), log)

      // Quita parámetros de seguimiento (?si=...) que a veces rompen el resolve
      const urlLimpia = text.trim().split('?')[0]
      log(`ℹ url: ${urlLimpia}`)

      const trackRes = await paso('resolve del track', () =>
        http.get('https://api-v2.soundcloud.com/resolve', {
          params: { url: urlLimpia, client_id: clientId },
          timeout: 10000
        }), log
      )

      const track = trackRes.data
      if (!track || track.kind !== 'track') throw new Error('No se encontró el track en esa URL')
      log(`ℹ track: ${track.title} | policy: ${track.policy || '?'} | access: ${track.access || '?'}`)
      log(`ℹ track_authorization: ${track.track_authorization ? 'sí' : 'NO'}`)

      // Candidatos en orden de preferencia: mp3 progresivo > mp3 HLS > cualquier otro HLS
      const transcodings = track.media?.transcodings || []
      log(`ℹ transcodings: ${transcodings.map(t => `${t.format?.protocol}/${t.format?.mime_type}`).join(', ') || 'ninguno'}`)

      const esMp3 = t => t.format?.mime_type?.startsWith('audio/mpeg')
      const candidatos = [
        ...transcodings.filter(t => esMp3(t) && t.format?.protocol === 'progressive'),
        ...transcodings.filter(t => esMp3(t) && t.format?.protocol === 'hls'),
        ...transcodings.filter(t => !esMp3(t) && t.format?.protocol === 'hls')
      ]

      if (!candidatos.length) throw new Error('No hay stream disponible')

      // Prueba cada uno hasta que alguno funcione
      let audio = null
      let ultimoError = null
      for (const t of candidatos) {
        log(`▶ probando ${t.format?.protocol} ${t.format?.mime_type}`)
        try {
          audio = await bajarTranscoding(t, track, clientId, log)
          break
        } catch (e) {
          ultimoError = e
          console.error(`scdl: falló ${t.format?.protocol} ${t.format?.mime_type} ->`, e.message)
        }
      }
      if (!audio) throw ultimoError || new Error('No se pudo descargar ningún stream')

      let audioBuffer = audio.buffer
      let mimetype = mimeEnvio(audio.mime)

      // Si no es mp3, intenta convertirlo para que WhatsApp lo reproduzca bien
      if (mimetype !== 'audio/mpeg') {
        try {
          audioBuffer = await aMp3(audioBuffer)
          mimetype = 'audio/mpeg'
          log('✔ convertido a mp3 con ffmpeg')
        } catch (e) {
          log(`✖ ffmpeg: ${e.message} (se manda sin convertir como ${mimetype})`)
        }
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

      log(`✔ enviado (${mimetype})`)
      await react('✅')
      await enviarDebug()

    } catch (error) {
      await react('❌')
      await reply({ text: `❌ Error: ${error.message}` })
      await enviarDebug()
      console.error('Error en scdl:', error)
    }
  }
}