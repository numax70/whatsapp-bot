require('dotenv').config();
const express = require('express');
const app = express();
const fs = require('fs');
const path = require('path');
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode');
const nodemailer = require('nodemailer');
const admin = require('firebase-admin');
const { parse, isValid, isFuture, isWithinInterval, endOfYear, format, addDays, isSaturday, isSunday } = require('date-fns');
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
        user: EMAIL_USER,
        pass: EMAIL_PASS,
    },
});

// Popolamento del calendario
async function populateCalendar() {
    const startDate = new Date();
    const endDate = new Date('2025-07-31');
    const times = ['09:00', '11:00', '14:00', '16:00'];
    const lessonTypes = ['Yoga', 'Pilates', 'Fitness'];

    let currentDate = startDate;
    while (currentDate <= endDate) {
        if (!isSaturday(currentDate) && !isSunday(currentDate)) {
            const dateStr = format(currentDate, 'yyyy-MM-dd');
            const slots = times.map((time) => ({
                time,
                lessonType: lessonTypes[Math.floor(Math.random() * lessonTypes.length)],
            }));

            await db.ref(`calendario/${dateStr}`).set(slots);
        }
        currentDate = addDays(currentDate, 1);
    }
    console.log('Calendario popolato.');
}

// Funzioni Firebase per il calendario
async function getAvailableSlots(date) {
    try {
        const ref = db.ref(`calendario/${date}`);
        const snapshot = await ref.once('value');
        const slots = snapshot.val();
        console.log(`Slot disponibili per ${date}:`, slots);
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
        console.log(`Slot aggiornati per ${date}:`, updatedSlots);
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
        console.log('Invio email...');
        await transporter.sendMail(mailOptions);
        console.log('Email inviata con successo.');
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
        else console.log(`QR Code salvato in ${qrPath}`);
    });
});

// Gestione dei messaggi
client.on('message', async (message) => {
    console.log(`Messaggio ricevuto da ${message.from}: ${message.body}`);
    const chatId = message.from;
    const userResponse = message.body.trim().toLowerCase();

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
                    await message.reply('Nessun orario disponibile per questa data.');
                }
            } else {
                await message.reply('Data non valida.');
            }
            break;

        case 'ask_time':
            const timeIndex = parseInt(userResponse, 10) - 1;
            const slots = await getAvailableSlots(userState.data.date);
            if (slots[timeIndex]) {
                const selectedSlot = slots[timeIndex];
                userState.data.time = selectedSlot.time;
                userState.data.lessonType = selectedSlot.lessonType;
                await updateAvailableSlots(userState.data.date, selectedSlot.time);
                await sendEmailNotification(userState.data);
                delete userStates[chatId];
                await message.reply('Prenotazione completata con successo!');
            } else {
                await message.reply('Orario non valido.');
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

client.on('ready', () => console.log('Bot connesso a WhatsApp!'));
client.initialize();
