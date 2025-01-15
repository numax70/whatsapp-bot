require('dotenv').config();
const express = require('express');
const app = express();
const fs = require('fs');
const path = require('path');
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode');
const nodemailer = require('nodemailer');
const admin = require('firebase-admin');
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
    const today = new Date(); // Data odierna
    today.setHours(0, 0, 0, 0); // Azzerare ore, minuti e secondi per confronti solo sulla data

    for (const fmt of formats) {
        const parsedDate = parse(input, fmt, today, { locale: it });
        if (isValid(parsedDate) && parsedDate >= today) { // Controllo: la data deve essere odierna o futura
            return format(parsedDate, 'yyyy-MM-dd');
        }
    }
    return null;
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
    if (!bookingData.name) {
        throw new Error('Nome non specificato. Impossibile inviare il riepilogo della prenotazione.');
    }
    if (!bookingData.surname) {
        throw new Error('Cognome non specificato. Impossibile inviare il riepilogo della prenotazione.');
    }
    if (!bookingData.phone) {
        throw new Error('Numero di telefono non specificato. Impossibile inviare il riepilogo della prenotazione.');
    }
    if (!bookingData.date) {
        throw new Error('Data non specificata. Impossibile inviare il riepilogo della prenotazione.');
    }
    if (!bookingData.time) {
        throw new Error('Orario non specificato. Impossibile inviare il riepilogo della prenotazione.');
    }
    if (!bookingData.lessonType) {
        throw new Error('Tipo di lezione non specificato. Impossibile inviare il riepilogo della prenotazione.');
    }
    const message = `
📋 *Riepilogo Prenotazione*
👤 Nome: ${bookingData.name || 'N/A'}
👥 Cognome: ${bookingData.surname || 'N/A'}
📞 Telefono: ${bookingData.phone || 'N/A'}
📅 Data: ${bookingData.date || 'N/A'}
⏰ Ora: ${bookingData.time || 'N/A'}
📘 Lezione: ${bookingData.lessonType || 'N/A'}
    `;

    try {
        await client.sendMessage(phone, message);
        console.log(`Riepilogo prenotazione inviato a ${phone}.`);
    } catch (error) {
        console.error(`Errore nell'invio del riepilogo a ${phone}:`, error.message);
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
            userStates[chatId] = { step: 'ask_discipline' }; // Riparte con la richiesta della disciplina
            const disciplines = getAvailableDisciplines(schedule);
            await message.reply(`Ecco le discipline disponibili:\n${disciplines.map((d, i) => `${i + 1}) ${d}`).join('\n')}\nScegli il numero della disciplina.`);
        } else {
            await message.reply('Scrivi "prenotazione" per avviare una nuova prenotazione.');
        }
        return;
    }

    // Se l'utente non ha uno stato attivo, inizializza
    if (!userStates[chatId]) {
        userStates[chatId] = { step: 'ask_discipline' };
        const disciplines = getAvailableDisciplines(schedule);
        await message.reply(`Vuoi prenotare una lezione? Ecco le discipline disponibili:\n${disciplines.map((d, i) => `${i + 1}) ${d}`).join('\n')}\nScegli il numero della disciplina.`);
        return;
    }

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
            const [day, time] = userResponse.split(' ').map(s => s.trim());
            const daySlots = schedule[day.toLowerCase()]; // Recupera gli slot per il giorno scelto
        
            if (daySlots) {
                const selectedSlot = daySlots.find(slot => slot.lessonType === userState.data.discipline && slot.time === time);
        
                if (selectedSlot) {
                    userState.data.day = day; // Salva il giorno scelto
                    userState.data.time = time; // Salva l'orario scelto
                    userState.data.lessonType = selectedSlot.lessonType; // Salva il tipo di lezione
        
                    userState.step = 'ask_date'; // Passa allo step successivo
                    await message.reply(`Hai scelto ${userState.data.discipline} il ${day} alle ${time}. Inserisci una data valida (formato: GG/MM/YYYY):`);
                } else {
                    // Caso in cui la combinazione di giorno e orario non è valida
                    const availableTimes = daySlots
                        .filter(slot => slot.lessonType === userState.data.discipline)
                        .map(slot => slot.time)
                        .join(', ');
                    await message.reply(`L'orario inserito non è valido per ${userState.data.discipline} il ${day}. Gli orari disponibili sono: ${availableTimes}. Riprova.`);
                }
            } else {
                // Caso in cui il giorno non è valido
                await message.reply('Il giorno inserito non è valido. Scegli un giorno valido (ad esempio, "lunedì", "martedì", ecc.) e riprova.');
            }
            break;
        }
        

        case 'ask_date': {
            const formattedDate = validateAndFormatDate(userResponse);
            if (formattedDate) {
                userState.data.date = formattedDate;
                userState.step = 'ask_name';
                await message.reply(`La data scelta è ${formattedDate}. Procediamo! Inserisci il tuo nome:`);
            } else {
                await message.reply('Data non valida. Inserisci una data valida (formato: GG/MM/YYYY).');
            }
            break;
        }

        case 'ask_name': {
            if (userResponse.trim().length > 0) {
                userState.data.name = userResponse.trim();
                userState.step = 'ask_surname';
                await message.reply('Perfetto! Ora inserisci il tuo cognome:');
            } else {
                await message.reply('Per favore, inserisci un nome valido.');
            }
            break;
        }

        case 'ask_surname': {
            if (userResponse.trim().length > 0) {
                userState.data.surname = userResponse.trim();
                userState.step = 'ask_phone';
                await message.reply('Inserisci il tuo numero di telefono:');
            } else {
                await message.reply('Per favore, inserisci un cognome valido.');
            }
            break;
        }

        case 'ask_phone': {
            if (/^\d+$/.test(userResponse.trim())) {
                userState.data.phone = userResponse.trim();

                // Aggiorna lo slot nel database
                const result = await updateAvailableSlots(
                    userState.data.date,
                    userState.data.time
                );

                if (result.success) {
                    // Invia riepilogo
                    await sendWhatsAppNotification(client, chatId, userState.data);
                    await sendWhatsAppNotification(client, OWNER_PHONE, userState.data);
                    await sendEmailNotification(userState.data);

                    await message.reply('Prenotazione completata con successo! ✅');
                } else {
                    await message.reply(result.message);
                }

                delete userStates[chatId]; // Reset dello stato dell'utente
            } else {
                await message.reply('Per favore, inserisci un numero di telefono valido.');
            }
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
    try {
        const ref = db.ref(`calendario/${date}`);
        const snapshot = await ref.once('value');
        const slots = snapshot.val();

        if (!slots) {
            return { success: false, message: 'Non ci sono slot disponibili per questa data.' };
        }

        const updatedSlots = slots.map((slot) => {
            if (slot.time === time) {
                if (!slot.remainingSeats || slot.remainingSeats <= 0) {
                    throw new Error('Non ci sono più posti disponibili per questo slot.');
                }
                // Decrementa i posti disponibili
                return {
                    ...slot,
                    remainingSeats: slot.remainingSeats - 1,
                };
            }
            return slot;
        });

        await ref.set(updatedSlots); // Aggiorna il database
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
client.initialize();
