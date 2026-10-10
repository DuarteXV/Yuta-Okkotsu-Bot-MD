import { db } from '../../database/db.js'

const MAX = 999_999_999_999

export default {
  name: ['chetar'],
  description: 'Da Fragmentos a un usuario (solo owners)',
  category: 'owner',
  ownerOnly: true,

  async run({ sock, from, msg, sender, args, reply, react }) {
    const ctx = msg.message?.extendedTextMessage?.contextInfo

    // Objetivo: mencionado > mensaje citado > tú (el mismo sender que usa .balance)
    const target = ctx?.mentionedJid?.[0] || ctx?.participant || sender

    // ¿Dónde guardar? "banco" o por defecto "bolsillo"
    const aBanco = args.some(a => a.toLowerCase() === 'banco')
    const campo = aBanco ? 'banco' : 'bolsillo'

    const num = args.find(a => /^\d+$/.test(a))
    const cantidad = Math.min(Number(num) || MAX, MAX)

    try {
      const eco = db.getEco(target)
      const nuevo = Math.min(eco[campo] + cantidad, MAX)
      db.setEco(target, { [campo]: nuevo })

      const after = db.getEco(target) // lo vuelve a leer para confirmar que se guardó

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