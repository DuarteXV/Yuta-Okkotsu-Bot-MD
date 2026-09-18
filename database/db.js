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

const stmts = {
  getUser: db_instance.prepare("SELECT data FROM users WHERE jid = ?"),
  insertUser: db_instance.prepare("INSERT INTO users (jid, data) VALUES (?, ?)"),
  updateUser: db_instance.prepare("UPDATE users SET data = ? WHERE jid = ?"),
  getAllUsers: db_instance.prepare("SELECT jid, data FROM users"),

  getGroup: db_instance.prepare("SELECT data FROM groups WHERE jid = ?"),
  insertGroup: db_instance.prepare("INSERT INTO groups (jid, data) VALUES (?, ?)"),
  updateGroup: db_instance.prepare("UPDATE groups SET data = ? WHERE jid = ?"),

  getBot: db_instance.prepare("SELECT data FROM bots WHERE jid = ?"),
  insertBot: db_instance.prepare("INSERT INTO bots (jid, data) VALUES (?, ?)"),
  updateBot: db_instance.prepare("UPDATE bots SET data = ? WHERE jid = ?"),
  getAllBots: db_instance.prepare("SELECT jid, data FROM bots"),
  deleteBot: db_instance.prepare("DELETE FROM bots WHERE jid = ?")
};

function getUser(jid) {
  const row = stmts.getUser.get(jid);
  if (!row) {
    const defaultUser = {
      role: "user",
      banned: false,
      registeredAt: new Date().toISOString()
    };
    stmts.insertUser.run(jid, JSON.stringify(defaultUser));
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
    stmts.updateUser.run(JSON.stringify(updatedData), jid);
  },

  getAllUsers() {
    const rows = stmts.getAllUsers.all();
    return rows.map(row => ({
      jid: row.jid,
      ...JSON.parse(row.data)
    }));
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
    const numeroLimpio = jid.split('@')[0];

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
      stmts.updateUser.run(JSON.stringify(partnerUser), partner);
    }
    const user = getUser(jid);
    delete user.partner;
    delete user.marriedAt;
    stmts.updateUser.run(JSON.stringify(user), jid);
  },

  // 🚻 GÉNERO (hombre / mujer)
  setGenero(jid, genero) {
    db.setUser(jid, { genero });
  },

  getGenero(jid) {
    return getUser(jid).genero || null;
  },
};