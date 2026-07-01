import { Servient } from "@node-wot/core";
import { HttpClientFactory } from "@node-wot/binding-http";
import { MqttClientFactory } from "@node-wot/binding-mqtt";

// Configura il Servient WoT come consumer
const servient = new Servient();
servient.addClientFactory(new HttpClientFactory());
servient.addClientFactory(new MqttClientFactory());

// Credenziali per accedere alla pompa protetta da token
servient.addCredentials({
  "urn:dev:wot:greenhouse-irrigation-pump-01": {
    token: "chiave-segreta-pompa"
  }
});

let isPumpRunning = false;

console.log("[ORCHESTRATORE] Avvio...");

servient.start().then(async (WoT) => {
  console.log("[ORCHESTRATORE] Runtime avviato.");

  try {
    // Richiesta delle Thing Description dinamiche dai produttori
    console.log("[ORCHESTRATORE] Caricamento TD sensore...");
    const sensorTd = await WoT.requestThingDescription("http://localhost:8080/sensore-ambientale-serra");

    console.log("[ORCHESTRATORE] Caricamento TD pompa...");
    const pumpTd = await WoT.requestThingDescription("http://localhost:8082/pompa-irrigazione-serra");

    // Consuma le Thing
    const sensorThing = await WoT.consume(typeof sensorTd === "string" ? JSON.parse(sensorTd) : sensorTd);
    const pumpThing = await WoT.consume(typeof pumpTd === "string" ? JSON.parse(pumpTd) : pumpTd);

    console.log("[ORCHESTRATORE] Sottoscrizione eventi MQTT attiva.");

    // Ascolta i dati dei sensori in arrivo via MQTT
    await sensorThing.subscribeEvent("environmentalData", async (output) => {
      try {
        const data = (await output.value()) as { temperature: number; humidity: number };
        const { temperature, humidity } = data;

        console.log(`[ORCHESTRATORE] Ricevuto -> Temp: ${temperature}°C, Umidità: ${humidity}%`);

        // Legge dinamicamente il tipo di serra attivo dal sensore
        const activeGreenhouseOutput = await sensorThing.readProperty("activeGreenhouse");
        const activeGreenhouse = (await activeGreenhouseOutput.value()) as string;

        // Imposta la soglia di umidità in base alla serra attiva (Tropicale: 40%, Mediterranea: 30%)
        const threshold = activeGreenhouse === "tropical" ? 40 : 30;
        console.log(`[ORCHESTRATORE] Ricevuto -> Temp: ${temperature}°C, Umidità: ${humidity}% | Serra: ${activeGreenhouse.toUpperCase()} (Soglia: ${threshold}%)`);

        // Logica di controllo dell'irrigazione
        if (humidity < threshold) {
          if (isPumpRunning) {
            console.log(`[ORCHESTRATORE] Umidità sotto soglia (${humidity}%), ma la pompa è già in funzione.`);
            return;
          }

          // Calcola la durata dell'irrigazione in base alla gravità della siccità e al tipo di serra
          let duration = 10;
          let level = "medio";

          if (activeGreenhouse === "tropical") {
            if (humidity >= 35) {
              duration = 5;
              level = "basso";
            } else if (humidity >= 30) {
              duration = 10;
              level = "medio";
            } else if (humidity >= 25) {
              duration = 20;
              level = "alto";
            } else {
              duration = 30;
              level = "critico";
            }
          } else {
            // Mediterranea
            if (humidity >= 25) {
              duration = 5;
              level = "basso";
            } else if (humidity >= 20) {
              duration = 10;
              level = "medio";
            } else if (humidity >= 15) {
              duration = 15;
              level = "alto";
            } else {
              duration = 25;
              level = "critico";
            }
          }

          console.log(`[ORCHESTRATORE] Avvio irrigazione automatica (livello: ${level}, durata: ${duration}s)`);
          isPumpRunning = true;

          // Attiva la pompa tramite HTTP POST
          await pumpThing.invokeAction("turnOnPump", duration);
          console.log("[ORCHESTRATORE] Comando turnOnPump inviato all'attuatore.");

          // Sblocca la pompa al termine dell'irrigazione
          setTimeout(() => {
            isPumpRunning = false;
            console.log("[ORCHESTRATORE] Irrigazione conclusa, logica sbloccata.");
          }, duration * 1000);

        } else {
          console.log(`[ORCHESTRATORE] Stato OK, umidità sufficiente per la serra corrente.`);
        }
      } catch (err: any) {
        console.error("[ORCHESTRATORE] Errore nell'elaborazione del dato ricevuto:", err.message);
      }
    });

  } catch (err: any) {
    console.error("[ORCHESTRATORE] Errore durante l'inizializzazione:", err);
  }
}).catch((err) => {
  console.error("[ORCHESTRATORE] Impossibile avviare il runtime:", err);
});
