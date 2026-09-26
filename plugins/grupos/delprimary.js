import { db } from '../../database/db.js'
import { claimOnce } from '../../core/subbotManager.js'

export default {
  name: ['delprimary', 'quitarprincipal'],
  description: 'Quita el bot primario del grupo',
  category: 'grupos',
  groupOnly: true,
  adminOnly: true,

  async run({ from, msg, react, reply }) {
    if (!claimOnce(msg.key.id)) return

    const primary = db.getPrimary(from)
    if (!primary) {
      return await reply({
        text:
          `⚠️ *Este grupo no tiene bot primario establecido.*\n\n` +
          `💡 Usa *.setprimary* para establecer uno.`
      })
    }

    db.delPrimary(from)

    await react('🗑️')
    await reply({
      text:
        `✅ *Bot primario eliminado*\n\n` +
        `Todos los bots y sub-bots responderán en este grupo ahora.`
    })
  }
}