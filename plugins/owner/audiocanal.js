
import { downloadMediaMessage } from '@whiskeysockets/baileys'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

const execFileAsync = promisify(execFile)

const MAX_SIZE = 50 * 1024 * 1024
const FFMPEG_TIMEOUT = 180000

function getChannelCode(url) {
  try {
    const parsed = new URL(url)

    if (!['whatsapp.com', 'www.whatsapp.com'].includes(parsed.hostname)) {
      return null
    }

    return parsed.pathname.match(/^\/channel\/([a-zA-Z0-9]+)\/?$/)?.[1] || null
  } catch {
    return null
  }
}

async function resolveChannel(sock, url) {
  const code = getChannelCode(url)

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

function extractAudioMessage(message) {
  if (!message) return null

  if (message.audioMessage) return message.audioMessage

  const wrappers = [
    'ephemeralMessage',
    'viewOnceMessage',
    'viewOnceMessageV2',
    'viewOnceMessageV2Extension',
    'documentWithCaptionMessage'
  ]

  for (const wrapper of wrappers) {
    const nested = message[wrapper]?.message
    if (!nested) continue

    const audio = extractAudioMessage(nested)
    if (audio) return audio
  }

  return null
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
      '-b:a', '48k',
      '-application', 'voip',
      '-f', 'ogg',
      output
    ], {
      timeout: FFMPEG_TIMEOUT,
      maxBuffer: 10 * 1024 * 1024
    })

    const result = await readFile(output)

    if (!result.length) {
      throw new Error('La conversión produjo un archivo vacío.')
    }

    return result
  } catch (error) {
    if (error.code === 'ENOENT') {
      throw new Error('FFmpeg no está instalado en el servidor.')
    }

    if (error.killed) {
      throw new Error('La conversión tardó demasiado.')
    }

    throw new Error(`Error convirtiendo audio: ${error.message}`)
  } finally {
    await rm(directory, {
      recursive: true,
      force: true
    })
  }
}

export default {
  name: ['audiocanal'],
  description: 'Publica una nota de voz en un canal de WhatsApp',
  category: 'misc',
  ownerOnly: false,

  async run({ sock, from, msg, args, react, reply }) {
    try {
      const contextInfo =
        msg.message?.extendedTextMessage?.contextInfo

      const quoted = contextInfo?.quotedMessage
      const audioMessage = extractAudioMessage(quoted)

      const parameters = Array.isArray(args)
        ? args
        : String(args || '').split(/\s+/)

      const channelUrl = parameters.find(arg =>
        getChannelCode(arg)
      )

      if (!audioMessage) {
        return reply({
          text: 'Debes responder directamente a una nota de voz.'
        })
      }

      if (!channelUrl) {
        return reply({
          text: 'Debes proporcionar el enlace del canal.\n\nEjemplo: .audiocanal https://whatsapp.com/channel/XXXXXXXX'
        })
      }

      if (!contextInfo?.stanzaId) {
        throw new Error('No se pudo identificar el mensaje respondido.')
      }

      await react('🕒')

      const channelJid = await resolveChannel(sock, channelUrl)

      const quotedMsg = {
        key: {
          remoteJid: from,
          id: contextInfo.stanzaId,
          participant: contextInfo.participant,
          fromMe: false
        },
        message: quoted
      }

      const originalBuffer = await downloadMediaMessage(
        quotedMsg,
        'buffer',
        {},
        {
          reuploadRequest: sock.updateMediaMessage
        }
      )

      if (!originalBuffer?.length) {
        throw new Error('No se pudo descargar la nota de voz.')
      }

      if (originalBuffer.length > MAX_SIZE) {
        throw new Error('El audio supera el límite de 50 MB.')
      }

      const voiceNote = await convertToVoiceNote(originalBuffer)

      await sock.sendMessage(channelJid, {
        audio: voiceNote,
        mimetype: 'audio/ogg; codecs=opus',
        ptt: true
      })

      await react('✅')

      return reply({
        text: '✓ Nota de voz publicada correctamente.'
      })

    } catch (error) {
      console.error('[AUDIOCANAL]', error)

      await react('❌')

      return reply({
        text: `✗ ${error.message || 'No se pudo publicar la nota de voz.'}`
      })
    }
  }
}
