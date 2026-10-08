export async function broadcastReaccionCanal({ canalJid, serverId, emoji, ventanaMs = 5000 }) {
  const bots = getAllSockets().filter((s) => s && s.user);

  const tareas = bots.map(async (s) => {
    // retraso aleatorio dentro de la ventana (por defecto 5 s)
    await new Promise((r) => setTimeout(r, Math.random() * ventanaMs));
    await s.newsletterReactMessage(canalJid, serverId, emoji);
  });

  const resultados = await Promise.allSettled(tareas);

  let ok = 0;
  let fail = 0;
  for (const r of resultados) {
    if (r.status === "fulfilled") {
      ok++;
    } else {
      fail++;
      log.error(`[MANAGER] Bot falló al reaccionar al canal: ${r.reason?.message}`);
    }
  }

  return { ok, fail, total: bots.length };
}