import { totalmem, freemem, platform } from 'os'
import path from 'path'
import { pathToFileURL } from 'url'

const IMAGEN = 'https://raw.githubusercontent.com/ANDERSONARRUE/Img.2/main/upload_1769284872805.jpg'
const CREADOR = 'DuarteXV'
const GRUPOS_TTL = 5 * 60 * 1000

let cacheGrupos = { n: 0, exp: 0 }

// Importa desde la raíz del proyecto, así no depende de en qué carpeta esté el plugin
const importar = (ruta) => import(pathToFileURL(path.resolve(ruta)).href)

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

export default {
  name: ['info', 'botinfo', 'infobot'],
  description: 'Muestra información y estado del bot',
  category: 'info',

  async run({ sock, from, msg, react, reply, usedPrefix, sender, isOwner, isCoOwner, isMod, isPremium }) {
    try {
      const { db } = await importar('./database/db.js')
      const { getPlugins } = await importar('./core/pluginLoader.js')
      const { getAllSockets } = await importar('./core/subbotManager.js')

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
      const nombre = msg.pushName || db.getPushName(sender) || 'User'
      const nombreBot = global.botname || 'Yuta'

      const info =
        `✦ *${nombreBot}*\n\n` +
        `❖ hola › ${nombre}\n` +
        `✧ rol › ${rol}\n` +
        `❀ prefijo › ${usedPrefix}\n` +
        `◈ latencia › ${latencia} ms\n` +
        `☾ uptime › ${uptime}\n\n` +
        `✿ registrados › ${users}\n` +
        `⚝ grupos › ${grupos}\n` +
        `❁ plugins › ${plugins}\n` +
        `✺ bots online › ${bots.length}\n\n` +
        `❂ plataforma › ${platform()}\n` +
        `⟡ ram › ${formatBytes(usedRam)} / ${formatBytes(totalRam)} (${ramPercentage}%)\n\n` +
        `✪ creador › ${CREADOR}`

      await sock.sendMessage(from, {
        image: { url: IMAGEN },
        caption: info,
        mentions: [sender]
      }, { quoted: msg })

      await react('✅')
    } catch (e) {
      console.error('[info:botinfo]', e?.message || e)
      await react('❌')
      await reply({ text: `✦ error: ${e.message}` })
    }
  }
}