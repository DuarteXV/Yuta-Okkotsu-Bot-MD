import { totalmem, freemem, platform } from 'os'
import { sizeFormatter } from 'human-readable'
import { db } from '../../database/db.js'
import { getPlugins } from '../../core/pluginLoader.js'
import { getAllSockets } from '../../core/subbotManager.js'

const format = sizeFormatter({
  std: 'JEDEC',
  decimalPlaces: 2,
  keepTrailingZeroes: false,
  render: (literal, symbol) => `${literal} ${symbol}B`
})

const IMAGEN = 'https://raw.githubusercontent.com/ANDERSONARRUE/Img.2/main/upload_1769284872805.jpg'
const CREADOR = 'DuarteXV'
const GRUPOS_TTL = 5 * 60 * 1000

let cacheGrupos = { n: 0, exp: 0 }

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
      const ts = Number(msg.messageTimestamp) || Math.floor(Date.now() / 1000)
      const latencia = Math.max(0, Date.now() - ts * 1000)
      const uptime = clockString(process.uptime() * 1000)

      const totalRam = totalmem()
      const usedRam = totalRam - freemem()
      const ramPercentage = Math.round((usedRam / totalRam) * 100)

      const bots = getAllSockets().filter((b) => b?.user)
      const grupos = await contarGrupos(bots)
      const users = db.countUsers()
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
        `⟡ ram › ${format(usedRam)} / ${format(totalRam)} (${ramPercentage}%)\n\n` +
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