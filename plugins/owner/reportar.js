// plugins/owner/reportar.js
import { getAllSockets } from "../../core/subbotManager.js";
import { log } from "../../core/logger.js";

// ── Configuración ─────────────────────────────
const MIN_POR_BOT = 2;
const MAX_POR_BOT = 30;        // máximo de reportes POR BOT
const DEFAULT_FLOW = "ContactInfo"; // alternativa: "MessageMenu"
const TIMEOUT_MS = 15_000;

const esTimeout = (m = "") => /timeout|timed out/i.test(m);

// ── Helpers ───────────────────────────────────
function parseTarget(raw) {
  if (!raw) return null;

  // acepta +57xxx, 57xxx, 57xxx@s.whatsapp.net, 57xxx:12@...
  const at = raw.lastIndexOf("@");
  if (at !== -1) {
    const user = raw.slice(0, at).split(":")[0].replace(/\D/g, "");
    const server = raw.slice(at + 1).toLowerCase();
    return user ? `${user}@${server}` : null;
  }

  const d = raw.replace(/\D/g, "");
  return d.length >= 7 ? `${d}@s.whatsapp.net` : null;
}

export default {
  name: ["reportar", "report", "reportnum"],
  ownerOnly: true,

  run: async (ctx) => {
    const { args, reply, react, sock } = ctx;

    // ── Parseo: .reportar <número> | <reportes por bot> ──
    let numeroRaw = null;
    let porBot = null;
    let flow = DEFAULT_FLOW;

    for (const tk of args) {
      if (tk === "|") continue;

      const low = tk.toLowerCase();
      if (low === "menu") { flow = "MessageMenu"; continue; }
      if (low === "contacto") { flow = "ContactInfo"; continue; }

      const digits = tk.replace(/\D/g, "");

      // primer token con 7+ dígitos = número (el '+' y separadores se ignoran)
      if (numeroRaw === null && digits.length >= 7) { numeroRaw = tk; continue; }

      // resto: cantidad (1-2 dígitos) — funciona con o sin '|'
      if (porBot === null && digits.length >= 1 && digits.length <= 2) {
        porBot = +digits;
      }
    }

    const targetJid = parseTarget(numeroRaw);
    if (!targetJid) {
      return reply(
        "✖️ Uso: *.reportar <número> | <reportes por bot>*\n" +
        `> • Reportes por bot: ${MIN_POR_BOT}-${MAX_POR_BOT} (por defecto: ${MAX_POR_BOT})\n` +
        "> • Reportan TODOS los bots (subbots + conectados)\n" +
        "> • Número con o sin '+'\n" +
        "> • Ej: `.reportar +573001234567 | 5` · `.reportar 573001234567 | 30`"
      );
    }

    // ── Pool: TODOS los bots conectados ──
    const pool = [...new Set([...getAllSockets(), sock])]
      .filter((s) => s?.user?.id && s?.ws?.isOpen !== false);

    if (pool.length === 0) return reply("❌ No hay bots conectados para reportar.");

    // ── Reportes por bot (default: máximo) ──
    let nota = "";
    if (porBot === null) {
      porBot = MAX_POR_BOT;
    } else if (porBot < MIN_POR_BOT) {
      porBot = MIN_POR_BOT;
      nota = ` (mínimo ${MIN_POR_BOT})`;
    } else if (porBot > MAX_POR_BOT) {
      porBot = MAX_POR_BOT;
      nota = ` (máximo ${MAX_POR_BOT})`;
    }

    // Barajado Fisher-Yates (orden de disparo)
    const shuffled = pool.slice();
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = (Math.random() * (i + 1)) | 0;
      const tmp = shuffled[i];
      shuffled[i] = shuffled[j];
      shuffled[j] = tmp;
    }

    // Nodo reutilizable (el contenido es read-only, solo clonamos attrs)
    const base = {
      tag: "iq",
      attrs: { to: "s.whatsapp.net", type: "set", xmlns: "spam" },
      content: [{ tag: "spam_list", attrs: { jid: targetJid, spam_flow: flow }, content: [] }],
    };

    await react("⏳");

    // ── Disparo EN PARALELO: cada bot manda `porBot` reportes de golpe ──
    const total = shuffled.length * porBot;
    const tareas = [];

    for (const s of shuffled) {
      for (let k = 0; k < porBot; k++) {
        tareas.push(s.query({ ...base, attrs: { ...base.attrs } }, TIMEOUT_MS));
      }
    }

    const resultados = await Promise.allSettled(tareas);

    let ok = 0;
    let sinResp = 0;
    const fallos = new Map();

    for (const r of resultados) {
      if (r.status === "fulfilled") { ok++; continue; }
      const m = r.reason?.message || String(r.reason);
      if (esTimeout(m)) { sinResp++; continue; }
      fallos.set(m, (fallos.get(m) || 0) + 1);
    }

    const fallidos = total - ok - sinResp;
    await react(fallidos === 0 ? "✅" : ok > 0 ? "⚠️" : "❌");

    // ── Resumen ──
    const numero = targetJid.split("@")[0];
    let out = "📢 *Reporte enviado*\n\n";
    out += `> • Número: +${numero}\n`;
    out += `> • Bots: ${shuffled.length}\n`;
    out += `> • Reportes por bot: ${porBot}${nota}\n`;
    out += `> • Total de reportes: ${total}\n`;
    out += `> • Resultado: ✅ ${ok}`;
    if (sinResp) out += ` · ⏱️ ${sinResp} sin respuesta`;
    if (fallidos) out += ` · ❌ ${fallidos}`;

    if (fallos.size) {
      out += "\n\n*Fallos:*\n";
      let i = 0;
      for (const [m, c] of fallos) {
        if (i++ >= 3) break;
        out += `> • ${c}x ${m.slice(0, 90)}\n`;
      }
    }

    log.info(`[REPORTAR] ${shuffled.length} bots x${porBot} → ${targetJid} ok=${ok} sinResp=${sinResp} fail=${fallidos}`);
    return reply(out);
  }
};