import config from "../../config.js";
import { db } from "../../database/db.js";

export default {
  name: ["self"],
  description: 'Prende o apaga el modo self del grupo usando "on" u "off"',
  category: "owner",
  groupOnly: true,
  ownerOnly: true,

  async run({ from, args, react, reply }) {
    const accion = args[0]?.toLowerCase();

    if (accion === "on") {
      db.setGroup(from, { selfMode: true });
      await react("🔒");
      return await reply({
        text: `🔒 *Modo Self ACTIVADO en este grupo.*\n\nA partir de ahora, *${config.botName}* ignorará los mensajes de usuarios comunes en este grupo. Solo se atenderá a sí mismo y a los owners.`
      });
    }

    if (accion === "off") {
      db.setGroup(from, { selfMode: false });
      await react("🔓");
      return await reply({
        text: `🔓 *Modo Self DESACTIVADO en este grupo.*\n\nEl bot ha vuelto a la normalidad y responderá a todo el público.`
      });
    }

    await react("❓");
    await reply({ text: `💡 *Uso correcto del comando:*\n• _.self on_ (Para encender)\n• _.self off_ (Para apagar)` });
  }
};