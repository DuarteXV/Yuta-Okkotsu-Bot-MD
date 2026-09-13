import { db } from "../../database/db.js";

const VALIDOS = ["hombre", "mujer"];

export default {
  name: ["setgenero", "setgenre"],
  description: "Configura tu género (hombre/mujer) para tu perfil",
  category: "info",
  ownerOnly: false,

  async run({ sender, text, reply }) {
    const genero = (text || "").trim().toLowerCase();

    if (!VALIDOS.includes(genero)) {
      return await reply({ text: `⚠️ Solo puedes elegir *hombre* o *mujer*.\n\n*Ejemplo:* .setgenero hombre` });
    }

    db.setGenero(sender, genero);

    return await reply({ text: `✅ Listo, ahora te identificas como: *${genero}*` });
  }
};