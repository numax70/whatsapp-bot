const express = require('express');
const app = express();
const fs = require('fs'); // Modulo per lavorare con il file system
const path = require('path'); // Modulo per gestire i percorsi
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode');
const nodemailer = require('nodemailer');
const { parse, isValid, isFuture, isWithinInterval, endOfYear, format } = require('date-fns');
const { it } = require('date-fns/locale'); // Locale italiano

// Legge le variabili d'ambiente
const OWNER_PHONE = process.env.OWNER_PHONE || '393288830885@c.us';
const EMAIL_USER = process.env.EMAIL_USER; // Email per l'invio
const EMAIL_PASS = process.env.EMAIL_PASS; // Password per l'app Gmail

// Stato per gli utenti
const userStates = {};
const disengagedUsers = new Set(); // Per gestire utenti che hanno detto "no"

// Configura Nodemailer per l'invio email
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: EMAIL_USER,
        pass: EMAIL_PASS,
    },
});

// Funzione per inviare email di notifica
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

// Funzione per inviare la notifica finale al proprietario
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
        console.log(`Invio notifica finale a ${OWNER_PHONE} con il seguente messaggio:\n${summary}`);
        await client.sendMessage(OWNER_PHONE, `Nuova prenotazione ricevuta:\n${summary}`);
        console.log('Notifica finale inviata con successo.');
    } catch (error) {
        console.error(`Errore nell'invio della notifica finale a ${OWNER_PHONE}:`, error.message);
    }
}

// Funzione per inviare il promemoria all'utente
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
Grazie per aver prenotato con noi la tua lezione gratuita! Per modifiche o cancellazioni, rispondi a questo messaggio.
    `;

    try {
        console.log(`Invio promemoria all'utente ${chatId} con il seguente messaggio:\n${summary}`);
        await client.sendMessage(chatId, summary);
        console.log('Promemoria inviato con successo all\'utente.');
    } catch (error) {
        console.error(`Errore nell'invio del promemoria all'utente ${chatId}:`, error.message);
    }
}

// Funzione per validare e formattare la data
function validateAndFormatDate(input) {
    const today = new Date();
    const yearEnd = endOfYear(today);
    let parsedDate;

    const formats = ['dd MMMM yyyy', 'dd/MM/yyyy'];

    for (const fmt of formats) {
        parsedDate = parse(input, fmt, today, { locale: it });

        if (isValid(parsedDate)) {
            if (isFuture(parsedDate) && isWithinInterval(parsedDate, { start: today, end: yearEnd })) {
                return format(parsedDate, 'dd/MM/yyyy');
            }
        }
    }

    return null;
}

// Funzione per validare l'orario
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

// Altre rotte
app.get('/', (req, res) => res.send('Il bot è attivo!'));

// Porta di ascolto
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
    console.log(`Server in ascolto sulla porta ${PORT}`);
});

// Avvio del bot
client.on('ready', () => console.log('Bot connesso a WhatsApp!'));

// Aggiunta di log per i messaggi ricevuti
/* client.on('message', async (message) => {
    console.log(`Messaggio ricevuto da ${message.from}: ${message.body}`);
    if (message.body.toLowerCase() === 'ciao') {
        await message.reply('Ciao! Il bot è operativo.');
    }
}); */
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



// Inizializza il client WhatsApp
client.initialize();
