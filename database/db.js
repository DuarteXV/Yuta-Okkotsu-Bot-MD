import Database from "better-sqlite3";
import { mkdirSync } from "fs";
import config from "../config.js";

mkdirSync("./database", { recursive: true });

const db_instance = new Database("./database/yuta.sqlite");
db_instance.pragma("journal_mode = WAL");
db_instance.pragma("synchronous = NORMAL");
db_instance.pragma("wal_autocheckpoint = 1000");
db_instance.pragma("busy_timeout = 3000");

db_instance.exec(`
  CREATE TABLE IF NOT EXISTS users (
    jid TEXT PRIMARY KEY,
    data TEXT DEFAULT '{}'
  );
  CREATE TABLE IF NOT EXISTS groups (
    jid TEXT PRIMARY KEY,
    data TEXT DEFAULT '{}'
  );
  CREATE TABLE IF NOT EXISTS bots (
    jid TEXT PRIMARY KEY,
    data TEXT DEFAULT '{}'
  );
`);

const hierarchy = ["user", "premium", "mod", "coowner", "owner"];

// Los usuarios se guardan SIEMPRE por número (sin @dominio ni :dispositivo).
// Así "123@s.whatsapp.net", "123:5@s.whatsapp.net" y "123" son la misma fila.
function normalizeJid(jid = "") {
  return String(jid).split("@")[0].split(":")[0];
}

const stmts = {
  getUser: db_instance.prepare("SELECT data FROM users WHERE jid = ?"),
  insertUser: db_instance.prepare("INSERT INTO users (jid, data) VALUES (?, ?)"),
  updateUser: db_instance.prepare("UPDATE users SET data = ? WHERE jid = ?"),
  deleteUser: db_instance.prepare("DELETE FROM users WHERE jid = ?"),
  getAllUsers: db_instance.prepare("SELECT jid, data FROM users"),
  countUsers: db_instance.prepare("SELECT COUNT(*) AS n FROM users"),

  getGroup: db_instance.prepare("SELECT data FROM groups WHERE jid = ?"),
  insertGroup: db_instance.prepare("INSERT INTO groups (jid, data) VALUES (?, ?)"),
  updateGroup: db_instance.prepare("UPDATE groups SET data = ? WHERE jid = ?"),
  countGroups: db_instance.prepare("SELECT COUNT(*) AS n FROM groups"),

  getBot: db_instance.prepare("SELECT data FROM bots WHERE jid = ?"),
  insertBot: db_instance.prepare("INSERT INTO bots (jid, data) VALUES (?, ?)"),
  updateBot: db_instance.prepare("UPDATE bots SET data = ? WHERE jid = ?"),
  getAllBots: db_instance.prepare("SELECT jid, data FROM bots"),
  deleteBot: db_instance.prepare("DELETE FROM bots WHERE jid = ?")
};

// Migración única: junta las filas viejas con JID completo en la fila por número.
function migrateUserKeys() {
  const rows = db_instance
    .prepare("SELECT jid, data FROM users WHERE jid LIKE '%@%' OR jid LIKE '%:%'")
    .all();
  if (!rows.length) return;

  const run = db_instance.transaction(() => {
    for (const row of rows) {
      const key = normalizeJid(row.jid);
      const old = JSON.parse(row.data);
      const cur = stmts.getUser.get(key);

      if (!cur) {
        stmts.insertUser.run(key, JSON.stringify(old));
      } else {
        const base = JSON.parse(cur.data);
        const merged = {
          ...base,
          ...old,
          role: base.role && base.role !== "user" ? base.role : old.role || "user",
          banned: base.banned === true || old.banned === true,
          registeredAt: [base.registeredAt, old.registeredAt].filter(Boolean).sort()[0]
        };
        stmts.updateUser.run(JSON.stringify(merged), key);
      }
      stmts.deleteUser.run(row.jid);
    }
  });
  run();
}

migrateUserKeys();

function getUser(jid) {
  const key = normalizeJid(jid);
  const row = stmts.getUser.get(key);
  if (!row) {
    const defaultUser = {
      role: "user",
      banned: false,
      registeredAt: new Date().toISOString()
    };
    stmts.insertUser.run(key, JSON.stringify(defaultUser));
    return defaultUser;
  }
  return JSON.parse(row.data);
}

function getGroup(jid) {
  const row = stmts.getGroup.get(jid);
  if (!row) {
    const defaultGroup = {
      welcome: false,
      antilink: false,
      primaryBot: null,
      adminMode: false
    };
    stmts.insertGroup.run(jid, JSON.stringify(defaultGroup));
    return defaultGroup;
  }
  return JSON.parse(row.data);
}

function getBot(jid) {
  const row = stmts.getBot.get(jid);
  if (!row) {
    const defaultBot = {
      label: "Subbot",
      isMain: false,
      status: "offline"
    };
    stmts.insertBot.run(jid, JSON.stringify(defaultBot));
    return defaultBot;
  }
  return JSON.parse(row.data);
}

export const db = {
  getUser,
  getGroup,
  getBot,

  setUser(jid, dataObject) {
    const currentData = getUser(jid);
    const updatedData = { ...currentData, ...dataObject };
    stmts.updateUser.run(JSON.stringify(updatedData), normalizeJid(jid));
  },

  getAllUsers() {
    const rows = stmts.getAllUsers.all();
    return rows.map(row => ({
      jid: row.jid,
      ...JSON.parse(row.data)
    }));
  },

  countUsers() {
    return stmts.countUsers.get().n;
  },

  countGroups() {
    return stmts.countGroups.get().n;
  },

  setGroup(jid, dataObject) {
    const currentData = getGroup(jid);
    const updatedData = { ...currentData, ...dataObject };
    stmts.updateGroup.run(JSON.stringify(updatedData), jid);
  },

  setBot(jid, dataObject, force = false) {
    const currentData = getBot(jid);

    if (currentData.isMain === true && dataObject.isMain === false && !force) {
      return;
    }

    if (force) {
      stmts.updateBot.run(JSON.stringify(dataObject), jid);
    } else {
      const updatedData = { ...currentData, ...dataObject };
      stmts.updateBot.run(JSON.stringify(updatedData), jid);
    }
  },

  deleteBot(jid) {
    stmts.deleteBot.run(jid);
  },

  getAllBots() {
    try {
      db_instance.pragma("wal_checkpoint(PASSIVE)");
    } catch {}

    const rows = stmts.getAllBots.all();
    return rows.map(row => ({
      id: row.jid,
      jid: row.jid,
      ...JSON.parse(row.data)
    }));
  },

  getOnlineBots() {
    return this.getAllBots().filter(bot => bot.status === 'online');
  },

  hasRole(jid, role) {
    const numeroLimpio = normalizeJid(jid);

    const esOwnerGlobal = config.ownerNumber?.includes(numeroLimpio);
    const esCoOwnerGlobal = config.coOwners?.includes(numeroLimpio);

    if (esOwnerGlobal) return true;
    if (esCoOwnerGlobal && hierarchy.indexOf("coowner") >= hierarchy.indexOf(role)) return true;

    const user = getUser(jid);
    return hierarchy.indexOf(user.role) >= hierarchy.indexOf(role);
  },

  setRole(jid, role) {
    db.setUser(jid, { role });
  },

  isBanned(jid) {
    return getUser(jid).banned === true;
  },

  ban(jid) {
    db.setUser(jid, { banned: true });
  },

  unban(jid) {
    db.setUser(jid, { banned: false });
  },

  setPrimary(groupJid, botId) {
    db.setGroup(groupJid, { primaryBot: botId });
  },

  getPrimary(groupJid) {
    return getGroup(groupJid).primaryBot || null;
  },

  delPrimary(groupJid) {
    const group = getGroup(groupJid);
    delete group.primaryBot;
    stmts.updateGroup.run(JSON.stringify(group), groupJid);
  },

  // 👤 NOMBRE DE PERFIL (persistente, sobrevive reinicios)
  // Solo escribe si el nombre cambió, para no golpear la DB en cada mensaje.
  setPushName(jid, name) {
    if (!jid || !name) return;
    const user = getUser(jid);
    if (user.pushName !== name) {
      db.setUser(jid, { pushName: name });
    }
  },

  getPushName(jid) {
    return getUser(jid).pushName || null;
  },

  // 💰 ECONOMÍA — Fragmentos
  getEco(jid) {
    const user = getUser(jid);
    return {
      bolsillo: user.bolsillo ?? 0,
      banco: user.banco ?? 0,
      inventario: user.inventario ?? [],
      lastWork: user.lastWork ?? 0
    };
  },

  setEco(jid, dataObject) {
    db.setUser(jid, dataObject);
  },

  // 💍 MATRIMONIO
  getMarriage(jid) {
    return getUser(jid).partner || null;
  },

  marry(jid1, jid2) {
    const marriedAt = new Date().toISOString();
    db.setUser(jid1, { partner: jid2, marriedAt });
    db.setUser(jid2, { partner: jid1, marriedAt });
  },

  divorce(jid) {
    const partner = db.getMarriage(jid);
    if (partner) {
      const partnerUser = getUser(partner);
      delete partnerUser.partner;
      delete partnerUser.marriedAt;
      stmts.updateUser.run(JSON.stringify(partnerUser), normalizeJid(partner));
    }
    const user = getUser(jid);
    delete user.partner;
    delete user.marriedAt;
    stmts.updateUser.run(JSON.stringify(user), normalizeJid(jid));
  },

  // 🚻 GÉNERO (hombre / mujer)
  setGenero(jid, genero) {
    db.setUser(jid, { genero });
  },

  getGenero(jid) {
    return getUser(jid).genero || null;
  },
};