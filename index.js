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
		{ "time": "10:30", "lessonType": "PILATES MATWORK", "remainingSeats": 10 },
        { "time": "12:00", "lessonType": "GIROKYNESIS", "remainingSeats": 10 },
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
        { "time": "13:30", "lessonType": "PILATES MATWORK", "remainingSeats": 10 },
    ],
    "giovedì": [
	    { "time": "10:30", "lessonType": "PILATES MATWORK", "remainingSeats": 10 },
        { "time": "12:00", "lessonType": "GIROKYNESIS", "remainingSeats": 10 },
		{ "time": "13:30", "lessonType": "GIROKYNESIS", "remainingSeats": 10 },
        { "time": "15:00", "lessonType": "PILATES MATWORK", "remainingSeats": 10 },
        { "time": "16:30", "lessonType": "PILATES EXO CHAIR", "remainingSeats": 10 },
        { "time": "18:00", "lessonType": "PILATES MATWORK", "remainingSeats": 10 },
        { "time": "19:00", "lessonType": "YOGA", "remainingSeats": 10 }
    ],
	
	"venerdì": [
		{ "time": "13:00", "lessonType": "PILATES DANCE BARRE", "remainingSeats": 10 },
        { "time": "14:00", "lessonType": "PILATES MATWORK", "remainingSeats": 10 },
        { "time": "15:00", "lessonType": "PILATES EXO CHAIR", "remainingSeats": 10 },
        { "time": "16:15", "lessonType": "PILATES DANCE BARRE", "remainingSeats": 10 },
		{ "time": "17:30", "lessonType": "PILATES MATWORK", "remainingSeats": 10 },
        { "time": "19:00", "lessonType": "FUNCTIONAL TRAINER MOVEMENT", "remainingSeats": 10 }
    ]
};

const alternativeNames = {
    "matwork": "PILATES MATWORK",
    "Matwork": "PILATES MATWORK",
    "barre": "PILATES DANCE BARRE",
    "Barre": "PILATES DANCE BARRE",
    "exo chair": "PILATES EXO CHAIR",
    "exo": "PILATES EXO CHAIR",
    "Exo": "PILATES EXO CHAIR",
    "chair": "PILATES EXO CHAIR",
    "Chair": "PILATES EXO CHAIR",
    "functional": "FUNCTIONAL TRAINER MOVEMENT",
    "functional trainer": "FUNCTIONAL TRAINER MOVEMENT",
    "functional trainer movement": "FUNCTIONAL TRAINER MOVEMENT",
    "Functional trainer movement": "FUNCTIONAL TRAINER MOVEMENT",
    "Girokinesis": "GIROKYNESIS",
    "Giro": "GIROKYNESIS",
    "GIRO": "GIROKYNESIS",
    "Kinesis": "GIROKYNESIS",
    "Yoga": "YOGA",
    "yoga": "YOGA"


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
        databaseURL: 'https://whatsapp-bot-1-df029-default-rtdb.europe-west1.firebasedatabase.app',
    });
    console.log('Firebase inizializzato correttamente.');
} catch (error) {
    console.error('Errore durante l\'inizializzazione di Firebase:', error.message);
    process.exit(1);
}

const db = admin.database();
const userStates = {};

// Configurazione email
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: EMAIL_USER,
        pass: EMAIL_PASS,
    },
});

async function sendEmailNotification(data) {
    const emailBody = `🧑🏻‍💻 Nuova prenotazione ricevuta:
👤 Nome: ${data.name} ${data.surname}
📞 Telefono: ${data.phone}
🤗 Disciplina: ${data.discipline}
📅 Giorno: ${data.day}
⏰ Orario: ${data.time}
📅 Data: ${data.formattedDate}`;

    const mailOptions = {
        from: EMAIL_USER,
        to: 'siselcatania@gmail.com', // Sostituisci con l'email del proprietario
        subject: 'Nuova Richiesta di Prenotazione Lezione',
        text: emailBody,
    };

    try {
        await transporter.sendMail(mailOptions);
        console.log('Email inviata al proprietario.');
    } catch (error) {
        console.error('Errore nell\'invio dell\'email:', error.message);
    }
}

async function populateDatabase() {
    const today = new Date();
    const endDate = addDays(today, 7); // Riempie per una settimana

    for (let d = today; d <= endDate; d = addDays(d, 1)) {
        const dayName = format(d, 'EEEE', { locale: it }).toLowerCase();
        const formattedDate = format(d, 'yyyy-MM-dd');

        if (schedule[dayName]) {
            const daySchedule = schedule[dayName];
            const ref = db.ref(`calendario/${formattedDate}`);
            const snapshot = await ref.once('value');

            if (!snapshot.exists()) {
                await ref.set(daySchedule);
                console.log(`Aggiunto calendario per ${formattedDate}`);
            } else {
                console.log(`Calendario già esistente per ${formattedDate}`);
            }
        }
    }
}

async function resetSlots() {
    const yesterday = addDays(new Date(), -1);
    const formattedDate = format(yesterday, 'yyyy-MM-dd');

    const ref = db.ref(`calendario/${formattedDate}`);
    const snapshot = await ref.once('value');

    if (snapshot.exists()) {
        const slots = snapshot.val();
        const resetSlots = slots.map(slot => ({
            ...slot,
            remainingSeats: 10
        }));

        await ref.set(resetSlots);
        console.log(`Ripristinati slot per ${formattedDate}`);
    }
}

async function startBot() {
    const client = new Client({ authStrategy: new LocalAuth() });

    await populateDatabase(); // Riempie il database con il calendario

    setInterval(async () => {
        await resetSlots(); // Ripristina slot ogni giorno
    }, 24 * 60 * 60 * 1000); // Ogni 24 ore

    client.on('message', async message => {
        const chatId = message.from;
        const userResponse = message.body.trim();

        //Controlla se l'utente è nuovo
        if (!userStates[chatId]) {
            userStates[chatId] = { step: 'ask_details' }; // Avanza direttamente al menu
            await sendWelcomeMessage(client, chatId);
            return; // Interrompi qui, il menu è già stato mostrato
        }

        const userState = userStates[chatId];

        switch (userState.step) {
            case 'ask_details':
                const [discipline, day, time, date] = userResponse.split(',').map(s => s.trim());

                if (!discipline || !day || !time || !date) {
                    await message.reply(' 👩🏻 Assicurati di inserire tutte le informazioni richieste nel formato:*disciplina, giorno, orario, data* Esempio: matwork, lunedì, 09:30, 26 gennaio');
                    break;
                }

                //Normalizza e valida
                const normalizedDiscipline = normalizeDiscipline(discipline);

                if (!getAvailableDisciplines(schedule).includes(normalizedDiscipline)) {
                    await message.reply('👩🏻 Disciplina non valida. Riprova con una delle seguenti: ' + getAvailableDisciplines(schedule).join(', '));
                    break;
                }

                const validation = validateAndFormatDate(date, schedule, normalizedDiscipline, time);
                if (!validation.isValid) {
                    await message.reply(validation.message);
                    break;
                }

                userState.data = { discipline: normalizedDiscipline, day, time, date: validation.date };
                userState.step = 'ask_user_info';
                await message.reply('👩🏻 Inserisci il tuo nome, cognome e numero di telefono nel formato: *nome,cognome,numero* Esempio: Mario,Rossi,3479056597');
                break;

            case 'ask_user_info':
                const [name, surname, phone] = userResponse.split(',').map(s => s.trim());

                if (!name || !surname || !phone) {
                    await message.reply('👩🏻 Assicurati di inserire tutte le informazioni richieste nel formato: *nome,cognome,numero* Esempio: Mario,Rossi,3479056597');
                    break;
                }

                if (!/^[a-zA-Z\s]+$/.test(name)) {
                    await message.reply('👩🏻 Il nome può contenere solo lettere.');
                    break;
                }

                if (!/^[a-zA-Z\s]+$/.test(surname)) {
                    await message.reply('👩🏻 Il cognome può contenere solo lettere.');
                    break;
                }

                if (!/^\d{10,15}$/.test(phone)) {
                    await message.reply('👩🏻 Il numero di telefono deve contenere solo cifre e avere una lunghezza tra 10 e 15 cifre.');
                    break;
                }

                userState.data.name = name;
                userState.data.surname = surname;
                userState.data.phone = phone;

                // Riformatta la data e salvala
                const formattedDate = formatDateISOtoDDMMYYYY(userState.data.date);
                userState.data.formattedDate = formattedDate;

                userState.step = 'confirm_booking';
                await message.reply(`👩🏻 Ecco il riepilogo della tua prenotazione:
🤗 Disciplina: ${userState.data.discipline}
📅 Giorno: ${userState.data.day}
- Orario: ${userState.data.time}
📅 Data: ${userState.data.formattedDate}
👤 Nome: ${userState.data.name}
👤 Cognome: ${userState.data.surname}
📞 Telefono: ${userState.data.phone}

👩🏻 Vuoi apportare modifiche? Rispondi con "Sì" o "No".`);
                break;

                

            case 'confirm_booking':
                if (userResponse.toLowerCase() === 'sì' || userResponse.toLowerCase() === 'si') {
                    userState.step = 'modify_booking';
                    await message.reply('Cosa vuoi modificare? Scrivi: "disciplina", "giorno", "orario", "data", "nome", "cognome" o "telefono".');
                } else if (userResponse.toLowerCase() === 'no') {
                    if (!userState.data || !userState.data.date || !userState.data.time || !userState.data.discipline) {
                        await message.reply('⚠️ Si è verificato un errore con i dati della prenotazione. Riprova.');
                        delete userStates[chatId];
                        break;
                    }
                    const updateResult = await updateAvailableSlots(userState.data.date, userState.data.time);
                    if (!updateResult.success) {
                        await message.reply('⚠️ Posti esauriti. Scegli un altro orario.');
                        userState.step = 'ask_details';
                        break;
                    }
                    
                                                     

                    // Invio riepilogo al cliente
                    await client.sendMessage(
                        chatId,
                        `✅ *Prenotazione Completata con Successo!* ✅
                    
                    Ecco il riepilogo della tua prenotazione:
                    
                    📅 *Data*: ${userState.data.formattedDate}
                    ⏰ *Orario*: ${userState.data.time}
                    📍 *Disciplina*: ${userState.data.discipline}
                    👤 *Nome*: ${userState.data.name} ${userState.data.surname}
                    📞 *Telefono*: ${userState.data.phone}
                    
                    Grazie per aver scelto *Spazio Lotus*! 🌟
                    Se hai domande, non esitare a contattarci.`
                    );
                    
                    await client.sendMessage(OWNER_PHONE, `📢 Nuova prenotazione ricevuta 📢
                    👤 *Cliente*: ${userState.data.name} ${userState.data.surname}
                    📞 *Telefono*: ${userState.data.phone}
                    📍 *Disciplina*: ${userState.data.discipline}
                    📆 *Giorno*: ${userState.data.day}
                    ⏰ *Orario*: ${userState.data.time}
                    📅 *Data*: ${userState.data.formattedDate}
                    
                    🔔 Assicurati che tutto sia pronto per accogliere il cliente!`);
                    // Invio email
                    await sendEmailNotification(userState.data);   
                    
                    // Messaggio di completamento al cliente
                    await message.reply('🎉 Grazie! La tua prenotazione è stata registrata con successo.');
       
                    delete userStates[chatId];
                } else {
                    await message.reply('👩🏻 Risposta non valida. Digita "Sì" per modificare o "No" per confermare.');
                }
                break;

            case 'modify_booking':
                if (['disciplina', 'giorno', 'orario', 'data', 'nome', 'cognome', 'telefono'].includes(userResponse.toLowerCase())) {
                    userState.step = `modify_${userResponse.toLowerCase()}`;
                    await message.reply(`👩🏻 Inserisci il nuovo valore per ${userResponse.toLowerCase()}.`);
                } else {
                    await message.reply('👩🏻 Modifica non valida. Scrivi: "disciplina", "giorno", "orario", "data", "nome", "cognome" o "telefono".');
                }
                break;

            case 'modify_disciplina':
                const newDiscipline = normalizeDiscipline(userResponse);
                if (!getAvailableDisciplines(schedule).includes(newDiscipline)) {
                    await message.reply('👩🏻 Disciplina non valida. Riprova.');
                } else {
                    userState.data.discipline = newDiscipline;
                    userState.step = 'confirm_booking';
                    await message.reply('👩🏻 Disciplina aggiornata. Vuoi apportare altre modifiche? Rispondi con "Sì" o "No".');
                }
                break;

            case 'modify_giorno':
                userState.data.day = userResponse;
                userState.step = 'confirm_booking';
                await message.reply('👩🏻 Giorno aggiornato. Vuoi apportare altre modifiche? Rispondi con "Sì" o "No".');
                break;

            case 'modify_orario':
                userState.data.time = userResponse;
                userState.step = 'confirm_booking';
                await message.reply('👩🏻 Orario aggiornato. Vuoi apportare altre modifiche? Rispondi con "Sì" o "No".');
                break;

            case 'modify_data':
                const validatedDate = validateAndFormatDate(userResponse, schedule, userState.data.discipline, userState.data.time);
                if (!validatedDate.isValid) {
                    await message.reply(validatedDate.message);
                } else {
                    userState.data.date = validatedDate.date;
                    userState.step = 'confirm_booking';
                    await message.reply('👩🏻 Data aggiornata. Vuoi apportare altre modifiche? Rispondi con "Sì" o "No".');
                }
                break;

            case 'modify_nome':
                if (/^[a-zA-Z\s]+$/.test(userResponse)) {
                    userState.data.name = userResponse;
                    userState.step = 'confirm_booking';
                    await message.reply('👩🏻 Nome aggiornato. Vuoi apportare altre modifiche? Rispondi con "Sì" o "No".');
                } else {
                    await message.reply('👩🏻 Nome non valido. Usa solo lettere.');
                }
                break;

            case 'modify_cognome':
                if (/^[a-zA-Z\s]+$/.test(userResponse)) {
                    userState.data.surname = userResponse;
                    userState.step = 'confirm_booking';
                    await message.reply('👩🏻 Cognome aggiornato. Vuoi apportare altre modifiche? Rispondi con "Sì" o "No".');
                } else {
                    await message.reply('👩🏻 Cognome non valido. Usa solo lettere.');
                }
                break;

            case 'modify_telefono':
                if (/^\d{10,15}$/.test(userResponse)) {
                    userState.data.phone = userResponse;
                    userState.step = 'confirm_booking';
                    await message.reply('👩🏻Telefono aggiornato. Vuoi apportare altre modifiche? Rispondi con "Sì" o "No".');
                } else {
                    await message.reply('👩🏻 Telefono non valido. Inserisci un numero tra 10 e 15 cifre.');
                }
                break;

            default:
                await message.reply('👩🏻 Si è verificato un errore. Riprova.');
                delete userStates[chatId];
        }
    });

    client.on('qr', qr => {
        console.log('QR Code generato.');
        qrcode.toFile(path.join(__dirname, 'qr.png'), qr, err => {
            if (err) console.error('👩🏻 Errore nella generazione del QR Code:', err);
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
        console.log('👩🏻 Bot connesso a WhatsApp!');
    });

    client.initialize();

    app.listen(3000, () => {
        console.log('Server in ascolto sulla porta 3000');
    });
}

async function updateAvailableSlots(date, time) {
    const ref = db.ref(`calendario/${date}`);
    try {
        const transactionResult = await ref.transaction(slots => {
            if (!slots) return null;
            return slots.map(slot => {
                if (slot.time === time) {
                                        if (slot.remainingSeats <= 0) {
                        console.error('👩🏻 Nessun posto disponibile per questo orario.');
                        return slot;
                    }
                    return { ...slot, remainingSeats: slot.remainingSeats - 1 };
                }
                return slot;
            });
        });

        if (transactionResult.committed) {
            console.log(`Slot aggiornato con successo per la data ${date} e orario ${time}.`);
            return { success: true };
        } else {
            return { success: false, message: 'Transazione non riuscita.' };
        }
    } catch (error) {
        console.error(`Errore durante l'aggiornamento degli slot: ${error.message}`);
        return { success: false, message: error.message };
    }
}

function normalizeDiscipline(input) {
    const normalizedInput = input.trim().toLowerCase();
    return alternativeNames[normalizedInput] || Object.keys(alternativeNames).find(key => normalizedInput.includes(key)) || input;
}

function validateAndFormatDate(input, schedule, discipline, time) {
    if (!input) {
        return { isValid: false, message: '👩🏻 La data non è valida. L\'anno non è indispensabile, usa semplicemente il formato "26 gennaio".' };
    }

    const today = new Date();
    const year = today.getFullYear();

    let parsedDate;
    try {
        parsedDate = parse(`${input} ${year}`, 'd MMMM yyyy', today, { locale: it });
    } catch (error) {
        return { isValid: false, message: '👩🏻 Errore nella decodifica della data. Usa il formato "26 gennaio".' };
    }

    if (!isValid(parsedDate) || parsedDate < today) {
        return { isValid: false, message: '👩🏻 Inserisci una data valida e successiva a quella odierna.' };
    }

    const inputDay = format(parsedDate, 'EEEE', { locale: it }).toLowerCase();
    if (!schedule[inputDay]) {
        return { isValid: false, message: `Non ci sono lezioni il giorno ${inputDay}.` };
    }

    const slot = schedule[inputDay].find(s => s.lessonType.toLowerCase() === discipline.toLowerCase() && s.time === time);
    if (!slot) {
        return { isValid: false, message: '👩🏻 Nessuna lezione disponibile per questa combinazione (verifica la tabella e il giorno di calendario).' };
    }

    return { isValid: true, date: format(parsedDate, 'yyyy-MM-dd') };
}

function formatDateISOtoDDMMYYYY(isoDate) {
    const [year, month, day] = isoDate.split('-');
    return `${day}-${month}-${year}`;
}

function getAvailableDisciplines(schedule) {
    return [...new Set(Object.values(schedule).flatMap(day => day.map(slot => slot.lessonType)))];
}

async function sendWelcomeMessage(client, recipient) {
    const logoPath = path.join(__dirname, 'logo.jpg');
    const tableImagePath = path.join(__dirname, 'tabella.jpg'); // Immagine della tabella orari
    try {
        // Invio del logo
        if (fs.existsSync(logoPath)) {
            const logoMedia = MessageMedia.fromFilePath(logoPath);
            await client.sendMessage(recipient, logoMedia);
        }

        // Messaggio di benvenuto
        await client.sendMessage(
            recipient,
            `🎉 Benvenuto su Spazio Lotus!\n📍 Sedi:\n- Catania: Via Carmelo Patanè Romeo, 28\n- Trecastagni (CT): Via Luigi Capuana, 51\n📞 Telefono: +39 349 289 0065`
        );

        // Invio della tabella orari
        if (fs.existsSync(tableImagePath)) {
            const tableMedia = MessageMedia.fromFilePath(tableImagePath);
            await client.sendMessage(recipient, tableMedia);
        } else {
            console.error('Tabella orari non trovata.');
        }

        // Domanda per prenotazione
        const disciplines = getAvailableDisciplines(schedule).join(', ');
        await client.sendMessage(
            recipient,
            ` 👩🏻 Vuoi prenotare una lezione ? Ecco le discipline disponibili:\n${disciplines}.\n\nScrivi il tuo messaggio seguendo questo formato:\n*disciplina, giorno, orario, data*\n\nEsempio:\nPILATES MATWORK, lunedì, 09:30, 26 gennaio`
        );
    } catch (error) {
        console.error('Errore durante l\'invio del messaggio di benvenuto:', error.message);
    }
}


startBot().catch(console.error);

