import { db } from "../../database/db.js";

export default {
  name: ["divorciar", "divorcio"],
  description: "Termina tu matrimonio actual",
  category: "info",

  async run(ctx) {
    const { sender, reply } = ctx;

    const partner = db.getMarriage(sender);
    if (!partner) {
      return reply({ text: "💔 No estás casado(a) con nadie." });
    }

    db.divorce(sender);

    return reply({
      text: `💔 @${sender.split("@")[0]} se ha divorciado de @${partner.split("@")[0]}.\n> Ambos ya son libres de volver a casarse.`,
      mentions: [sender, partner],
    });
  },
};