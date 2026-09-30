import { db } from '../../database/db.js'

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

  async run({ sender, args, reply, react }) {
    if (args.length < 2) return await reply({ text: `⚠️ Uso incorrecto.\n\n*Ejemplo:* .rt rojo 500` })

    const colorInput = COLORES[(args[0] || '').toLowerCase()]
    const apuesta = parseInt(args[1])

    if (!colorInput) return await reply({ text: `❌ Color inválido. Usa: *rojo*, *negro* o *verde*.` })
    if (!apuesta || isNaN(apuesta) || apuesta <= 0) return await reply({ text: `❌ Indica un monto de apuesta válido.` })

    const eco = db.getEco(sender)
    if (eco.bolsillo < apuesta) {
      return await reply({ text: `❌ No tenés suficientes Fragmentos en el bolsillo.\n\n*Bolsillo:* ${eco.bolsillo} Fragmentos` })
    }

    const numero = sender.split('@')[0]

    await react('🎡')
    await reply({
      text: `🎡 *RULETA*\n\n@${numero} apostó *${apuesta}* Fragmentos a ${EMOJI[colorInput]} *${colorInput}*\n\n🌀 Girando la ruleta...`,
      mentions: [sender]
    })

    await new Promise(res => setTimeout(res, 2000))

    const resultado = girarRuleta()
    const gano = resultado.color === colorInput

    let mensaje = `🎯 Salió: *${resultado.numero}* ${EMOJI[resultado.color]} (${resultado.color})\n\n`

    if (gano) {
      const ganancia = apuesta * PAGO[colorInput]
      db.setEco(sender, { bolsillo: eco.bolsillo + (ganancia - apuesta) })
      mensaje += `🏆 @${numero} ganó *${ganancia}* Fragmentos (x${PAGO[colorInput]})`
      await react('🏆')
    } else {
      db.setEco(sender, { bolsillo: eco.bolsillo - apuesta })
      mensaje += `💸 @${numero} perdió su apuesta.`
      await react('💸')
    }

    await reply({ text: mensaje, mentions: [sender] })
  }
}