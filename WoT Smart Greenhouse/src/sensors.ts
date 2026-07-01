import { Servient } from "@node-wot/core";
import { MqttClientFactory, MqttBrokerServer } from "@node-wot/binding-mqtt";
import { HttpServer } from "@node-wot/binding-http";
import * as td from "./td/environmental-sensor.td.json";
import { createServer } from "http";
import { readFileSync } from "fs";
import { join } from "path";

// Inizializza il Servient WoT per il sensore
const servient = new Servient();

// Configura il broker MQTT (usa localhost se non diversamente specificato)
const MQTT_BROKER = process.env.MQTT_BROKER || "mqtt://localhost:1883";

servient.addClientFactory(new MqttClientFactory());
servient.addServer(new MqttBrokerServer({ uri: MQTT_BROKER }));
servient.addServer(new HttpServer({ port: 8080 }));

console.log(`[SENSORE] Avvio con Broker MQTT: ${MQTT_BROKER} e Server HTTP sulla porta 8080`);

servient.start().then(async (WoT) => {
  // Clona la descrizione del sensore per inserire dinamicamente l'URL del broker MQTT configurato
  const environmentalSensorTd = JSON.parse(JSON.stringify(td));
  const originalHref = environmentalSensorTd.events.environmentalData.forms[0].href;
  const topicPath = new URL(originalHref).pathname;
  environmentalSensorTd.events.environmentalData.forms[0].href = `${MQTT_BROKER}${topicPath}`;

  try {
    // Variabili per mantenere i dati dei sensori e la configurazione della serra
    let latestTemperature = 22.5;
    let latestHumidity = 45.0;
    let activeGreenhouse = "tropical";

    // Produce il Thing del sensore
    const exposedThing = await WoT.produce(environmentalSensorTd);

    // Gestori di lettura per le proprietà
    exposedThing.setPropertyReadHandler("temperature", async () => latestTemperature);
    exposedThing.setPropertyReadHandler("humidity", async () => latestHumidity);
    exposedThing.setPropertyReadHandler("activeGreenhouse", async () => activeGreenhouse);

    // Gestore di scrittura per cambiare tipo di serra
    exposedThing.setPropertyWriteHandler("activeGreenhouse", async (val) => {
      const newVal = await val.value() as string;
      if (newVal === "tropical" || newVal === "desert") {
        activeGreenhouse = newVal;
        console.log(`[SENSORE] Tipo di serra modificato a: ${activeGreenhouse.toUpperCase()}`);
        return undefined;
      }
      throw new Error("Tipo di serra non supportato.");
    });

    // Espone il Thing in rete
    await exposedThing.expose();
    console.log(`[SENSORE] Thing "${environmentalSensorTd.title}" online su HTTP e MQTT.`);

    // Server web separato sulla porta 8081 per mostrare la Dashboard HTML
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
          const htmlPath = join(__dirname, "dashboard", fileName);
          const htmlContent = readFileSync(htmlPath, "utf-8");
          res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
          res.end(htmlContent);
        } catch (err) {
          res.writeHead(500);
          res.end(`Errore caricamento pagina: ${fileName}`);
        }
      } else {
        res.writeHead(404);
        res.end("Pagina non trovata");
      }
    });

    dashboardServer.listen(8081, () => {
      console.log("[SENSORE] Dashboard Web attiva a: http://localhost:8081/");
    });

    // Loop periodico per la generazione e pubblicazione dei dati simulati (default: 15 secondi)
    const TELEMETRY_INTERVAL = Number(process.env.TELEMETRY_INTERVAL) || 15000;

    setInterval(async () => {
      // Generazione dati in base alla serra attiva
      if (activeGreenhouse === "tropical") {
        // Serra Tropicale: più umida e con temperature moderate
        latestTemperature = parseFloat((Math.random() * 8 + 24).toFixed(2)); // Tra 24°C e 32°C
        latestHumidity = parseFloat((Math.random() * 25 + 25).toFixed(2));    // Tra 25% e 50%
      } else {
        // Serra Desertica: molto calda e arida
        latestTemperature = parseFloat((Math.random() * 10 + 28).toFixed(2)); // Tra 28°C e 38°C
        latestHumidity = parseFloat((Math.random() * 20 + 12).toFixed(2));    // Tra 12% e 32%
      }

      const payload = {
        temperature: latestTemperature,
        humidity: latestHumidity
      };

      console.log(`[SENSORE] Rilevamento (${activeGreenhouse.toUpperCase()}) -> Temp: ${payload.temperature}°C, Umidità: ${payload.humidity}%`);

      try {
        // Pubblica i dati su MQTT tramite l'evento
        await exposedThing.emitEvent("environmentalData", payload);
      } catch (err) {
        console.error("[SENSORE] Errore pubblicazione evento MQTT:", err);
      }
    }, TELEMETRY_INTERVAL);

  } catch (error) {
    console.error("[SENSORE] Impossibile creare o esporre il Thing del sensore:", error);
  }
}).catch((err) => {
  console.error("[SENSORE] Errore all'avvio del Servient dei sensori:", err);
});
