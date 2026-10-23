// plugins/owner/reportar.js
import { getAllSockets } from "../../core/subbotManager.js";
import { log } from "../../core/logger.js";

// ── Configuración ─────────────────────────────
const MIN_REPORTES = 2;
const MAX_REPORTES = 30;
const DEFAULT_FLOW = "ContactInfo"; // alternativa: "MessageMenu"
const TIMEOUT_MS = 15_000;
const JITTER_MS = 1_200;      // dispersión aleatoria por reporte
const REPEAT_GAP_MS = 2_500;  // espera extra cuando un mismo bot repite

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const esTimeout = (m = "") => /timeout|timed out/i.test(m);

// ── Helpers ───────────────────────────────────
function parseTarget(raw) {
  if (!raw) return null;

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
  name: ["reportar", "reportnum"],
  ownerOnly: true,

  run: async (ctx) => {
    const { args, reply, react, sock } = ctx;

    // ── Parseo: .reportar <número> [cantidad] ──
    let numeroRaw = null;
    let cantidad = null;
    let flow = DEFAULT_FLOW;

    for (const tk of args) {
      if (tk === "|") continue;

      const low = tk.toLowerCase();
      if (low === "menu") { flow = "MessageMenu"; continue; }
      if (low === "contacto") { flow = "ContactInfo"; continue; }

      const largo = tk.replace(/\D/g, "").length;
      if (numeroRaw === null && largo >= 7) { numeroRaw = tk; continue; }
      if (cantidad === null && largo >= 1 && largo <= 2) cantidad = +tk.replace(/\D/g, "");
    }

    const targetJid = parseTarget(numeroRaw);
    if (!targetJid) {
      return reply(
        "✖️ Uso: *.reportar <número> [cantidad]*\n" +
        `> • Cantidad: ${MIN_REPORTES}-${MAX_REPORTES} (por defecto: todos los bots)\n` +
        "> • Ej: `.reportar 573001234567` · `.reportar 573001234567 5`"
      );
    }

    // ── Pool de bots conectados ──
    const pool = [...new Set([...getAllSockets(), sock])]
      .filter((s) => s?.user?.id && s?.ws?.isOpen !== false);

    if (pool.length === 0) return reply("❌ No hay bots conectados para reportar.");

    // ── Cantidad (default: todos los bots) ──
    let nota = "";
    if (cantidad === null) {
      cantidad = Math.min(pool.length, MAX_REPORTES);
    } else if (cantidad < MIN_REPORTES) {
      cantidad = MIN_REPORTES;
      nota = ` (mínimo ${MIN_REPORTES})`;
    } else if (cantidad > MAX_REPORTES) {
      cantidad = MAX_REPORTES;
      nota = ` (máximo ${MAX_REPORTES})`;
    }

    // Barajado Fisher-Yates
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

    // ── Disparo en paralelo ──
    const total = shuffled.length;
    const tareas = new Array(cantidad);

    for (let i = 0; i < cantidad; i++) {
      const s = shuffled[i % total];
      const espera = ((i / total) | 0) * REPEAT_GAP_MS + Math.random() * JITTER_MS;

      tareas[i] = (async () => {
        await sleep(espera);
        await s.query({ ...base, attrs: { ...base.attrs } }, TIMEOUT_MS);
      })();
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

    const fallidos = cantidad - ok - sinResp;
    await react(fallidos === 0 ? "✅" : ok > 0 ? "⚠️" : "❌");

    // ── Resumen ──
    const numero = targetJid.split("@")[0];
    let out = "📢 *Reporte enviado*\n\n";
    out += `> • Número: +${numero}\n`;
    out += `> • Reportes: ${cantidad}${nota}\n`;
    out += `> • Bots: ${Math.min(pool.length, cantidad)}${cantidad > pool.length ? ` (+${cantidad - pool.length} reenvíos)` : ""}\n`;
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

    log.info(`[REPORTAR] ${cantidad}→${targetJid} ok=${ok} sinResp=${sinResp} fail=${fallidos}`);
    return reply(out);
  }
};