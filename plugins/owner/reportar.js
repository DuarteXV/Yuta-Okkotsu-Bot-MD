import config from "../../config.js";
import { activeBots } from "../../core/subbotManager.js";
import { jidNormalizedUser, isLidUser } from "@whiskeysockets/baileys";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const conTimeout = (p, ms, etiqueta = "timeout") =>
  new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error(etiqueta)), ms);
    Promise.resolve(p).then(
      (v) => { clearTimeout(t); res(v); },
      (e) => { clearTimeout(t); rej(e); }
    );
  });

const INTENTOS_POR_BOT = 3;
const DELAY = 350;
const TIMEOUT = 8000;
const DEBUG = true;

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
        await react("🔥");
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

      const getSock = (b) =>
        b.sock || b.socket || b.conn || b.client || b.waSocket || b.s || null;

      const limpiarNumero = (jid = "") =>
        jid.split("@")[0].split(":")[0].replace(/\D/g, "");

      const reportar = async (botSock) => {
        if (!botSock) throw new Error("sin socket");

        const node = {
          tag: "iq",
          attrs: {
            to: "s.whatsapp.net",
            type: "set",
            xmlns: "spam",
            id: botSock.generateMessageTag
              ? botSock.generateMessageTag()
              : `${Date.now()}${Math.floor(Math.random() * 9999)}`,
          },
          content: [{ tag: "spam_list", attrs: { jid: targetJid } }],
        };

        if (typeof botSock.query === "function") {
          await conTimeout(botSock.query(node), TIMEOUT, "timeout iq");
          return;
        }
        if (typeof botSock.sendNode === "function") {
          botSock.sendNode(node);
          return;
        }
        throw new Error("socket sin query ni sendNode");
      };

      const resultados = await Promise.all(
        botsOnline.map(async (bot) => {
          const botSock = getSock(bot);
          let ok = 0;
          let err = 0;
          let motivo = null;

          for (let i = 0; i < INTENTOS_POR_BOT; i++) {
            try {
              await reportar(botSock);
              ok++;
            } catch (e) {
              err++;
              motivo = e?.message || String(e);
            }
            if (i < INTENTOS_POR_BOT - 1) await sleep(DELAY);
          }

          if (err && DEBUG) {
            console.log(`[reportar] ${bot.jid} → ${ok} ok / ${err} err · ${motivo}`);
          }

          return { jid: bot.jid, lid: bot.lid, ok, err, motivo };
        })
      );

      const totalOk = resultados.reduce((a, r) => a + r.ok, 0);
      const totalErr = resultados.reduce((a, r) => a + r.err, 0);

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

        mentions = resultados.map((r) => {
          const num = limpiarNumero(r.jid);
          const t = findTarget(num, r.lid);
          return t ? jidNormalizedUser(t.id) : `${num}@s.whatsapp.net`;
        });
      }

      // ── Reporte ──
      let report = `「✦」Consulta *spam_list*\n\n`;
      report += `❖ Número » +${numero}\n`;
      report += `❖ Bots » *${botsOnline.length}* · Ejecuciones » *${totalOk}* ok / *${totalErr}* err\n\n`;

      resultados.forEach((r, i) => {
        const visible = mentions[i] ? mentions[i].split("@")[0] : limpiarNumero(r.jid);
        const estado =
          r.err === 0 ? "ok"
          : r.ok === 0 ? "err"
          : `${r.ok} ok / ${r.err} err`;
        report += `• @${visible} » ${estado}\n`;
      });

      report += `> by DuarteXV-JonathanG`;

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