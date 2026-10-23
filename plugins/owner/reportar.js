import config from "../../config.js";
import { activeBots } from "../../core/subbotManager.js";
import { jidNormalizedUser, isLidUser } from "@whiskeysockets/baileys";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const INTENTOS_POR_BOT = 4;
const DELAY = 400;            // ms entre ejecuciones

export default {
  name: ["reportar", "report"],
  description: "Reporta un número usando todos los bots conectados",
  category: "sockets",
  groupOnly: false,

  async run({ sock, from, msg, args, react, reply, groupMeta }) {
    try {
      await react("🗣️");

      const raw = (args?.[0] || "").trim();
      const numero = raw.replace(/\D/g, "");

      if (!numero || numero.length < 8) {
        await react("⚠️");
        return reply({ text: "⚠️ Uso: *.reportar +5058888888*" });
      }

      const targetJid = `${numero}@s.whatsapp.net`;

      const botsOnline = [...activeBots.values()].filter(
        (b) => b.status === "online" && b.jid
      );

      if (!botsOnline.length) {
        await react("❌");
        return reply({ text: "❌ No hay bots conectados para reportar." });
      }

      const getSock = (b) => b.sock || b.socket || b.conn;

      const limpiarNumero = (jid = "") =>
        jid.split("@")[0].split(":")[0].replace(/\D/g, "");

      const reportar = async (botSock) => {
        await botSock.query({
          tag: "iq",
          attrs: {
            to: "s.whatsapp.net",
            type: "set",
            xmlns: "spam",
            id: botSock.generateMessageTag
              ? botSock.generateMessageTag()
              : Date.now().toString(),
          },
          content: [
            {
              tag: "spam_list",
              attrs: { jid: targetJid },
            },
          ],
        });
      };

      let totalOk = 0;
      let totalErr = 0;
      const resultados = [];

      for (const bot of botsOnline) {
        const botSock = getSock(bot);
        let ok = 0;
        let err = 0;

        for (let i = 0; i < INTENTOS_POR_BOT; i++) {
          if (!botSock) {
            err++;
            continue;
          }
          try {
            await reportar(botSock);
            ok++;
          } catch (e) {
            err++;
          }
          await sleep(DELAY);
        }

        totalOk += ok;
        totalErr += err;

        resultados.push({
          jid: bot.jid,
          lid: bot.lid,
          ok,
          err,
          estado: err === 0 ? "ok" : ok === 0 ? "err" : "parcial",
        });
      }

      const esGrupo = from.endsWith("@g.us");
      let mentions = [];

      if (esGrupo) {
        const metadata = groupMeta || (await sock.groupMetadata(from));

        const findTarget = (num, lid) =>
          metadata.participants.find((p) => {
            const clean = jidNormalizedUser(p.id);
            if (!isLidUser(clean)) return clean === `${num}@s.whatsapp.net`;
            return lid && limpiarNumero(clean) === lid;
          });

        mentions = resultados
          .map((r) => {
            const num = limpiarNumero(r.jid);
            const t = findTarget(num, r.lid);
            return t ? jidNormalizedUser(t.id) : `${num}@s.whatsapp.net`;
          })
          .filter(Boolean);
      }

      const ejecuciones = botsOnline.length * INTENTOS_POR_BOT;

      let report = `「✦」Consulta *spam_list*\n\n`;
      report += `❖ Número » +${numero}\n`;
      report += `❖ Bots » *${botsOnline.length}* · Ejecuciones » *${totalOk}* ok / *${totalErr}* err\n\n`;

      for (let i = 0; i < resultados.length; i++) {
        const r = resultados[i];
        const visible = mentions[i]
          ? mentions[i].split("@")[0]
          : limpiarNumero(r.jid);
        const icono = r.estado === "ok" ? "ok" : r.estado === "parcial" ? `${r.ok} ok / ${r.err} err` : "err";
        report += `• @${visible} » ${icono}\n`;
      }

      report += `> by DuarteXV-Jhonatan G ✾`;

      await sock.sendMessage(
        from,
        { text: report, mentions: mentions.filter(Boolean) },
        { quoted: msg }
      );

      await react("✅");
    } catch (e) {
      console.error(e);
      await react("❌");
      if (reply) await reply({ text: "Failed" });
    }
  },
};