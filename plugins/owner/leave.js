export default {
  name: ["salir", "leave"],
  description: "Hace que el bot abandone el grupo actual",
  category: "grupos",
  groupOnly: true,
  ownerOnly: true,

  async run({ sock, from, reply }) {
    await reply({
      text: `✦ 𝑵𝒐𝒔 𝒗𝒐𝒍𝒗𝒆𝒓𝒆𝒎𝒐𝒔 𝒂 𝒆𝒏𝒄𝒐𝒏𝒕𝒓𝒂𝒓...`
    });

    await sock.groupLeave(from);
  }
};