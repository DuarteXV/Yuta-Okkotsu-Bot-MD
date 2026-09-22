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

// Devuelve un Readable stream listo para pasarle a Baileys.
// Importante: un stream solo se puede consumir una vez, así que si
// necesitás reenviar (audio + documento), pedí uno nuevo por cada envío.
async function getAudioStream(url) {
  const res = await axios.get(url, {
    responseType: "stream",
    timeout: 60000,
    headers: { "User-Agent": "Mozilla/5.0" },
  });
  return res.data;
}

function extractVideoId(text) {
  const patterns = [
    /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/shorts\/|youtube\.com\/embed\/)([A-Za-z0-9_-]{11})/,
  ];
  for (const p of patterns) {
    const match = text.match(p);
    if (match) return match[1];
  }
  return null;
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

      const videoId = extractVideoId(text);
      let yt;

      if (videoId) {
        // Ya es un link directo: no necesitamos buscar en YouTube, evitamos el 302 de yts
        yt = {
          url: `https://www.youtube.com/watch?v=${videoId}`,
          title: null,
          thumbnail: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
          views: null,
          seconds: null,
        };
      } else {
        try {
          const search = await yts(text);
          yt = search.videos?.[0] || search.all?.[0];
        } catch (e) {
          console.error("[play] búsqueda yts falló:", e.message);
          return reply({
            text: "⛧ no pude buscar en YouTube ahorita, mejor pega el link directo del video",
          });
        }

        if (!yt) {
          return reply({
            text: "⛧ no encontré resultados",
          });
        }
      }

      const audio = await getAudio(yt.url);

      const title = audio.title || yt.title || "Sin título";
      const thumbnail = audio.thumbnail || yt.thumbnail;
      const youtube_url = yt.url;
      const download_url = audio.url;
      const calidad = audio.calidad || "128k";
      const formato = audio.formato || "mp3";
      const fileName = audio.fileName || `${title}.${formato}`;

      const vistas = formatViews(yt.views);

      // Arrancamos a pedir el stream del audio en paralelo mientras
      // se envía el mensaje del thumbnail, para no perder tiempo.
      const streamPromise = getAudioStream(download_url);

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
      const stream = await streamPromise;

      if (isLongAudio) {
        await sock.sendMessage(
          from,
          {
            document: stream,
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
            audio: stream,
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
