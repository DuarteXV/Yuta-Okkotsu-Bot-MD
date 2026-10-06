import axios from 'axios'
import yts from 'yt-search'

const LIMIT_MB = 80
const LONG_VIDEO_SECONDS = 1200 // sin peso conocido, más de 20 min va como documento
const ID_RE = /(?:youtu\.be\/|v=|shorts\/)([\w-]{11})/

const APIS = [
  {
    name: 'alyacore',
    endpoint: 'https://api.alyacore.xyz/dl/ytmp4v2',
    apikey: 'Duarte-zz12',
    tries: 2,
    timeout: 60000,
    parse: data =>
      data?.status && data?.data?.dl
        ? { url: data.data.dl, title: data.data.title }
        : null
  }
]

const fetchData = async url => {
  for (const api of APIS) {
    for (let i = 0; i < api.tries; i++) {
      try {
        const { data } = await axios.get(api.endpoint, {
          params: { url, apikey: api.apikey },
          timeout: api.timeout
        })
        const media = api.parse(data)
        if (media?.url) return media
      } catch (e) {
        console.error(`[play2] ${api.name} falló (${i + 1}/${api.tries}):`, e.message)
      }
    }
  }
  return null
}

// Un solo HEAD con límite corto: si no responde rápido, se sigue sin peso
const getSize = async url => {
  try {
    const head = await axios.head(url, { timeout: 4000, maxRedirects: 5 })
    return Number(head.headers['content-length']) || 0
  } catch {
    return 0
  }
}

const cleanFileName = name =>
  String(name).replace(/[\\/:*?"<>|]/g, '').replace(/\s+/g, ' ').trim().slice(0, 100) || 'video'

export default {
  name: ['play2'],
  description: 'Descarga video de YouTube',
  category: 'dl',
  ownerOnly: false,

  async run({ sock, from, msg, react, reply, text }) {
    try {
      if (!text) return reply({ text: '✧ Ingresa un nombre o link' })

      await react('🔍')

      const id = text.match(ID_RE)?.[1]
      const info = id ? await yts({ videoId: id }).catch(() => null) : (await yts(text)).videos[0]
      if (!info && !id) return reply({ text: '❌ Sin resultados' })

      const data = await fetchData(info?.url ?? text)

      if (!data) {
        await react('❌')
        return reply({ text: '❌ Error API' })
      }

      const mp4 = data.url
      const title = data.title || info?.title || 'video'

      const size = await getSize(mp4)
      const sizeMB = size / 1024 / 1024
      const sizeLabel = size ? ` ( ${sizeMB.toFixed(2)} MB )` : ''
      const caption = `> ${title}${sizeLabel}`

      const asDocument = size
        ? sizeMB >= LIMIT_MB
        : (info?.seconds || 0) > LONG_VIDEO_SECONDS

      if (asDocument) {
        await sock.sendMessage(
          from,
          {
            document: { url: mp4 },
            mimetype: 'video/mp4',
            fileName: `${cleanFileName(title)}.mp4`,
            caption
          },
          { quoted: msg }
        )
      } else {
        await sock.sendMessage(
          from,
          {
            video: { url: mp4 },
            mimetype: 'video/mp4',
            caption
          },
          { quoted: msg }
        )
      }

      await react('✅')
    } catch (error) {
      await react('❌')
      await reply({ text: `❌ Error: ${error.message}` })
    }
  }
}