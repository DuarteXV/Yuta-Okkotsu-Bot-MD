import { db } from '../../database/db.js'

const POR_PAGINA = 10

function cleanJid(jid = '') {
  if (!jid) return ''
  const atIndex = jid.lastIndexOf('@')
  if (atIndex === -1) return jid.split(':')[0]
  const userPart = jid.slice(0, atIndex).split(':')[0]
  const domainPart = jid.slice(atIndex + 1)
  return `${userPart}@${domainPart}`
}

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

    const miembrosJids = new Set()
    for (const p of groupMeta.participants) {
      if (p.id) miembrosJids.add(cleanJid(p.id))
      if (p.phoneNumber) miembrosJids.add(cleanJid(p.phoneNumber))
    }

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

    const totalPaginas = Math.ceil(ranked.length / POR_PAGINA)
    const pagina = args[0] && !isNaN(parseInt(args[0]))
      ? Math.min(Math.max(parseInt(args[0]), 1), totalPaginas)
      : 1

    const inicio = (pagina - 1) * POR_PAGINA
    const paginaActual = ranked.slice(inicio, inicio + POR_PAGINA)

    let texto = `「✿」Los usuarios con más *Fragmentos 💰* son:\n\n`

    texto += paginaActual.map((u, i) => {
      const posicionGlobal = inicio + i + 1
      const nombre = db.getPushName(u.jid) || u.jid.split('@')[0]
      return `✰ ${posicionGlobal} » *${nombre}*\n\t\t Total→ *${u.total.toLocaleString()} Fragmentos 💰*`
    }).join('\n\n')

    texto += `\n\n> • Página *${pagina}* de *${totalPaginas}*`
    if (totalPaginas > 1) {
      texto += `\n> • Usa *.baltop 2* para la siguiente página`
    }

    const mentions = paginaActual.map(u => u.jid)

    return await reply({ text: texto, mentions })
  }
}