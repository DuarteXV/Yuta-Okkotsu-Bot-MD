import axios from 'axios'
import yts from 'yt-search'
import { AIRich } from '@whiskeysockets/baileys'

const LIMIT_MB = 80
const ID_RE = /(?:youtu\.be\/|v=|shorts\/)([\w-]{11})/

const APIS = [
  {
    name: 'lempi',
    endpoint: 'https://api.lempi.lat/dl/ytv',
    apikey: 'Duarte-1311-2026',
    tries: 3,
    timeout: 30000,
    parse: data =>
      data?.status && data?.datos?.url
        ? { url: data.datos.url, title: data.titulo }
        : null
  },
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

      const thumbnail = info?.thumbnail ?? info?.image

      const rich = new AIRich(sock)
       // .setTitle('© Downloaded With Yuta')
        .addVideo(
          { url: '', thumbnail },
          { autoFill: false, status: 'GENERATING', estimatedTime: 60000, id: 'media' }
        )

      await rich.send(from, { quoted: msg })

      const data = await fetchData(info?.url ?? text)

      if (!data) {
        rich.addText('❌ Error API', { replace: 'media' })
        await rich.sendEdit()
        return react('❌')
      }

      const mp4 = data.url
      const title = data.title ?? info?.title ?? 'video'

      const head = await axios.head(mp4).catch(() => null)
      const size = Number(head?.headers['content-length']) || 0
      const sizeMB = size / 1024 / 1024
      const caption = `> ${title} ( ${sizeMB.toFixed(2)} MB )`

      if (sizeMB >= LIMIT_MB) {
        rich.addText(caption, { replace: 'media' })
        await rich.sendEdit()
        await sock.sendMessage(
          from,
          { document: { url: mp4 }, mimetype: 'video/mp4', fileName: `${title}.mp4` },
          { quoted: msg }
        )
      } else {
        rich.addVideo(
          { url: mp4, file_length: size, duration: info?.seconds, thumbnail },
          { replace: 'media', autoFill: !info }
        )
        rich.addText(caption)
        await rich.sendEdit()
      }

      await react('✅')
    } catch (error) {
      await react('❌')
      await reply({ text: `❌ Error: ${error.message}` })
    }
  }
}