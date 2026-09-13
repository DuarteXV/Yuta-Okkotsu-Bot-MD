import { db } from "../../database/db.js";

const pendingProposals = new Map(); // proposerJid -> { targetJid, at }
const PROPOSAL_TTL_MS = 5 * 60 * 1000;

function cleanJid(jid = "") {
  if (!jid) return "";
  const atIndex = jid.lastIndexOf("@");
  if (atIndex === -1) return jid.split(":")[0];
  const userPart = jid.slice(0, atIndex).split(":")[0];
  const domainPart = jid.slice(atIndex + 1);
  return `${userPart}@${domainPart}`;
}

function cleanExpired() {
  const now = Date.now();
  for (const [proposer, data] of pendingProposals) {
    if (now - data.at > PROPOSAL_TTL_MS) pendingProposals.delete(proposer);
  }
}

function labelPorGenero(jid) {
  const genero = (db.getGenero(jid) || "").toLowerCase();
  if (genero === "hombre") return "Esposo";
  if (genero === "mujer") return "Esposa";
  return "Espos@";
}

export default {
  name: ["marry", "casar"],
  description: "Propón o acepta matrimonio con alguien",
  category: "info",

  async run(ctx) {
    const { sock, msg, from, sender, reply, resolveLid, groupMeta } = ctx;
    cleanExpired();

    const contextInfo = msg?.message?.extendedTextMessage?.contextInfo;

    let targetJid = null;
    if (contextInfo?.mentionedJid?.length > 0) {
      targetJid = contextInfo.mentionedJid[0];
    } else if (contextInfo?.participant) {
      targetJid = contextInfo.participant;
    }

    if (!targetJid) {
      return reply({
        text: "💍 Debes mencionar a alguien o responder su mensaje para aceptar o proponer matrimonio.\n> Ejemplo » *.marry @user* o responde su mensaje con *.marry*",
      });
    }

    if (targetJid.endsWith("@lid") || isNaN(targetJid.split("@")[0])) {
      const found = groupMeta?.participants?.find((p) => p.id === targetJid || p.lid === targetJid);
      if (found?.id) targetJid = found.id;
    }

    if (targetJid.endsWith("@lid")) {
      targetJid = await resolveLid(targetJid);
    }

    const target = cleanJid(targetJid);

    if (target === sender) {
      return reply({ text: "💀 No puedes casarte contigo mismo." });
    }

    const senderPartner = db.getMarriage(sender);
    if (senderPartner) {
      return reply({ text: `❌ Ya estás casado(a) con @${senderPartner.split("@")[0]}.`, mentions: [senderPartner] });
    }

    const targetPartner = db.getMarriage(target);
    if (targetPartner) {
      return reply({ text: `❌ Esa persona ya está casada con @${targetPartner.split("@")[0]}.`, mentions: [targetPartner] });
    }

    const reverseProposal = pendingProposals.get(target);
    if (reverseProposal && reverseProposal.targetJid === sender) {
      pendingProposals.delete(target);
      db.marry(sender, target);

      const labelTarget = labelPorGenero(target);
      const labelSender = labelPorGenero(sender);

      const texto = `𓂃 ࣪˖ ⋆.˚ ʚїɞ ⋆ ˚ ༘♡ ⋆｡˚\n¡𝑆𝑒 ℎ𝑎𝑛 𝑐𝑎𝑠𝑎𝑑𝑜! \n𓂃ෆ˚\n\n*ʚଓ ${labelTarget}:*\n *@${target.split("@")[0]} ˃͈◡˂͈*\n\n*ʚଓ ${labelSender}:*\n *@${sender.split("@")[0]} ˃͈◡˂͈*\n\n*𝑑𝑖𝑠𝑓𝑟𝑢𝑡𝑒𝑛 𝑠𝑢 𝑙𝑢𝑛𝑎 𝑑𝑒 𝑚𝑖𝑒𝑙 🍯𖤐⭒๋࣭ ⭑*`;

      return reply({ text: texto, mentions: [sender, target] });
    }

    pendingProposals.set(sender, { targetJid: target, at: Date.now() });

    return reply({
      text: `💌 @${sender.split("@")[0]} le ha propuesto matrimonio a @${target.split("@")[0]}.\n> @${target.split("@")[0]}, usa *.marry @${sender.split("@")[0]}* (o responde este mensaje con *.marry*) para aceptar (expira en 5 min).`,
      mentions: [sender, target],
    });
  },
};