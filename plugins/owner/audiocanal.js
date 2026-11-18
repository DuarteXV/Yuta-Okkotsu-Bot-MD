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

return await readFile(output)

} catch (error) {
if (error.code === 'ENOENT') {
throw new Error('FFmpeg no está instalado.')
}

throw new Error(
  `FFmpeg: ${error.message}\n${error.stderr || ''}`.slice(0, 2500)
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
description: 'Publica notas de voz en canales',
category: 'misc',
ownerOnly: true,

async run({ sock, from, msg, args, react, reply }) {
try {
const contextInfo =
msg.message?.extendedTextMessage?.contextInfo

  const quoted = contextInfo?.quotedMessage
  const audioMessage = extractAudioMessage(quoted)

  if (!audioMessage) {
    throw new Error('Responde a un audio para publicarlo en el canal.')
  }

  const parameters = Array.isArray(args)
    ? args
    : String(args || '').split(/\s+/)

  const channelUrl = parameters.find(arg => getChannelCode(arg))

  if (!channelUrl) {
    throw new Error('Debes proporcionar un enlace válido del canal.')
  }

  if (typeof sock.newsletterMetadata !== 'function') {
    throw new Error('Tu versión de Baileys no tiene newsletterMetadata.')
  }

  const code = getChannelCode(channelUrl)
  const metadata = await sock.newsletterMetadata('invite', code)

  if (!metadata?.id) {
    throw new Error('No se pudo obtener el ID del canal.')
  }

  if (!contextInfo?.stanzaId) {
    throw new Error('No se encontró el ID del mensaje respondido.')
  }

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
    throw new Error('El audio descargado está vacío.')
  }

  if (originalBuffer.length > MAX_SIZE) {
    throw new Error('El audio supera los 50 MB.')
  }

  const voiceNote = await convertToVoiceNote(originalBuffer)

  await sock.sendMessage(metadata.id, {
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
    text: `✗ No se pudo publicar la nota de voz.\n\n${error.message}`
  })
}

}
}