import { getMainSock } from "../../core/subbotManager.js"

const REPORT_GROUP_ID = "120363427598752084@g.us"

function cleanJid(jid = "") {
  if (!jid) return "";
  const atIndex = jid.lastIndexOf("@");
  if (atIndex === -1) return jid.split(":")[0];
  const userPart = jid.slice(0, atIndex).split(":")[0];
  const domainPart = jid.slice(atIndex + 1);
  return `${userPart}@${domainPart}`;
}

export default {
  name: ["report", "reportar"],
  description: "Envía un reporte al grupo de staff",
  category: "utils",
  ownerOnly: false,

  async run({ sock, from, msg, text, reply, senderNum, isGroup, groupName, groupMeta }) {
    const quoted = msg.message?.extendedTextMessage?.contextInfo

    if (!text && !quoted?.stanzaId) {
      return await reply({
        text: "꒰✖️꒱  ᰍ Escrıᑲᧉ ᧉƖ motivo ძᧉ𝗅 ꭇᧉpoꭇƚᧉ o ꭇᧉsponძᧉ ⍺ un mᧉns⍺jᧉ.\n\n`✎..Ejemplo:` *.report* el usuario me está enviando spam"
      })
    }

    const participants = groupMeta?.participants || []
    let senderRaw = msg.key.participantAlt || msg.key.participant || `${senderNum}@s.whatsapp.net`
    senderRaw = senderRaw.split(':')[0]
    let senderJid = cleanJid(senderRaw)
    if (senderRaw.endsWith('@lid')) {
      const match = participants.find(p => p.lid === senderRaw)
      if (match) senderJid = cleanJid(match.id)
    }
    const senderNumResolved = senderJid.split('@')[0]

    const origen = isGroup ? `Grupo: ${groupName}` : "Chat privado"

    let textoReporte = `╭━━━━━━━━━━━○\n`
    textoReporte += `│⏤͟͟͞͞🚨 *NUEVO REPORTE*\n`
    textoReporte += `│\n`
    textoReporte += `│【👤】 *𝐃𝐄:* ↷\n @${senderNumResolved}\n`
    textoReporte += `│【📍】 *𝐎𝐫𝐢𝐠𝐞𝐧:* ${origen.startsWith("Grupo:") ? "Grupo: ↷\n \"" + groupName + "\"" : origen}\n`

    if (text) {
      textoReporte += `│【📝】 *𝐌𝐨𝐭𝐢𝐯𝐨:* ↷\n"${text}"\n`
    } else {
      textoReporte += `│【📝】 *𝐌𝐨𝐭𝐢𝐯𝐨:* ↷\n"(mensaje citado abajo)"\n`
    }

    textoReporte += `╰━━━━━━━━━━━━━○`

    const mainSock = getMainSock()
    const senderSock = mainSock || sock // fallback por si el principal no está conectado

    try {
      if (quoted?.stanzaId) {
        await senderSock.sendMessage(REPORT_GROUP_ID, {
          forward: {
            key: {
              remoteJid: from,
              id: quoted.stanzaId,
              participant: quoted.participant,
              fromMe: false
            },
            message: quoted.quotedMessage
          }
        })
      }

      await senderSock.sendMessage(REPORT_GROUP_ID, {
        text: textoReporte,
        mentions: [senderJid]
      })

      await reply({ text: "✅ Tu reporte fue enviado al equipo de staff. ¡Gracias!" })
    } catch (e) {
      await reply({ text: `❌ No se pudo enviar el reporte: ${e.message}` })
    }
  }
}