import { db } from "../database/db.js";
import { claimOnce, getAllSockets } from "../lib/subbotManager.js"; // ajusta la ruta

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const numOf = (jid = "") => jid.split("@")[0].split(":")[0];

export default {
  name: ["difundir", "bc", "broadcast"],
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

    const bots = getAllSockets().filter((b) => b?.user && b.ws?.isOpen);

    // groupId -> Map(numeroBot -> socket)
    const grupos = new Map();
    for (const bot of bots) {
      try {
        const all = await bot.groupFetchAllParticipating();
        for (const g of Object.values(all)) {
          if (!grupos.has(g.id)) grupos.set(g.id, new Map());
          grupos.get(g.id).set(numOf(bot.user.id), bot);
        }
      } catch {}
      await sleep(1000);
    }

    let ok = 0, fail = 0, skip = 0, i = 0;

    for (const [gid, botsEnGrupo] of grupos) {
      i++;
      if (gid === from) { skip++; continue; } // no repetir en el grupo donde lo escribiste

      const primary = db.getPrimary(gid);
      const emisor = primary
        ? botsEnGrupo.get(primary) ?? null        // primario (si no está conectado, se omite)
        : [...botsEnGrupo.values()][0];           // sin primario: el bot que esté ahí

      if (!emisor) { skip++; continue; }

      try {
        await emisor.sendMessage(gid, { text });
        ok++;
      } catch {
        fail++;
      }

      if (i % 5 === 0) {
        await edit(`📢 \`difusión\`\n> ⏤͟͟͞͞⊱☕︎ *progreso:* ${i}/${grupos.size}`);
      }
      await sleep(3000 + Math.random() * 2000);
    }

    await edit(
      `📢 \`difusión terminada\`\n` +
      `> ✅ *Enviados:* ${ok}\n` +
      `> ❌ *Fallidos:* ${fail}\n` +
      `> ⏭️ *Omitidos:* ${skip}`
    );
  },
};