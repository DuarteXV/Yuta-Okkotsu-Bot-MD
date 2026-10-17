import axios from 'axios'
import { prepareWAMessageMedia, generateWAMessageFromContent } from '@whiskeysockets/baileys'
import { totalmem, freemem, platform } from 'os'
import path from 'path'
import { pathToFileURL } from 'url'

const BANNER_DEFAULT = 'https://cdn.dix.lat/me/f5f104cd-9fb7-4d71-82bf-04bac49f8813.jpg'
const LINK = 'https://mancosyasociados.kesug.com'
const CREADOR = 'DuarteXV'
const GRUPOS_TTL = 5 * 60 * 1000
const BANNER_TTL = 60 * 60 * 1000

const CANAL = {
  newsletterJid: '120363420979328566@newsletter',
  newsletterName: '⏤͟͟͞͞★꙲⃝͟𝐘𝐔𝐓𝐀 𝐎𝐊𝐊𝐎𝐓𝐒𝐔 │ 𝐂𝐇𝐀𝐍𝐍𝐄𝐋 ◌Ⳋ𝅄',
  serverMessageId: -1
}

let cacheGrupos = { n: 0, exp: 0 }
const bannerCache = new Map() // url -> { media, exp }

// Importa desde la raíz del proyecto, así no depende de en qué carpeta esté el plugin
const importar = (ruta) => import(pathToFileURL(path.resolve(ruta)).href)

const getTs = (ts) => (typeof ts === 'object' ? Number(ts?.low ?? ts) : Number(ts))

function formatBytes(bytes) {
  const u = ['B', 'KB', 'MB', 'GB', 'TB']
  let i = 0
  let n = bytes
  while (n >= 1024 && i < u.length - 1) {
    n /= 1024
    i++
  }
  return `${Number(n.toFixed(2))} ${u[i]}`
}

function clockString(ms) {
  const h = Math.floor(ms / 3600000)
  const m = Math.floor(ms / 60000) % 60
  const s = Math.floor(ms / 1000) % 60
  return `${h}h ${m}m ${s}s`
}

// Cuenta grupos únicos entre todos los bots (principal + subbots), con caché
async function contarGrupos(bots) {
  if (cacheGrupos.exp > Date.now()) return cacheGrupos.n

  const res = await Promise.allSettled(bots.map((b) => b.groupFetchAllParticipating()))
  const ids = new Set()
  for (const r of res) {
    if (r.status !== 'fulfilled') continue
    for (const g of Object.values(r.value)) ids.add(g.id)
  }

  cacheGrupos = { n: ids.size, exp: Date.now() + GRUPOS_TTL }
  return ids.size
}

// Miniatura del link preview. La caché va por URL: si cambias el banner, se vuelve a subir.
async function getBannerMedia(sock, url) {
  const hit = bannerCache.get(url)
  if (hit && hit.exp > Date.now()) return hit.media

  const res = await axios.get(url, { responseType: 'arraybuffer', timeout: 30000 })
  const { imageMessage } = await prepareWAMessageMedia(
    { image: Buffer.from(res.data) },
    { upload: sock.waUploadToServer, mediaTypeOverride: 'thumbnail-link' }
  )

  bannerCache.set(url, { media: imageMessage, exp: Date.now() + BANNER_TTL })
  return imageMessage
}

export default {
  name: ['info', 'botinfo', 'infobot'],
  description: 'Muestra información y estado del bot',
  category: 'info',

  async run({ sock, from, msg, react, reply, usedPrefix, sender, senderNum, isOwner, isCoOwner, isMod, isPremium }) {
    try {
      const { db } = await importar('./database/db.js')
      const { default: config } = await importar('./config.js')
      const { getPlugins } = await importar('./core/pluginLoader.js')
      const { getAllSockets } = await importar('./core/subbotManager.js')

      // Mismo banner y nombre que el menú (se lee de la DB en cada uso)
      const currentBotNum = sock.user?.id ? sock.user.id.split('@')[0].split(':')[0].replace(/\D/g, '') : ''
      const currentBotJid = currentBotNum ? `${currentBotNum}@s.whatsapp.net` : ''
      const botData = db.getBot(currentBotJid) || db.getBot('main')

      const esLabelAutomatico = botData?.label?.startsWith('SUB_') || botData?.label === 'Subbot' || botData?.label === 'MAIN'
      const nombreBot = (esLabelAutomatico || !botData?.label ? config.botName : botData.label).replace(/@\d+/g, '').trim()
      const urlFoto = botData?.banner || BANNER_DEFAULT

      const ts = Number(msg.messageTimestamp) || Math.floor(Date.now() / 1000)
      const latencia = Math.max(0, Date.now() - ts * 1000)
      const uptime = clockString(process.uptime() * 1000)

      const totalRam = totalmem()
      const usedRam = totalRam - freemem()
      const ramPercentage = Math.round((usedRam / totalRam) * 100)

      const bots = getAllSockets().filter((b) => b?.user)
      const grupos = await contarGrupos(bots)
      const users = db.countUsers ? db.countUsers() : db.getAllUsers().length
      const plugins = new Set(getPlugins().values()).size

      const rol = isOwner ? 'owner' : isCoOwner ? 'coowner' : isMod ? 'mod' : isPremium ? 'premium' : 'user'
      const tipoBot = botData?.isMain === true || botData?.isMain === 1 ? 'principal' : 'subbot'

      const info =
        `✦ *${nombreBot}*\n\n` +
        `❖ hola › @${senderNum}\n` +
        `✧ rol › ${rol}\n` +
        `❀ prefijo › ${usedPrefix}\n` +
        `◈ latencia › ${latencia} ms\n` +
        `☾ uptime › ${uptime}\n\n` +
        `✿ registrados › ${users}\n` +
        `⚝ grupos › ${grupos}\n` +
        `❁ plugins › ${plugins}\n` +
        `✺ bots online › ${bots.length}\n` +
        `❃ tipo › ${tipoBot}\n\n` +
        `❂ plataforma › ${platform()}\n` +
        `⟡ ram › ${formatBytes(usedRam)} / ${formatBytes(totalRam)} (${ramPercentage}%)\n\n` +
        `✪ creador › ${CREADOR}`

      // Banner del bot; si el editado no carga, usa el de respaldo
      let img
      try {
        img = await getBannerMedia(sock, urlFoto)
      } catch {
        img = await getBannerMedia(sock, BANNER_DEFAULT)
      }

      const content = {
        extendedTextMessage: {
          endCardTiles: [],
          text: info,
          matchedText: LINK,
          canonicalUrl: LINK,
          description: `Powered by ${CREADOR} | ${nombreBot}`,
          title: nombreBot.toUpperCase(),
          previewType: 0,
          jpegThumbnail: img.jpegThumbnail,
          thumbnailDirectPath: img.directPath,
          thumbnailSha256: img.fileSha256,
          thumbnailEncSha256: img.fileEncSha256,
          mediaKey: img.mediaKey,
          mediaKeyTimestamp: getTs(img.mediaKeyTimestamp),
          thumbnailHeight: img.height || 1080,
          thumbnailWidth: img.width || 1920,
          inviteLinkGroupTypeV2: 0,
          contextInfo: {
            mentionedJid: [sender],
            isForwarded: true,
            forwardingScore: 1,
            forwardedNewsletterMessageInfo: CANAL
          }
        }
      }

      const waMsg = generateWAMessageFromContent(from, content, { userJid: sock.user?.id, quoted: msg })
      await sock.relayMessage(from, waMsg.message, { messageId: waMsg.key.id })

      await react('✅')
    } catch (e) {
      console.error('[info:botinfo]', e?.message || e)
      await react('❌')
      await reply({ text: `✦ error: ${e.message}` })
    }
  }
}