import fs from "fs";
import path from "path";
import Database from "better-sqlite3";
import makeWASocket, {
  DisconnectReason,
  makeCacheableSignalKeyStore,
  fetchLatestBaileysVersion,
  initAuthCreds,
  BufferJSON,
  proto,
} from "@whiskeysockets/baileys";
import pino from "pino";
import { mkdir } from "fs/promises";
import { log } from "./logger.js";
import { db } from "../database/db.js";
import { handleMessage } from "./messageHandler.js";

const SUBBOTS_DIR = "./sessions/subbots";
if (!fs.existsSync(SUBBOTS_DIR)) fs.mkdirSync(SUBBOTS_DIR, { recursive: true });

export const activeBots = new Map();
const sockets = new Map();
let mainSock = null;

const logger = pino({ level: "silent" });
const PAIRING_TIMEOUT_MS = 60_000;

function backoffDelay(attempt) {
  const base = 5000;
  const capped = Math.min(60_000, base * Math.pow(1.6, Math.min(attempt, 8)));
  return capped + Math.random() * 1500;
}

function isSessionRegistered(sessionDir) {
  const dbPath = path.join(sessionDir, "auth.db");
  if (!fs.existsSync(dbPath)) return false;
  try {
    const authDb = new Database(dbPath, { readonly: true, fileMustExist: true });
    const row = authDb.prepare("SELECT data FROM auth WHERE id = ?").get("creds");
    authDb.close();
    if (!row) return false;
    const creds = JSON.parse(row.data);
    return !!creds.registered;
  } catch {
    return false;
  }
}

function esLabelGenerico(label) {
  return !label || label === "Subbot" || label === "MAIN" || label.startsWith("SUB_");
}

async function useSQLiteAuthState(sessionDir) {
  if (!fs.existsSync(sessionDir)) {
    fs.mkdirSync(sessionDir, { recursive: true });
  }

  const authDb = new Database(path.join(sessionDir, "auth.db"));
  authDb.pragma("journal_mode = WAL");
  authDb.exec(`CREATE TABLE IF NOT EXISTS auth (id TEXT PRIMARY KEY, data TEXT)`);

  const readData = (id) => {
    const row = authDb.prepare("SELECT data FROM auth WHERE id = ?").get(id);
    return row ? JSON.parse(row.data, BufferJSON.reviver) : null;
  };

  const writeData = (data, id) => {
    authDb
      .prepare("INSERT OR REPLACE INTO auth (id, data) VALUES (?, ?)")
      .run(id, JSON.stringify(data, BufferJSON.replacer));
  };

  const removeData = (id) => authDb.prepare("DELETE FROM auth WHERE id = ?").run(id);

  let creds = readData("creds") || initAuthCreds();

  return {
    state: {
      creds,
      keys: {
        get: async (type, ids) => {
          const data = {};
          ids.forEach((id) => {
            let value = readData(`${type}-${id}`);
            if (type === "app-state-sync-key" && value) {
              value = proto.Message.AppStateSyncKeyData.fromObject(value);
            }
            data[id] = value;
          });
          return data;
        },
        set: async (data) => {
          for (const cat in data) {
            for (const id in data[cat]) {
              const val = data[cat][id];
              if (val) {
                writeData(val, `${cat}-${id}`);
              } else {
                removeData(`${cat}-${id}`);
              }
            }
          }
        },
      },
    },
    saveCreds: () => writeData(creds, "creds"),
    closeDb: () => { try { authDb.close(); } catch {} },
  };
}

export function registerMainBot(sock, label = "MAIN") {
  mainSock = sock;
  const rawJid = sock.user?.id || "";
  const jid = rawJid ? rawJid.split(":")[0].split("@")[0] + "@s.whatsapp.net" : "";
  const status = jid ? "online" : "connecting";

  const rawLid = sock.user?.lid || "";
  const lid = rawLid ? rawLid.split(":")[0] : "";

  const existing = jid ? db.getBot(jid) : null;
  const labelFinal = !esLabelGenerico(existing?.label) ? existing.label : label;

  activeBots.set("main", { label: labelFinal, jid, status, isMain: true, lid });

  if (jid) {
    const oldMains = db.getAllBots().filter(b => b.isMain && b.jid !== jid);
    for (const old of oldMains) {
      db.setBot(old.jid, { isMain: false, status: "offline" }, true);
    }

    db.setBot(jid, { label: labelFinal, jid, status, isMain: true, lid });
    global.mainBotNum = jid.split("@")[0];
  }

  if (!jid) {
    sock.ev.on("connection.update", ({ connection }) => {
      if (connection === "open") {
        mainSock = sock;
        const currentRawJid = sock.user?.id || "";
        const currentJid = currentRawJid ? currentRawJid.split(":")[0].split("@")[0] + "@s.whatsapp.net" : "";
        const currentRawLid = sock.user?.lid || "";
        const currentLid = currentRawLid ? currentRawLid.split(":")[0] : "";

        if (currentJid) {
          const oldMains = db.getAllBots().filter(b => b.isMain && b.jid !== currentJid);
          for (const old of oldMains) {
            db.setBot(old.jid, { isMain: false, status: "offline" }, true);
          }

          const existingNow = db.getBot(currentJid);
          const labelFinalNow = !esLabelGenerico(existingNow?.label) ? existingNow.label : label;

          activeBots.set("main", { label: labelFinalNow, jid: currentJid, status: "online", isMain: true, lid: currentLid });
          db.setBot(currentJid, { label: labelFinalNow, jid: currentJid, status: "online", isMain: true, lid: currentLid });
          global.mainBotNum = currentJid.split("@")[0];
        }
      }
    });
  }
}

export function getMainSock() {
  return mainSock;
}

export function getAllSockets() {
  const lista = [];
  if (mainSock) lista.push(mainSock);
  for (const entry of sockets.values()) {
    if (entry?.sock) lista.push(entry.sock);
  }
  return lista;
}

export function updateBotStatus(id, data) {
  const current = activeBots.get(id) || {};
  activeBots.set(id, { ...current, ...data });

  const targetKey = data.jid || id;
  const existing = db.getBot(targetKey);

  if (!esLabelGenerico(existing?.label) && data.label) {
    delete data.label;
  }

  if (data.jid) {
    db.deleteBot(id);
    db.setBot(data.jid, data);
  } else {
    db.setBot(id, data);
  }
}

export function removeSubbot(id) {
  const entry = sockets.get(id);
  if (entry) {
    try { entry.closeDb?.(); } catch {}
    try { entry.sock?.end?.(new Error("removed")); } catch {}
    try { entry.sock?.ws?.close?.(); } catch {}
    sockets.delete(id);
  }
  const botData = activeBots.get(id);
  activeBots.delete(id);
  if (botData && botData.jid) {
    db.deleteBot(botData.jid);
  }
  db.deleteBot(id);
  const sessionDir = `${SUBBOTS_DIR}/${id}`;
  if (fs.existsSync(sessionDir)) {
    fs.rmSync(sessionDir, { recursive: true, force: true });
    log.warn(`[MANAGER] Sesión de ${id} eliminada por completo`);
  }
}

function handleSockExit(id) {
  sockets.delete(id);
  const sessionDir2 = `${SUBBOTS_DIR}/${id}`;

  if (isSessionRegistered(sessionDir2)) {
    log.info(`[MANAGER] Reconectando subbot ${id} en unos segundos...`);
    setTimeout(() => launchSubbot(id), 5000 + Math.random() * 1500);
  } else {
    log.warn(`[MANAGER] ${id} nunca completó la vinculación — descartando sesión`);
    const botData = activeBots.get(id);
    activeBots.delete(id);
    if (botData && botData.jid) {
      db.deleteBot(botData.jid);
    }
    db.deleteBot(id);
    if (fs.existsSync(sessionDir2)) {
      fs.rmSync(sessionDir2, { recursive: true, force: true });
    }
  }
}

async function startSubbotConnection(id, sessionDir, phoneNumber = null, onCode = null, _attempt = 0) {
  await mkdir(sessionDir, { recursive: true });

  const { state, saveCreds, closeDb } = await useSQLiteAuthState(sessionDir);
  const { version } = await fetchLatestBaileysVersion();
  const useCode = !!phoneNumber && !state.creds.registered;

  let sock;
  let connected = false;
  let pendingMessages = [];
  let pairingTimer = null;

  function clearPairingTimer() {
    if (pairingTimer) {
      clearTimeout(pairingTimer);
      pairingTimer = null;
    }
  }

  async function flushPending() {
    const queue = pendingMessages.splice(0);
    for (const msg of queue) {
      handleMessage(sock, msg, id.toUpperCase()).catch(() => {});
    }
  }

  try {
    sock = makeWASocket({
      version,
      auth: {
        creds: state.creds,
        keys: makeCacheableSignalKeyStore(state.keys, logger),
      },
      printQRInTerminal: false,
      logger,
      browser: ["Ubuntu", "Chrome", "20.0.04"],
      syncFullHistory: false,
      markOnlineOnConnect: false,
      generateHighQualityLinkPreview: false,
      connectTimeoutMs: 60000,
      keepAliveIntervalMs: 25000,
      retryRequestDelayMs: 3000,
      defaultQueryTimeoutMs: 60000,
    });
  } catch (e) {
    try { closeDb(); } catch {}
    log.error(`[${id}] Error al crear socket: ${e.message}`);
    setTimeout(() => startSubbotConnection(id, sessionDir, phoneNumber, onCode, _attempt + 1), backoffDelay(_attempt));
    return;
  }

  sockets.set(id, { sock, closeDb });

  if (useCode) {
    await new Promise((r) => setTimeout(r, 3000));
    try {
      let code = await sock.requestPairingCode(phoneNumber.replace(/\D/g, ""));
      code = code?.match(/.{1,4}/g)?.join("-") || code;
      onCode?.(code);

      pairingTimer = setTimeout(() => {
        if (!connected) {
          updateBotStatus(id, { status: "pairing_timeout" });
          log.warn(`[MANAGER] Subbot ${id} no ingresó el código a tiempo`);
          try { sock.end(new Error("pairing_timeout")); } catch {}
          removeSubbot(id);
        }
      }, PAIRING_TIMEOUT_MS);
    } catch (e) {
      log.error(`[${id}] Error al pedir código: ${e.message}`);
      try { closeDb(); } catch {}
      sockets.delete(id);
      return;
    }
  }

  sock.ev.on("connection.update", async ({ connection, lastDisconnect }) => {
    if (connection === "open") {
      connected = true;
      clearPairingTimer();

      const rawJid = sock.user?.id || "";
      const jidLimpio = rawJid ? rawJid.split(":")[0].split("@")[0] + "@s.whatsapp.net" : "";

      const rawLid = sock.user?.lid || "";
      const lidLimpio = rawLid ? rawLid.split(":")[0] : "";

      const pushName = sock.user?.name || sock.user?.verifiedName || "";

      updateBotStatus(id, { jid: jidLimpio, status: "online", label: id.toUpperCase(), isMain: false, lid: lidLimpio, pushName });
      await flushPending();
    }

    if (connection === "close") {
      connected = false;
      clearPairingTimer();
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      updateBotStatus(id, { status: "offline", jid: "" });
      try { closeDb(); } catch {}
      sockets.delete(id);

      if (statusCode === DisconnectReason.loggedOut) {
        log.warn(`[MANAGER] Subbot ${id} cerró sesión — eliminando...`);
        removeSubbot(id);
        return;
      }

      if (statusCode === DisconnectReason.connectionReplaced) {
        return;
      }

      if (statusCode === DisconnectReason.badSession || statusCode === 403) {
        log.warn(`[MANAGER] Subbot ${id} sesión inválida o bloqueada — eliminando...`);
        removeSubbot(id);
        return;
      }

      if (statusCode === DisconnectReason.restartRequired) {
        startSubbotConnection(id, sessionDir, null, null, 0);
        return;
      }

      setTimeout(() => startSubbotConnection(id, sessionDir, null, null, _attempt + 1), backoffDelay(_attempt));
    }
  });

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("messages.upsert", async ({ messages, type }) => {
    if (type !== "notify") return;
    for (const msg of messages) {
      if (!msg.message) continue;
      if (msg.key?.remoteJid === "status@broadcast") continue;
      if (!connected) {
        pendingMessages.push(msg);
        return;
      }
      handleMessage(sock, msg, id.toUpperCase()).catch(() => {});
    }
  });
}

export function launchSubbot(id) {
  if (sockets.has(id)) return;

  const sessionDir = path.resolve(`${SUBBOTS_DIR}/${id}`);
  if (!fs.existsSync(sessionDir)) fs.mkdirSync(sessionDir, { recursive: true });

  log.info(`[MANAGER] Lanzando subbot: ${id}`);

  startSubbotConnection(id, sessionDir).catch((e) => {
    log.error(`[MANAGER] Error lanzando ${id}: ${e.message}`);
    handleSockExit(id);
  });
}

export async function requestSubbotCode(id, phoneNumber, sock, from) {
  const sessionDir = path.resolve(`${SUBBOTS_DIR}/${id}`);
  if (!fs.existsSync(sessionDir)) fs.mkdirSync(sessionDir, { recursive: true });

  if (sockets.has(id)) {
    removeSubbot(id);
  }

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error("Timeout esperando código"));
    }, 15000);

    const cleanupTimeout = setTimeout(() => {
      const bot = activeBots.get(id);
      if (!bot || bot.status !== "online") {
        log.warn(`[MANAGER] Subbot ${id} nunca se conectó — eliminado`);
        removeSubbot(id);
      }
    }, 70_000);

    startSubbotConnection(id, sessionDir, phoneNumber, (code) => {
      clearTimeout(timeout);
      resolve(code);
    }).catch((e) => {
      clearTimeout(timeout);
      clearTimeout(cleanupTimeout);
      reject(e);
    });

    const checkOnline = setInterval(() => {
      const bot = activeBots.get(id);
      if (bot?.status === "online") {
        clearInterval(checkOnline);
        clearTimeout(cleanupTimeout);
        const userNum = id.replace("sub_", "");
        const userJid = bot.jid || `${userNum}@s.whatsapp.net`;
        sock.sendMessage(from, {
          text: `📍 *@${userNum} ha vinculado un subbot con éxito*\n` +
            "> • Puedes usar *.delbot* para desvincularlo cuando quieras.",
          mentions: [userJid]
        }).catch(e => log.error(`[MANAGER] Error enviando mensaje de éxito: ${e.message}`));
      }
    }, 2000);

    setTimeout(() => clearInterval(checkOnline), 75_000);
  });
}

export function launchAllSubbots() {
  if (!fs.existsSync(SUBBOTS_DIR)) return;
  const dirs = fs.readdirSync(SUBBOTS_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name);

  if (dirs.length === 0) return;

  log.info(`[MANAGER] Relanzando ${dirs.length} subbot(s)...`);
  for (const id of dirs) {
    const sessionDir = path.resolve(`${SUBBOTS_DIR}/${id}`);
    if (isSessionRegistered(sessionDir)) {
      launchSubbot(id);
    } else {
      log.warn(`[MANAGER] ${id} nunca completó vinculación — eliminando sesión huérfana`);
      fs.rmSync(sessionDir, { recursive: true, force: true });
    }
  }
}