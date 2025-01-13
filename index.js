const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const nodemailer = require('nodemailer');
const { parse, isValid, isFuture, isWithinInterval, endOfYear, format } = require('date-fns');
const { it } = require('date-fns/locale'); // Locale italiano

// Numero WhatsApp del proprietario che riceverà la notifica finale
const OWNER_PHONE = '393479056597@c.us'; // Numero corretto del proprietario

// Stato per gli utenti
const userStates = {};
const disengagedUsers = new Set(); // Per gestire utenti che hanno detto "no"

// Configura Nodemailer per l'invio email
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: 'webdesignsolutionct@gmail.com',
        pass: 'tuxx kebg teln ahph', // Password per le app
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
        from: 'webdesignsolutionct@gmail.com',
        to: 'siselcatania@gmail.com',
        subject: 'Nuova Prenotazione',
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
📅 Data rchiesta: ${bookingData.date}
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
    console.log(`Tentativo di validare la data: "${input}"`);

    const today = new Date();
    const yearEnd = endOfYear(today);
    let parsedDate;

    // Formati accettati
    const formats = ['dd MMMM yyyy', 'dd/MM/yyyy'];

    for (const fmt of formats) {
        parsedDate = parse(input, fmt, today, { locale: it });

        if (isValid(parsedDate)) {
            // Controlla che la data sia futura e all'interno dell'anno corrente
            if (isFuture(parsedDate) && isWithinInterval(parsedDate, { start: today, end: yearEnd })) {
                const formattedDate = format(parsedDate, 'dd/MM/yyyy');
                console.log(`Data valida: ${formattedDate}`);
                return formattedDate;
            }
        }
    }

    console.log('Data non valida');
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

    return null; // Orario non valido
}

// Crea un client di WhatsApp Web
const client = new Client({
    authStrategy: new LocalAuth(),
});

// Mostra il QR code per connettere il bot
client.on('qr', (qr) => {
    console.log('Scansiona il QR Code con WhatsApp:');
    qrcode.generate(qr, { small: true });
});

// Conferma che il bot è pronto
client.on('ready', async () => {
    console.log('Bot connesso a WhatsApp!');
});

// Gestione dei messaggi ricevuti
client.on('message', async (message) => {
    const chatId = message.from; // Identifica l'utente
    const userResponse = message.body.trim().toLowerCase(); // Normalizza l'input

    // Ignora i messaggi provenienti da OWNER_PHONE
    if (chatId === OWNER_PHONE) return;

    // Se l'utente è nella lista "disimpegnata", ascolta solo "prenotazione"
    if (disengagedUsers.has(chatId)) {
        if (userResponse === 'prenotazione') {
            disengagedUsers.delete(chatId); // Rimuovi dalla lista "disimpegnata"
            userStates[chatId] = { step: 'ask_name', data: {} }; // Riavvia il processo
            await message.reply('Riprendiamo la prenotazione! Come ti chiami?');
        }
        return; // Ignora tutto il resto
    }

    // Inizializza lo stato dell'utente se non esiste
    if (!userStates[chatId]) {
        userStates[chatId] = { step: 'initial', data: {} };
        console.log(`Nuova conversazione avviata con ${chatId}`);
        await message.reply('Vuoi prenotare una lezione di Pilates ? Digita "Sì" o "No".');
        return;
    }

    const userState = userStates[chatId];
    console.log(`Stato corrente (${chatId}): ${userState.step}`);

    switch (userState.step) {
        case 'initial':
            if (userResponse === 'sì' || userResponse === 'si') {
                userState.step = 'ask_name';
                await message.reply('Perfetto! Come ti chiami?');
            } else if (userResponse === 'no') {
                disengagedUsers.add(chatId); // Aggiungi alla lista "disimpegnata"
                delete userStates[chatId]; // Cancella lo stato dell'utente
                await message.reply(
                    'Va bene! Se desideri prenotare una lezione in futuro, basta digitare "prenotazione".'
                );
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
            await message.reply('Perfetto! Inserisci il tuo numero di telefono (Su questo numero riceverai la conferma successiva).');
            break;

        case 'ask_phone':
            const phone = message.body.replace(/\D/g, '');
            if (phone.length >= 8 && phone.length <= 15) {
                userState.data.phone = phone;
                userState.step = 'ask_date';
                await message.reply('Ottimo! Quale data preferisci per la lezione ? (Esempio Formato valido: "12 Febbraio 2025").');
            } else {
                await message.reply('Il numero di telefono non è valido. Riprova.');
            }
            break;

        case 'ask_date':
            const formattedDate = validateAndFormatDate(message.body.trim());
            if (formattedDate) {
                userState.data.date = formattedDate;
                userState.step = 'ask_time';
                await message.reply('Grazie! A che ora vuoi prenotare? (Esempio formato valido: "14:30").');
            } else {
                await message.reply('La data non è valida. Inseriscila nel formato valido: "12 Febbraio 2025".');
            }
            break;

        case 'ask_time':
            const formattedTime = validateAndFormatTime(message.body.trim());
            if (formattedTime) {
                userState.data.time = formattedTime;
                console.log(`Prenotazione completata per ${chatId}:`, userState.data);

                // Invia notifiche finali
                await sendFinalNotification(client, userState.data);
                await sendEmailNotification(userState.data);

                // Invia promemoria all'utente
                await sendUserReminder(client, chatId, userState.data);

                await message.reply('Grazie! La tua prenotazione è stata registrata con successo.');
                delete userStates[chatId];
            } else {
                await message.reply('L\'orario non è valido. Inserisci un orario nel formato valido: "14:30".');
            }
            break;

        default:
            console.error(`Errore sconosciuto con lo stato: ${userState.step}`);
            delete userStates[chatId];
            await message.reply('Si è verificato un errore. Riprova dall\'inizio.');
            break;
    }
});

// Avvia il bot
client.initialize();
