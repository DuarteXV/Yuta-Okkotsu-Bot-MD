function parseMention(text = '') {
    return [...text.matchAll(/@([0-9]{5,16}|0)/g)].map(v => v[1] + '@s.whatsapp.net')
}

export default {
    name: ['inspect', 'inspeccionar'],
    description: 'Inspecciona un enlace de grupo, comunidad o canal de WhatsApp',
    category: 'herramientas',

    async run({ sock, from, msg, text, reply }) {
        let md = 'https://github.com/DuarteXV'
        let icons = 'https://raw.githubusercontent.com/danielalejandrobasado-glitch/Yotsuba-MD-Premium/main/uploads/91ea84fc3ce47e5a.jpg'

        const sender = msg.key.participant || msg.key.remoteJid

        let fkontak = {
            "key": {
                "participants": "0@s.whatsapp.net",
                "remoteJid": "status@broadcast",
                "fromMe": false,
                "id": "Halo"
            },
            "message": {
                "contactMessage": {
                    "vcard": `BEGIN:VCARD\nVERSION:3.0\nN:Sy;Bot;;;\nFN:y\nitem1.TEL;waid=${sender.split('@')[0]}:${sender.split('@')[0]}\nitem1.X-ABLabel:Ponsel\nEND:VCARD`
                }
            },
            "participant": "0@s.whatsapp.net"
        }

        if (!text) return await reply({ text: '```ⓘ Ingrese un enlace de grupo, comunidad o canal.```' })

        // Detectar tipo de enlace
        const groupUrl = text.match(/(?:https?:\/\/)?(?:chat\.whatsapp\.com\/)([0-9A-Za-z]{22,24})/i)?.[1]
        const channelUrl = text.match(/(?:https?:\/\/)?(?:whatsapp\.com\/channel\/)([0-9A-Za-z@.]+)/i)?.[1]

        let caption = ''

        // ─── CANAL ───
        if (channelUrl) {
            try {
                const info = await sock.newsletterMetadata("invite", channelUrl).catch(() => null)

                if (!info) {
                    return await reply({ text: `❌ No se encontró información del canal. Verifique que el enlace sea correcto.` })
                }

                const meta = info.thread_metadata || {}

                const id = info.id || 'No encontrado'
                const nombre = meta.name?.text || 'Sin nombre'
                const descripcion = meta.description?.text || 'Sin descripción'
                const suscriptores = meta.subscribers_count ?? 'No disponible'
                const verificado = meta.verification === 'VERIFIED' ? '✅ Verificado' : '❌ No verificado'

                caption =
`📢 *INFORMACIÓN DEL CANAL*

🪪 *Nombre:* ${nombre}
🆔 *ID:* ${id}
👥 *Suscriptores:* ${suscriptores}
${verificado}
📝 *Descripción:* ${descripcion}`

            } catch (e) {
                console.error('Error canal:', e)
                return await reply({ text: `❌ Error al obtener información del canal.` })
            }

        // ─── GRUPO / COMUNIDAD ───
        } else if (groupUrl) {
            try {
                const info = await sock.groupGetInviteInfo(groupUrl).catch(() => null)

                if (!info) {
                    return await reply({ text: `❌ No se encontró información. Verifique que el enlace sea válido.` })
                }

                const id = info.id || 'No encontrado'
                const nombre = info.subject || 'Sin nombre'
                const descripcion = info.desc || 'Sin descripción'
                const participantes = info.size ?? info.participants?.length ?? 'No disponible'
                const tipo = info.isCommunity ? '🏘️ Comunidad' : '👥 Grupo'

                // Obtener creador
                const creadorJid = info.owner
                const creador = creadorJid ? `@${creadorJid.split('@')[0]}` : 'No disponible / Salió del grupo'

                const creacion = info.creation
                    ? new Date(info.creation * 1000).toLocaleDateString('es-ES')
                    : 'No disponible'

                caption =
`${tipo === '🏘️ Comunidad'
? '🏘️ *INFORMACIÓN DE LA COMUNIDAD*'
: '👥 *INFORMACIÓN DEL GRUPO*'}

📛 *Nombre:* ${nombre}
🆔 *ID:* ${id}
👑 *Creador:* ${creador}
👥 *Participantes:* ${participantes}
📅 *Creado:* ${creacion}
📝 *Descripción:* ${descripcion}`

            } catch (e) {
                console.error('Error grupo/comunidad:', e)
                return await reply({ text: `❌ Error al obtener información del grupo o comunidad.` })
            }

        } else {
            return await reply({ text: `❌ No se detectó un enlace válido de grupo, comunidad o canal de WhatsApp.` })
        }

        // ─── ENVIAR RESULTADO ───
        await sock.sendMessage(from, {
            text: caption,
            contextInfo: {
                mentionedJid: parseMention(caption)
            }
        }, { quoted: fkontak })
    }
}
