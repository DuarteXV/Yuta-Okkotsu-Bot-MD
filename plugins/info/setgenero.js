import { db } from "../../database/db.js";

export default {
  name: ["setgenero", "setgenre"],
  description: "Configura cómo te identificas en tu perfil",
  category: "info",
  ownerOnly: false,

  async run({ sender, text, reply }) {
    if (!text || text.trim().length === 0) {
      return await reply({ text: `⚠️ Especifica cómo te identificas.\n\n*Ejemplo:* .setgenero hombre` });
    }

    const genero = text.trim().slice(0, 30);
    db.setGenero(sender, genero);

    return await reply({ text: `✅ Listo, ahora te identificas como: *${genero}*` });
  }
};