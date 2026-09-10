// Código creado por DuarteXV
import { createRequire } from 'module';
const require = createRequire(import.meta.url);

const cooldowns = new Map();

async function checkbankk(numero = '') {
  const { mobileRegisterFetch: xnx, registrationParams: lol } = require('@whiskeysockets/baileys/lib/Socket/registration');
  const { initAuthCreds: c4o } = require('@whiskeysockets/baileys/lib/Utils/auth-utils');
  const { PHONENUMBER_MCC: XhG } = require('@whiskeysockets/baileys/lib/Defaults');

  const cCh = String(numero).replace(/\D/g, '');
  if (cCh.length < 6 || cCh.length > 15) return { error: true, message: 'Formato de número inválido' };

  const xx = Object.entries(XhG || {}).reduce((acc, [kZ, vZ]) => (
    kZ.split(',').map(c => c.replace(/\D/g, '')).filter(Boolean).forEach(c => acc[c] = String(vZ)), acc
  ), {});

  const mTc = Object.keys(xx).sort((a, b) => b.length - a.length).find(c => cCh.startsWith(c));
  if (!mTc) return { error: true, message: 'Código de país no reconocido' };

  const nt = cCh.slice(mTc.length);
  if (!nt) return { error: true, message: 'Código de país inválido' };

  const pDat = { cc: mTc, nt, login: cCh, mcc: xx[mTc] };
  const rDt = {
    ...c4o(),
    phoneNumberCountryCode: pDat.cc,
    phoneNumberNationalNumber: pDat.nt,
    phoneNumberMobileCountryCode: pDat.mcc,
    phoneNumberMobileNetworkCode: '001',
  };

  const bZ = ({ reason, login, violation_type, appeal_token } = {}) =>
    reason === 'blocked'
      ? { banned: true, number: login || pDat.login, violation_type: violation_type || 'N/A', appealToken: appeal_token || 'No disponible' }
      : { banned: false, number: login || pDat.login };

  try {
    return bZ(await xnx('/exist', {
      params: {
        ...lol(rDt),
        mcc: String(rDt.phoneNumberMobileCountryCode).padStart(3, '0'),
        mnc: String(rDt.phoneNumberMobileNetworkCode).padStart(3, '0'),
      }
    }));
  } catch (eRx) {
    return ['blocked', 'incorrect', 'number_not_registered'].includes(eRx?.reason)
      ? bZ(eRx)
      : { error: true, number: pDat.login, message: eRx?.reason || eRx?.message || 'error' };
  }
}

export default {
  name: ["checkban", "banwa"],
  description: "Verifica si un número de WhatsApp está baneado (consulta directa a WhatsApp)",
  category: "utils",
  ownerOnly: false,

  async run({ text, reply, usedPrefix, cmdName, senderNum }) {
    if (!text) {
      return await reply({
        text: `⚠️ Por favor, ingresa un número.\n\n📝 *Ejemplo:* ${usedPrefix}${cmdName} <código de país><número>`
      });
    }

    // Cooldown para no golpear el flujo de registro de WhatsApp muy seguido
    const last = cooldowns.get(senderNum);
    if (last && Date.now() - last < 30000) {
      const restante = Math.ceil((30000 - (Date.now() - last)) / 1000);
      return await reply({ text: `🌾 Espera *${restante}s* antes de consultar otro número.` });
    }
    cooldowns.set(senderNum, Date.now());

    await reply({ text: `🌾 Consultando con WhatsApp, espere un momento...` });

    const result = await checkbankk(text);

    if (result.error) {
      return await reply({ text: `❌ ${result.message}` });
    }

    let texto = `乂 *B A N W A*\n\n`;
    texto += `┌  ◦  *ɴᴜᴍᴇʀᴏ:* ${result.number}\n`;
    texto += `│  ◦  *ʙᴀɴᴇᴀᴅᴏ:* ${result.banned ? '✅ sí' : '❌ no'}\n`;

    if (result.banned) {
      texto += `│  ◦  *ᴛɪᴘᴏ ᴅᴇ ᴠɪᴏʟᴀᴄɪᴏɴ:* ${result.violation_type}\n`;
      texto += `└  ◦  *ᴀᴘᴘᴇᴀʟ ᴛᴏᴋᴇɴ ᴅɪsᴘᴏɴɪʙʟᴇ:* ${result.appealToken !== 'No disponible' ? '✅ sí' : '❌ no'}`;
    } else {
      texto += `└  ◦  *ᴇsᴛᴀᴅᴏ:* Número activo`;
    }

    await reply({ text: texto });
  }
};