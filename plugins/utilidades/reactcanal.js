import { broadcastReaccionCanal } from '../../core/subbotManager.js'

export default {
  name: ['reactcanal'],
  description: 'Hace que todos los bots reaccionen a un mensaje de canal',
  category: 'utils',
  ownerOnly: false,

  async run({ sock, args, reply, react }) {
    const [link, emoji] = args

    if (!link || !emoji) {
      return await reply({ text: '⚠️ Usa: *.reactcanal <link del mensaje> <emoji>*' })
    }

    const match = link.match(/channel\/([A-Za-z0-9]+)\/(\d+)/)
    if (!match) {
      return await reply({ text: '❌ Ese no es un link válido de mensaje de canal.' })
    }

    const [, invite, serverId] = match

    await react('🐢')
    await reply({ text: `🐢 *Procesando...* Reaccionando con ${emoji} en todos los bots (~5 segundos).` })

    // El JID real del canal (xxxx@newsletter), no el código de invitación
    let canalJid
    try {
      const meta = await sock.newsletterMetadata('invite', invite)
      canalJid = meta.id
    } catch (e) {
      console.error('No se pudo obtener el canal:', e)
      await react('❌')
      return await reply({ text: '❌ No se pudo encontrar el canal. Verifica el link.' })
    }

    let res
    try {
      res = await broadcastReaccionCanal({ canalJid, serverId, emoji, ventanaMs: 5000 })
    } catch (e) {
      console.error('Error en broadcast:', e)
      await react('❌')
      return await reply({ text: '❌ Ocurrió un error al reaccionar.' })
    }

    if (res.ok > 0) {
      await react('✅')
      await reply({
        text: `✅ Listo: ${res.ok}/${res.total} bot(s) reaccionaron con ${emoji}${res.fail ? ` (${res.fail} fallaron)` : ''}`
      })
    } else {
      await react('❌')
      await reply({ text: '❌ Ningún bot pudo reaccionar. Verifica el link.' })
    }
  }
}