
import { downloadMediaMessage } from '@whiskeysockets/baileys'

const MAX_SIZE = 25 * 1024 * 1024

function getChannelCode(url) {
  try {
    const parsed = new URL(url)

    if (!['whatsapp.com', 'www.whatsapp.com'].includes(parsed.hostname)) {
      return null
    }

    const match = parsed.pathname.match(/^\/channel\/([a-zA-Z0-9]+)\/?$/)

    return match?.[1] || null
  } catch {
    return null
  }
}

async function resolveChannel(sock, input, from) {
  if (from?.endsWith('@newsletter')) {
    return from
  }

  if (!input) {
    throw new Error('Proporciona el enlace del canal.')
  }

  if (input.endsWith('@newsletter')) {
    return input
  }

  const code = getChannelCode(input)

  if (!code) {
    throw new Error('El enlace del canal no es válido.')
  }

  if (typeof sock.newsletterMetadata !== 'function') {
    throw new Error('Tu versión de Baileys no soporta newsletterMetadata.')
  }

  const metadata = await sock.newsletterMetadata('invite', code)

  if (!metadata?.id) {
    throw new Error('No se pudo obtener el ID del canal.')
  }

  return metadata.id
}

async function downloadAudio(url) {
  let parsed

  try {
    parsed = new URL(url)
  } catch {
    throw new Error('La URL del audio no es válida.')
  }

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('Solo se permiten enlaces HTTP o HTTPS.')
  }

  const response = await fetch(parsed, {
    signal: AbortSignal.timeout(30000),
    headers: {
      'User-Agent': 'Mozilla/5.0'
    }
  })

  if (!response.ok) {
    throw new Error(`Error descargando audio: HTTP ${response.status}`)
  }

  const length = Number(response.headers.get('content-length') || 0)

  if (length > MAX_SIZE) {
    throw new Error('El audio supera el límite de 25 MB.')
  }

  if (!response.body) {
    throw new Error('No se recibió contenido del servidor.')
  }

  const reader = response.body.getReader()
  const chunks = []
  let total = 0

  try {
    while (true) {
      const { done, value } = await reader.read()

      if (done) break

      total += value.length

      if (total > MAX_SIZE) {
        await reader.cancel()
        throw new Error('El audio supera el límite de 25 MB.')
      }

      chunks.push(Buffer.from(value))
    }
  } finally {
    reader.releaseLock()
  }

  const buffer = Buffer.concat(chunks)

  if (!buffer.length) {
    throw new Error('El archivo de audio está vacío.')
  }

  const contentType = (
    response.headers.get('content-type') || ''
  ).split(';')[0].toLowerCase()

  const extension = parsed.pathname.toLowerCase()

  let mimetype = contentType

  if (!mimetype.startsWith('audio/')) {
    if (extension.endsWith('.mp3')) mimetype = 'audio/mpeg'
    else if (extension.endsWith('.ogg')) mimetype = 'audio/ogg'
    else if (extension.endsWith('.m4a')) mimetype = 'audio/mp4'
    else if (extension.endsWith('.wav')) mimetype = 'audio/wav'
    else if (extension.endsWith('.aac')) mimetype = 'audio/aac'
    else {
      throw new Error('La URL no parece contener un archivo de audio.')
    }
  }

  return { buffer, mimetype }
}

export default {
  name: ['audiocanal'],
  description: 'Publica audios en canales de WhatsApp',
  category: 'owner',
  ownerOnly: true,

  async run({ sock, from, msg, args, usedPrefix, react, reply }) {
    try {
      const contextInfo =
        msg.message?.extendedTextMessage?.contextInfo

      const quoted = contextInfo?.quotedMessage

      // Detectar audio respondido
      const audioMessage =
        quoted?.audioMessage ||
        quoted?.viewOnceMessage?.message?.audioMessage ||
        quoted?.viewOnceMessageV2?.message?.audioMessage ||
        quoted?.ephemeralMessage?.message?.audioMessage

      // Detectar enlaces en los argumentos
      const urls = args.filter(arg =>
        /^https?:\/\//i.test(arg)
      )

      const channelUrl = urls.find(url => getChannelCode(url))

      const audioUrl = urls.find(url => url !== channelUrl)

      if (!audioMessage && !audioUrl) {
        return await reply({
          text:
            `❌ Responde a un audio o proporciona su URL.\n\n` +
            `✦ ${usedPrefix}audiocanal <URL audio> <URL canal>\n` +
            `✦ ${usedPrefix}audiocanal <URL canal> (respondiendo a un audio)`
        })
      }

      if (!channelUrl && !from.endsWith('@newsletter')) {
        return await reply({
          text: '❌ También debes proporcionar el enlace del canal.'
        })
      }

      await react('🕒')

      // Resolver canal
      const channelJid = await resolveChannel(
        sock,
        channelUrl,
        from
      )

      let buffer
      let mimetype

      if (audioMessage) {
        // Descargar audio respondido
        const targetMsg = {
          key: {
            remoteJid: from,
            id: contextInfo.stanzaId,
            participant: contextInfo.participant
          },
          message: quoted
        }

        buffer = await downloadMediaMessage(
          targetMsg,
          'buffer',
          {},
          { sock }
        )

        mimetype = audioMessage.mimetype || 'audio/mpeg'

      } else {
        // Descargar audio desde URL
        const result = await downloadAudio(audioUrl)

        buffer = result.buffer
        mimetype = result.mimetype
      }

      if (!buffer?.length) {
        throw new Error('No se pudo obtener el audio.')
      }

      // Publicar como audio normal, no PTT
      await sock.sendMessage(channelJid, {
        audio: buffer,
        mimetype,
        ptt: false
      })

      await react('✅')

      await reply({
        text: '✓ Audio publicado correctamente en el canal.'
      })

    } catch (error) {
      console.error('[AUDIOCANAL]', error)

      await react('❌')

      await reply({
        text: `❌ ${error.message}`
      })
    }
  }
}
