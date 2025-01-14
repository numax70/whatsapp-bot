require('dotenv').config();
const express = require('express');
const app = express();
const fs = require('fs');
const path = require('path');
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode');
const nodemailer = require('nodemailer');
const admin = require('firebase-admin');
const {
    parse,
    isValid,
    isFuture,
    format,
    addDays,
    isSaturday,
    isSunday,
} = require('date-fns');
const { it } = require('date-fns/locale');
const os = require('os');

// Variabili d'ambiente
const OWNER_PHONE = process.env.OWNER_PHONE || '393288830885@c.us';
const EMAIL_USER = process.env.EMAIL_USER;
const EMAIL_PASS = process.env.EMAIL_PASS;

// Configurazione Firebase Admin SDK
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
    console.error("Errore durante l'inizializzazione di Firebase:", error.message);
    process.exit(1);
}

const db = admin.database();
const userStates = {};

// Configurazione email
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: EMAIL_USER,
        pass: EMAIL_PASS,
    },
});

// Funzione per validare e convertire la data
function validateAndFormatDate(input) {
    const formats = ['dd/MM/yyyy', 'dd MMMM yyyy'];
    const today = new Date();

    for (const fmt of formats) {
        const parsedDate = parse(input, fmt, today, { locale: it });
        if (isValid(parsedDate) && isFuture(parsedDate)) {
            return format(parsedDate, 'yyyy-MM-dd');
        }
    }
    return null;
}

// Funzione per popolare il calendario su Firebase
async function populateCalendar() {
    const startDate = new Date(2025, 0, 1);
    const endDate = new Date(2025, 6, 31);

    const schedule = {
        "Lunedì": [
            { "time": "09:30", "lessonType": "PILATES MATWORK" },
            { "time": "10:30", "lessonType": "POSTURALE" }
        ],
        "Martedì": [
            { "time": "13:30", "lessonType": "GIROKYNESIS" },
            { "time": "15:00", "lessonType": "PILATES MATWORK" }
        ],
        "Mercoledì": [
            { "time": "09:30", "lessonType": "PILATES MATWORK" },
            { "time": "12:00", "lessonType": "PILATES EXO CHAIR" }
        ],
        "Giovedì": [
            { "time": "13:30", "lessonType": "GIROKYNESIS" },
            { "time": "18:00", "lessonType": "YOGA" }
        ],
        "Venerdì": [
            { "time": "14:00", "lessonType": "PILATES MATWORK" },
            { "time": "17:00", "lessonType": "FUNCTIONAL TRAINER MOVEMENT" }
        ]
    };

    let currentDate = startDate;
    while (currentDate <= endDate) {
        if (!isSaturday(currentDate) && !isSunday(currentDate)) {
            const day = format(currentDate, 'EEEE', { locale: it });
            if (schedule[day]) {
                const formattedDate = format(currentDate, 'yyyy-MM-dd');
                await db.ref(`calendario/${formattedDate}`).set(schedule[day]);
            }
        }
        currentDate = addDays(currentDate, 1);
    }
    console.log('Calendario popolato su Firebase.');
}

// Funzioni Firebase per il calendario
async function getAvailableSlots(date) {
    try {
        const ref = db.ref(`calendario/${date}`);
        const snapshot = await ref.once('value');
        const slots = snapshot.val();
        return slots || [];
    } catch (error) {
        console.error(`Errore durante il recupero degli slot disponibili per ${date}:`, error.message);
        return [];
    }
}

async function updateAvailableSlots(date, time) {
    try {
        const ref = db.ref(`calendario/${date}`);
        const snapshot = await ref.once('value');
        const slots = snapshot.val() || [];
        const updatedSlots = slots.filter((slot) => slot.time !== time);
        await ref.set(updatedSlots);
    } catch (error) {
        console.error(`Errore durante l'aggiornamento degli slot per ${date}:`, error.message);
    }
}

// Funzioni per notifiche ed email
async function sendEmailNotification(bookingData) {
    const emailBody = `
        Nuova prenotazione ricevuta:
        - Nome: ${bookingData.name}
        - Cognome: ${bookingData.surname}
        - Telefono: ${bookingData.phone}
        - Data: ${bookingData.date}
        - Ora: ${bookingData.time}
        - Tipo di lezione: ${bookingData.lessonType}
    `;

    const mailOptions = {
        from: EMAIL_USER,
        to: 'siselcatania@gmail.com',
        subject: 'Nuova Prenotazione Lezione',
        text: emailBody,
    };

    try {
        await transporter.sendMail(mailOptions);
        console.log('Email inviata con successo all\'owner.');
    } catch (error) {
        console.error('Errore nell\'invio dell\'email:', error.message);
    }
}

// Funzione per mostrare il prospetto delle lezioni
function displaySchedule() {
    return `
📅 *Prospetto Settimanale delle Lezioni*
- *Lunedì*: 09:30 PILATES MATWORK, 10:30 POSTURALE
- *Martedì*: 13:30 GIROKYNESIS, 15:00 PILATES MATWORK
- *Mercoledì*: 09:30 PILATES MATWORK, 12:00 PILATES EXO CHAIR
- *Giovedì*: 13:30 GIROKYNESIS, 18:00 YOGA
- *Venerdì*: 14:00 PILATES MATWORK, 17:00 FUNCTIONAL TRAINER MOVEMENT
`;
}

// Configurazione WhatsApp Client
const client = new Client({ authStrategy: new LocalAuth() });

client.on('qr', (qr) => {
    console.log('QR Code generato.');
    const qrPath = path.join(__dirname, 'qr.png');
    qrcode.toFile(qrPath, qr, (err) => {
        if (err) console.error('Errore nel salvataggio del QR Code:', err.message);
    });
});

app.get('/qr', (req, res) => {
    const qrPath = path.join(__dirname, 'qr.png');
    if (fs.existsSync(qrPath)) {
        res.sendFile(qrPath);
    } else {
        res.status(404).send('QR Code non trovato.');
    }
});

client.on('message', async (message) => {
    const chatId = message.from;
    const userResponse = message.body.trim();

    if (!userStates[chatId]) {
        userStates[chatId] = { step: 'ask_date', data: {} };
        await message.reply(
            `Vuoi prenotare una lezione? Digita "Sì" o "No".\n${displaySchedule()}`
        );
        return;
    }

    // Gestione messaggi simile al precedente...
});

app.listen(process.env.PORT || 10000, async () => {
    console.log(`Server in ascolto sulla porta ${process.env.PORT || 10000}`);
    await populateCalendar();
});

// Monitoraggio risorse
setInterval(() => {
    const memoryUsage = process.memoryUsage();
    const cpuLoad = os.loadavg();
    console.log(`RAM Utilizzata: ${(memoryUsage.rss / 1024 / 1024).toFixed(2)} MB`);
    console.log(`CPU Load (1 minuto): ${cpuLoad[0].toFixed(2)}`);
}, 60000);

app.get('/ping', (req, res) => {
    res.status(200).send('OK');
});

client.on('ready', () => console.log('Bot connesso a WhatsApp!'));
client.initialize();
