import { db } from '../../database/db.js'

const MAX = 999_999_999_999

function cleanJid(jid = '') {
  if (!jid) return ''
  const atIndex = jid.lastIndexOf('@')
  if (atIndex === -1) return jid.split(':')[0]
  const userPart = jid.slice(0, atIndex).split(':')[0]
  const domainPart = jid.slice(atIndex + 1)
  return `${userPart}@${domainPart}`
}

export default {
  name: ['chetar'],
  description: 'Da Fragmentos a un usuario (solo owners)',
  category: 'owner',
  ownerOnly: true,

  async run({ sock, from, sender, args, msg, groupMeta, resolveLid, reply, react }) {
    const contextInfo = msg?.message?.extendedTextMessage?.contextInfo

    // Objetivo: mencionado > mensaje citado > tú
    let targetJid = contextInfo?.mentionedJid?.[0] || contextInfo?.participant || sender

    // Misma resolución de LID que usa .donar
    if (targetJid.endsWith('@lid') || isNaN(targetJid.split('@')[0])) {
      const found = groupMeta?.participants?.find((p) => p.id === targetJid || p.lid === targetJid)
      if (found?.id) targetJid = found.id
    }
    if (targetJid.endsWith('@lid')) {
      targetJid = await resolveLid(targetJid)
    }

    const target = cleanJid(targetJid)

    const campo = args.some((a) => a.toLowerCase() === 'banco') ? 'banco' : 'bolsillo'
    const num = args.find((a) => /^\d+$/.test(a))
    const cantidad = Math.min(Number(num) || MAX, MAX)

    try {
      const eco = db.getEco(target)
      db.setEco(target, { [campo]: Math.min(eco[campo] + cantidad, MAX) })
      const after = db.getEco(target)

      await react('💰')
      await sock.sendMessage(from, {
        text:
          `💰 *Listo:* @${target.split('@')[0]} recibió *${cantidad.toLocaleString('es-ES')}* Fragmentos en el *${campo}*.\n\n` +
          `👜 Bolsillo: *${after.bolsillo.toLocaleString('es-ES')}*\n` +
          `🏦 Banco: *${after.banco.toLocaleString('es-ES')}*`,
        mentions: [target]
      }, { quoted: msg })
    } catch (e) {
      console.error('Error chetar:', e)
      await react('❌')
      await reply({ text: '⚠︎ No se pudo dar el dinero.' })
    }
  }
}