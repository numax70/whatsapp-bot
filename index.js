require('dotenv').config();
const express = require('express');
const app = express();
const fs = require('fs');
const path = require('path');
const { Client, MessageMedia, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode');
const nodemailer = require('nodemailer');
const admin = require('firebase-admin');
const os = require('os');
const { parse, isValid, format } = require('date-fns');
const { it } = require('date-fns/locale');

const schedule = {
    "lunedì": [
        { "time": "09:30", "lessonType": "PILATES MATWORK", "remainingSeats": 10 },
        { "time": "10:30", "lessonType": "POSTURALE", "remainingSeats": 10 },
        { "time": "12:00", "lessonType": "PILATES EXO CHAIR", "remainingSeats": 10 },
        { "time": "13:30", "lessonType": "PILATES DANCE BARRE", "remainingSeats": 10 },
        { "time": "14:30", "lessonType": "PILATES MATWORK", "remainingSeats": 10 },
        { "time": "16:00", "lessonType": "PILATES EXO CHAIR", "remainingSeats": 10 },
        { "time": "17:00", "lessonType": "PILATES DANCE BARRE", "remainingSeats": 10 },
        { "time": "18:15", "lessonType": "PILATES MATWORK", "remainingSeats": 10 },
        { "time": "19:30", "lessonType": "FUNCTIONAL TRAINER MOVEMENT", "remainingSeats": 10 }
    ],
    "martedì": [
        { "time": "13:30", "lessonType": "GIROKYNESIS", "remainingSeats": 10 },
        { "time": "15:00", "lessonType": "PILATES MATWORK", "remainingSeats": 10 },
        { "time": "16:30", "lessonType": "PILATES EXO CHAIR", "remainingSeats": 10 },
        { "time": "18:00", "lessonType": "PILATES MATWORK", "remainingSeats": 10 },
        { "time": "19:00", "lessonType": "YOGA", "remainingSeats": 10 }
    ],
    "mercoledì": [
        { "time": "09:30", "lessonType": "PILATES MATWORK", "remainingSeats": 10 },
        { "time": "10:30", "lessonType": "POSTURALE", "remainingSeats": 10 },
        { "time": "12:00", "lessonType": "PILATES EXO CHAIR", "remainingSeats": 10 },
        { "time": "13:30", "lessonType": "PILATES DANCE BARRE", "remainingSeats": 10 }
    ],
    "giovedì": [
        { "time": "13:30", "lessonType": "GIROKYNESIS", "remainingSeats": 10 },
        { "time": "15:00", "lessonType": "PILATES MATWORK", "remainingSeats": 10 },
        { "time": "16:30", "lessonType": "PILATES EXO CHAIR", "remainingSeats": 10 },
        { "time": "18:00", "lessonType": "PILATES MATWORK", "remainingSeats": 10 },
        { "time": "19:00", "lessonType": "YOGA", "remainingSeats": 10 }
    ],
    "venerdì": [
        { "time": "14:00", "lessonType": "PILATES MATWORK", "remainingSeats": 10 },
        { "time": "16:00", "lessonType": "PILATES EXO CHAIR", "remainingSeats": 10 },
        { "time": "17:00", "lessonType": "PILATES DANCE BARRE", "remainingSeats": 10 },
        { "time": "19:00", "lessonType": "FUNCTIONAL TRAINER MOVEMENT", "remainingSeats": 10 }
    ]
};

const alternativeNames = {
    "matwork": "PILATES MATWORK",
    "exo chair": "PILATES EXO CHAIR",
    "exo": "PILATES EXO CHAIR",
    "chair": "PILATES EXO CHAIR",
    "functional": "FUNCTIONAL TRAINER MOVEMENT",
    "functional trainer": "FUNCTIONAL TRAINER MOVEMENT",
    "functional trainer movement": "FUNCTIONAL TRAINER MOVEMENT"
};

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
        databaseURL: 'https://your-firebase-url.firebaseio.com',
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

async function startBot() {
    const client = new Client({ authStrategy: new LocalAuth() });
    let currentOwnerPhone = OWNER_PHONE;

    function changeOwnerPhone(newPhone) {
        console.log(`Cambio il numero del proprietario da ${currentOwnerPhone} a ${newPhone}`);
        currentOwnerPhone = newPhone;
    }

    async function sendWelcomeMessage(client, recipient) {
        const logoPath = path.join(__dirname, 'logo.jpg');
        const tableImagePath = path.join(__dirname, 'tabella.jpg');
        try {
            if (fs.existsSync(logoPath)) {
                const logoMedia = MessageMedia.fromFilePath(logoPath);
                await client.sendMessage(recipient, logoMedia);
            }
            await client.sendMessage(
                recipient,
                `🎉 Benvenuto su Spazio Lotus!
📍 Sedi:
- Catania: Via Carmelo Patanè Romeo, 28
- Trecastagni (CT): Via Luigi Capuana, 51
📞 Telefono: +39 349 289 0065`
            );
            if (fs.existsSync(tableImagePath)) {
                const tableMedia = MessageMedia.fromFilePath(tableImagePath);
                await client.sendMessage(recipient, tableMedia);
            }
            await client.sendMessage(
                recipient,
                `Vuoi prenotare una lezione?
Ecco le discipline disponibili:
${getAvailableDisciplines(schedule).join(', ')}.

Scrivi il tuo messaggio seguendo questo formato:
*disciplina, giorno, orario, data*

Esempio:
PILATES MATWORK, lunedì, 09:30, 26 gennaio`
            );
        } catch (error) {
            console.error('Errore durante l\'invio del messaggio di benvenuto:', error.message);
        }
    }

    function normalizeDiscipline(input) {
        const normalizedInput = input.trim().toLowerCase();
        return alternativeNames[normalizedInput] || Object.keys(alternativeNames).find(key => normalizedInput.includes(key)) || input;
    }

    function validateAndFormatDate(input, schedule, discipline, time) {
        if (!input) {
            return { isValid: false, message: 'La data non è valida. Usa il formato "26 gennaio".' };
        }

        const today = new Date();
        const year = today.getFullYear();

        // Aggiungi l'anno corrente alla data fornita dall'utente
        let parsedDate;
        try {
            parsedDate = parse(`${input} ${year}`, 'd MMMM yyyy', today, { locale: it });
        } catch (error) {
            return { isValid: false, message: 'Errore nella decodifica della data. Usa il formato "26 gennaio".' };
        }

        if (!isValid(parsedDate) || parsedDate < today) {
            return { isValid: false, message: 'Inserisci una data valida e futura.' };
        }

        const inputDay = format(parsedDate, 'EEEE', { locale: it }).toLowerCase();
        if (!schedule[inputDay]) {
            return { isValid: false, message: `Non ci sono lezioni il giorno ${inputDay}.` };
        }

        const slot = schedule[inputDay].find(s => s.lessonType.toLowerCase() === discipline.toLowerCase() && s.time === time);
        if (!slot) {
            return { isValid: false, message: 'Nessuna lezione disponibile per questa combinazione.' };
        }

        return { isValid: true, date: format(parsedDate, 'yyyy-MM-dd') };
    }

    function getAvailableDisciplines(schedule) {
        return [...new Set(Object.values(schedule).flatMap(day => day.map(slot => slot.lessonType)))];
    }

    async function updateAvailableSlots(date, time) {
        const ref = db.ref(`calendario/${date}`);
        try {
            const transactionResult = await ref.transaction(slots => {
                if (!slots) return null;
                return slots.map(slot => {
                    if (slot.time === time) {
                        if (slot.remainingSeats <= 0) throw new Error('Nessun posto disponibile.');
                        return { ...slot, remainingSeats: slot.remainingSeats - 1 };
                    }
                    return slot;
                });
            });
            if (!transactionResult.committed) {
                return { success: false };
            }
            return { success: true };
        } catch (error) {
            console.error(error.message);
            return { success: false };
        }
    }

    client.on('message', async message => {
        const chatId = message.from;
        const userResponse = message.body.trim();

        if (!userStates[chatId]) {
            userStates[chatId] = { step: 'welcome' };
            await sendWelcomeMessage(client, chatId);
            userStates[chatId].step = 'ask_details';
            return;
        }

        const userState = userStates[chatId];

        switch (userState.step) {
            case 'ask_details':
                const [discipline, day, time, date] = userResponse.split(',').map(s => s.trim());

                if (!discipline || !day || !time || !date) {
                    await message.reply('Assicurati di inserire tutte le informazioni richieste nel formato:*disciplina, giorno, orario, data*Esempio:PILATES MATWORK, lunedì, 09:30, 26 gennaio');
                    break;
                }

                const normalizedDiscipline = normalizeDiscipline(discipline);

                if (!getAvailableDisciplines(schedule).includes(normalizedDiscipline)) {
                    await message.reply('Disciplina non valida. Riprova con una delle seguenti: ' + getAvailableDisciplines(schedule).join(', '));
                    break;
                }

                const validation = validateAndFormatDate(date, schedule, normalizedDiscipline, time);
                if (!validation.isValid) {
                    await message.reply(validation.message);
                    break;
                }

                userState.data = { discipline: normalizedDiscipline, day, time, date: validation.date };
                userState.step = 'review_details';
                await message.reply(`Ecco il riepilogo della tua prenotazione:
Disciplina: ${normalizedDiscipline}
Giorno: ${day}
Orario: ${time}
Data: ${validation.date}

Vuoi modificare qualcosa? Rispondi con "Sì" o "No".`);
                break;

            case 'review_details':
                if (userResponse.toLowerCase() === 'sì' || userResponse.toLowerCase() === 'si') {
                    userState.step = 'ask_modification';
                    await message.reply('Cosa vuoi modificare? (Disciplina, Giorno, Orario, Data)');
                } else if (userResponse.toLowerCase() === 'no') {
                    userState.step = 'ask_name';
                    await message.reply('Inserisci il tuo nome.');
                } else {
                    await message.reply('Risposta non valida. Digita "Sì" per modificare o "No" per confermare.');
                }
                break;

            case 'ask_modification':
                if (userResponse.toLowerCase().includes('disciplina')) {
                    userState.step = 'ask_details';
                    await message.reply('Reinserisci la disciplina, il giorno, l\'orario e la data.');
                } else if (userResponse.toLowerCase().includes('giorno')) {
                    userState.step = 'ask_day';
                    await message.reply('Inserisci il nuovo giorno.');
                } else if (userResponse.toLowerCase().includes('orario')) {
                    userState.step = 'ask_time';
                    await message.reply('Inserisci il nuovo orario.');
                } else if (userResponse.toLowerCase().includes('data')) {
                    userState.step = 'ask_date';
                    await message.reply('Inserisci la nuova data.');
                } else {
                    await message.reply('Non ho capito cosa vuoi modificare. Specifica Disciplina, Giorno, Orario o Data.');
                }
                break;

            case 'ask_name':
                if (!/^[a-zA-Z\s]+$/.test(userResponse)) {
                    await message.reply('Nome non valido. Usa solo lettere.');
                    break;
                }
                userState.data.name = userResponse;
                userState.step = 'ask_surname';
                await message.reply('Inserisci il tuo cognome.');
                break;

            case 'ask_surname':
                if (!/^[a-zA-Z\s]+$/.test(userResponse)) {
                    await message.reply('Cognome non valido. Usa solo lettere.');
                    break;
                }
                userState.data.surname = userResponse;
                userState.step = 'ask_phone';
                await message.reply('Inserisci il tuo numero di telefono.');
                break;

            case 'ask_phone':
                if (!/^\d{10,15}$/.test(userResponse)) {
                    await message.reply('Numero di telefono non valido.');
                    break;
                }
                userState.data.phone = userResponse;
                const updateResult = await updateAvailableSlots(userState.data.date, userState.data.time);
                if (!updateResult.success) {
                    await message.reply('Posti esauriti. Scegli un altro orario.');
                    userState.step = 'ask_details';
                    break;
                }
                await message.reply('Prenotazione completata! ✅');
                delete userStates[chatId];
                break;

            default:
                await message.reply('Si è verificato un errore. Riprova.');
                delete userStates[chatId];
        }
    });

    client.on('qr', qr => {
        console.log('QR Code generato.');
        qrcode.toFile(path.join(__dirname, 'qr.png'), qr, err => {
            if (err) console.error('Errore nella generazione del QR Code:', err);
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

    app.get('/ping', (req, res) => {
        console.log(`[PING] Endpoint chiamato da ${req.ip} - ${new Date().toISOString()}`);
        res.status(200).send('OK');
    });

    setInterval(() => {
        console.log(`RAM Utilizzata: ${(process.memoryUsage().rss / 1024 / 1024).toFixed(2)} MB`);
        console.log(`CPU Load (1 minuto): ${os.loadavg()[0].toFixed(2)}`);
    }, 60000);

    client.on('ready', () => {
        console.log('Bot connesso a WhatsApp!');
    });

    client.initialize();

    app.listen(3000, () => {
        console.log('Server in ascolto sulla porta 3000');
    });
}

startBot().catch(console.error);
