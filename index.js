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
const OWNER_PHONE = process.env.OWNER_PHONE || '393288830885@c.us'; // Definisci il numero di telefono del proprietario

// Verifica variabili d'ambiente
if (!process.env.FIREBASE_PROJECT_ID || !process.env.FIREBASE_PRIVATE_KEY || !process.env.FIREBASE_CLIENT_EMAIL) {
    console.error('Errore: una o più variabili di ambiente Firebase non sono configurate.');
    process.exit(1);
}

if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
    console.error('Errore: le credenziali email non sono configurate.');
    process.exit(1);
}

// Firebase Admin SDK
try {
    admin.initializeApp({
        credential: admin.credential.cert({
            project_id: process.env.FIREBASE_PROJECT_ID,
            private_key: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
            client_email: process.env.FIREBASE_CLIENT_EMAIL,
        }),
        databaseURL: 'https://whatsapp-bot-1-df029-default-rtdb.europe-west1.firebasedatabase.app',
    });
    console.log('Firebase inizializzato correttamente.');
} catch (error) {
    console.error('Errore durante l\'inizializzazione di Firebase:', error.message);
    process.exit(1);
}

const db = admin.database();

// Stato utenti
const userStates = {};
const disengagedUsers = new Set();

// Configurazione email
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS,
    },
});

// Funzioni Firebase per il calendario
async function getAvailableSlots(date) {
    try {
        const ref = db.ref(`calendario/${date}`);
        const snapshot = await ref.once('value');
        const slots = snapshot.val();
        console.log(`Slot disponibili per ${date}: ${slots ? slots.join(', ') : 'Nessuno'}`);
        return slots;
    } catch (error) {
        console.error(`Errore durante il recupero degli slot disponibili per ${date}:`, error.message);
        return null;
    }
}

async function updateAvailableSlots(date, time) {
    try {
        const ref = db.ref(`calendario/${date}`);
        const snapshot = await ref.once('value');
        const slots = snapshot.val() || [];
        const updatedSlots = slots.filter((slot) => slot !== time);
        await ref.set(updatedSlots);
        console.log(`Slot aggiornati per ${date}: ${updatedSlots.join(', ')}`);
    } catch (error) {
        console.error(`Errore durante l'aggiornamento degli slot per ${date}:`, error.message);
    }
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
        from: process.env.EMAIL_USER,
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

// Rotta per ottenere il QR Code
app.get('/qr', (req, res) => {
    const qrPath = path.join(__dirname, 'qr.png');
    fs.access(qrPath, fs.constants.R_OK, (err) => {
        if (err) {
            console.error('Il QR Code non è disponibile:', err.message);
            res.status(404).send('QR Code non trovato.');
        } else {
            res.sendFile(qrPath);
            console.log('QR Code inviato con successo.');
        }
    });
});

// Rotta ping per uptime
app.get('/ping', (req, res) => {
    console.log('Ping ricevuto da UptimeRobot.');
    res.status(200).send('OK');
});

app.get('/', (req, res) => res.send('Il bot è attivo!'));

// Avvio del server
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`Server in ascolto sulla porta ${PORT}`));

// Gestione dei messaggi WhatsApp
client.on('message', async (message) => {
    console.log(`Messaggio ricevuto da ${message.from}: ${message.body}`);
    const chatId = message.from;
    const userResponse = message.body.trim().toLowerCase();

    if (chatId === OWNER_PHONE) return;

    if (!userStates[chatId]) {
        userStates[chatId] = { step: 'ask_date', data: {} };
        await message.reply('Vuoi prenotare una lezione di Pilates? Digita "Sì" o "No".');
        return;
    }

    const userState = userStates[chatId];
    if (userState.step === 'ask_date') {
        const date = validateAndFormatDate(userResponse);
        const slots = await getAvailableSlots(date);
        if (slots) {
            userState.data.date = date;
            userState.step = 'ask_time';
            await message.reply(`Orari disponibili per ${date}: ${slots.join(', ')}`);
        } else {
            await message.reply('Nessun orario disponibile.');
        }
    }
});

// Riconnessione automatica
client.on('disconnected', (reason) => {
    console.log(`Bot disconnesso: ${reason}`);
    client.initialize();
});

client.on('ready', () => console.log('Bot connesso a WhatsApp!'));
client.initialize();
