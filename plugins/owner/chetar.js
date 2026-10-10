import { db } from '../../database/db.js'

const MAX = 999_999_999_999 // "infinito" sin romper el JSON

export default {
  name: ['chetar'],
  description: 'Da Fragmentos a un usuario (solo owners)',
  category: 'owner',
  ownerOnly: true,

  async run({ sock, from, msg, args, reply, react }) {
    const ctx = msg.message?.extendedTextMessage?.contextInfo
    const sender = msg.key.participant || msg.key.remoteJid

    // Objetivo: mencionado > mensaje citado > el que escribe
    const target = ctx?.mentionedJid?.[0] || ctx?.participant || sender

    // Cantidad: primer argumento numérico (que no sea la mención), o el máximo
    const num = args.find(a => !a.startsWith('@') && /^\d+$/.test(a))
    const cantidad = Math.min(Number(num) || MAX, MAX)

    try {
      const eco = db.getEco(target)
      const nuevo = Math.min(eco.bolsillo + cantidad, MAX)
      db.setEco(target, { bolsillo: nuevo })

      await react('💰')
      await sock.sendMessage(from, {
        text:
          `💰 *Listo:* @${target.split('@')[0]} recibió *${cantidad.toLocaleString('es-ES')}* Fragmentos.\n` +
          `👛 Bolsillo: *${nuevo.toLocaleString('es-ES')}*`,
        mentions: [target]
      }, { quoted: msg })
    } catch (e) {
      console.error('Error chetar:', e)
      await react('❌')
      await reply({ text: '⚠︎ No se pudo dar el dinero.' })
    }
  }
}