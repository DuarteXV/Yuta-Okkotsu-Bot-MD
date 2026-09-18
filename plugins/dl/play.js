import axios from "axios";
import yts from "yt-search";

const APIS = [
  {
    name: "lempi",
    timeout: 90000,
    build: (url) =>
      `https://api.lempi.lat/dl/yta?apikey=Duarte-1311-2026&url=${encodeURIComponent(url)}`,
    parse: (data) => {
      if (!data?.status || !data?.datos?.url) return null;
      return {
        title: data.titulo,
        thumbnail: data.miniatura,
        url: data.datos.url,
        calidad: data.datos.calidad,
        formato: data.datos.extension?.replace(".", ""),
        fileName: data.datos.archivo,
      };
    },
  },
  {
    name: "alyacore",
    timeout: 60000,
    build: (url) =>
      `https://api.alyacore.xyz/dl/ytmp3v2?apikey=Duarte-zz12&url=${encodeURIComponent(url)}`,
    parse: (data) => {
      if (!data?.status || !data?.data?.dl) return null;
      const d = data.data;
      return {
        title: d.title,
        thumbnail: d.thumbnail,
        url: d.dl,
        calidad: d.quality,
        formato: d.format || "mp3",
        fileName: null,
      };
    },
  },
];

async function getAudio(ytUrl) {
  let lastError;

  for (const api of APIS) {
    try {
      const res = await axios.get(api.build(ytUrl), { timeout: api.timeout });
      const audio = api.parse(res.data);
      if (audio?.url) return audio;
      lastError = new Error(`${api.name}: respuesta sin URL de audio`);
    } catch (e) {
      console.error(`[play] ${api.name} falló:`, e.message);
      lastError = e;
    }
  }

  throw lastError || new Error("no pude obtener el audio");
}

export default {
  name: ["play", "yta", "ytmp3", "playaudio"],
  description: "Descarga música de YouTube",
  category: "dl",
  ownerOnly: false,

  async run({ sock, from, msg, text, reply, react }) {
    try {
      if (!text.trim()) {
        return reply({
          text: "⛧ escribe el nombre o link del video",
        });
      }

      await react("🎧");

      const search = await yts(text);
      const yt = search.videos?.[0] || search.all?.[0];

      if (!yt) {
        return reply({
          text: "⛧ no encontré resultados",
        });
      }

      const audio = await getAudio(yt.url);

      const title = audio.title || yt.title;
      const thumbnail = audio.thumbnail || yt.thumbnail;
      const youtube_url = yt.url;
      const download_url = audio.url;
      const calidad = audio.calidad || "128k";
      const formato = audio.formato || "mp3";
      const fileName = audio.fileName || `${title}.${formato}`;

      const vistas = formatViews(yt.views);

      await sock.sendMessage(
        from,
        {
          image: { url: thumbnail },
          caption:
            `⛧ ${title}\n\n` +
            `⛧ vistas › ${vistas}\n` +
            `⛧ duración › ${formatDuration(yt.seconds)}\n` +
            `⛧ calidad › ${calidad}\n` +
            `⛧ formato › ${formato}\n` +
            `⛧ link › ${youtube_url}`,
        },
        { quoted: msg }
      );

      const isLongAudio = yt.seconds > 1800; // 30 minutos

      if (isLongAudio) {
        await sock.sendMessage(
          from,
          {
            document: { url: download_url },
            mimetype: "audio/mpeg",
            fileName,
            caption: "⛧ audio enviado como documento por duración/tamaño",
          },
          { quoted: msg }
        );
      } else {
        await sock.sendMessage(
          from,
          {
            audio: { url: download_url },
            mimetype: "audio/mpeg",
            ptt: false,
          },
          { quoted: msg }
        );
      }

      await react("✅");
    } catch (e) {
      console.error(e);
      await react("❌");
      await reply({
        text: `⛧ ${e.message}`,
      });
    }
  },
};

function formatViews(views) {
  if (!views) return "No disponible";
  if (views >= 1e9) return `${(views / 1e9).toFixed(1)}B`;
  if (views >= 1e6) return `${(views / 1e6).toFixed(1)}M`;
  if (views >= 1e3) return `${(views / 1e3).toFixed(1)}k`;
  return views.toString();
}

function formatDuration(duration) {
  if (!duration) return "No disponible";

  if (typeof duration === "string") {
    if (duration.includes(":")) return duration;
    duration = Number(duration);
  }

  if (isNaN(duration)) return "No disponible";

  const hours = Math.floor(duration / 3600);
  const minutes = Math.floor((duration % 3600) / 60);
  const seconds = Math.floor(duration % 60);

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }

  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}