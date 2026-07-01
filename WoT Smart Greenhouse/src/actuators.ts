import { Servient } from "@node-wot/core";
import { HttpServer } from "@node-wot/binding-http";
import * as td from "./td/pump-actuator.td.json";

// Inizializza il Servient WoT per l'attuatore della pompa
const servient = new Servient();

// Aggiunge il server HTTP sulla porta 8082 con sicurezza Bearer
const httpServer = new HttpServer({ 
  port: 8082,
  security: [
    { scheme: "bearer" }
  ]
});

// Patch per risolvere un bug di node-wot nella validazione del token Bearer (case sensitivity)
const originalCheckCredentials = (httpServer as any).checkCredentials.bind(httpServer);
(httpServer as any).checkCredentials = async (thing: any, req: any) => {
  const selected = thing.security[0];
  const schemeDef = thing.securityDefinitions[selected];
  const originalScheme = schemeDef.scheme;
  if (originalScheme === "bearer") {
    schemeDef.scheme = "Bearer";
  }
  try {
    return await originalCheckCredentials(thing, req);
  } finally {
    schemeDef.scheme = originalScheme;
  }
};

servient.addServer(httpServer);

// Definisce la chiave segreta (token Bearer) per l'accesso protetto all'attuatore
servient.addCredentials({
  "urn:dev:wot:greenhouse-irrigation-pump-01": {
    token: "chiave-segreta-pompa"
  }
});

// Variabili per memorizzare lo stato reale degli attuatori
let pumpRunning = false;
let pumpTimeout: NodeJS.Timeout | null = null;

servient.start().then(async (WoT) => {
  try {
    // Produce il Thing della pompa a partire dal file di descrizione JSON-LD
    const exposedThing = await WoT.produce(td as any);
    
    // Gestore per leggere lo stato attuale della pompa
    exposedThing.setPropertyReadHandler("pumpStatus", async () => {
      console.log(`[ATTUATORE] Lettura stato pompa: ${pumpRunning ? "ATTIVO" : "SPENTO"}`);
      return pumpRunning;
    });

    // Gestore per attivare la pompa
    exposedThing.setActionHandler("turnOnPump", async (params) => {
      // Estrae la durata dall'input
      const inputData = await params.value();
      const duration = Number(inputData);

      if (isNaN(duration) || duration <= 0) {
        throw new Error("Durata di irrigazione non valida.");
      }

      console.log(`[ATTUATORE] Ricevuto comando: avvio pompa per ${duration} secondi.`);

      // Se la pompa è già attiva, rifiuta il comando per evitare attivazioni concorrenti
      if (pumpRunning) {
        console.log("[ATTUATORE] Rifiutato comando avvio: la pompa è già attiva.");
        throw new Error("La pompa è già attiva.");
      }

      pumpRunning = true;
      console.log("[ATTUATORE] >>> POMPA ACCESA (irrigazione in corso) <<<");

      // Spegnimento automatico al termine della durata impostata
      pumpTimeout = setTimeout(() => {
        pumpRunning = false;
        pumpTimeout = null;
        console.log("[ATTUATORE] >>> POMPA SPENTA (irrigazione terminata) <<<");
      }, duration * 1000);

      return undefined;
    });

    // Espone l'attuatore sulla porta 8082
    await exposedThing.expose();
    console.log("Attuatore Pompa pronto su http://localhost:8082/greenhouse-irrigation-pump");
  } catch (error) {
    console.error("Errore durante la creazione del Thing della pompa:", error);
  }
}).catch((err) => {
  console.error("Errore durante l'avvio del Servient degli attuatori:", err);
});
