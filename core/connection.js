import makeWASocket, {
  DisconnectReason,
  makeCacheableSignalKeyStore,
} from "@whiskeysockets/baileys";
import pino from "pino";
import { mkdir } from "fs/promises";
import path from "path";
import readline from "readline";
import Database from "better-sqlite3";
import fs from "fs";
import qrcode from "qrcode-terminal";
import { log } from "./logger.js";
import config from "../config.js";
import { handleMessage, invalidateGroupCache } from "./messageHandler.js";
import {
  useSQLiteAuthState,
  getWAVersion,
  cleanupSocket,
  registerMainBot,
} from "./subbotManager.js";

// Se re-exporta por si otro archivo lo importa desde aquí
export { useSQLiteAuthState };

function question(prompt) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise((resolve) => {
    rl.question(prompt, (ans) => {
      rl.close();
      resolve(ans.trim());
    });
  });
}

// Solo se usa cuando la sesión está corrupta (badSession)
export async function clearSocketFiles(sessionDir) {
  try {
    const dbPath = path.join(sessionDir, "auth.db");
    if (fs.existsSync(dbPath)) {
      const db = new Database(dbPath);
      const result = db.prepare("DELETE FROM auth WHERE id != 'creds'").run();
      if (result.changes > 0) {
        log.warn(`🗑️ Limpiados ${result.changes} registros de socket en la base de datos de [${path.basename(sessionDir)}]`);
      }
      db.close();
    }
  } catch (e) {
    log.error(`Error al limpiar base de datos de sockets: ${e.message}`);
  }
}

export async function createConnection({
  sessionDir = config.sessionDir,
  botLabel = "MAIN",
  isSubbot = false,
  phoneNumber = null,
  _attempt = 0,
} = {}) {
  await mkdir(sessionDir, { recursive: true });

  // Contador local: se reinicia en 0 cuando la conexión abre bien
  let attempt = _attempt;

  if (attempt > 0) {
    const delay = Math.min(config.reconnectDelay * attempt, 30000);
    log.info(`[${botLabel}] Esperando ${delay / 1000}s para reconectar...`);
    await new Promise((r) => setTimeout(r, delay));
  }

  const { state, saveCreds, closeDb } = useSQLiteAuthState(sessionDir);
  const version = await getWAVersion();

  let useCode = false;
  let phone = phoneNumber;

  if (!isSubbot && !state.creds.registered && _attempt === 0) {
    const choice = await question(
      "\n ╔══════════════════════════════════╗\n" +
      " ║ [1] Código de emparejamiento ║\n" +
      " ║ [2] Código QR ║\n" +
      " ╚══════════════════════════════════╝\n" +
      " Elige (1 o 2): "
    );

    if (choice === "1") {
      useCode = true;
      let rawPhone = await question(
        " Digita el número de teléfono (ej: 521XXXXXXXXXX): "
      );
      rawPhone = rawPhone.replace(/\D/g, "");
      if (!rawPhone.startsWith("+")) rawPhone = `+${rawPhone}`;
      if (rawPhone.startsWith("+521")) {
        rawPhone = rawPhone.replace("+521", "+52");
      } else if (rawPhone.startsWith("+52") && rawPhone[4] === "1") {
        rawPhone = rawPhone.replace("+52 1", "+52");
      }
      phone = rawPhone.replace(/\D/g, "");
    }
  }

  let sock;
  let connectionTimeout;
  let connected = false;
  let pendingMessages = [];

  const msgStore = new Map();
  const MAX_STORE_SIZE = 100;

  function cacheMessage(msg) {
    if (!msg?.key?.id) return;
    const cacheKey = `${msg.key.remoteJid}:${msg.key.id}`;
    msgStore.set(cacheKey, msg);
    if (msgStore.size > MAX_STORE_SIZE) {
      const oldestKey = msgStore.keys().next().value;
      msgStore.delete(oldestKey);
    }
  }

  function clearConnTimeout() {
    if (connectionTimeout) {
      clearTimeout(connectionTimeout);
      connectionTimeout = null;
    }
  }

  async function flushPending() {
    const queue = pendingMessages.splice(0);
    for (const { msg, label } of queue) {
      handleMessage(sock, msg, label).catch((e) =>
        log.error(`[${label}] Error en mensaje: ${e.message}`)
      );
    }
  }

  try {
    sock = makeWASocket({
      version,
      auth: {
        creds: state.creds,
        keys: makeCacheableSignalKeyStore(state.keys, pino({ level: "silent" })),
      },
      printQRInTerminal: !useCode,
      logger: pino({ level: "silent" }),
      browser: useCode ? ["Ubuntu", "Chrome", "20.0.04"] : ["YutaBot", "Chrome", "1.0.0"],
      syncFullHistory: false,
      shouldSyncHistoryMessage: () => false,
      markOnlineOnConnect: false,
      generateHighQualityLinkPreview: false,
      connectTimeoutMs: 60000,
      keepAliveIntervalMs: 25000,
      retryRequestDelayMs: 3000,
      defaultQueryTimeoutMs: 60000,
      getMessage: async (key) => {
        const cacheKey = `${key.remoteJid}:${key.id}`;
        const cached = msgStore.get(cacheKey);
        return cached?.message || undefined;
      },
    });
  } catch (e) {
    log.error(`[${botLabel}] Error al crear socket: ${e.message}`);
    closeDb();
    if (attempt < config.maxReconnectAttempts) {
      return createConnection({ sessionDir, botLabel, isSubbot, phoneNumber, _attempt: attempt + 1 });
    }
    return;
  }

  sock.sessionDir = sessionDir;

  if (useCode && !state.creds.registered) {
    await new Promise((r) => setTimeout(r, 3000));
    try {
      let code = await sock.requestPairingCode(phone, "GITHUBUG");
      code = code?.match(/.{1,4}/g)?.join("-") || code;
      console.log(
        `\n ┌─────────────────────────────┐\n` +
        ` │ 🔑 Tu código: ${String(code).padEnd(14)}│\n` +
        ` └─────────────────────────────┘\n`
      );
    } catch (e) {
      log.error(`[${botLabel}] Error al pedir código: ${e.message}`);
    }
  }

  connectionTimeout = setTimeout(() => {
    if (!connected) {
      log.warn(`[${botLabel}] Timeout de conexión alcanzado, reconectando...`);
      try { sock.end(new Error("timeout")); } catch {}
    }
  }, 75000);

  sock.ev.on("connection.update", async ({ connection, lastDisconnect, qr }) => {
    if (qr) {
      log.info(`[${botLabel}] QR listo para escanear`);
      qrcode.generate(qr, { small: true });
    }

    if (connection === "connecting") {
      log.conn(`[${botLabel}] Conectando...`);
    }

    if (connection === "open") {
      clearConnTimeout();
      connected = true;
      attempt = 0;
      log.ok(`[${botLabel}] ✅ Conectado → ${sock.user?.id}`);
      if (!isSubbot) registerMainBot(sock, botLabel);
      await flushPending();
    }

    if (connection === "close") {
      clearConnTimeout();
      connected = false;
      pendingMessages = [];

      const statusCode = lastDisconnect?.error?.output?.statusCode;
      const errorMsg = lastDisconnect?.error?.message || "Desconocido";

      log.warn(`[${botLabel}] ❌ Conexión cerrada → código: ${statusCode} | ${errorMsg}`);

      // Liberar el socket viejo antes de reconectar
      cleanupSocket(sock);
      closeDb();
      msgStore.clear();

      if (statusCode === DisconnectReason.loggedOut) {
        log.error(`[${botLabel}] Sesión cerrada (loggedOut). Elimina el archivo "auth.db" dentro de la carpeta "${path.basename(sessionDir)}" y reinicia.`);
        return;
      }

      if (statusCode === DisconnectReason.connectionReplaced) {
        log.error(`[${botLabel}] Sesión reemplazada por otra instancia. Cerrando.`);
        return;
      }

      if (statusCode === DisconnectReason.badSession) {
        log.error(`[${botLabel}] Sesión corrupta. Limpiando y reconectando...`);
        await clearSocketFiles(sessionDir);
      }

      if (attempt < config.maxReconnectAttempts) {
        log.info(`[${botLabel}] Reconectando (intento ${attempt + 1}/${config.maxReconnectAttempts})...`);
        createConnection({ sessionDir, botLabel, isSubbot, phoneNumber, _attempt: attempt + 1 });
      } else {
        log.error(`[${botLabel}] Se agotaron los intentos de reconexión.`);
      }
    }
  });

  sock.ev.on("CB:stream:error", (err) => {
    log.error(`[${botLabel}] Stream error: ${err?.message || err}`);
  });

  sock.ws?.on?.("error", (err) => {
    log.error(`[${botLabel}] WS error: ${err?.message || err}`);
  });

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("group-participants.update", ({ id }) => {
    invalidateGroupCache(id);
  });

  sock.ev.on("messages.upsert", async ({ messages, type }) => {
    if (type !== "notify") return;

    for (const msg of messages) {
      if (!msg.message) continue;
      if (msg.key?.remoteJid === "status@broadcast") continue;

      cacheMessage(msg);

      if (!connected) {
        if (pendingMessages.length < 50) pendingMessages.push({ msg, label: botLabel });
        continue;
      }

      handleMessage(sock, msg, botLabel).catch((e) =>
        log.error(`[${botLabel}] Error en mensaje: ${e.message}`)
      );
    }
  });

  return sock;
}