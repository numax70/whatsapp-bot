require('dotenv').config();
const express = require('express');
const app = express();
const fs = require('fs');
const path = require('path');
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode');
const nodemailer = require('nodemailer');
const admin = require('firebase-admin');
const userStates = {};
const userTimeouts = {};
const STATE_TIMEOUT = 300000; // 5 minuti (300.000 millisecondi)

function getUserState(chatId) {
    return userStates[chatId] || null;
}

function setUserState(chatId, state) {
    userStates[chatId] = { ...state, lastUpdated: Date.now() };

    if (userTimeouts[chatId]) {
        clearTimeout(userTimeouts[chatId]);
    }

    userTimeouts[chatId] = setTimeout(() => {
        clearUserState(chatId);
    }, STATE_TIMEOUT);
}

function clearUserState(chatId) {
    delete userStates[chatId];
    if (userTimeouts[chatId]) {
        clearTimeout(userTimeouts[chatId]);
        delete userTimeouts[chatId];
    }
    console.log(`Stato utente ${chatId} eliminato.`);
}


setInterval(() => {
    const now = Date.now();
    for (const chatId in userStates) {
        if (userStates[chatId]?.lastUpdated < now - STATE_TIMEOUT) {
            clearUserState(chatId);
        }
    }
}, STATE_TIMEOUT);


client.on('message', async (message) => {
    const chatId = message.from;

    // Comando per ripristinare lo stato dell'utente
    if (message.body.toLowerCase() === 'reset') {
        clearUserState(chatId);
        await message.reply('Il tuo stato è stato reimpostato. Puoi ricominciare.');
        return;
    }

    // Recupera lo stato corrente o imposta uno nuovo
    let userState = getUserState(chatId);

    if (!userState) {
        setUserState(chatId, { step: 'ask_discipline' });
        const disciplines = getAvailableDisciplines(schedule);
        await message.reply(`Vuoi prenotare una lezione?\nEcco le discipline disponibili:\n${disciplines.map((d, i) => `${i + 1}) ${d}`).join('\n')}\nScegli la disciplina, digita il numero.`);
        return;
    }

    // Aggiorna il timestamp dell'utente
    setUserState(chatId, { ...userState });

    // Flusso dei messaggi (modificato per usare getUserState e setUserState)
    switch (userState.step) {
        case 'ask_discipline':
            // Logica per gestire la scelta della disciplina
            break;
        case 'ask_day_time':
            // Logica per gestire giorno e orario
            break;
        // Altri case...
    }
});


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
function validateAndFormatDate(input, schedule, discipline, time) {
    const formats = ['dd/MM/yyyy', 'dd MMMM yyyy'];
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    for (const fmt of formats) {
        const parsedDate = parse(input, fmt, today, { locale: it });

        if (!isValid(parsedDate)) continue;

        if (parsedDate < today) {
            return { isValid: false, message: 'Non è possibile inserire una data passata.' };
        }

        const month = parsedDate.getMonth();
        if (month === 6 || month === 7) {
            return { isValid: false, message: 'Le prenotazioni sono chiuse a luglio e agosto.' };
        }

        const year = parsedDate.getFullYear();
        const currentYear = today.getFullYear();
        if (year > currentYear + 1 || (year > currentYear && today.getMonth() !== 11)) {
            return { isValid: false, message: 'Non puoi prenotare per l\'anno successivo se non siamo a dicembre.' };
        }

        const dayOfWeek = format(parsedDate, 'EEEE', { locale: it }).toLowerCase();
        const slots = schedule[dayOfWeek];
        if (!slots || !slots.some(slot => slot.lessonType === discipline && slot.time === time)) {
            return { isValid: false, message: 'Nessuna lezione disponibile per questa data e orario.' };
        }

        return { isValid: true, date: format(parsedDate, 'yyyy-MM-dd') };
    }

    return { isValid: false, message: 'Formato data non valido. Usa GG/MM/YYYY.' };
}





function getAvailableDisciplines(schedule) {
    const disciplines = Object.values(schedule).flatMap(day =>
        day.map(slot => slot.lessonType)
    );
    return [...new Set(disciplines)];
}

function getAvailableTimesForDiscipline(schedule, discipline) {
    const times = [];
    for (const day of Object.values(schedule)) {
        for (const slot of day) {
            if (slot.lessonType === discipline) {
                times.push(slot.time);
            }
        }
    }
    return [...new Set(times)];
}

function getDatesForDisciplineAndTime(schedule, discipline, time) {
    const dates = [];
    for (const [date, slots] of Object.entries(schedule)) {
        if (slots.some(slot => slot.lessonType === discipline && slot.time === time)) {
            dates.push(date);
        }
    }
    return dates;
}

function findNextAvailableDate(schedule, inputDate, discipline, time) {
    const dates = getDatesForDisciplineAndTime(schedule, discipline, time);
    return dates.find(date => new Date(date) >= new Date(inputDate));
}

// Funzione per inviare il riepilogo al cliente
async function sendWhatsAppNotification(client, phone, bookingData) {
    // Validazione dei dati obbligatori
    const missingFields = [];
    if (!bookingData.name) missingFields.push('Nome');
    if (!bookingData.surname) missingFields.push('Cognome');
    if (!bookingData.phone) missingFields.push('Numero di telefono');
    if (!bookingData.date) missingFields.push('Data');
    if (!bookingData.time) missingFields.push('Orario');
    if (!bookingData.lessonType) missingFields.push('Tipo di lezione');

    if (missingFields.length > 0) {
        throw new Error(`I seguenti campi sono mancanti: ${missingFields.join(', ')}. Impossibile inviare il riepilogo della prenotazione.`);
    }

    // Composizione del messaggio
    const message = `
📋 *Riepilogo Prenotazione*
👤 Nome: ${bookingData.name}
👥 Cognome: ${bookingData.surname}
📞 Telefono: ${bookingData.phone}
📅 Data: ${bookingData.date}
⏰ Ora: ${bookingData.time}
📘 Lezione: ${bookingData.lessonType}
    `;

    try {
        // Invio del messaggio tramite WhatsApp
        await client.sendMessage(phone, message);
        console.log(`Riepilogo prenotazione inviato con successo a ${phone}.`);
    } catch (error) {
        console.error(`Errore nell'invio del riepilogo a ${phone}: ${error.message}`);
        throw new Error(`Errore durante l'invio del messaggio WhatsApp a ${phone}: ${error.message}`);
    }
}



async function clearCalendar() {
    try {
        await db.ref('calendario').remove();
        console.log('✅ Calendario cancellato con successo.');
    } catch (error) {
        console.error('❌ Errore durante la cancellazione del calendario:', error.message);
    }
}

// Funzione per popolare il calendario su Firebase
async function populateCalendarWithValidation() {
    const startDate = new Date(2025, 0, 1); // 1 gennaio 2025
    const endDate = new Date(2025, 6, 31); // 31 luglio 2025

    let currentDate = startDate;

    while (currentDate <= endDate) {
        if (!isSaturday(currentDate) && !isSunday(currentDate)) {
            const day = format(currentDate, 'EEEE', { locale: it }).toLowerCase();

            if (schedule[day]) {
                const formattedDate = format(currentDate, 'yyyy-MM-dd');
                try {
                    const ref = db.ref(`calendario/${formattedDate}`);
                    const snapshot = await ref.once('value');
                    let existingData = snapshot.val();

                    if (!existingData || existingData.length !== schedule[day].length) {
                        // Se non esistono dati, inizializza con la struttura dello schedule
                        await ref.set(schedule[day]);
                        console.log(`✅ Dati aggiunti per ${formattedDate}:`, schedule[day]);
                    } else {
                        // Aggiorna eventuali slot mancanti o campi non inizializzati
                        existingData = existingData.map((slot) => ({
                            ...slot,
                            remainingSeats: slot.remainingSeats || 10, // Aggiunge il campo se mancante
                        }));
                        await ref.set(existingData);
                        console.log(`🔄 Dati aggiornati per ${formattedDate}:`, existingData);
                    }
                } catch (error) {
                    console.error(`❌ Errore durante il popolamento per ${formattedDate}:`, error.message);
                }
            }
        } else {
            console.log(`⏭ Giorno saltato (weekend): ${format(currentDate, 'yyyy-MM-dd')}`);
        }
        currentDate = addDays(currentDate, 1);
    }
    console.log('🎉 Calendario popolato con successo.');
}

async function migrateRemainingSeats() {
    const migrationFlagRef = db.ref('migrationFlags/remainingSeats');
    const migrationFlagSnapshot = await migrationFlagRef.once('value');
    const isMigrationDone = migrationFlagSnapshot.val();

    if (isMigrationDone) {
        console.log('ℹ️ Migrazione "remainingSeats" già completata.');
        return;
    }

    const ref = db.ref('calendario');
    const snapshot = await ref.once('value');
    const data = snapshot.val();

    if (data) {
        for (const date in data) {
            const slots = data[date];
            const updatedSlots = slots.map((slot) => ({
                ...slot,
                remainingSeats: slot.remainingSeats || 10,
            }));
            await db.ref(`calendario/${date}`).set(updatedSlots);
            console.log(`🔄 Migrazione completata per la data: ${date}`);
        }

        // Imposta il flag per indicare che la migrazione è completata
        await migrationFlagRef.set(true);
        console.log('✅ Migrazione completata e flag aggiornato.');
    } else {
        console.log('❌ Nessun dato trovato per migrazione.');
    }
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
    if (!data.name) {
        throw new Error('Nome non specificato. Impossibile inviare la notifica email.');
    }
    if (!data.surname) {
        throw new Error('Cognome non specificato. Impossibile inviare la notifica email.');
    }
    if (!data.phone) {
        throw new Error('Numero di telefono non specificato. Impossibile inviare la notifica email.');
    }
    if (!data.date) {
        throw new Error('Data non specificata. Impossibile inviare la notifica email.');
    }
    if (!data.time) {
        throw new Error('Orario non specificato. Impossibile inviare la notifica email.');
    }
    if (!data.lessonType) {
        throw new Error('Tipo di lezione non specificato. Impossibile inviare la notifica email.');
    }
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
const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: {
        headless: true, // Puoi impostarlo a false per debug visivo
        args: ['--no-sandbox', '--disable-setuid-sandbox'], // Per stabilità
    },
});
async function startClient() {
    console.log('Inizializzando il client WhatsApp...');
    try {
        await client.initialize();
    } catch (error) {
        console.error('Errore durante l\'inizializzazione del client:', error.message);
        console.log('Ritento l\'inizializzazione...');
        setTimeout(startClient, 5000); // Ritenta dopo 5 secondi
    }
}

// Percorso per salvare il QR Code
const qrPath = path.join(__dirname, 'qr.png');

// Evento: QR Code generato
client.on('qr', async (qr) => {
    console.log('QR Code generato. Scansiona il codice per continuare.');

    // Salva il QR Code come immagine
    try {
        await qrcode.toFile(qrPath, qr);
        console.log('QR Code salvato con successo.');
    } catch (err) {
        console.error('Errore nel salvataggio del QR Code:', err.message);
    }

    // Timeout per rigenerare il QR code se non scansionato entro 60 secondi
    setTimeout(() => {
        if (!client.info || !client.info.wid) {
            console.log('QR Code scaduto. Rigenerando...');
            startClient(); // Reinizializza il client per generare un nuovo QR
        }
    }, 60000); // Timeout di 60 secondi
});

// Evento: Pronto
client.on('ready', () => {
    console.log('Bot connesso a WhatsApp!');

    // Rimuove il QR Code dal file system dopo la connessione
    if (fs.existsSync(qrPath)) {
        try{
            fs.unlinkSync(qrPath);
            console.log('QR Code eliminato per sicurezza.');  
        }catch(error){
            console.error('Errore durante l\'eliminazione del QR Code:', error.message);
        }
        
    }
});

// Evento: Autenticazione completata
client.on('authenticated', () => {
    console.log('Autenticazione completata.');
    if (fs.existsSync(qrPath)) {
        fs.unlinkSync(qrPath); // Elimina il QR Code una volta autenticato
    }
});

// Evento: Disconnessione
client.on('disconnected', (reason) => {
    console.error(`Bot disconnesso: ${reason}`);
    console.log('Tentativo di riconnessione in corso...');
    startClient(); // Reinizializza il client in caso di disconnessione
});
// Endpoint per recuperare il QR Code
app.get('/qr', (req, res) => {
    if (fs.existsSync(qrPath)) {
        res.sendFile(qrPath); // Serve il file QR Code se esiste
    } else {
        res.status(404).send('QR Code non trovato. Attendi la generazione del QR.');
    }
});

app.get('/ping', (req, res) => {
    console.log(`[PING] Endpoint chiamato da ${req.ip} - ${new Date().toISOString()}`);
    res.status(200).send('OK');
});

// Funzione per prospetto settimanale
function displaySchedule() {
    return `
📅 *Prospetto Settimanale delle Lezioni*
- *Lunedì*: 09:30 PILATES MATWORK, 10:30 POSTURALE, 12:00 PILATES EXO CHAIR, 13:30 PILATES DANCE BARRE, 14:30, PILATES MATWORK
- *Martedì*: 13:30 GIROKYNESIS, 15:00 PILATES MATWORK
- *Mercoledì*: 09:30 PILATES MATWORK, 12:00 PILATES EXO CHAIR
- *Giovedì*: 13:30 GIROKYNESIS, 18:00 YOGA
- *Venerdì*: 14:00 PILATES MATWORK, 17:00 FUNCTIONAL TRAINER MOVEMENT
`;
}

// Funzione per recuperare gli slot disponibili dal database per una data specifica
async function getAvailableSlots(date) {
    try {
        const ref = db.ref(`calendario/${date}`);
        const snapshot = await ref.once('value');
        const slots = snapshot.val();

        if (!slots) {
            return []; // Nessuno slot disponibile per quella data
        }

        // Costruisce il prospetto con posti disponibili
        return slots.map((slot, index) => ({
            index: index + 1,
            time: slot.time,
            lessonType: slot.lessonType,
            remaining: slot.remaining || 10 // Di default 10 posti se non esiste il campo
        }));
    } catch (error) {
        console.error(`Errore durante il recupero degli slot per ${date}:`, error.message);
        return [];
    }
}


// Gestione messaggi WhatsApp
client.on('message', async (message) => {
    const chatId = message.from;
    const userResponse = message.body.trim().toLowerCase(); // Confronto case-insensitive

    // Se l'utente è disimpegnato
    if (disengagedUsers.has(chatId)) {
        if (userResponse === 'prenotazione') {
            disengagedUsers.delete(chatId);
            setUserState(chatId, { step: 'ask_discipline', lastUpdated: Date.now() }); // Riparte con la richiesta della disciplina
            const disciplines = getAvailableDisciplines(schedule);
            await message.reply(`Ecco le discipline disponibili da Spazio Lotus:\n${disciplines.map((d, i) => `${i + 1}) ${d}`).join('\n')}\nScegli la disciplina, digita il numero.`);
        } else {
            await message.reply('Scrivi "prenotazione" per avviare una nuova prenotazione.');
        }
        return;
    }

    // Se l'utente non ha uno stato attivo, inizializza
// Gestore dei timeout per gli stati utente
const userTimeouts = {};

if (!userStates[chatId]) {
    setUserState(chatId, { step: 'ask_discipline' });
    const disciplines = getAvailableDisciplines(schedule);
    await message.reply(`Vuoi prenotare una lezione?\nEcco le discipline disponibili:\n${disciplines.map((d, i) => `${i + 1}) ${d}`).join('\n')}\nScegli la disciplina, digita il numero.`);
    return;
}

// Aggiorna il timestamp dell'utente per indicare che è ancora attivo
userStates[chatId].lastUpdated = Date.now();


    const userState = userStates[chatId];

    // Gestione del flusso
    switch (userState.step) {
        case 'ask_discipline': {
            const disciplines = getAvailableDisciplines(schedule);
            const disciplineIndex = parseInt(userResponse, 10) - 1;

            if (disciplines[disciplineIndex]) {
                userState.data = { discipline: disciplines[disciplineIndex] };
                userState.step = 'ask_day_time';

                // Mostra i giorni e gli orari disponibili
                const dayTimeOptions = Object.entries(schedule)
                    .filter(([day, slots]) => slots.some(slot => slot.lessonType === userState.data.discipline))
                    .map(([day, slots]) => {
                        const times = slots
                            .filter(slot => slot.lessonType === userState.data.discipline)
                            .map(slot => slot.time)
                            .join(', ');
                        return `${day}: ${times}`;
                    }).join('\n');

                await message.reply(`Per ${userState.data.discipline}, sono disponibili i seguenti giorni e orari:\n${dayTimeOptions}\nScrivi il giorno (es: lunedì) e l'orario (es: 09:30) per continuare.`);
            } else {
                await message.reply('Disciplina non valida. Riprova con un numero valido.');
            }
            break;
        }

        case 'ask_day_time': {
            const userInput = userResponse.split(' ').map(s => s.trim().toLowerCase());
            if (userInput.length < 2) {
                await message.reply('Per favore, inserisci sia il giorno che l\'orario nel formato: "giorno orario" (ad esempio: "lunedì 09:30").');
                break;
            }
        
            const [day, time] = userInput;
        
            // Controlla se il giorno esiste nello schedule
            const daySlots = schedule[day];
            if (!daySlots) {
                await message.reply('Il giorno inserito non è valido. Riprova con uno dei giorni disponibili (ad esempio: lunedì, martedì, ...).');
                break;
            }
        
            // Filtra gli orari disponibili per la disciplina scelta
            const availableTimes = daySlots
                .filter(slot => slot.lessonType === userState.data.discipline)
                .map(slot => slot.time);
        
            if (availableTimes.length === 0) {
                // Nessun orario disponibile per la disciplina scelta nel giorno selezionato
                await message.reply(`Non ci sono orari disponibili per ${userState.data.discipline} il ${day}. Prova con un altro giorno.`);
                break;
            }
        
            // Verifica se l'orario è valido
            if (availableTimes.includes(time)) {
                // Orario valido
                const selectedSlot = daySlots.find(slot => slot.lessonType === userState.data.discipline && slot.time === time);
                userState.data.day = day;
                userState.data.time = time;
                userState.data.lessonType = selectedSlot.lessonType; // Assicurati che lessonType venga salvato
                userState.step = 'ask_date';
                await message.reply(`Hai scelto ${userState.data.discipline} il ${day} alle ${time}. Inserisci una data valida (formato: GG/MM/YYYY):`);
            } else {
                // Orario non valido, ripropone gli orari disponibili
                const timesList = availableTimes.join(', ');
                await message.reply(`L'orario inserito non è valido per ${userState.data.discipline} il ${day}. Gli orari disponibili sono: ${timesList}. Riprova scegliendo un orario valido.`);
            }
            break;
        }
        

        case 'ask_date': {
            const validationResult = validateAndFormatDate(
                userResponse,
                schedule, // Passa il calendario
                userState.data.discipline, // Disciplina selezionata
                userState.data.time // Orario selezionato
            );
        
            if (!validationResult.isValid) {
                // Messaggio di errore specifico basato sulla validazione
                await message.reply(validationResult.message);
            } else {
                // La data è valida
                userState.data.date = validationResult.date;
                userState.step = 'ask_name';
                await message.reply(`La data scelta è ${validationResult.date}. Procediamo! Inserisci il tuo nome:`);
            }
            break;
        }
        
        
               

        case 'ask_name': {
            if (/^[a-zA-Z\s]+$/.test(userResponse.trim())) { // Verifica che il nome contenga solo lettere
                userState.data.name = userResponse.trim(); // Salva il nome
                userState.step = 'ask_surname'; // Passa alla richiesta del cognome
                await message.reply('Perfetto! Ora inserisci il tuo cognome:');
            } else {
                await message.reply('Per favore, inserisci un nome valido composto solo da lettere.');
            }
            break;
        }

        case 'ask_surname': {
            if (/^[a-zA-Z\s]+$/.test(userResponse.trim())) { // Verifica che il cognome contenga solo lettere
                userState.data.surname = userResponse.trim(); // Salva il cognome
                userState.step = 'ask_phone'; // Passa alla richiesta del numero di telefono
                await message.reply('Inserisci il tuo numero di telefono:');
            } else {
                await message.reply('Per favore, inserisci un cognome valido composto solo da lettere.');
            }
            break;
        }

        case 'ask_phone': {
            const isValidPhoneNumber = /^\d{10,15}$/.test(userResponse.trim());
            
            if (!isValidPhoneNumber) {
                await message.reply('Per favore, inserisci un numero di telefono valido (es. 1234567890, tra 10 e 15 cifre).');
                break; // Resta nello stato 'ask_phone'
            }
        
            userState.data.phone = userResponse.trim(); // Salva il numero di telefono
        
            // Controllo finale dello slot
            const slotCheck = await getAvailableSlots(userState.data.date);
            const selectedSlot = slotCheck.find(
                (slot) => slot.time === userState.data.time && slot.lessonType === userState.data.lessonType
            );
        
            if (!selectedSlot || selectedSlot.remainingSeats <= 0) {
                await message.reply('Purtroppo questo slot è appena stato prenotato. Torna a scegliere un altro orario.');
                userState.step = 'ask_time'; // Torna alla selezione dell'orario
                break;
            }
        
            // Aggiorna lo slot nel database
            const result = await updateAvailableSlots(userState.data.date, userState.data.time);
        
            if (!result.success) {
                await message.reply('Non ci sono più posti disponibili per questo orario. Torna a scegliere un altro orario valido.');
                userState.step = 'ask_time'; // Torna alla selezione dell'orario
                break;
            }
        
            // Continua con la prenotazione
            await sendWhatsAppNotification(client, chatId, userState.data);
            await sendWhatsAppNotification(client, OWNER_PHONE, userState.data);
            await sendEmailNotification(userState.data);
        
            await message.reply('Prenotazione completata con successo! ✅');
            delete userStates[chatId]; // Reset dello stato dell'utente
            break;
        }
        
       
        

        default:
            await message.reply('Errore sconosciuto. Riprova.');
            delete userStates[chatId]; // Reset dello stato per prevenire loop infiniti
            break;
    }
});


// Funzione per aggiornare gli slot disponibili rimuovendo quello prenotato
async function updateAvailableSlots(date, time) {
    const ref = db.ref(`calendario/${date}`);
    try {
        const transactionResult = await ref.transaction((slots) => {
            if (!slots) return slots; // Se non ci sono slot, esci
            return slots.map((slot) => {
                if (slot.time === time) {
                    if (!slot.remainingSeats || slot.remainingSeats <= 0) {
                        throw new Error('Non ci sono più posti disponibili per questo orario.');
                    }
                    return { ...slot, remainingSeats: slot.remainingSeats - 1 };
                }
                return slot;
            });
        });

        if (!transactionResult.committed) {
            return { success: false, message: 'Un altro utente ha prenotato questo slot. Prova con un altro orario.' };
        }
        
        return { success: true };
    } catch (error) {
        console.error(`Errore durante l'aggiornamento degli slot per ${date}:`, error.message);
        return { success: false, message: error.message };
    }
}





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
// Avvio del server
app.listen(process.env.PORT || 10000, async () => {
    console.log(`Server in ascolto sulla porta ${process.env.PORT || 10000}`);
    await clearCalendar();
    await populateCalendarWithValidation();
    await migrateRemainingSeats();
});
startClient();
