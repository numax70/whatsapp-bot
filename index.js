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
const { parse, isValid, format, addDays } = require('date-fns');
const { it } = require('date-fns/locale');

const schedule = { /* ... (la tua struttura schedule non è stata modificata) ... */ };
const alternativeNames = { /* ... (la tua struttura alternativeNames non è stata modificata) ... */ };

const OWNER_PHONE = process.env.OWNER_PHONE || '393288830885@c.us';
const EMAIL_USER = process.env.EMAIL_USER;
const EMAIL_PASS = process.env.EMAIL_PASS;

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

const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: EMAIL_USER,
        pass: EMAIL_PASS,
    },
});

async function sendEmailNotification(data) { /* ... (codice invariato) ... */ }

async function populateDatabase() { /* ... (codice invariato) ... */ }

async function resetSlots() { /* ... (codice invariato) ... */ }

/**
 * Verifica la validità della combinazione di giorno, orario e disciplina.
 */
function isCombinationValid(day, time, discipline) {
    return schedule[day]?.some(slot => slot.lessonType === discipline && slot.time === time);
}

/**
 * Ritorna tutte le combinazioni disponibili per un giorno specifico.
 */
function getAvailableCombinations(day) {
    return schedule[day]?.map(slot => `${slot.lessonType} alle ${slot.time}`) || [];
}

/**
 * Analizza l'input di una data accettando più formati.
 */
const acceptedFormats = ['dd/MM/yyyy', 'd/M/yyyy', 'dd-MM-yyyy', 'd-M-yyyy', 'd MMMM yyyy', 'd MMMM'];
function parseDateInput(input) {
    const today = new Date();
    const year = today.getFullYear();

    for (const formatString of acceptedFormats) {
        try {
            let dateToParse = input;
            if (formatString === 'd MMMM') {
                const match = input.match(/^\d{1,2}\s+\w+/);
                if (match) {
                    dateToParse += ` ${year}`;
                }
            }
            const parsedDate = parse(dateToParse, formatString, today, { locale: it });
            if (isValid(parsedDate)) return parsedDate;
        } catch {
            continue;
        }
    }
    throw new Error('Formato data non valido.');
}

/**
 * Valida e formatta la data in ISO.
 */
function validateAndFormatDate(input, schedule, discipline, time) {
    try {
        const parsedDate = parseDateInput(input);
        const dayName = format(parsedDate, 'EEEE', { locale: it }).toLowerCase();

        if (!schedule[dayName]) return { isValid: false, message: `⚠️ Nessuna lezione il giorno "${dayName}".` };

        if (!isCombinationValid(dayName, time, discipline)) {
            return { isValid: false, message: `⚠️ Nessuna lezione per "${discipline}" alle ${time} il giorno "${dayName}".` };
        }

        return { isValid: true, date: format(parsedDate, 'yyyy-MM-dd') };
    } catch {
        return { isValid: false, message: '⚠️ Data non valida. Usa il formato corretto.' };
    }
}

async function startBot() {
    const client = new Client({ authStrategy: new LocalAuth() });

    await populateDatabase();

    setInterval(resetSlots, 24 * 60 * 60 * 1000);

    client.on('message', async message => {
        const chatId = message.from;
        const userResponse = message.body.trim();

        if (!userStates[chatId]) {
            userStates[chatId] = { step: 'ask_details' };
            await sendWelcomeMessage(client, chatId);
            return;
        }

        const userState = userStates[chatId];

        switch (userState.step) {
            case 'ask_details':
                const [discipline, day, time, date] = userResponse.split(',').map(s => s.trim());
                if (!discipline || !day || !time || !date) {
                    await message.reply('👩🏻 Inserisci: disciplina, giorno, orario, data. Esempio: matwork, lunedì, 09:30, 26 gennaio');
                    break;
                }

                const normalizedDiscipline = normalizeDiscipline(discipline);
                const validation = validateAndFormatDate(date, schedule, normalizedDiscipline, time);

                if (!validation.isValid) {
                    await message.reply(validation.message);
                    break;
                }

                userState.data = { discipline: normalizedDiscipline, day, time, date: validation.date };
                userState.step = 'ask_user_info';
                await message.reply('Inserisci: nome, cognome, numero. Esempio: Mario, Rossi, 3479056597');
                break;

            case 'ask_user_info':
                const [name, surname, phone] = userResponse.split(',').map(s => s.trim());
                if (!name || !surname || !phone || !/^[a-zA-Z\s]+$/.test(name) || !/^[a-zA-Z\s]+$/.test(surname) || !/^\d{10,15}$/.test(phone)) {
                    await message.reply('⚠️ Formato errato. Inserisci: nome, cognome, numero.');
                    break;
                }
                userState.data = { ...userState.data, name, surname, phone };
                userState.step = 'confirm_booking';
                await message.reply('✅ Confermi la prenotazione? Rispondi con Sì o No.');
                break;

            case 'confirm_booking':
                if (userResponse.toLowerCase() === 'sì') {
                    const updateResult = await updateAvailableSlots(userState.data.date, userState.data.time);
                    if (!updateResult.success) {
                        await message.reply('⚠️ Posti esauriti. Cambia orario.');
                        break;
                    }
                    await sendEmailNotification(userState.data);
                    await message.reply('🎉 Prenotazione completata!');
                    delete userStates[chatId];
                } else if (userResponse.toLowerCase() === 'no') {
                    await message.reply('⚠️ Prenotazione annullata.');
                    delete userStates[chatId];
                } else {
                    await message.reply('⚠️ Risposta non valida. Rispondi con Sì o No.');
                }
                break;

            case 'modify_booking':
                if (['disciplina', 'giorno', 'orario', 'data', 'nome', 'cognome', 'telefono'].includes(userResponse.toLowerCase())) {
                    userState.step = `modify_${userResponse.toLowerCase()}`;
                    await message.reply(`Inserisci il nuovo valore per ${userResponse.toLowerCase()}.`);
                } else {
                    await message.reply('⚠️ Modifica non valida. Usa: disciplina, giorno, orario, data, nome, cognome, telefono.');
                }
                break;

            // Aggiungi casi per `modify_giorno`, `modify_orario`, etc. con gestione combinazioni
        }
    });

    client.on('qr', qr => qrcode.toFile(path.join(__dirname, 'qr.png'), qr));
    app.get('/ping', (req, res) => res.send('OK'));

    client.initialize();
    app.listen(3000, () => console.log('Server in ascolto sulla porta 3000'));
}

startBot().catch(console.error);
