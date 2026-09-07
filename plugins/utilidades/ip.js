import axios from 'axios';

export default {
  name: ["ip"],
  description: "Busca información de una dirección IP",
  category: "utils",
  ownerOnly: false,

  async run({ text, reply, usedPrefix, cmdName }) {
    if (!text) {
      return await reply({
        text: `⚠️ Por favor, ingresa una *IP*.\n\n📝 *Ejemplo:* ${usedPrefix}${cmdName} 8.8.8.8`
      });
    }

    await reply({ text: `🌾 Buscando, espere un momento...` });

    try {
      const res = await axios.get(
        `http://ip-api.com/json/${text}?fields=status,message,country,countryCode,region,regionName,city,district,zip,lat,lon,timezone,isp,org,as,mobile,hosting,query`
      );
      const data = res.data;

      if (String(data.status) !== 'success') {
        throw new Error(data.message || 'Falló');
      }

      const ipsearch = `
☁️ *I N F O - I P* ☁️

IP : ${data.query}
País : ${data.country}
Código de País : ${data.countryCode}
Provincia : ${data.regionName}
Código de Provincia : ${data.region}
Ciudad : ${data.city}
Distrito : ${data.district}
Código Postal : ${data.zip}
Zona Horaria : ${data.timezone}
ISP : ${data.isp}
Organización : ${data.org}
AS : ${data.as}
Mobile : ${data.mobile ? 'Si' : 'No'}
Hosting : ${data.hosting ? 'Si' : 'No'}
`.trim();

      await reply({ text: ipsearch });

    } catch (e) {
      await reply({ text: `❌ Error: ${e.message}` });
    }
  }
};