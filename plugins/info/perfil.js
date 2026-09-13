import { xpProgress } from "../../core/xp.js";
import { db } from "../../database/db.js";

const FALLBACK_PHOTO = "https://cdn.dix.lat/me/0b0v_20260828-c91x-qz9u-550c.jpg";

function cleanJid(jid = "") {
  if (!jid) return "";
  const atIndex = jid.lastIndexOf("@");
  if (atIndex === -1) return jid.split(":")[0];
  const userPart = jid.slice(0, atIndex).split(":")[0];
  const domainPart = jid.slice(atIndex + 1);
  return `${userPart}@${domainPart}`;
}

function labelPorGenero(jid) {
  const genero = (db.getGenero(jid) || "").toLowerCase();
  if (genero === "hombre") return "Esposo";
  if (genero === "mujer") return "Esposa";
  return "Espos@";
}

function labelSoltero(jid) {
  const genero = (db.getGenero(jid) || "").toLowerCase();
  if (genero === "hombre") return "Soltero";
  if (genero === "mujer") return "Soltera";
  return "Solter@";
}

export default {
  name: ["perfil", "profile"],
  description: "Muestra tu perfil: foto, monedas y XP",
  category: "info",

  async run({ sock, sender, from, msg, groupMeta, resolveLid, reply }) {
    const contextInfo = msg?.message?.extendedTextMessage?.contextInfo;

    let targetJid = null;
    if (contextInfo?.mentionedJid?.length > 0) {
      targetJid = contextInfo.mentionedJid[0];
    } else if (contextInfo?.participant) {
      targetJid = contextInfo.participant;
    }

    let target = sender;
    if (targetJid) {
      if (targetJid.endsWith("@lid") || isNaN(targetJid.split("@")[0])) {
        const found = groupMeta?.participants?.find((p) => p.id === targetJid || p.lid === targetJid);
        if (found?.id) targetJid = found.id;
      }
      if (targetJid.endsWith("@lid")) {
        targetJid = await resolveLid(targetJid);
      }
      target = cleanJid(targetJid);
    }

    const user = db.getUser(target);
    const eco = db.getEco(target);
    const partner = db.getMarriage(target);
    const { level, xp, missing } = xpProgress(user.xp || 0);

    let photoUrl = FALLBACK_PHOTO;
    try {
      photoUrl = await sock.profilePictureUrl(target, "image");
    } catch {
      // Sin foto o privacidad restringida: se usa la foto de respaldo
    }

    const total = eco.bolsillo + eco.banco;
    const mention = `@${target.split("@")[0]}`;

    const parejaLine = partner
      ? `𓂃ෆ˚ 💍 ${labelPorGenero(partner)}: @${partner.split("@")[0]} ˃͈◡˂͈\n`
      : `𓂃ෆ˚ 💔 ⍴ᥲrᥱjᥲ: ${labelSoltero(target)}\n`;

    const caption =
      `𓂃ෆ˚ 🍮 ⍴ᥲrᥱ𝖿іᥣ ძᥱ ${mention} ౨ৎ\n\n` +
      `𓂃ෆ˚ 🍮 m᥆ᥒᥱძᥲs ${total} [ᑲ᥆ᥣsіᥣᥣ᥆: ${eco.bolsillo} | ᑲᥲᥒᥴ᥆: ${eco.banco}]\n` +
      `⏤͟͟͞͞  ⚡ ᥒі᥎ᥱᥣ: ${level}\n` +
      parejaLine +
      `𓂃ෆ˚ *᥊⍴:* ${xp} [𝖿ᥲᥣ𝗍ᥲᥒ ${missing} ⍴ᥲrᥲ ᥒі᥎ᥱᥣ${level + 1}]`;

    const mentions = partner ? [target, partner] : [target];

    try {
      await sock.sendMessage(
        from,
        { image: { url: photoUrl }, caption, mentions },
        { quoted: msg }
      );
    } catch (error) {
      await reply({ text: `Error al mostrar el perfil: ${error.message}` });
      console.error("Error en perfil:", error);
    }
  }
};