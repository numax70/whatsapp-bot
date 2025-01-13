const express = require('express');
const app = express();
const fs = require('fs');
const path = require('path'); // Per lavorare con i percorsi dei file
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
const authPath = './.wwebjs_auth'; // Cambiato il nome della variabile
const fs = require('fs');

// Rimuove i file di autenticazione, se esistono
if (fs.existsSync(authPath)) {
    fs.rmSync(authPath, { recursive: true, force: true });
    console.log('Cartella .wwebjs_auth eliminata per rigenerare il QR Code.');
}


client.initialize();
