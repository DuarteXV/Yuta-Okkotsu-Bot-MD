export default {
  name: ['join', 'unirse'],
  description: 'El bot se une a un grupo por link',
  category: 'grupos',
  ownerOnly: true,

  async run({ sock, text, usedPrefix, react, reply }) {
    await react('⏳')

    if (!text) return await reply({
      text:
        `❌ Pega el link del grupo.\n\n` +
        `💡 *${usedPrefix}join https://chat.whatsapp.com/XXXXXX*`
    })

    const match = text.trim().match(/chat\.whatsapp\.com\/([A-Za-z0-9]{20,24})/)

    if (!match) return await reply({
      text: `❌ El link no es válido.\n\nDebe ser: *https://chat.whatsapp.com/XXXXXX*`
    })

    const code = match[1]

    try {
      await sock.groupAcceptInvite(code)
      await react('✅')
      await reply({
        text:
          `✅ *Bot unido al grupo*\n\n` +
          `🔗 *Link:* ${text.trim()}\n\n` +
          `⚔️ _Yuta Okotsu MD | DuarteXV_`
      })
    } catch (e) {
      await react('❌')
      console.log(e)
      await reply({ text: `❌ No se pudo unir: ${e.message}` })
    }
  }
}