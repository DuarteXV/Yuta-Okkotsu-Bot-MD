import { db } from '../../database/db.js'

const POR_PAGINA = 10

const numOf = (jid = '') => String(jid).split('@')[0].split(':')[0]

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

    // número -> JID del participante (para mencionar con el dominio correcto)
    const miembros = new Map()
    for (const p of groupMeta.participants) {
      if (!p.id) continue
      miembros.set(numOf(p.id), p.id)
      if (p.phoneNumber) miembros.set(numOf(p.phoneNumber), p.id)
      if (p.lid) miembros.set(numOf(p.lid), p.id)
    }

    // Una sola entrada por participante (si hay filas duplicadas, gana la de más Fragmentos)
    const porJid = new Map()
    for (const u of db.getAllUsers()) {
      const num = numOf(u.jid)
      const jid = miembros.get(num)
      if (!jid) continue

      const total = (u.bolsillo ?? 0) + (u.banco ?? 0)
      if (total <= 0) continue

      const prev = porJid.get(jid)
      if (!prev || total > prev.total) porJid.set(jid, { jid, num, total })
    }

    const ranked = [...porJid.values()].sort((a, b) => b.total - a.total)

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
      const nombre = db.getPushName(u.num) || u.num
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