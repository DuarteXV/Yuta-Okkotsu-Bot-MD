
import { downloadMediaMessage } from '@whiskeysockets/baileys'

export default {
  name: ['pvtcanal'],
  description: 'Envía una nota de video a un canal',
  category: 'owner',
  ownerOnly: true,

  async run({ sock, from, msg, args, react, reply }) {
    const link = args?.[0]

    if (!link) {
      return reply({
        text: '❌ Proporciona el enlace del canal.\n\nEjemplo: .pvtcanal https://whatsapp.com/channel/XXXXXXXX'
      })
    }

    const inviteCode = link.match(
      /whatsapp\.com\/channel\/([A-Za-z0-9_-]+)/i
    )?.[1]

    if (!inviteCode) {
      return reply({ text: '❌ El enlace del canal no es válido.' })
    }

    const contextInfo =
      msg.message?.extendedTextMessage?.contextInfo

    const quoted = contextInfo?.quotedMessage
    const quotedType = quoted ? Object.keys(quoted)[0] : null

    if (quotedType !== 'videoMessage') {
      return reply({
        text: '❌ Responde a un video para enviarlo al canal.'
      })
    }

    await react('⏳')

    try {
      const channel = await sock.newsletterMetadata(
        'invite',
        inviteCode
      )

      if (!channel?.id) {
        throw new Error('No se pudo obtener el canal.')
      }

      const targetMsg = {
        key: {
          remoteJid: from,
          id: contextInfo.stanzaId,
          participant: contextInfo.participant
        },
        message: quoted
      }

      const videoBuffer = await downloadMediaMessage(
        targetMsg,
        'buffer',
        {},
        { sock }
      )

      await sock.sendMessage(channel.id, {
        video: videoBuffer,
        mimetype: 'video/mp4',
        ptv: true
      })

      await react('✅')
      return reply({
        text: `✅ Nota de video enviada al canal:\n${channel.name || channel.id}`
      })

    } catch (error) {
      console.error('[PVTCANAL]', error)

      await react('❌')
      return reply({
        text: '❌ No se pudo enviar el video. Verifica el enlace y los permisos del bot.'
      })
    }
  }
}
