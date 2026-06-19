import { Servient } from "@node-wot/core";
import { MqttClientFactory, MqttBrokerServer } from "@node-wot/binding-mqtt";
import { HttpServer } from "@node-wot/binding-http";
import * as td from "../../tds/environmental-sensor.td.json";
import { createServer } from "http";
import { readFileSync } from "fs";
import { join } from "path";

/**
 * ============================================================================
 * NOTE DI STUDIO PER L'ESAME: CONCETTI DELLO STANDARD W3C WEB OF THINGS (WoT)
 * ============================================================================
 * 
 * 1. IL SERVIENT:
 *    Un "Servient" WoT è l'ambiente di runtime principale. Si tratta di un componente
 *    software a doppia responsabilità che funge sia da Server (per produrre/ospitare Thing)
 *    sia da Client (per consumare/interagire con Thing esterne).
 *    In questo codice instanziamo un `Servient` per produrre ed esporre il nostro sensore.
 * 
 * 2. PROTOCOL BINDINGS (Associazioni di Protocollo):
 *    Lo standard WoT è agnostico rispetto al protocollo di rete utilizzato. Il runtime core
 *    non conosce dettagli su HTTP, MQTT, CoAP o Modbus. Registriamo invece dei "Client Factory"
 *    e dei "Protocol Server" (binding) nel Servient. A runtime, il Servient seleziona 
 *    automaticamente il binding corretto analizzando lo schema URI indicato nel campo "href"
 *    dei form all'interno della Thing Description (es. "mqtt://", "http://").
 * 
 * 3. PRODUCING VS. CONSUMING (Produzione vs. Consumo):
 *    - Producer: Definisce una Thing Description (TD), istanzia un oggetto "ExposedThing",
 *                implementa la logica di lettura/scrittura ed espone il dispositivo in rete.
 *    - Consumer: Legge la TD da una risorsa remota, istanzia un "ConsumedThing" e interagisce
 *                con le sue proprietà, azioni o eventi.
 * 
 * 4. EXPOSED THING:
 *    Un ExposedThing è la rappresentazione a runtime del dispositivo fisico o virtuale locale.
 *    Una volta invocato il metodo `expose()`, il Servient avvia i server di protocollo configurati
 *    (es. si connette al broker MQTT o avvia un server HTTP) permettendo ai client di interagire.
 * 
 * ============================================================================
 */

// 1. Inizializza il Servient WoT
const servient = new Servient();

// 2. Configura l'URI del Broker MQTT
// Impostiamo come valore predefinito 'localhost' per uniformità con il resto della rete dei colleghi.
const MQTT_BROKER = process.env.MQTT_BROKER || "mqtt://localhost:1883";

// 3. Registra i componenti di binding per MQTT e HTTP
// - MqttClientFactory: Consente al Servient di agire come client MQTT per pubblicare
//   eventi o invocare interazioni su altre Thing connesse al broker.
// - MqttBrokerServer: Si connette al broker MQTT e registra i topic appropriati, in modo
//   che i consumatori esterni possano interagire con il nostro Exposed Thing tramite il broker.
// - HttpServer: Espone gli endpoint HTTP locali del Thing (permette di leggere la TD a
//   http://localhost:8080/greenhouse-environmental-sensor-01 ed effettuare chiamate HTTP).
servient.addClientFactory(new MqttClientFactory());
servient.addServer(new MqttBrokerServer({ uri: MQTT_BROKER }));
servient.addServer(new HttpServer({ port: 8080 }));

console.log(`[Servient] Inizializzazione del Servient WoT con Broker MQTT: ${MQTT_BROKER} e Server HTTP sulla porta 8080`);

// 4. Avvia il Servient
servient.start()
  .then(async (WoT) => {
    console.log("[Servient] Runtime WoT avviato con successo.");

    // 5. Clona e adatta la Thing Description (TD) in memoria
    // Questo ci permette di inserire dinamicamente l'indirizzo del broker MQTT configurato
    // all'interno dei form della TD, evitando di scriverlo fisicamente nel file JSON statico.
    const environmentalSensorTd = JSON.parse(JSON.stringify(td));
    const originalHref = environmentalSensorTd.events.environmentalData.forms[0].href;
    
    // Estrae il percorso del topic dall'href originale (es. "/greenhouse/sensors/environmental/data")
    const topicPath = new URL(originalHref).pathname;
    
    // Imposta l'URL del broker finale nel form della TD
    environmentalSensorTd.events.environmentalData.forms[0].href = `${MQTT_BROKER}${topicPath}`;
    
    console.log(`[Producer] Topic MQTT di destinazione: ${topicPath}`);
    console.log(`[Producer] Form Href: ${environmentalSensorTd.events.environmentalData.forms[0].href}`);

    try {
      // Variabili di stato locali per memorizzare le ultime misurazioni dei sensori.
      // Saranno lette dagli handler di lettura delle proprietà quando un client fa richieste HTTP.
      let latestTemperature = 22.5;
      let latestHumidity = 45.0;

      // 6. Crea la Exposed Thing
      // WoT.produce() accetta una Thing Description standard W3C valida e restituisce un oggetto ExposedThing.
      // Questo passaggio inizializza lo stato, il modello semantico e l'interfaccia del nostro sensore.
      const exposedThing = await WoT.produce(environmentalSensorTd);
      const tdDescription = exposedThing.getThingDescription();
      
      console.log(`[Producer] Creata Exposed Thing: "${tdDescription.title}" (${tdDescription.id})`);

      // Registra gli handler di lettura per le proprietà.
      // Vengono invocati automaticamente quando arrivano richieste HTTP GET agli endpoint delle proprietà.
      exposedThing.setPropertyReadHandler("temperature", async () => {
        return latestTemperature;
      });

      exposedThing.setPropertyReadHandler("humidity", async () => {
        return latestHumidity;
      });

      // 7. Espone la Thing in rete
      // Il metodo expose() attiva i server di protocollo (HTTP sulla porta 8080 e MQTT).
      await exposedThing.expose();
      console.log(`[Producer] La Exposed Thing "${tdDescription.title}" è online.`);
      console.log(`[Producer] -> Thing Description HTTP URL: http://localhost:8080/greenhouse-environmental-sensor`);
      console.log("==================================================");

      // Avvia un server web separato sulla porta 8081 per ospitare la dashboard HTML.
      // Questo consente all'utente di aprire http://localhost:8081/ direttamente nel browser,
      // aggirando le restrizioni CORS delle aperture locali (file://).
      const dashboardServer = createServer((req, res) => {
        let fileName = "";
        if (req.url === "/" || req.url === "/dashboard" || req.url === "/dashboard.html") {
          fileName = "dashboard.html";
        } else if (req.url === "/temperature" || req.url === "/temperature.html") {
          fileName = "temperature.html";
        } else if (req.url === "/humidity" || req.url === "/humidity.html") {
          fileName = "humidity.html";
        } else if (req.url === "/pump" || req.url === "/pump.html") {
          fileName = "pump.html";
        }

        if (fileName !== "") {
          try {
            const htmlPath = join(__dirname, fileName);
            const htmlContent = readFileSync(htmlPath, "utf-8");
            res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
            res.end(htmlContent);
          } catch (err) {
            res.writeHead(500);
            res.end(`Errore nel caricamento della pagina: ${fileName}`);
          }
        } else {
          res.writeHead(404);
          res.end("Pagina non trovata");
        }
      });

      dashboardServer.listen(8081, () => {
        console.log(`[Producer] -> Dashboard Web attiva a: http://localhost:8081/`);
        console.log("==================================================");
      });

      // Funzione di utilità per generare un numero casuale a virgola mobile in un intervallo specifico
      const generateRandom = (min: number, max: number): number => {
        return parseFloat((Math.random() * (max - min) + min).toFixed(2));
      };

      // 8. Loop di Invio dell'Evento (Configurabile via ambiente, default 10 secondi)
      // Gli eventi W3C WoT si basano su un meccanismo di push. Il Producer genera i dati e chiama
      // `emitEvent` per notificare i sottoscrittori. Sotto il cofano, node-wot utilizza il modulo
      // MqttClientFactory registrato per pubblicare questo payload sul topic del broker MQTT.
      const TELEMETRY_INTERVAL = Number(process.env.TELEMETRY_INTERVAL) || 10000;
      console.log(`[Producer] Avvio del loop periodico di misurazione dei dati ambientali (intervallo ${TELEMETRY_INTERVAL / 1000}s)...`);
      
      setInterval(async () => {
        // Genera letture realistiche per una serra:
        // - Temperatura: tra 20°C e 35°C (ambiente serra caldo)
        // - Umidità del suolo: tra 10% e 60%
        const currentTemperature = generateRandom(20.0, 35.0);
        const currentHumidity = generateRandom(10.0, 60.0);

        // Aggiorna le variabili di stato locali lette dagli handler HTTP delle proprietà
        latestTemperature = currentTemperature;
        latestHumidity = currentHumidity;

        // Prepara il payload strutturato esattamente come definito nello schema dell'evento nella TD
        const payload = {
          temperature: currentTemperature,
          humidity: currentHumidity
        };

        console.log(`[Sensor-Env] Nuova osservazione acquisita -> Temp: ${payload.temperature}°C, Umidità: ${payload.humidity}%`);

        try {
          // emitEvent(eventName, payload)
          // Questa chiamata standard W3C innesca l'emissione dell'evento 'environmentalData'.
          // node-wot associa l'evento alla definizione del form presente nella TD, serializza il payload
          // in formato JSON (application/json) e lo pubblica sul broker MQTT.
          await exposedThing.emitEvent("environmentalData", payload);
          console.log("[Sensor-Env] Evento 'environmentalData' pubblicato con successo sul broker.");
        } catch (err) {
          console.error("[Sensor-Env] Errore durante l'emissione dell'evento:", err);
        }
      }, TELEMETRY_INTERVAL);

    } catch (error) {
      console.error("[Producer] Impossibile creare/esporre la Thing:", error);
    }
  })
  .catch((err) => {
    console.error("[Servient] Impossibile avviare il Servient WoT:", err);
  });
