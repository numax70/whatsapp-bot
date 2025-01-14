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

// Funzione per validare e formattare la data
function validateAndFormatDate(input) {
    const today = new Date();
    const formats = ['dd MMMM yyyy', 'dd/MM/yyyy', 'yyyy-MM-dd'];

    for (const fmt of formats) {
        const parsedDate = parse(input, fmt, today, { locale: it });
        if (isValid(parsedDate) && isFuture(parsedDate)) {
            return format(parsedDate, 'yyyy-MM-dd'); // Formatta al formato richiesto
        }
    }
    return null;
}

// Funzione per popolare il calendario su Firebase
async function populateCalendar() {
    const startDate = new Date(2025, 0, 1); // 1 gennaio 2025
    const endDate = new Date(2025, 6, 31); // 31 luglio 2025

    const schedule = {
        MONDAY: [
            { time: '09:30', lessonType: 'PILATES MATWORK' },
            { time: '10:30', lessonType: 'POSTURALE' },
        ],
        TUESDAY: [
            { time: '13:30', lessonType: 'GIROKYNESIS' },
            { time: '15:00', lessonType: 'PILATES MATWORK' },
        ],
        WEDNESDAY: [
            { time: '09:30', lessonType: 'PILATES MATWORK' },
            { time: '12:00', lessonType: 'PILATES EXO CHAIR' },
        ],
        THURSDAY: [
            { time: '13:30', lessonType: 'GIROKYNESIS' },
            { time: '18:00', lessonType: 'YOGA' },
        ],
        FRIDAY: [
            { time: '14:00', lessonType: 'PILATES MATWORK' },
            { time: '17:00', lessonType: 'FUNCTIONAL TRAINER MOVEMENT' },
        ],
    };

    let currentDate = startDate;
    while (currentDate <= endDate) {
        if (!isSaturday(currentDate) && !isSunday(currentDate)) {
            const day = format(currentDate, 'EEEE', { locale: it }).toUpperCase();
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

// Funzione per notificare un errore specifico
function notifySpecificError(errorType) {
    switch (errorType) {
        case 'date':
            return 'Data non valida o non presente. Scegli una data corretta dal calendario.';
        case 'time':
            return 'Orario non valido o non disponibile. Scegli un orario corretto tra quelli disponibili.';
        default:
            return 'Errore sconosciuto. Riprova.';
    }
}

// Funzione per notifiche ed email
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
    } catch (error) {
        console.error('Errore nell\'invio dell\'email:', error.message);
    }
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

// Endpoint per il QR Code
app.get('/qr', (req, res) => {
    const qrPath = path.join(__dirname, 'qr.png');
    if (fs.existsSync(qrPath)) {
        res.sendFile(qrPath);
    } else {
        res.status(404).send('QR Code non trovato.');
    }
});

// Gestione dei messaggi
client.on('message', async (message) => {
    console.log(`Messaggio ricevuto da ${message.from}: ${message.body}`);
    const chatId = message.from;
    const userResponse = message.body.trim();

    if (chatId === OWNER_PHONE) return;

    if (!userStates[chatId]) {
        userStates[chatId] = { step: 'ask_date', data: {} };
        await message.reply('Vuoi prenotare una lezione? Digita "Sì" o "No".');
        return;
    }

    const userState = userStates[chatId];

    switch (userState.step) {
        case 'ask_date':
            const date = validateAndFormatDate(userResponse);
            if (date) {
                const slots = await getAvailableSlots(date);
                if (slots.length > 0) {
                    userState.data.date = date;
                    userState.step = 'ask_time';
                    const slotOptions = slots
                        .map((slot, index) => `${index + 1}) ${slot.time} (${slot.lessonType})`)
                        .join('\n');
                    await message.reply(`Orari disponibili per ${date}:\n${slotOptions}`);
                } else {
                    await message.reply(notifySpecificError('date'));
                }
            } else {
                await message.reply(notifySpecificError('date'));
            }
            break;

        case 'ask_time':
            const timeIndex = parseInt(userResponse, 10) - 1;
            const slots = await getAvailableSlots(userState.data.date);
            if (slots[timeIndex]) {
                const selectedSlot = slots[timeIndex];
                userState.data.time = selectedSlot.time;
                userState.data.lessonType = selectedSlot.lessonType;
                userState.data.phone = chatId; // Salva il numero del cliente
                await updateAvailableSlots(userState.data.date, selectedSlot.time);
                await sendEmailNotification(userState.data);
                delete userStates[chatId];
                await message.reply('Prenotazione completata con successo!');
            } else {
                await message.reply(notifySpecificError('time'));
            }
            break;

        default:
            delete userStates[chatId];
            await message.reply('Errore sconosciuto. Riprova.');
            break;
    }
});

// Avvio del server
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

// Endpoint per UptimeRobot (Ping per evitare sospensione)
app.get('/ping', (req, res) => {
    console.log('Ping ricevuto da UptimeRobot.');
    res.status(200).send('OK');
});

client.on('ready', () => console.log('Bot connesso a WhatsApp!'));
client.initialize();
