import { Servient } from "@node-wot/core";
import { HttpClientFactory } from "@node-wot/binding-http";
import { MqttClientFactory } from "@node-wot/binding-mqtt";

/*
 * Questo script funge esclusivamente da WoT Consumer. I suoi compiti sono:
 * 1. Recuperare dinamicamente le Thing Descriptions (TD) dei dispositivi tramite HTTP.
 * 2. Collegarsi al broker MQTT per ascoltare gli eventi del sensore ambientale.
 * 3. Collegarsi al server HTTP dell'attuatore della pompa per comandare l'irrigazione.
 * 4. Implementare la logica di controllo (Mashup): se l'umidità scende sotto il 30%,
 *    attiva la pompa per 10 secondi, bloccando ulteriori attivazioni mentre è in funzione.
 */

// 1. Configurazione del Servient WoT Consumer
const servient = new Servient();

// Aggiungiamo i client factory per supportare i protocolli HTTP e MQTT.
// Node-WoT richiede che i client siano registrati esplicitamente affinché il Servient
// possa risolvere le forme di interazione (forms) presenti nelle Thing Descriptions.
servient.addClientFactory(new HttpClientFactory());
servient.addClientFactory(new MqttClientFactory());

// 2. Iniezione delle Credenziali di Sicurezza per la Pompa
// Node-WoT gestisce un archivio di credenziali interno al Servient. Quando invochiamo un'azione
// o leggiamo una proprietà su un ConsumedThing, il client HTTP controlla se l'ID del Thing corrisponde
// a una chiave dell'archivio delle credenziali. In tal caso, estrae il token e lo inserisce
// automaticamente nell'header "Authorization: Bearer <token>" della richiesta HTTP.
servient.addCredentials({
  "urn:dev:wot:greenhouse-irrigation-pump-01": {
    token: "chiave-segreta-pompa"
  }
});

// Stato locale per evitare di attivare la pompa ripetutamente se è già in esecuzione
let isPumpRunning = false;

console.log("[Gateway] Avvio del Servient WoT Consumer...");

servient.start()
  .then(async (WoT) => {
    console.log("[Gateway] Runtime WoT avviato con successo.");

    try {
      // 3. Recupero dinamico delle Thing Descriptions (WoT.requestThingDescription)
      // Recuperiamo le TD aggiornate e complete direttamente dagli endpoint HTTP dei produttori.
      // Questo approccio evita problemi legati a file statici obsoleti o privi dei campi 'forms' generati a runtime.
      console.log("[Gateway] Recupero della Thing Description del Sensore da http://localhost:8080/greenhouse-environmental-sensor ...");
      const sensorTd = await WoT.requestThingDescription("http://localhost:8080/greenhouse-environmental-sensor");

      console.log("[Gateway] Recupero della Thing Description della Pompa da http://localhost:8082/greenhouse-irrigation-pump ...");
      const pumpTd = await WoT.requestThingDescription("http://localhost:8082/greenhouse-irrigation-pump");

      // 4. Consumazione delle Thing Descriptions (WoT.consume)
      // Il metodo consume() analizza semanticamente il documento JSON-LD (TD) e restituisce un oggetto
      // proxy di tipo 'ConsumedThing'. Questo oggetto ci permette di interagire con il dispositivo fisico
      // in modo trasparente rispetto al protocollo di rete reale (HTTP o MQTT).
      console.log(`[Gateway] Consumazione TD del Sensore Ambientale: "${(sensorTd as any).title}"`);
      const sensorThing = await WoT.consume(sensorTd);

      console.log(`[Gateway] Consumazione TD dell'Attuatore Pompa: "${(pumpTd as any).title}"`);
      const pumpThing = await WoT.consume(pumpTd);

      console.log("====================================================================");
      console.log("[Gateway] Orchestratore in ascolto su MQTT (Topic /greenhouse/sensors/environmental/data)...");
      console.log("====================================================================");

      // 5. Sottoscrizione all'evento MQTT 'environmentalData'
      // Il sensore ambientale pubblica periodicamente i suoi dati su MQTT. Con subscribeEvent,
      // Node-WoT si connette al broker specificato nel form dell'evento della TD ed esegue il callback
      // ad ogni nuovo messaggio ricevuto.
      await sensorThing.subscribeEvent("environmentalData", async (output) => {
        try {
          // Aspetta la risoluzione asincrona del valore ricevuto
          const data = (await output.value()) as { temperature: number; humidity: number };
          const temperature = data.temperature;
          const humidity = data.humidity;

          console.log(`[Gateway] [DATO RICEVUTO] Temp: ${temperature}°C | Umidità: ${humidity}%`);

          // 6. Logica di Business / Mashup (Orchestratore)
          // Se l'umidità scende sotto la soglia critica del 30%...
          if (humidity < 30) {
            // Verifichiamo se la pompa è già contrassegnata come attiva per evitare invii ripetuti
            if (isPumpRunning) {
              console.log(`[Gateway] [Sotto Soglia] Umidità al ${humidity}% (< 30%), ma la pompa è già attiva.`);
              return;
            }

            // Calcolo proporzionale della durata in base a quanto è scesa l'umidità:
            // - Umidità tra 25% e 29.9% -> Irrigazione leggera (5 secondi)
            // - Umidità tra 20% e 24.9% -> Irrigazione media (10 secondi)
            // - Umidità tra 15% e 19.9% -> Irrigazione profonda (20 secondi)
            // - Umidità sotto il 15%    -> Irrigazione critica (30 secondi)
            let duration = 10;
            let severity = "media";
            if (humidity >= 25) {
              duration = 5;
              severity = "leggera";
            } else if (humidity >= 20) {
              duration = 10;
              severity = "media";
            } else if (humidity >= 15) {
              duration = 20;
              severity = "profonda";
            } else {
              duration = 30;
              severity = "critica";
            }

            console.log(`[Gateway] [Sotto Soglia] Umidità al ${humidity}% (< 30%). Rilevato stato di irrigazione "${severity}".`);
            console.log(`[Gateway] ATTIVAZIONE POMPA IN CORSO (Durata calcolata: ${duration}s)...`);
            isPumpRunning = true;

            // Invochiamo l'azione 'turnOnPump' tramite HTTP POST, passando il valore calcolato.
            await pumpThing.invokeAction("turnOnPump", duration);
            console.log(`[Gateway] [Azione] Comando 'turnOnPump' per ${duration} secondi inviato con successo.`);

            // Impostiamo un timer locale pari alla durata effettiva dell'irrigazione
            // prima di permettere un'eventuale nuova attivazione.
            setTimeout(() => {
              isPumpRunning = false;
              console.log(`[Gateway] [Timer] Sblocco logica di irrigazione (i ${duration} secondi sono trascorsi).`);
            }, duration * 1000);
          } else {
            console.log(`[Gateway] [Stato OK] Umidità al ${humidity}% (>= 30%). Nessuna irrigazione richiesta.`);
          }
        } catch (err: any) {
          console.error("[Gateway] Errore nell'elaborazione del payload dell'evento:", err.message);
        }
      });

    } catch (err: any) {
      console.error("[Gateway] Errore durante la consumazione dei Thing:", err.message);
    }
  })
  .catch((err) => {
    console.error("[Gateway] Errore durante l'avvio del Servient:", err);
  });
