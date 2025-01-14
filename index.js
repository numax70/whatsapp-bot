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



// Funzione per inviare il riepilogo al cliente
async function sendWhatsAppNotification(client, phone, bookingData) {
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
        await client.sendMessage(phone, message);
        console.log(`Riepilogo prenotazione inviato a ${phone}.`);
    } catch (error) {
        console.error(`Errore nell'invio del riepilogo a ${phone}:`, error.message);
    }
}

// Funzione per popolare il calendario su Firebase
async function populateCalendarWithValidation() {
    const startDate = new Date(2025, 0, 1); // 1 gennaio 2025
    const endDate = new Date(2025, 6, 31); // 31 luglio 2025

    const schedule = {
        "lunedì": [
            { "time": "09:30", "lessonType": "PILATES MATWORK", "remainingSeats": 10 },
            { "time": "10:30", "lessonType": "POSTURALE", "remainingSeats": 10 },
            { "time": "12:00", "lessonType": "PILATES EXO CHAIR", "remainingSeats": 10 },
            { "time": "13:30", "lessonType": "PILATES DANCE BARRE", "remainingSeats": 10 },
        ],
        "martedì": [
            { "time": "13:30", "lessonType": "GIROKYNESIS", "remainingSeats": 10 },
            { "time": "15:00", "lessonType": "PILATES MATWORK", "remainingSeats": 10 },
            { "time": "16:30", "lessonType": "PILATES EXO CHAIR", "remainingSeats": 10 },
            { "time": "18:00", "lessonType": "PILATES DANCE BARRE", "remainingSeats": 10 },
        ],
        "mercoledì": [
            { "time": "09:30", "lessonType": "PILATES MATWORK", "remainingSeats": 10 },
            { "time": "10:30", "lessonType": "POSTURALE", "remainingSeats": 10 },
            { "time": "12:00", "lessonType": "PILATES EXO CHAIR", "remainingSeats": 10 },
            { "time": "13:30", "lessonType": "PILATES DANCE BARRE", "remainingSeats": 10 },
        ],
        "giovedì": [
            { "time": "13:30", "lessonType": "GIROKYNESIS", "remainingSeats": 10 },
            { "time": "15:00", "lessonType": "PILATES MATWORK", "remainingSeats": 10 },
            { "time": "18:00", "lessonType": "PILATES DANCE BARRE", "remainingSeats": 10 },
            { "time": "19:00", "lessonType": "YOGA", "remainingSeats": 10 },
        ],
        "venerdì": [
            { "time": "14:00", "lessonType": "PILATES MATWORK", "remainingSeats": 10 },
            { "time": "15:30", "lessonType": "FUNCTIONAL TRAINER MOVEMENT", "remainingSeats": 10 },
        ],
    };

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

                    if (!existingData) {
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




// Gestione messaggi WhatsApp
client.on('message', async (message) => {
    const chatId = message.from;
    const userResponse = message.body.trim().toLowerCase(); // Confronto case-insensitive

    // Se l'utente è disimpegnato
    if (disengagedUsers.has(chatId)) {
        if (userResponse === 'prenotazione') {
            disengagedUsers.delete(chatId);
            userStates[chatId] = { step: 'ask_booking' };
            await message.reply(
                `Vuoi prenotare una lezione? Digita "Sì" o "No".`
            );
        } else {
            await message.reply('Scrivi "prenotazione" per avviare una nuova prenotazione.');
        }
        return;
    }

    // Se l'utente non ha uno stato attivo, inizializza
    if (!userStates[chatId]) {
        userStates[chatId] = { step: 'ask_booking' };
        await message.reply(`Vuoi prenotare una lezione? Digita "Sì" o "No".\n${displaySchedule()}`);
        return;
    }

    const userState = userStates[chatId];

    // Gestione del flusso
    switch (userState.step) {
        case 'ask_booking':
            if (userResponse === 'sì' || userResponse === 'si') {
                userState.step = 'ask_date'; // Aggiorna lo stato
                await message.reply('Inserisci la data della lezione (formato: GG/MM/YYYY):');
            } else if (userResponse === 'no') {
                disengagedUsers.add(chatId); // Aggiungi l'utente alla lista disimpegnata
                delete userStates[chatId]; // Rimuovi lo stato
                await message.reply('Ok, puoi scrivere "prenotazione" in qualsiasi momento.');
            } else {
                await message.reply('Per favore, rispondi con "Sì" o "No".');
            }
            break;

            case 'ask_date':
                const date = validateAndFormatDate(userResponse);
                if (date) {
                    const slots = await getAvailableSlots(date);
                    if (slots.length > 0) {
                        userState.data = { date }; // Salva la data
                        userState.step = 'ask_time'; // Aggiorna lo stato
                        const slotOptions = slots.map(
                            (slot, index) => `${index + 1}) ${slot.time} (${slot.lessonType})`
                        ).join('\n');
                        await message.reply(`Orari disponibili per ${date}:\n${slotOptions}\nScegli un numero corrispondente alla lezione.`);
                    } else {
                        await message.reply('Nessuna lezione disponibile per questa data. Prova con un\'altra data.');
                    }
                } else {
                    await message.reply('Data non valida o antecedente alla data odierna. Inserisci una data valida (formato: GG/MM/YYYY).');
                }
                break;
            
                case 'ask_time':
                    const timeIndex = parseInt(userResponse, 10) - 1;
                    const slots = await getAvailableSlots(userState.data.date);
                
                    if (slots[timeIndex]) {
                        const selectedSlot = slots[timeIndex];
                        userState.data = { ...userState.data, ...selectedSlot }; // Salva i dettagli della prenotazione
                        userState.step = 'ask_name'; // Passa alla fase successiva
                        await message.reply('Inserisci il tuo nome:');
                    } else {
                        await message.reply('Orario non valido. Prova con un altro numero.');
                    }
                    break;
                
                case 'ask_name':
                    if (userResponse.trim().length > 0) { // Verifica che il nome non sia vuoto
                        userState.data.name = userResponse.trim(); // Salva il nome
                        userState.step = 'ask_surname'; // Passa alla richiesta del cognome
                        await message.reply('Perfetto! Ora inserisci il tuo cognome:');
                    } else {
                        await message.reply('Per favore, inserisci un nome valido.');
                    }
                    break;
                
                case 'ask_surname':
                    if (userResponse.trim().length > 0) { // Verifica che il cognome non sia vuoto
                        userState.data.surname = userResponse.trim(); // Salva il cognome
                        userState.step = 'ask_phone'; // Passa alla richiesta del numero di telefono
                        await message.reply('Inserisci il tuo numero di telefono:');
                    } else {
                        await message.reply('Per favore, inserisci un cognome valido.');
                    }
                    break;
                
                case 'ask_phone':
                    if (/^\d+$/.test(userResponse.trim())) { // Verifica che il numero sia composto solo da cifre
                        userState.data.phone = userResponse.trim(); // Salva il numero di telefono
                
                        // Aggiorna lo slot nel database
                        const result = await updateAvailableSlots(
                            userState.data.date,
                            userState.data.time,
                            userState.data.name,
                            userState.data.surname, // Includi il cognome
                            userState.data.phone
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
                
                default:
                    await message.reply('Errore sconosciuto. Riprova.');
                    delete userStates[chatId]; // Reset dello stato per prevenire loop infiniti
                    break;
                

      
    }
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
// Avvio del server
app.listen(process.env.PORT || 10000, async () => {
    console.log(`Server in ascolto sulla porta ${process.env.PORT || 10000}`);
    await populateCalendarWithValidation();
    await migrateRemainingSeats();
});
client.initialize();
