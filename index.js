require('dotenv').config();
const express = require('express');
const app = express();
const fs = require('fs');
const path = require('path');
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode');
const nodemailer = require('nodemailer');
const admin = require('firebase-admin'); // Firebase Admin SDK
const { parse, isValid, isFuture, isWithinInterval, endOfYear, format } = require('date-fns');
const { it } = require('date-fns/locale');

// Variabili d'ambiente
const OWNER_PHONE = process.env.OWNER_PHONE || '393288830885@c.us';
const EMAIL_USER = process.env.EMAIL_USER;
const EMAIL_PASS = process.env.EMAIL_PASS;

// Firebase Admin SDK
const serviceAccount = require('./firebase-adminsdk.json'); // File di configurazione Firebase
admin.initializeApp({
    credential: admin.credential.cert({
        project_id: process.env.FIREBASE_PROJECT_ID,
        private_key: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
        client_email: process.env.FIREBASE_CLIENT_EMAIL
    }),
    databaseURL: 'https://whatsapp-bot-1-df029-default-rtdb.europe-west1.firebasedatabase.app/' // Sostituisci con il tuo URL
});

const db = admin.database();

// Stato utenti
const userStates = {};
const disengagedUsers = new Set();

// Configurazione email
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: EMAIL_USER,
        pass: EMAIL_PASS,
    },
});

// Funzioni Firebase per il calendario
async function getAvailableSlots(date) {
    const ref = db.ref(`calendario/${date}`);
    const snapshot = await ref.once('value');
    return snapshot.val();
}

async function updateAvailableSlots(date, time) {
    const ref = db.ref(`calendario/${date}`);
    const snapshot = await ref.once('value');
    const slots = snapshot.val() || [];
    const updatedSlots = slots.filter((slot) => slot !== time);
    await ref.set(updatedSlots);
}

// Funzione per inviare email
async function sendEmailNotification(bookingData) {
    const emailBody = `
        Nuova prenotazione ricevuta:
        - Nome: ${bookingData.name}
        - Cognome: ${bookingData.surname}
        - Telefono: ${bookingData.phone}
        - Data: ${bookingData.date}
        - Ora: ${bookingData.time}
    `;
    const mailOptions = {
        from: EMAIL_USER,
        to: 'siselcatania@gmail.com',
        subject: 'Nuova Prenotazione lezione Pilates',
        text: emailBody,
    };
    try {
        console.log('Invio email...');
        const result = await transporter.sendMail(mailOptions);
        console.log('Email inviata con successo:', result.response);
    } catch (error) {
        console.error('Errore nell\'invio dell\'email:', error.message);
    }
}

// Funzione per inviare notifiche e promemoria
async function sendFinalNotification(client, bookingData) {
    const summary = `
        Prenotazione completata:
        - Nome: ${bookingData.name}
        - Cognome: ${bookingData.surname}
        - Telefono: ${bookingData.phone}
        - Data: ${bookingData.date}
        - Ora: ${bookingData.time}
    `;
    try {
        console.log(`Invio notifica finale a ${OWNER_PHONE}:\n${summary}`);
        await client.sendMessage(OWNER_PHONE, `Nuova prenotazione ricevuta:\n${summary}`);
        console.log('Notifica finale inviata con successo.');
    } catch (error) {
        console.error(`Errore nell'invio della notifica finale a ${OWNER_PHONE}:`, error.message);
    }
}

async function sendUserReminder(client, chatId, bookingData) {
    const summary = `
📋 *Promemoria della tua Prenotazione*
──────────────────────
👤 Nome: ${bookingData.name}
👥 Cognome: ${bookingData.surname}
📞 Telefono: ${bookingData.phone}
📅 Data richiesta: ${bookingData.date}
⏰ Orario richiesto: ${bookingData.time}
──────────────────────
Grazie per aver prenotato con noi la tua lezione gratuita!
    `;
    try {
        console.log(`Invio promemoria all'utente ${chatId}:\n${summary}`);
        await client.sendMessage(chatId, summary);
        console.log('Promemoria inviato con successo.');
    } catch (error) {
        console.error(`Errore nell'invio del promemoria all'utente ${chatId}:`, error.message);
    }
}

// Funzioni di validazione
function validateAndFormatDate(input) {
    const today = new Date();
    const yearEnd = endOfYear(today);
    const formats = ['dd MMMM yyyy', 'dd/MM/yyyy'];
    for (const fmt of formats) {
        const parsedDate = parse(input, fmt, today, { locale: it });
        if (isValid(parsedDate) && isFuture(parsedDate) && isWithinInterval(parsedDate, { start: today, end: yearEnd })) {
            return format(parsedDate, 'dd/MM/yyyy');
        }
    }
    return null;
}

function validateAndFormatTime(input) {
    const timeRegex = /^(\d{1,2}):(\d{2})$/;
    const match = timeRegex.exec(input);
    if (match) {
        const hours = parseInt(match[1], 10);
        const minutes = parseInt(match[2], 10);
        if (hours >= 0 && hours < 24 && minutes >= 0 && minutes < 60) {
            return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;
        }
    }
    return null;
}

// Configurazione WhatsApp Client
const client = new Client({ authStrategy: new LocalAuth() });

client.on('qr', (qr) => {
    console.log('QR Code generato.');
    const qrPath = path.join(__dirname, 'qr.png');
    qrcode.toFile(qrPath, qr, (err) => {
        if (err) console.error('Errore nel salvataggio del QR Code:', err.message);
        else console.log(`QR Code salvato in ${qrPath}`);
    });
});

// Server Express
app.get('/qr', (req, res) => {
    const qrPath = path.join(__dirname, 'qr.png');
    if (fs.existsSync(qrPath)) {
        res.sendFile(qrPath);
    } else {
        res.status(404).send('QR Code non trovato.');
    }
});

app.get('/ping', (req, res) => {
    console.log('Ping ricevuto da UptimeRobot.');
    res.status(200).send('OK');
});

app.get('/', (req, res) => res.send('Il bot è attivo!'));

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
    console.log(`Server in ascolto sulla porta ${PORT}`);
});

// Gestione dei messaggi
client.on('message', async (message) => {
    console.log(`Messaggio ricevuto da ${message.from}: ${message.body}`);
    const chatId = message.from;
    const userResponse = message.body.trim().toLowerCase();

    if (chatId === OWNER_PHONE) return;

    if (disengagedUsers.has(chatId)) {
        if (userResponse === 'prenotazione') {
            disengagedUsers.delete(chatId);
            userStates[chatId] = { step: 'ask_name', data: {} };
            await message.reply('Riprendiamo la prenotazione! Come ti chiami?');
        }
        return;
    }

    if (!userStates[chatId]) {
        userStates[chatId] = { step: 'initial', data: {} };
        await message.reply('Vuoi prenotare una lezione di Pilates? Digita "Sì" o "No".');
        return;
    }

    const userState = userStates[chatId];
    switch (userState.step) {
        case 'ask_date':
            const date = validateAndFormatDate(message.body.trim());
            if (date) {
                const slots = await getAvailableSlots(date);
                if (slots && slots.length > 0) {
                    userState.data.date = date;
                    userState.step = 'ask_time';
                    await message.reply(`Orari disponibili per ${date}: ${slots.join(', ')}`);
                } else {
                    await message.reply('Nessun orario disponibile per questa data.');
                }
            } else {
                await message.reply('Data non valida.');
            }
            break;

        case 'ask_time':
            const time = message.body.trim();
            const availableSlots = await getAvailableSlots(userState.data.date);
            if (availableSlots && availableSlots.includes(time)) {
                userState.data.time = time;
                await updateAvailableSlots(userState.data.date, time);
                await sendFinalNotification(client, userState.data);
                await sendEmailNotification(userState.data);
                await sendUserReminder(client, chatId, userState.data);
                delete userStates[chatId];
                await message.reply('Prenotazione completata!');
            } else {
                await message.reply('Orario non disponibile.');
            }
            break;

        default:
            delete userStates[chatId];
            await message.reply('Errore sconosciuto. Riprova.');
            break;
    }
});

// Riconnessione Automatica
client.on('disconnected', (reason) => {
    console.log(`Bot disconnesso: ${reason}`);
    client.initialize();
});

// Avvio del bot
client.initialize();
client.on('ready', () => console.log('Bot connesso a WhatsApp!'));
