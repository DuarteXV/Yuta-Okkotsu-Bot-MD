import { db } from '../../database/db.js'

export default {
  name: ['baltop', 'ricos'],
  description: 'Top de usuarios con más Fragmentos en el grupo',
  category: 'economy',
  ownerOnly: false,
  groupOnly: true,

  async run({ args, groupMeta, reply }) {
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

    if (ranked.length === 0) {
      return await reply({ text: '📉 Todavía nadie en este grupo tiene Fragmentos registrados.' })
    }

    // Sin límite real: si piden un número, se respeta; si no, top 10 por defecto
    const cantidad = args[0] && !isNaN(parseInt(args[0]))
      ? Math.min(parseInt(args[0]), ranked.length)
      : Math.min(10, ranked.length)

    const totalGrupo = ranked.reduce((acc, u) => acc + u.total, 0)
    const paginaActual = ranked.slice(0, cantidad)

    const medallas = ['🥇', '🥈', '🥉']
    const lines = paginaActual.map((u, i) => {
      const posicion = medallas[i] || `${i + 1}.`
      return `${posicion} @${u.jid.split('@')[0]} — *${u.total.toLocaleString()}* Fragmentos`
    })

    const texto = `🏆 *Top Fragmentos del grupo*\n` +
      `💰 *Total en el grupo:* ${totalGrupo.toLocaleString()} Fragmentos\n\n` +
      lines.join('\n') +
      (ranked.length > cantidad ? `\n\n> Usa *.baltop ${Math.min(cantidad + 10, ranked.length)}* para ver más` : '')

    const mentions = paginaActual.map(u => u.jid)

    return await reply({ text: texto, mentions })
  }
}