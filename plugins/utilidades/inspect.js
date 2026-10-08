async function resolverJid(sock, jid) {
    if (!jid) return null
    if (!jid.endsWith('@lid')) {
        return jid.split(':')[0].split('@')[0] + '@s.whatsapp.net'
    }
    try {
        const pn = await sock.signalRepository?.lidMapping?.getPNForLID(jid)
        if (pn) return pn.split(':')[0].split('@')[0] + '@s.whatsapp.net'
    } catch {}
    return jid // no se pudo resolver: se queda como LID (WhatsApp lo muestra con nombre al mencionarlo)
}

export default {
    name: ['inspect', 'inspeccionar'],
    description: 'Inspecciona un enlace de grupo, comunidad o canal de WhatsApp',
    category: 'herramientas',

    async run({ sock, from, msg, text, reply }) {
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

        const groupUrl = text.match(/(?:https?:\/\/)?(?:chat\.whatsapp\.com\/)([0-9A-Za-z]{22,24})/i)?.[1]
        const channelUrl = text.match(/(?:https?:\/\/)?(?:whatsapp\.com\/channel\/)([0-9A-Za-z@.]+)/i)?.[1]

        let caption = ''
        let mentions = []

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
                const esComunidad = !!info.isCommunity

                // Creador (arreglo LID): prioriza ownerPn, si no, resuelve el LID
                const creadorJid = await resolverJid(sock, info.ownerPn || info.owner)
                let creador = 'No disponible / Salió del grupo'
                if (creadorJid) {
                    creador = `@${creadorJid.split('@')[0]}`
                    mentions.push(creadorJid)
                }

                const creacion = info.creation
                    ? new Date(info.creation * 1000).toLocaleDateString('es-ES')
                    : 'No disponible'

                caption =
`${esComunidad ? '🏘️ *INFORMACIÓN DE LA COMUNIDAD*' : '👥 *INFORMACIÓN DEL GRUPO*'}

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

        await sock.sendMessage(from, {
            text: caption,
            contextInfo: { mentionedJid: mentions }
        }, { quoted: fkontak })
    }
}