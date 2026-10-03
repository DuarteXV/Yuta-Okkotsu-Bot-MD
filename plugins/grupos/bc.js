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

    // Si varios bots escucharon el comando, solo uno lo ejecuta
    if (!claimOnce(`bc:${msg.key.id}`)) return;

    const sent = await reply({ text: "📢 `difusión`\n> ⏤͟͟͞͞⊱☕︎ *estado:* reuniendo bots..." });
    const edit = (t) => sock.sendMessage(from, { text: t, edit: sent.key });

    const bots = getAllSockets().filter((b) => b?.user);

    // 1) Todos los bots listan sus grupos al mismo tiempo
    const listas = await Promise.allSettled(
      bots.map(async (bot) => ({
        bot,
        grupos: Object.values(await bot.groupFetchAllParticipating()),
      }))
    );

    // groupId -> Map(numeroBot -> socket)
    const grupos = new Map();
    for (const r of listas) {
      if (r.status !== "fulfilled") continue;
      const { bot, grupos: gs } = r.value;
      for (const g of gs) {
        if (!grupos.has(g.id)) grupos.set(g.id, new Map());
        grupos.get(g.id).set(numOf(bot.user.id), bot);
      }
    }

    // 2) Decide quién manda en cada grupo y arma la cola de cada bot
    const colas = new Map(); // bot -> [gid, ...]
    let skip = 0;
    for (const [gid, botsEnGrupo] of grupos) {
      if (gid === from) { skip++; continue; }
      const primary = db.getPrimary(gid);
      const emisor = primary
        ? botsEnGrupo.get(primary) ?? null   // con primario: solo ese
        : [...botsEnGrupo.values()][0];      // sin primario: el bot que esté ahí
      if (!emisor) { skip++; continue; }
      if (!colas.has(emisor)) colas.set(emisor, []);
      colas.get(emisor).push(gid);
    }

    const total = [...colas.values()].reduce((a, q) => a + q.length, 0);
    let ok = 0, fail = 0, hechos = 0;

    await edit(`📢 \`difusión\`\n> ⏤͟͟͞͞⊱☕︎ *enviando:* 0/${total} (${colas.size} bots)`);

    // 3) Todos los bots mandan a la vez, cada uno con su propio ritmo
    await Promise.all(
      [...colas].map(async ([bot, cola]) => {
        for (const gid of cola) {
          try { await bot.sendMessage(gid, { text }); ok++; } catch { fail++; }
          hechos++;
          if (hechos % 10 === 0) {
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