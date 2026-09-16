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
  name: ['setprimary', 'botprincipal'],
  description: 'Establece un bot como primario del grupo',
  category: 'grupos',
  groupOnly: true,
  adminOnly: true,

  async run({ from, msg, react, reply, resolveLid }) {
    const parseNum = (jid) => jid ? jid.split('@')[0] : null

    const quoted = msg.message?.extendedTextMessage?.contextInfo || msg.message?.imageMessage?.contextInfo || msg.message?.videoMessage?.contextInfo

    const mentioned = quoted?.mentionedJid || []
    const targetRaw = mentioned[0] ? cleanJid(mentioned[0]) : (quoted?.participant ? cleanJid(quoted.participant) : null)

    let quotedSender = null
    if (targetRaw) {
      const resolved = await resolveLid(targetRaw)
      quotedSender = parseNum(cleanJid(resolved))
    }

    const botsActivos = [...activeBots.entries()].filter(([, bot]) => bot.status === 'online')

    if (!quotedSender) {
      let texto = `🤖 *¿A qué bot quieres como primario?*\n\n`
      for (const [, bot] of botsActivos) {
        const num = parseNum(cleanJid(bot.jid)) || 'N/A'
        texto += `  ✦ *${bot.label || 'Sub-Bot'}* → @${num}\n`
      }
      texto += `\n💡 Responde a un mensaje de ese bot y ejecuta *.setprimary* de nuevo.`

      const mentionJids = botsActivos.map(([, bot]) => cleanJid(bot.jid)).filter(Boolean)
      return await reply({ text: texto, mentions: mentionJids })
    }

    // Validación: el número mencionado/citado tiene que ser un bot real (main o sub) activo en este bot
    const esBotValido = botsActivos.some(([, bot]) => parseNum(cleanJid(bot.jid)) === quotedSender)

    if (!esBotValido) {
      return await reply({
        text: `⚠️ *Ese número no es un bot activo.*\n\n` +
          `Solo podés poner como primario a un bot (principal o sub-bot) que esté vinculado y online. Respondé a un mensaje suyo y ejecutá *.setprimary* de nuevo.`
      })
    }

    const whoNum = quotedSender
    const whoJid = cleanJid(`${whoNum}@s.whatsapp.net`)

    const current = db.getPrimary(from)
    if (current === whoNum) {
      return;
    }

    db.setPrimary(from, whoNum)

    await react('✅')
    await reply({
      text:
        `✅ *Bot primario establecido*\n\n` +
        `🤖 @${whoNum} es ahora el bot principal.\n` +
        `Los demás bots no responderán en este grupo.`,
      mentions: [whoJid]
    })
  }
}