import { createDecipheriv } from "node:crypto";
import { Readable } from "node:stream";

const API = "https://g.api.mega.co.nz/cs";
const MAX_MB = 100; // por encima de esto no se manda el archivo, solo se avisa
const TIMEOUT = 20000;

const MIMES = {
  mp4: "video/mp4", mkv: "video/x-matroska", webm: "video/webm", mov: "video/quicktime",
  mp3: "audio/mpeg", m4a: "audio/mp4", ogg: "audio/ogg", wav: "audio/wav", flac: "audio/flac",
  jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", gif: "image/gif",
  html: "text/html", htm: "text/html", txt: "text/plain", pdf: "application/pdf",
  zip: "application/zip", rar: "application/vnd.rar", "7z": "application/x-7z-compressed",
  apk: "application/vnd.android.package-archive",
};

const ERRORES = {
  [-9]: "El archivo no existe o fue eliminado.",
  [-16]: "El archivo fue bloqueado por MEGA (términos de servicio).",
  [-17]: "MEGA limitó el ancho de banda de este servidor. Intenta más tarde.",
  [-18]: "El archivo no está disponible temporalmente. Intenta más tarde.",
};

const extDe = (n) => (n.split(".").pop() || "").toLowerCase();

/** Saca { id, key } de los dos formatos de enlace */
function parsear(text) {
  const nuevo = text.match(/mega\.(?:nz|io|co\.nz)\/file\/([\w-]+)#([\w-]+)/i);
  if (nuevo) return { id: nuevo[1], key: nuevo[2] };
  const viejo = text.match(/mega\.(?:nz|io|co\.nz)\/#!([\w-]+)!([\w-]+)/i);
  if (viejo) return { id: viejo[1], key: viejo[2] };
  return null;
}

/** Clave de archivo (32 bytes) → clave AES (16 bytes, XOR de las mitades) + nonce CTR (8 bytes) */
function derivarClaves(keyB64) {
  const raw = Buffer.from(keyB64, "base64url");
  if (raw.length !== 32) throw new Error("La clave del enlace es inválida (¿link incompleto o de carpeta?).");
  const aes = Buffer.alloc(16);
  for (let i = 0; i < 16; i++) aes[i] = raw[i] ^ raw[i + 16];
  const iv = Buffer.concat([raw.subarray(16, 24), Buffer.alloc(8)]); // nonce + contador en 0
  return { aes, iv };
}

/** Pide a la API de MEGA la URL de descarga, el tamaño y el nombre cifrado */
async function infoArchivo(id) {
  const res = await fetch(`${API}?id=${Date.now() % 1e9}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify([{ a: "g", g: 1, ssl: 1, p: id }]),
    signal: AbortSignal.timeout(TIMEOUT),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} en la API de MEGA`);

  const json = await res.json();
  const data = Array.isArray(json) ? json[0] : json;
  if (typeof data === "number") throw new Error(ERRORES[data] || `MEGA devolvió el error ${data}.`);
  if (!data?.g) throw new Error("MEGA no devolvió enlace de descarga.");
  return data; // { g: url, s: tamaño, at: atributos cifrados }
}

/** Descifra el nombre del archivo (AES-128-CBC, IV cero) */
function leerNombre(at, aesKey) {
  try {
    const d = createDecipheriv("aes-128-cbc", aesKey, Buffer.alloc(16));
    d.setAutoPadding(false);
    const txt = Buffer.concat([d.update(Buffer.from(at, "base64url")), d.final()])
      .toString("utf8")
      .replace(/\0+$/, "");
    if (!txt.startsWith("MEGA")) return null;
    return JSON.parse(txt.slice(4)).n || null;
  } catch {
    return null;
  }
}

export default {
  name: ["mega", "megadl"],
  description: "Descarga archivos de MEGA a partir del enlace (audio, video, HTML, zip, etc.)",
  category: "dl",
  groupOnly: false,

  async run({ sock, from, msg, text, usedPrefix, reply, react }) {
    try {
      if (!text) {
        return await reply({
          text: `⚠️ Manda el link de MEGA.\n\n💡 *Uso:* ${usedPrefix || "."}mega <link>`,
        });
      }

      if (/mega\.(nz|io|co\.nz)\/(#F!|folder\/)/i.test(text)) {
        return await reply({ text: "❌ Las carpetas no están soportadas, manda el link de un archivo." });
      }

      const enlace = parsear(text);
      if (!enlace) {
        return await reply({ text: "❌ Ese no parece un link de MEGA válido (debe incluir la clave después del #)." });
      }

      await react("⏳");

      const { aes, iv } = derivarClaves(enlace.key);
      const info = await infoArchivo(enlace.id);

      const nombre = (leerNombre(info.at, aes) || "archivo").replace(/[\\/:*?"<>|]+/g, "_");
      const bytes = Number(info.s) || 0;
      const mb = bytes / 1048576;

      if (mb > MAX_MB) {
        await react("✅");
        return await reply({
          text: `📦 *${nombre}* pesa ${mb.toFixed(1)} MB, es demasiado para mandarlo por aquí (límite ${MAX_MB} MB).\n\n🔗 Bájalo desde el enlace original:\n${text.match(/https?:\/\/\S+/)?.[0] || ""}`,
        });
      }

      // La conexión tiene timeout; el cuerpo puede tardar lo que haga falta
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), TIMEOUT);
      let res;
      try {
        res = await fetch(info.g, { signal: ctrl.signal });
      } finally {
        clearTimeout(t);
      }
      if (res.status === 509) throw new Error(ERRORES[-17]);
      if (!res.ok) throw new Error(`HTTP ${res.status} al descargar`);

      // Descifrado al vuelo (AES-128-CTR): nada se guarda en disco
      const decipher = createDecipheriv("aes-128-ctr", aes, iv);
      const origen = Readable.fromWeb(res.body);
      origen.on("error", (e) => decipher.destroy(e));
      decipher.on("error", (e) => console.error("[mega:stream]", e.message));
      const stream = origen.pipe(decipher);

      const mimetype = MIMES[extDe(nombre)] || "application/octet-stream";
      const caption = `Aquí tienes :D\n\n📄 ${nombre} (${mb.toFixed(1)} MB)`;

      if (/^video\//.test(mimetype) && mb <= 64) {
        await sock.sendMessage(from, { video: { stream }, caption, mimetype }, { quoted: msg });
      } else if (/^audio\//.test(mimetype)) {
        await sock.sendMessage(from, { audio: { stream }, mimetype, fileName: nombre }, { quoted: msg });
      } else if (/^image\//.test(mimetype) && mb <= 16) {
        await sock.sendMessage(from, { image: { stream }, caption }, { quoted: msg });
      } else {
        await sock.sendMessage(
          from,
          { document: { stream }, mimetype, fileName: nombre, caption },
          { quoted: msg }
        );
      }

      await react("✅");
    } catch (e) {
      console.error("[mega]", e);
      await react("❌");
      await reply({ text: `❌ Error al descargar: ${e.message}` });
    }
  },
};
