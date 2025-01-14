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
    console.error('Errore durante l\'inizializzazione di Firebase:', error.message);
    process.exit(1);
}

const db = admin.database();
const userStates = {};
const disengagedUsers = new Set(); // Utenti disimpegnati

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
async function populateCalendarWithValidation() {
    const startDate = new Date(2025, 0, 1); // 1 gennaio 2025
    const endDate = new Date(2025, 6, 31); // 31 luglio 2025

    const schedule = {
        "Lunedì": [
            { "time": "09:30", "lessonType": "PILATES MATWORK" },
            { "time": "10:30", "lessonType": "POSTURALE" },
        ],
        "Martedì": [
            { "time": "13:30", "lessonType": "GIROKYNESIS" },
            { "time": "15:00", "lessonType": "PILATES MATWORK" },
        ],
        "Mercoledì": [
            { "time": "09:30", "lessonType": "PILATES MATWORK" },
            { "time": "12:00", "lessonType": "PILATES EXO CHAIR" },
        ],
        "Giovedì": [
            { "time": "13:30", "lessonType": "GIROKYNESIS" },
            { "time": "18:00", "lessonType": "YOGA" },
        ],
        "Venerdì": [
            { "time": "14:00", "lessonType": "PILATES MATWORK" },
            { "time": "17:00", "lessonType": "FUNCTIONAL TRAINER MOVEMENT" },
        ],
    };

    let currentDate = startDate;

    while (currentDate <= endDate) {
        if (!isSaturday(currentDate) && !isSunday(currentDate)) {
            // Ottieni il giorno della settimana nel formato "Lunedì", "Martedì", ecc.
            const day = format(currentDate, 'EEEE', { locale: it });

            if (schedule[day]) {
                const formattedDate = format(currentDate, 'yyyy-MM-dd'); // Data in formato ISO
                try {
                    const ref = db.ref(`calendario/${formattedDate}`);
                    const snapshot = await ref.once('value');
                    const existingData = snapshot.val();

                    if (!existingData) {
                        await ref.set(schedule[day]);
                        console.log(`Dati aggiunti per ${formattedDate}`);
                    }
                } catch (error) {
                    console.error(`Errore durante il popolamento per ${formattedDate}:`, error.message);
                }
            } else {
                console.log(`Nessun orario programmato per il giorno ${day}`);
            }
        } else {
            console.log(`Giorno saltato (weekend): ${format(currentDate, 'yyyy-MM-dd')}`);
        }
        currentDate = addDays(currentDate, 1);
    }
    console.log('Calendario popolato con successo.');
}



// Funzione per mostrare il prospetto delle lezioni
async function getSchedule(date) {
    try {
        const ref = db.ref(`calendario/${date}`);
        const snapshot = await ref.once('value');
        return snapshot.val() || [];
    } catch (error) {
        console.error(`Errore nel recupero del prospetto per ${date}:`, error.message);
        return [];
    }
}

// Funzione per notifiche email e riepilogo
async function sendEmailNotification(data) {
    const emailBody = `
        Nuova prenotazione ricevuta:
        - Nome: ${data.name}
        - Cognome: ${data.surname}
        - Telefono: ${data.phone}
        - Data: ${data.date}
        - Ora: ${data.time}
        - Tipo di lezione: ${data.lessonType}
    `;

    const mailOptions = {
        from: EMAIL_USER,
        to: 'siselcatania@gmail.com',
        subject: 'Nuova Prenotazione Lezione',
        text: emailBody,
    };

    try {
        await transporter.sendMail(mailOptions);
        console.log('Email inviata all\'owner.');
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

app.get('/qr', (req, res) => {
    const qrPath = path.join(__dirname, 'qr.png');
    if (fs.existsSync(qrPath)) {
        res.sendFile(qrPath);
    } else {
        res.status(404).send('QR Code non trovato.');
    }
});


// Gestione messaggi WhatsApp
client.on('message', async (message) => {
    const chatId = message.from;
    const userResponse = message.body.trim();

    if (disengagedUsers.has(chatId)) {
        if (userResponse.toLowerCase() === 'prenotazione') {
            disengagedUsers.delete(chatId);
            userStates[chatId] = { step: 'ask_booking' };
            await message.reply(`Vuoi prenotare una lezione? Digita "Sì" o "No".`);
        } else {
            await message.reply('Scrivi "prenotazione" per avviare una nuova prenotazione.');
        }
        return;
    }

    if (!userStates[chatId]) {
        userStates[chatId] = { step: 'ask_booking' };
        await message.reply(`Vuoi prenotare una lezione? Digita "Sì" o "No".`);
        return;
    }

    const userState = userStates[chatId];

    switch (userState.step) {
        case 'ask_booking':
            if (userResponse.toLowerCase() === 'sì') {
                userState.step = 'ask_date';
                await message.reply('Inserisci la data della lezione (formato: GG/MM/YYYY):');
            } else if (userResponse.toLowerCase() === 'no') {
                disengagedUsers.add(chatId);
                delete userStates[chatId];
                await message.reply('Ok, puoi scrivere "prenotazione" in qualsiasi momento.');
            } else {
                await message.reply('Per favore, rispondi con "Sì" o "No".');
            }
            break;

        case 'ask_date':
            const date = validateAndFormatDate(userResponse);
            if (date) {
                const schedule = await getSchedule(date);
                if (schedule.length > 0) {
                    userState.date = date;
                    userState.step = 'ask_time';
                    const slots = schedule.map((slot, index) => `${index + 1}) ${slot.time} (${slot.lessonType})`).join('\n');
                    await message.reply(`Orari disponibili per ${date}:\n${slots}`);
                } else {
                    await message.reply('Nessun orario disponibile per questa data.');
                }
            } else {
                await message.reply('Data non valida. Inserisci una data valida (formato: GG/MM/YYYY).');
            }
            break;

        case 'ask_time':
            const timeIndex = parseInt(userResponse, 10) - 1;
            const schedule = await getSchedule(userState.date);
            if (schedule[timeIndex]) {
                const selectedSlot = schedule[timeIndex];
                const bookingData = {
                    name: 'Utente', // Puoi personalizzarlo
                    surname: 'Generico',
                    phone: chatId,
                    date: userState.date,
                    time: selectedSlot.time,
                    lessonType: selectedSlot.lessonType,
                };
                await sendEmailNotification(bookingData);
                await message.reply(`Prenotazione completata! Riepilogo:\nData: ${bookingData.date}\nOra: ${bookingData.time}\nLezione: ${bookingData.lessonType}`);
                delete userStates[chatId];
            } else {
                await message.reply('Orario non valido. Riprova.');
            }
            break;

        default:
            delete userStates[chatId];
            await message.reply('Errore sconosciuto. Riprova.');
    }
});

// Avvio del server
app.listen(process.env.PORT || 10000, async () => {
    console.log(`Server in ascolto sulla porta ${process.env.PORT || 10000}`);
    await populateCalendarWithValidation();
});

// Ping per evitare sospensione
app.get('/ping', (req, res) => {
    res.status(200).send('OK');
});

// Monitoraggio risorse
setInterval(() => {
    console.log(`RAM Utilizzata: ${(process.memoryUsage().rss / 1024 / 1024).toFixed(2)} MB`);
    console.log(`CPU Load (1 minuto): ${os.loadavg()[0].toFixed(2)}`);
}, 60000);

client.on('ready', () => console.log('Bot connesso a WhatsApp!'));
client.initialize();
