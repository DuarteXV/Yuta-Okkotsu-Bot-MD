import { claimOnce, getAllSockets } from "../../core/subbotManager.js";
import { jidNormalizedUser, isLidUser } from "@whiskeysockets/baileys";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const numOf = (jid = "") => jid.split("@")[0].split(":")[0];
const limpiar = (jid = "") => numOf(jid).replace(/\D/g, "");

const conTimeout = (p, ms, etiqueta = "timeout") =>
  new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error(etiqueta)), ms);
    Promise.resolve(p).then(
      (v) => { clearTimeout(t); res(v); },
      (e) => { clearTimeout(t); rej(e); }
    );
  });

const INTENTOS_POR_BOT = 3;   // ← cada bot reporta 2 veces
const DELAY = 300;
const TIMEOUT = 8000;
const DEBUG = true;

export default {
  name: ["reportar", "reporte"],
  description: "Reporta un número usando todos los bots conectados",
  category: "owner",
  ownerOnly: true,
  groupOnly: false,

  async run({ sock, from, msg, reply, text, react, groupMeta }) {
    const numero = (text || "").trim().split(/\s+/)[0].replace(/\D/g, "");

    if (!numero || numero.length < 8) {
      return reply({ text: "⚠️ Uso: *.reportar +5058888888*" });
    }

    if (!claimOnce(`reportar:${msg.key.id}`)) return;
    await react?.("🗣️");

    const targetJid = `${numero}@s.whatsapp.net`;

    // ── Sockets crudos, deduplicados por número propio ──
    const unicos = new Map();
    for (const b of getAllSockets().filter((b) => b?.user?.id)) {
      const jid = jidNormalizedUser(b.user.id);
      if (!unicos.has(jid)) unicos.set(jid, b);
    }
    const bots = [...unicos.values()];

    if (!bots.length) {
      await react?.("❌");
      return reply({ text: "❌ No hay bots conectados para reportar." });
    }

    const sent = await reply({
      text: `「✦」Consulta *spam_list*\n> ⏤͟͟͞͞⊱☕︎ *estado:* reportando con ${bots.length} bots...`,
    });
    const edit = (t) => sock.sendMessage(from, { text: t, edit: sent.key }).catch(() => {});

    const reportar = async (botSock) => {
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

    let hechos = 0;
    const resultados = await Promise.all(
      bots.map(async (bot) => {
        const botJid = jidNormalizedUser(bot.user.id);
        let ok = 0;
        let err = 0;
        let motivo = null;

        for (let i = 0; i < INTENTOS_POR_BOT; i++) {
          try {
            await reportar(bot);
            ok++;
          } catch (e) {
            err++;
            motivo = e?.message || String(e);
          }
          if (i < INTENTOS_POR_BOT - 1) await sleep(DELAY);
        }

        if (err && DEBUG) {
          console.log(`[reportar] ${botJid} → ${ok} ok / ${err} err · ${motivo}`);
        }

        hechos++;
        if (hechos % 15 === 0) {
          edit(`「✦」Consulta *spam_list*\n> ⏤͟͟͞͞⊱☕︎ *progreso:* ${hechos}/${bots.length} bots`);
        }

        return { botJid, ok, err, motivo };
      })
    );

    const totalOk = resultados.reduce((a, r) => a + r.ok, 0);
    const totalErr = resultados.reduce((a, r) => a + r.err, 0);

    const esGrupo = from.endsWith("@g.us");
    let mentions = [];

    if (esGrupo) {
      const metadata = groupMeta || (await sock.groupMetadata(from));

      const findParticipant = (bot) => {
        const num = limpiar(bot.user.id);
        const lid = bot.user.lid ? limpiar(bot.user.lid) : null;
        return metadata.participants.find((p) => {
          const clean = jidNormalizedUser(p.id);
          if (!isLidUser(clean)) return clean === `${num}@s.whatsapp.net`;
          return lid && limpiar(clean) === lid;
        });
      };

      mentions = bots.map((bot) => {
        const t = findParticipant(bot);
        return t ? jidNormalizedUser(t.id) : jidNormalizedUser(bot.user.id);
      });
    }

    let report = `「✦」Consulta *spam_list*\n\n`;
    report += `❖ Número » +${numero}\n`;
    report += `❖ Bots » *${bots.length}* · Ejecuciones » *${totalOk}* ok / *${totalErr}* err\n\n`;

    resultados.forEach((r, i) => {
      const visible = mentions[i] ? mentions[i].split("@")[0] : numOf(r.botJid);
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

    await react?.("✅");
  },
};