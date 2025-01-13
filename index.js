const express = require('express');
const app = express();
const fs = require('fs');
const path = require('path');
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode');
const nodemailer = require('nodemailer');
const { parse, isValid, isFuture, isWithinInterval, endOfYear, format } = require('date-fns');
const { it } = require('date-fns/locale'); // Locale italiano

// Variabili d'ambiente
const OWNER_PHONE = process.env.OWNER_PHONE || '393288830885@c.us';
const EMAIL_USER = process.env.EMAIL_USER;
const EMAIL_PASS = process.env.EMAIL_PASS;

// Stato per gli utenti
const userStates = {};
const disengagedUsers = new Set(); // Per gestire utenti che hanno detto "no"

// Configurazione di Nodemailer
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: EMAIL_USER,
        pass: EMAIL_PASS,
    },
});

// Funzioni helper per validazione e formattazione
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

// Configurazione del client WhatsApp
const client = new Client({
    authStrategy: new LocalAuth(),
});

// Gestione QR Code
client.on('qr', (qr) => {
    console.log('QR Code generato. Salvataggio in corso...');
    const qrPath = path.join(__dirname, 'qr.png');
    qrcode.toFile(qrPath, qr, (err) => {
        if (err) {
            console.error('Errore durante il salvataggio del QR Code:', err.message);
        } else {
            console.log(`QR Code salvato come ${qrPath}`);
        }
    });
});

// Server Express per visualizzare il QR Code
app.get('/qr', (req, res) => {
    const qrPath = path.join(__dirname, 'qr.png');
    if (fs.existsSync(qrPath)) {
        res.sendFile(qrPath);
    } else {
        res.status(404).send('QR Code non trovato. Attendi qualche istante.');
    }
});

// Porta di ascolto
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
    console.log(`Server in ascolto sulla porta ${PORT}`);
});

// Avvio del bot
client.on('ready', () => console.log('Bot connesso a WhatsApp!'));

// Gestione dei messaggi ricevuti
client.on('message', async (message) => {
    const chatId = message.from;
    const userResponse = message.body.trim().toLowerCase();

    console.log(`Messaggio ricevuto da ${chatId}: ${message.body}`);

    // Ignora i messaggi del proprietario
    if (chatId === OWNER_PHONE) return;

    // Se l'utente ha detto "no", riattivarlo solo se dice "prenotazione"
    if (disengagedUsers.has(chatId)) {
        if (userResponse === 'prenotazione') {
            disengagedUsers.delete(chatId);
            userStates[chatId] = { step: 'ask_name', data: {} };
            await message.reply('Riprendiamo la prenotazione! Come ti chiami?');
        }
        return;
    }

    // Inizializza lo stato dell'utente se non esiste
    if (!userStates[chatId]) {
        userStates[chatId] = { step: 'initial', data: {} };
        await message.reply('Vuoi prenotare una lezione di Pilates? Digita "Sì" o "No".');
        return;
    }

    const userState = userStates[chatId];

    // Gestione del flusso di prenotazione
    switch (userState.step) {
        case 'initial':
            if (userResponse === 'sì' || userResponse === 'si') {
                userState.step = 'ask_name';
                await message.reply('Perfetto! Come ti chiami?');
            } else if (userResponse === 'no') {
                disengagedUsers.add(chatId);
                delete userStates[chatId];
                await message.reply('Va bene! Se desideri prenotare in futuro, scrivi "prenotazione".');
            } else {
                await message.reply('Non ho capito. Vuoi prenotare una lezione di Pilates? Digita "Sì" o "No".');
            }
            break;

        case 'ask_name':
            userState.data.name = message.body.trim();
            userState.step = 'ask_surname';
            await message.reply('Grazie! Ora scrivimi il tuo cognome.');
            break;

        case 'ask_surname':
            userState.data.surname = message.body.trim();
            userState.step = 'ask_phone';
            await message.reply('Inserisci il tuo numero di telefono.');
            break;

        case 'ask_phone':
            const phone = message.body.replace(/\D/g, '');
            if (phone.length >= 8 && phone.length <= 15) {
                userState.data.phone = phone;
                userState.step = 'ask_date';
                await message.reply('Quale data preferisci per la lezione? (Esempio: "12 Febbraio 2025").');
            } else {
                await message.reply('Il numero di telefono non è valido. Riprova.');
            }
            break;

        case 'ask_date':
            const date = validateAndFormatDate(message.body.trim());
            if (date) {
                userState.data.date = date;
                userState.step = 'ask_time';
                await message.reply('A che ora vuoi prenotare? (Formato: "14:30").');
            } else {
                await message.reply('La data non è valida. Inserisci una data futura valida.');
            }
            break;

        case 'ask_time':
            const time = validateAndFormatTime(message.body.trim());
            if (time) {
                userState.data.time = time;
                await message.reply('La tua prenotazione è stata completata! Grazie.');
                console.log(`Prenotazione completata:`, userState.data);
                delete userStates[chatId];
            } else {
                await message.reply('L\'orario non è valido. Inserisci un orario valido (Formato: "14:30").');
            }
            break;

        default:
            console.error(`Stato sconosciuto: ${userState.step}`);
            delete userStates[chatId];
            await message.reply('Si è verificato un errore. Riprova.');
            break;
    }
});

// Inizializza il bot
client.initialize();
