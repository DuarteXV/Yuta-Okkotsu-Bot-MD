
import crypto from 'crypto'
import { downloadMediaMessage } from '@whiskeysockets/baileys'

async function addExif(buffer, author) {
  const { default: webp } = await import('node-webpmux')
  const img = new webp.Image()

  await img.load(buffer)

  const json = {
    'sticker-pack-id': crypto.randomBytes(32).toString('hex'),
    'sticker-pack-name': '',
    'sticker-pack-publisher': author,
    emojis: ['⚔️']
  }

  const jsonBuffer = Buffer.from(
    JSON.stringify(json),
    'utf8'
  )

  // Encabezado EXIF TIFF válido para stickers
  const exifAttr = Buffer.from([
    0x49, 0x49, 0x2A, 0x00,
    0x08, 0x00, 0x00, 0x00,
    0x01, 0x00, 0x41, 0x57,
    0x07, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x16, 0x00,
    0x00, 0x00
  ])

  const exif = Buffer.concat([
    exifAttr,
    jsonBuffer
  ])

  exif.writeUIntLE(jsonBuffer.length, 14, 4)

  // Sustituir metadata anterior
  img.exif = exif

  return await img.save(null)
}

export default {
  name: ['wm', 'take'],
  description: 'Cambia la metadata de un sticker',
  category: 'stickers',
  ownerOnly: false,

  async run({ sock, from, msg, args, usedPrefix, react, reply }) {
    try {
      const contextInfo =
        msg.message?.extendedTextMessage?.contextInfo

      const quoted = contextInfo?.quotedMessage

      if (!quoted?.stickerMessage) {
        return await reply({
          text: `❌ Responde a un sticker.\n\n✦ ${usedPrefix}wm yo`
        })
      }

      const author = args.join(' ').trim()

      if (!author) {
        return await reply({
          text: `❌ Escribe el nuevo autor.\nEjemplo: ${usedPrefix}wm yo`
        })
      }

      await react('🕒')

      const targetMsg = {
        key: {
          remoteJid: from,
          id: contextInfo.stanzaId,
          participant: contextInfo.participant
        },
        message: quoted
      }

      const buffer = await downloadMediaMessage(
        targetMsg,
        'buffer',
        {},
        { sock }
      )

      if (!buffer?.length) {
        throw new Error('No se pudo descargar el sticker.')
      }

      const sticker = await addExif(buffer, author)

      if (!sticker?.length) {
        throw new Error('No se pudo generar el sticker.')
      }

      await sock.sendMessage(
        from,
        { sticker },
        { quoted: msg }
      )

      await react('✅')

    } catch (error) {
      console.error('Error en wm:', error)

      await react('❌')
      await reply({
        text: `❌ ${error.message}`
      })
    }
  }
}
