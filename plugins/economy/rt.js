import { db } from '../../database/db.js'

function cleanJid(jid = "") {
  if (!jid) return "";
  const atIndex = jid.lastIndexOf("@");
  if (atIndex === -1) return jid.split(":")[0];
  const userPart = jid.slice(0, atIndex).split(":")[0];
  const domainPart = jid.slice(atIndex + 1);
  return `${userPart}@${domainPart}`;
}

// Números rojos en la ruleta europea estándar (0 = verde, el resto negro)
const ROJOS = [1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]

const COLORES = {
  rojo: 'rojo', red: 'rojo', r: 'rojo',
  negro: 'negro', black: 'negro', n: 'negro',
  verde: 'verde', green: 'verde', v: 'verde'
}

function girarRuleta() {
  const numero = Math.floor(Math.random() * 37) // 0 al 36
  let color = 'negro'
  if (numero === 0) color = 'verde'
  else if (ROJOS.includes(numero)) color = 'rojo'
  return { numero, color }
}

const EMOJI = { rojo: '🔴', negro: '⚫', verde: '🟢' }
const PAGO = { rojo: 2, negro: 2, verde: 14 } // multiplicador sobre la apuesta

export default {
  name: ['rt', 'ruleta'],
  description: 'Ruleta: apuesta a rojo, negro o verde',
  category: 'economy',
  groupOnly: true,

  async run({ sock, from, msg, text, reply }) {
    const sender = msg.key.participant || msg.key.remoteJid
    const jugador = cleanJid(sender)

    const partes = text.trim().split(/\s+/)
    if (partes.length < 2) return await reply({ text: `❌ Uso incorrecto.\n\n💡 *.rt <rojo|negro|verde> <cantidad>*` })

    const colorInput = COLORES[partes[0].toLowerCase()]
    const apuesta = parseInt(partes[1])

    if (!colorInput) return await reply({ text: `❌ Color inválido. Usa: *rojo*, *negro* o *verde*.` })
    if (!apuesta || apuesta <= 0) return await reply({ text: `❌ Indica un monto de apuesta válido.` })

    const eco = db.getEco(jugador)
    if (eco.bolsillo < apuesta) return await reply({ text: `❌ No tienes suficiente dinero en tu bolsillo.` })

    const numero = jugador.split('@')[0]

    await reply({ text: `🎡 *RULETA*\n\n@${numero} apostó *${apuesta}* 💰 a ${EMOJI[colorInput]} *${colorInput}*\n\n🌀 Girando la ruleta...`, mentions: [jugador] })

    await new Promise(res => setTimeout(res, 2000))

    const resultado = girarRuleta()
    const gano = resultado.color === colorInput

    let mensaje = `🎯 Salió: *${resultado.numero}* ${EMOJI[resultado.color]} (${resultado.color})\n\n`

    if (gano) {
      const ganancia = apuesta * PAGO[colorInput]
      db.setEco(jugador, { bolsillo: eco.bolsillo + (ganancia - apuesta) })
      mensaje += `🏆 @${numero} ganó *${ganancia}* 💰 (x${PAGO[colorInput]})`
    } else {
      db.setEco(jugador, { bolsillo: eco.bolsillo - apuesta })
      mensaje += `💸 @${numero} perdió su apuesta.`
    }

    await reply({ text: mensaje, mentions: [jugador] })
  }
}