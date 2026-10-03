import { db } from "../../database/db.js";
import { claimOnce, getAllSockets } from "../../core/subbotManager.js";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const numOf = (jid = "") => jid.split("@")[0].split(":")[0];

export default {
  name: ["bc", "difundir", "broadcast"],
  description: "Envía un mensaje a todos los grupos donde haya bots",
  category: "owner",
  ownerOnly: true,
  groupOnly: true,

  async run({ sock, from, msg, reply, text }) {
    if (!text) return reply({ text: "⚠️ Escribe el mensaje.\nEj: `.bc Hola a todos`" });
    if (!claimOnce(`bc:${msg.key.id}`)) return;

    const sent = await reply({ text: "📢 `difusión`\n> ⏤͟͟͞͞⊱☕︎ *estado:* reuniendo bots..." });
    const edit = (t) => sock.sendMessage(from, { text: t, edit: sent.key });

    const bots = getAllSockets().filter((b) => b?.user);

    // 1) Todos los bots listan sus grupos a la vez
    const listas = await Promise.allSettled(
      bots.map(async (bot) => ({
        bot,
        grupos: Object.values(await bot.groupFetchAllParticipating()),
      }))
    );

    const grupos = new Map(); // gid -> Map(numeroBot -> socket)
    for (const r of listas) {
      if (r.status !== "fulfilled") continue;
      const { bot, grupos: gs } = r.value;
      for (const g of gs) {
        if (!grupos.has(g.id)) grupos.set(g.id, new Map());
        grupos.get(g.id).set(numOf(bot.user.id), bot);
      }
    }

    // 2) Reparto: primario si hay, si no el bot con menos carga
    const colas = new Map();
    let skip = 0;
    const orden = [...grupos].sort((a, b) => a[1].size - b[1].size);

    for (const [gid, botsEnGrupo] of orden) {
      if (gid === from) { skip++; continue; }

      const primary = db.getPrimary(gid);
      let emisor = null;

      if (primary) {
        emisor = botsEnGrupo.get(primary) ?? null;
      } else {
        let min = Infinity;
        for (const b of botsEnGrupo.values()) {
          const carga = colas.get(b)?.length ?? 0;
          if (carga < min) { min = carga; emisor = b; }
        }
      }

      if (!emisor) { skip++; continue; }
      if (!colas.has(emisor)) colas.set(emisor, []);
      colas.get(emisor).push(gid);
    }

    const total = [...colas.values()].reduce((a, q) => a + q.length, 0);
    let ok = 0, fail = 0, hechos = 0;

    await edit(`📢 \`difusión\`\n> ⏤͟͟͞͞⊱☕︎ *enviando:* 0/${total} (${colas.size} bots)`);

    // 3) Todos los bots mandan al mismo tiempo
    await Promise.all(
      [...colas].map(async ([bot, cola]) => {
        for (const gid of cola) {
          try { await bot.sendMessage(gid, { text }); ok++; } catch { fail++; }
          hechos++;
          if (hechos % 25 === 0) {
            edit(`📢 \`difusión\`\n> ⏤͟͟͞͞⊱☕︎ *progreso:* ${hechos}/${total}`).catch(() => {});
          }
          await sleep(2000 + Math.random() * 2000);
        }
      })
    );

    await edit(
      `📢 \`difusión terminada\`\n` +
      `> ✅ *Enviados:* ${ok}\n` +
      `> ❌ *Fallidos:* ${fail}\n` +
      `> ⏭️ *Omitidos:* ${skip}`
    );
  },
};