# Yuta Okotsu Bot 🌿
<p align="center">
<img src="./database/ed.gif" width="75%" alt="Yuta Okotsu Bot">
</p>

> Bot de WhatsApp estético, funcional y modular, desarrollado con **Baileys**, usando **SQLite** y una arquitectura limpia para bots principales, subbots y plugins.

<p align="center">
<img src="https://img.shields.io/badge/Status-Activo-22c55e?style=flat" alt="Status">
<img src="https://img.shields.io/badge/Node.js-v20+-16a34a?style=flat&logo=nodedotjs&logoColor=white" alt="Node.js">
<img src="https://img.shields.io/badge/Database-SQLite-2563eb?style=flat" alt="SQLite">
<img src="https://img.shields.io/badge/Baileys-WhatsApp-0f172a?style=flat" alt="Baileys">
</p>

<p align="center">
<a href="https://github.com/DuarteXV/Yuta-Okotsu-Bot-MD">
<img src="https://img.shields.io/badge/Repositorio-Yuta%20Okotsu%20Bot-7c3aed?style=for-the-badge&logo=github&logoColor=white" alt="Repositorio">
</a>
</p>

> [!NOTE]
> **Yuta Okkotsu Bot MD** está pensado para ofrecer una experiencia limpia, modular y fácil de usar en WhatsApp. El proyecto se mantiene en evolución constante para mejorar funciones, estabilidad y compatibilidad.

---

## 🌱 Descripción

**Yuta Okkotsu Bot MD** es un bot de WhatsApp basado en `baileys`, creado con una estructura modular para manejar comandos, subbots, sesiones, base de datos y funciones multimedia de forma organizada.

Su diseño está orientado a mantener el código limpio, facilitar la expansión del proyecto y permitir que otros usuarios puedan vincular sus propios números como subbots.

---

## 🪴 Requisitos

Antes de instalar el bot, asegúrate de tener instalado lo siguiente:

| Requisito | Descripción |
|---|---|
| Git | Para clonar el repositorio |
| Node.js v20+ | Para ejecutar el proyecto |
| FFmpeg | Para procesar audio, video y stickers |
| Build Essential | Para compilar dependencias nativas |

<p>
<a href="https://git-scm.com/downloads"><img src="https://img.shields.io/badge/Git-0f172a?style=flat&logo=git&logoColor=22c55e" alt="Git"></a>
<a href="https://nodejs.org/en/download"><img src="https://img.shields.io/badge/Node.js-1e3a8a?style=flat&logo=nodedotjs&logoColor=white" alt="Node.js"></a>
<a href="https://ffmpeg.org/download.html"><img src="https://img.shields.io/badge/FFmpeg-14532d?style=flat&logo=ffmpeg&logoColor=white" alt="FFmpeg"></a>
</p>

---

## 🌵 Instalación =>

<details>
<summary><strong>🍃 Linux / Ubuntu</summary>

```bash
apt update && apt upgrade -y
```
```bash
apt install git nodejs ffmpeg build-essential -y
```
```bash
git clone https://github.com/DuarteXV/Yuta-Okkotsu-Bot-MD.git Yuta
```
```bash
cd Yuta
```
```bash
npm i
```
```bash
npm start
```

</details>

<details>
<summary><strong>🌾 Termux</summary>

```bash
termux-setup-storage
```
```bash
pkg update && pkg upgrade -y
```
```bash
pkg install -y nodejs-lts git python clang make pkg-config libvips ffmpeg libwebp
```
```bash
git clone https://github.com/DuarteXV/Yuta-Okkotsu-Bot-MD.git Yuta && cd Yuta
```
```bash
export GYP_DEFINES="android_ndk_path=''"
echo 'export GYP_DEFINES="android_ndk_path="""' >> ~/.bashrc
```
```bash
npm i && npm install --cpu=wasm32 sharp && npm install @img/sharp-wasm32
```
```bash
npm start
```

> Si aparece una confirmación como **(Y/I/N/O/D/Z) [default=N] ?**, usa la letra **y** y presiona **ENTER**.

</details>

<details>
<summary><strong>🍀 Mantener el bot activo con PM2</summary>

Ejecuta estos comandos dentro de la carpeta del bot:

```bash
npm i -g pm2
```

```bash
pm2 start index.js
```

```bash
pm2 save
```

```bash
pm2 logs
```

### Opciones disponibles

Detener el bot:

```bash
pm2 stop index
```

Iniciar nuevamente:

```bash
pm2 start index
```

Eliminar el proceso:

```bash
pm2 delete index
```

Ver logs:

```bash
pm2 logs
```

</details>

> 🦎 Al iniciar, podrás elegir entre **código de emparejamiento** o **código QR** para vincular tu dispositivo.

---

## 🐸 Comandos principales

| Comando | Descripción |
|---|---|
| `menu` | Muestra el menú con todos los comandos disponibles |
| `code` | Vincula tu número como subbot |
| `s` | Crea stickers desde imagen, video o gif |
| `setmeta` | Personaliza la marca de agua de stickers |
| `play` | Descarga videos de YouTube en MP3 |
| `scdl` | Descarga canciones desde SoundCloud |
| `bots` | Muestra los subbots conectados |

---

## 🌳 Estructura del proyecto

```txt
Yuta-Okotsu-Bot-MD/
├── core/
├── database/
├── plugins/
├── sessions/
├── config.js/
├── index.js/
└── package.json
```

---

## 🐢 Sistema de Subbots

Yuta Okkotsu cuenta con soporte para **subbots**, permitiendo que otros usuarios vinculen sus propios números y usen el sistema de forma independiente.

---

## 🍃 APIs utilizadas

Parte de las funciones multimedia y de descarga del bot se apoyan en servicios externos. Si alguno de estos servicios llega a estar caído, los comandos que dependan de él pueden fallar temporalmente.

<table align="center">
<tr>
<td align="center" width="200">
<a href="https://api.alyacore.xyz/">
<img src="https://api.alyacore.xyz/favicon.ico" width="64px" alt="AlyaCore API"><br>
<sub><b>api.alyacore.xyz</b></sub>
</a>
</td>
<td align="center" width="200">
<a href="https://api.lempi.lat/">
<img src="https://api.lempi.lat/logo.png" width="64px" alt="Lempi API"><br>
<sub><b>api.lempi.lat</b></sub>
</a>
</td>
</tr>
</table>

> [!TIP]
> Se agradece a los desarrolladores de estas APIs por mantener sus servicios disponibles para la comunidad.

---

## 🌲 Colaboradores

Personas que han aportado código, ideas y soporte al desarrollo de **Yuta Okkotsu Bot MD**:

<table align="center">
<tr>
<td align="center">
<a href="https://github.com/naut21">
<img src="https://github.com/naut21.png?size=120" width="110px" alt="naut21"><br>
<sub><b>naut21</b></sub>
</a>
</td>
<td align="center">
<a href="https://github.com/DuarteXV">
<img src="https://github.com/DuarteXV.png?size=120" width="110px" alt="DuarteXV"><br>
<sub><b>DuarteXV</b></sub>
</a>
</td>
<td align="center">
<a href="https://github.com/jonathanggg">
<img src="https://github.com/jonathanggg.png?size=120" width="110px" alt="jonathanggg"><br>
<sub><b>jonathanggg</b></sub>
</a>
</td>
</tr>
</table>

> 🍀 ¿Quieres aparecer aquí? Las contribuciones son bienvenidas mediante **issues** y **pull requests**.

---

## 🌴 Aclaración legal

> Este proyecto **no está afiliado a WhatsApp ni a Meta**.  
> Es un bot independiente desarrollado con **Baileys**.

🌱 La temática visual está inspirada en **Jujutsu Kaisen** y el personaje **Yuta Okkotsu**.

---

<p align="center">
<a href="https://github.com/DuarteXV">
<img src="https://img.shields.io/badge/Powered%20by-DuarteXV-7c3aed?style=for-the-badge&logo=github&logoColor=white" alt="Powered by DuarteXV">
</a>
</p>
<p align="center">
<a href="https://github.com/DuarteXV">
<img src="https://github.com/DuarteXV.png?size=130" width="130px">
</a>
</p>
