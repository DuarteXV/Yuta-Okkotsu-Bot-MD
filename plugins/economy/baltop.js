import { db } from '../../database/db.js'

export default {
  name: ['baltop', 'ricos'],
  description: 'Top 10 de usuarios con más Fragmentos en el grupo',
  category: 'economy',
  ownerOnly: false,
  groupOnly: true,

  async run({ groupMeta, reply }) {
    if (!groupMeta?.participants?.length) {
      return await reply({ text: '❌ No se pudo leer la lista de miembros del grupo.' })
    }

    const miembrosJids = new Set(
      groupMeta.participants.map(p => p.id).filter(Boolean)
    )

    const users = db.getAllUsers()

    const ranked = users
      .filter(u => miembrosJids.has(u.jid))
      .map(u => ({
        jid: u.jid,
        total: (u.bolsillo ?? 0) + (u.banco ?? 0)
      }))
      .filter(u => u.total > 0)
      .sort((a, b) => b.total - a.total)
      .slice(0, 10)

    if (ranked.length === 0) {
      return await reply({ text: '📉 Todavía nadie en este grupo tiene Fragmentos registrados.' })
    }

    const medallas = ['🥇', '🥈', '🥉']
    const lines = ranked.map((u, i) => {
      const posicion = medallas[i] || `${i + 1}.`
      return `${posicion} @${u.jid.split('@')[0]} — *${u.total}* Fragmentos`
    })

    const texto = `🏆 *Top Fragmentos del grupo*\n\n${lines.join('\n')}`
    const mentions = ranked.map(u => u.jid)

    return await reply({ text: texto, mentions })
  }
}