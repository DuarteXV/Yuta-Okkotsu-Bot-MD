
import { downloadMediaMessage } from '@whiskeysockets/baileys'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

const execFileAsync = promisify(execFile)

const MAX_SIZE = 25 * 1024 * 1024
const FFMPEG_TIMEOUT = 120000

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
    throw new Error(
      'Tu versión de Baileys no soporta newsletterMetadata.'
    )
  }

  const metadata = await sock.newsletterMetadata('invite', code)

  if (!metadata?.id) {
    throw new Error('No se pudo obtener el ID del canal.')
  }

  return metadata.id
}

function extractAudioMessage(message) {
  if (!message) return null

  if (message.audioMessage) {
    return message.audioMessage
  }

  const wrappers = [
    'ephemeralMessage',
    'viewOnceMessage',
    'viewOnceMessageV2',
    'viewOnceMessageV2Extension',
    'documentWithCaptionMessage'
  ]

  for (const wrapper of wrappers) {
    const nested = message[wrapper]?.message

    if (nested) {
      const audio = extractAudioMessage(nested)

      if (audio) return audio
    }
  }

  return null
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

  return buffer
}

async function convertToVoiceNote(buffer) {
  const directory = await mkdtemp(
    path.join(tmpdir(), 'audiocanal-')
  )

  const input = path.join(directory, 'input.audio')
  const output = path.join(directory, 'output.ogg')

  try {
    await writeFile(input, buffer)

    await execFileAsync('ffmpeg', [
      '-y',
      '-i', input,
      '-map', '0:a:0',
      '-vn',
      '-ac', '1',
      '-ar', '48000',
      '-c:a', 'libopus',
      '-b:a', '64k',
      '-application', 'voip',
      '-f', 'ogg',
      output
    ], {
      timeout: FFMPEG_TIMEOUT,
      maxBuffer: 10 * 1024 * 1024
    })

    const converted = await readFile(output)

    if (!converted.length) {
      throw new Error('FFmpeg generó un audio vacío.')
    }

    return converted
  } catch (error) {
    if (error.code === 'ENOENT') {
      throw new Error(
        'FFmpeg no está instalado o no está disponible en PATH.'
      )
    }

    if (error.killed) {
      throw new Error('La conversión del audio tardó demasiado.')
    }

    throw new Error(
      `No se pudo convertir el audio: ${error.message}`
    )
  } finally {
    await rm(directory, {
      recursive: true,
      force: true
    })
  }
}

export default {
  name: ['audiocanal'],
  description: 'Publica notas de voz en canales de WhatsApp',
  category: 'owner',
  ownerOnly: true,

  async run({ sock, from, msg, args, react, reply }) {
    try {
      const contextInfo =
        msg.message?.extendedTextMessage?.contextInfo

      const quoted = contextInfo?.quotedMessage
      const audioMessage = extractAudioMessage(quoted)

      const parameters = Array.isArray(args)
        ? args
        : String(args || '').split(/\s+/)

      const urls = parameters.filter(arg =>
        /^https?:\/\//i.test(arg)
      )

      const channelUrl = urls.find(url => getChannelCode(url))
      const audioUrl = urls.find(url => url !== channelUrl)

      if (!audioMessage && !audioUrl) {
        return reply({
          text:
            'Responde a una nota de voz o proporciona un enlace de audio.\n\n' +
            'Uso:\n' +
            '• Responde a un audio y escribe .audiocanal LINK_DEL_CANAL\n' +
            '• .audiocanal URL_DEL_AUDIO LINK_DEL_CANAL'
        })
      }

      if (!channelUrl && !from?.endsWith('@newsletter')) {
        return reply({
          text: 'Debes proporcionar el enlace del canal de WhatsApp.'
        })
      }

      await react('🕒')

      const channelJid = await resolveChannel(
        sock,
        channelUrl,
        from
      )

      let originalBuffer

      if (audioMessage) {
        if (!contextInfo?.stanzaId) {
          throw new Error('No se pudo identificar el mensaje respondido.')
        }

        const quotedMsg = {
          key: {
            remoteJid: from,
            id: contextInfo.stanzaId,
            participant: contextInfo.participant
          },
          message: quoted
        }

        originalBuffer = await downloadMediaMessage(
          quotedMsg,
          'buffer',
          {},
          {}
        )
      } else {
        originalBuffer = await downloadAudio(audioUrl)
      }

      if (!originalBuffer?.length) {
        throw new Error('No se pudo obtener el audio.')
      }

      if (originalBuffer.length > MAX_SIZE) {
        throw new Error('El audio supera el límite de 25 MB.')
      }

      const voiceNote = await convertToVoiceNote(originalBuffer)

      await sock.sendMessage(channelJid, {
        audio: voiceNote,
        mimetype: 'audio/ogg; codecs=opus',
        ptt: true
      })

      await react('✅')

      return reply({
        text: '✓ Nota de voz publicada correctamente en el canal.'
      })

    } catch (error) {
      console.error('[AUDIOCANAL]', error)

      await react('❌')

      return reply({
        text: `✗ ${error.message || 'Ocurrió un error al publicar la nota de voz.'}`
      })
    }
  }
}
