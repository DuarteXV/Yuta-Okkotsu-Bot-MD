import config from "../config.js";
import { log } from "./logger.js";
import { getPlugins } from "./pluginLoader.js";
import { db } from "../database/db.js";
import { checkAntilink } from "./antilink.js";
import { handleChatXp, handleCommandXp } from "./xp.js";

const groupCache = new Map();
const prefixes = Array.isArray(config.prefix) ? config.prefix : [config.prefix];

// Cache de LID de owners/co-owners: se resuelve una sola vez por número,
// no en cada mensaje. El LID de un número no cambia salvo que reinstale WhatsApp.
const configuredLidCache = new Map();

export function invalidateGroupCache(groupJid) {
  groupCache.delete(groupJid);
}

function cleanJid(jid = "") {
  if (!jid) return "";
  const atIndex = jid.lastIndexOf("@");
  if (atIndex === -1) return jid.split(":")[0];

  const userPart = jid.slice(0, atIndex).split(":")[0];
  const domainPart = jid.slice(atIndex + 1);

  return `${userPart}@${domainPart}`;
}

async function resolveLid(lidJid, groupMeta, sock) {
  if (!lidJid || !lidJid.endsWith("@lid")) return lidJid;

  const match = groupMeta?.participants?.find((p) => cleanJid(p.id || "") === lidJid);
  if (match?.phoneNumber) {
    return cleanJid(match.phoneNumber);
  }

  try {
    const resolved = await sock.signalRepository?.lidMapping?.getPNForLID(lidJid);
    if (resolved) return cleanJid(resolved);
  } catch {}

  return lidJid;
}

async function matchesConfiguredNumber(numberList, senderNum, rawLid, sock) {
  if (numberList.includes(senderNum)) return true;

  if (rawLid && rawLid.endsWith("@lid")) {
    for (const num of numberList) {
      let lid = configuredLidCache.get(num);

      if (lid === undefined) {
        try {
          const resolved = await sock.signalRepository?.lidMapping?.getLIDForPN(`${num}@s.whatsapp.net`);
          lid = resolved ? cleanJid(resolved) : null;
        } catch {
          lid = null;
        }
        configuredLidCache.set(num, lid);
      }

      if (lid && lid === rawLid) return true;
    }
  }

  return false;
}

export async function handleMessage(sock, rawMsg, botLabel = "MAIN", mainBotNum = null, activeBotsLive = []) {
  try {
    const msg = rawMsg;
    const from = msg.key?.remoteJid;
    if (!from) return;
    if (from === "status@broadcast") return;

    const isGroup = from.endsWith("@g.us");

    const participantRaw = isGroup ? (msg.key?.participant || msg.participant || "") : "";
    const participantReal = isGroup ? (msg.key?.participantAlt || "") : "";

    let senderJid;
    if (isGroup) {
      senderJid = participantRaw.endsWith("@lid") && participantReal && !participantReal.endsWith("@lid")
        ? participantReal
        : participantRaw;
    } else {
      const remoteAlt = msg.key?.remoteJidAlt || "";
      senderJid = from.endsWith("@lid") && remoteAlt && !remoteAlt.endsWith("@lid")
        ? remoteAlt
        : from;
    }

    const senderLidJid = senderJid.endsWith("@lid")
      ? senderJid
      : (isGroup ? participantRaw : (from.endsWith("@lid") ? from : ""));

    let sender = cleanJid(senderJid);
    const senderLid = cleanJid(senderLidJid);
    const botJid = cleanJid(sock.user?.id || "");

    const body =
      msg.message?.conversation ||
      msg.message?.extendedTextMessage?.text ||
      msg.message?.imageMessage?.caption ||
      msg.message?.videoMessage?.caption ||
      msg.message?.buttonsResponseMessage?.selectedButtonId ||
      msg.message?.listResponseMessage?.singleSelectReply?.selectedRowId ||
      msg.message?.templateButtonReplyMessage?.selectedId ||
      "";

    const msgType = msg.message ? Object.keys(msg.message)[0] ?? "unknown" : "unknown";

    const msgTypeLabel =
      msgType === "conversation" ? "Texto" :
      msgType === "extendedTextMessage" ? "Texto" :
      msgType === "imageMessage" ? "🖼️ Imagen" :
      msgType === "videoMessage" ? "🎥 Video" :
      msgType === "audioMessage" ? "🎵 Audio" :
      msgType === "stickerMessage" ? "🎴 Sticker" :
      msgType === "documentMessage" ? "📄 Documento" :
      msgType === "ptvMessage" ? "📹 Nota de video" :
      msgType === "reactionMessage" ? "🔥 Reacción" :
      msgType === "contactMessage" ? "👤 Contacto" :
      msgType === "locationMessage" ? "📍 Ubicación" : "Otro"

    const usedPrefix = prefixes.find((p) => body.startsWith(p)) ?? null;
    const isCmd = !!usedPrefix;

    if (msg.key?.fromMe && !isCmd) return;

    const afterPrefix = isCmd ? body.slice(usedPrefix.length).trimStart() : "";
    const cmdName = isCmd ? afterPrefix.split(/\s+/)[0].toLowerCase() : "";
    const args = isCmd ? afterPrefix.slice(cmdName.length).trim().split(/\s+/).filter(Boolean) : [];
    const text = args.join(" ");

    let groupName = "";
    let groupMeta = null;

    if (isGroup) {
      if (groupCache.has(from)) {
        groupMeta = groupCache.get(from);
        groupName = groupMeta?.subject || from;
      } else {
        try {
          groupMeta = await sock.groupMetadata(from);
          groupName = groupMeta?.subject || from;
          groupCache.set(from, groupMeta);
          setTimeout(() => groupCache.delete(from), 10 * 60 * 1000);
        } catch {
          groupName = from;
        }
      }

      const primaryBot = db.getPrimary(from);
      if (primaryBot && cmdName !== "delprimary" && cmdName !== "setprimary") {
        const myId = botJid.split("@")[0];
        if (primaryBot !== myId) return;
      }
    }

    const rawSenderLid = sender.endsWith("@lid") ? sender : (senderLid || "");

    if (sender.endsWith("@lid")) {
      sender = await resolveLid(sender, groupMeta, sock);
    }

    if (msg.pushName) db.setPushName(sender, msg.pushName);

    const senderNum = sender.split("@")[0];

    const isOwner = await matchesConfiguredNumber(config.ownerNumber, senderNum, rawSenderLid, sock);
    const isCoOwner = await matchesConfiguredNumber(config.coOwners, senderNum, rawSenderLid, sock);
    const isMod = isOwner || isCoOwner || db.hasRole(senderNum, "mod");
    const isPremium = isMod || db.hasRole(senderNum, "premium");

    let isAdmin = false;
    let isBotAdmin = false;

    if (isGroup && groupMeta?.participants) {
      const botJidClean = cleanJid(botJid);

      let botLidClean = "";
      try {
        const resolvedBotLid = await sock.signalRepository?.lidMapping?.getLIDForPN(botJidClean);
        if (resolvedBotLid) botLidClean = cleanJid(resolvedBotLid);
      } catch {}

      const senderJidClean = cleanJid(sender);

      const matchesParticipant = (p, targetJid, targetLid) => {
        const pId = cleanJid(p.id);
        const pLid = cleanJid(p.lid || "");
        return (
          pId === targetJid ||
          (targetLid && pId === targetLid) ||
          (targetLid && pLid === targetLid) ||
          pLid === targetJid
        );
      };

      const botParticipant = groupMeta.participants.find(p => matchesParticipant(p, botJidClean, botLidClean));
      const senderParticipant = groupMeta.participants.find(p => matchesParticipant(p, senderJidClean, senderLid));

      isAdmin = senderParticipant?.admin === 'admin' || senderParticipant?.admin === 'superadmin';
      isBotAdmin = botParticipant?.admin === 'admin' || botParticipant?.admin === 'superadmin';
    }

    if (isGroup) {
      const groupData = db.getGroup(from);

      if (groupData?.privateMode && !isOwner && !isCoOwner) {
        return;
      }

      if (groupData?.adminMode && !isAdmin && !isMod) {
        return;
      }

      if (groupData?.antilink && body && !isAdmin && !isMod && !isCmd) {
        const handled = await checkAntilink({ sock, msg, from, sender, body, isBotAdmin, botLabel });
        if (handled) return;
      }

      if (!isCmd && body) {
        handleChatXp(sender);
      }
    }

    log.message({ from, sender, isGroup, groupName, body, isCmd, cmdName, botLabel, msgTypeLabel });

    if (!isCmd) return;

    const plugins = getPlugins();
    const plugin = plugins.get(cmdName);

    if (!plugin) {
      return await sock.sendMessage(from, {
        text: `✖️ EƖ ᥴoᴍanძo "*${usedPrefix}${cmdName}*" ɴo ᧉxı𝗌ƚᧉ o ᧉ𝗌ƚ⍺ m⍺Ɩ ᧉsᥴꭇiƚo.\n> usa *.help* para ver la lista de comandos.`
      }, { quoted: msg });
    }

    const ctx = {
      sock,
      msg,
      from,
      sender,
      senderNum,
      botJid,
      botLabel,
      mainBotNum,
      activeBotsLive,
      isGroup,
      groupName,
      groupMeta,
      body,
      isCmd,
      cmdName,
      args,
      text,
      usedPrefix,
      isOwner,
      isCoOwner,
      isMod,
      isPremium,
      isAdmin,
      isBotAdmin,
      resolveLid: (lidJid) => resolveLid(lidJid, groupMeta, sock),
      clearGroupCache: () => groupCache.delete(from),
      reply: async (content) => {
        if (typeof content === "string") content = { text: content };
        if (content.text !== undefined) {
          const extra = content.mentions || [];
          content.mentions = [...new Set([sender, ...extra])];
        }
        try {
          return await sock.sendMessage(from, content, { quoted: msg });
        } catch (e1) {
          log.warn(`[${botLabel}] reply con quoted falló (${e1.message}), reintentando sin quoted...`);
          try {
            return await sock.sendMessage(from, content);
          } catch (e2) {
            log.error(`[${botLabel}] reply sin quoted también falló: ${e2.message} | from: ${from}`);
          }
        }
      },
      react: async (emoji) => {
        try {
          return await sock.sendMessage(from, { react: { text: emoji, key: msg.key } });
        } catch (e) {
          log.warn(`[${botLabel}] react falló: ${e.message} | from: ${from}`);
        }
      },
    };

    if (plugin.ownerOnly && !isOwner) return ctx.reply({ text: "❌ Solo el owner puede usar este comando." });
    if (plugin.modOnly && !isMod) return ctx.reply({ text: "❌ Solo moderadores pueden usar este comando." });
    if (plugin.botAdmin && isGroup && !isBotAdmin) return ctx.reply({ text: "❌ El bot necesita ser admin del grupo." });
    if (plugin.adminOnly && isGroup && !isAdmin && !isMod) return ctx.reply({ text: "❌ Solo administradores del grupo pueden usar este comando." });
    if (plugin.premiumOnly && !isPremium) return ctx.reply({ text: "⭐ Este comando es exclusivo para premium." });
    if (plugin.groupOnly && !isGroup) return ctx.reply({ text: "👥 Este comando solo funciona en grupos." });
    if (plugin.privateOnly && isGroup) return ctx.reply({ text: "📩 Este comando solo funciona en privado." });

    const start = Date.now();
    try {
      await plugin.run(ctx);
      log.cmdExec({ cmdName, sender: senderNum, success: true, ms: Date.now() - start, botLabel });
      if (isGroup) handleCommandXp(sender);
    } catch (e) {
      log.cmdExec({ cmdName, sender: senderNum, success: false, ms: Date.now() - start, botLabel });
      log.error(`Comando ${cmdName}: ${e.message}`);
      await ctx.react("❌");

      if (e.message?.toLowerCase().includes('forbidden')) {
        await ctx.reply({ text: `❌ No se pudo completar la acción: el bot necesita ser administrador del grupo.` });
      } else {
        await ctx.reply({ text: `❌ Error ejecutando \`${cmdName}\`:\n${e.message}` });
      }
    }
  } catch (e) {
    log.error(`handleMessage: ${e.message}`);
  }
}