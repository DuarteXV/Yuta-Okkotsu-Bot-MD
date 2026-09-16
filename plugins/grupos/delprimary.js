import { db } from '../../database/db.js'
import { activeBots } from '../../core/subbotManager.js'

function cleanJid(jid = "") {
  if (!jid) return "";
  const atIndex = jid.lastIndexOf("@");
  if (atIndex === -1) return jid.split(":")[0];
  const userPart = jid.slice(0, atIndex).split(":")[0];
  const domainPart = jid.slice(atIndex + 1);
  return `${userPart}@${domainPart}`;
}

export default {
  name: ['delprimary', 'quitarprincipal'],
  description: 'Quita el bot primario del grupo',
  category: 'grupos',
  groupOnly: true,
  adminOnly: true,

  async run({ from, msg, react, reply, botJid }) {
    const primary = db.getPrimary(from)

    if (!primary) {
      return await reply({
        text:
          `⚠️ *Este grupo no tiene bot primario establecido.*\n\n` +
          `💡 Usa *.setprimary* para establecer uno.`
      })
    }

    const parseNum = (jid) => jid ? jid.split(':')[0].split('@')[0] : null
    const myNum = parseNum(botJid)

    if (myNum !== primary) {
      return;
    }

    if (msg.key.fromMe) {
       return;
    }

    const primaryJid = cleanJid(`${primary}@s.whatsapp.net`)

    await react('🗑️')
    db.delPrimary(from)

    await reply({
      text:
        `✅ *Bot primario eliminado*\n\n` +
        `🤖 El bot @${primary} ya no es el principal.\n` +
        `Todos los bots y sub-bots responderán en este grupo ahora.`,
      mentions: [primaryJid]
    })
  }
}