import { Servient } from "@node-wot/core";
import { HttpServer } from "@node-wot/binding-http";
import * as td from "../../tds/pump-actuator.td.json";

/**
 * ============================================================================
 * PROGETTO ESAME: SERRA INTELLIGENTE WoT - ATTUATORE POMPA DI IRRIGAZIONE (HTTP)
 * ============================================================================
 * Questo script implementa il secondo componente del nostro sistema IoT:
 * un attuatore per la pompa di irrigazione controllato tramite HTTP.
 * 
 * STANDARD W3C WEB OF THINGS (WoT):
 * - È definito semanticamente come un Actuator ("@type": "sosa:Actuator").
 * - Espone una Proprietà di sola lettura: 'pumpStatus' (stato di funzionamento).
 * - Espone un'Azione: 'turnOnPump' per attivare l'irrigazione per una durata specifica.
 * - Integra la sicurezza tramite token Bearer (usato come API Key).
 */

// 1. Configurazione del Servient WoT
// Il Servient è il runtime centrale di Node-WoT che ospita e gestisce i protocolli.
const servient = new Servient();

const httpServer = new HttpServer({ 
  port: 8082,
  security: [
    { scheme: "bearer" }
  ]
});

// WORKAROUND BUG DI @node-wot/binding-http:
// La libreria @node-wot/binding-http presenta una discrepanza di maiuscole/minuscole:
// - Il costruttore accetta solo la stringa minuscola "bearer" per configurare la sicurezza.
// - Il validatore delle credenziali (checkCredentials) controlla invece la stringa con iniziale maiuscola "Bearer".
// Questo provoca un blocco permanente di tutte le richieste con errore 401 Unauthorized.
// Per risolvere questo bug senza modificare i file in node_modules, applichiamo un "monkey-patch"
// temporaneo che mappa "bearer" in "Bearer" durante il controllo di sicurezza.
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

// 2. Configurazione e Registrazione della Sicurezza (API Key / Bearer Token)
// Nello standard W3C WoT, i meccanismi di sicurezza sono dichiarati nella Thing Description (TD).
// Node-WoT supporta nativamente la convalida di questi meccanismi tramite il registro delle credenziali.
// Registrando qui il token Bearer per l'ID della nostra pompa, l'HTTP Server di Node-WoT convaliderà
// automaticamente che ogni richiesta HTTP in entrata includa l'header:
// "Authorization: Bearer chiave-segreta-pompa"
// Se l'header manca o è errato, il server risponderà automaticamente con un codice HTTP "401 Unauthorized".
servient.addCredentials({
  "urn:dev:wot:greenhouse-irrigation-pump-01": {
    token: "chiave-segreta-pompa"
  }
});

console.log("[Servient] Inizializzazione dell'Attuatore Pompa di Irrigazione con Sicurezza Bearer...");

// Stato interno dell'attuatore (mock hardware della pompa)
let pumpRunning = false;
let pumpTimeout: NodeJS.Timeout | null = null;

// 3. Avvio del Servient e Produzione del Thing
servient.start()
  .then(async (WoT) => {
    console.log("[Servient] Runtime WoT avviato con successo.");

    try {
      // 4. Crea la Exposed Thing
      // WoT.produce() crea la rappresentazione software della pompa partendo dal modello TD JSON-LD.
      const exposedThing = await WoT.produce(td as any);
      const tdDescription = exposedThing.getThingDescription();

      console.log(`[Producer] Creata Exposed Thing: "${tdDescription.title}" (${tdDescription.id})`);

      // 5. Registrazione dell'Handler di Lettura della Proprietà "pumpStatus"
      // Questo blocco viene eseguito ogni volta che un client esegue una GET HTTP all'indirizzo:
      // http://localhost:8082/greenhouse-irrigation-pump/properties/pumpStatus
      exposedThing.setPropertyReadHandler("pumpStatus", async () => {
        console.log(`[Actuator-Pump] Richiesta lettura 'pumpStatus' ricevuta. Stato attuale: ${pumpRunning ? "ATTIVO" : "SPENTO"}`);
        return pumpRunning;
      });

      // 6. Registrazione dell'Handler dell'Azione "turnOnPump"
      // Questo blocco viene eseguito ogni volta che un client esegue una POST HTTP all'indirizzo:
      // http://localhost:8082/greenhouse-irrigation-pump/actions/turnOnPump
      // Il body della richiesta deve contenere il parametro in secondi (es. 10).
      exposedThing.setActionHandler("turnOnPump", async (params) => {
        // Estraiamo il parametro di input dall'oggetto InteractionOutput ricevuto.
        // Poiché nello standard W3C WoT l'input dell'azione è veicolato come InteractionOutput,
        // è necessario attendere la risoluzione asincrona tramite il metodo .value() per ottenerne il valore reale.
        const inputData = await params.value();
        const duration = Number(inputData);

        // Validazione dei parametri di input
        if (isNaN(duration) || duration <= 0) {
          throw new Error("Durata di attivazione non valida. Fornire un valore numerico superiore a zero.");
        }

        console.log(`\n==================================================`);
        console.log(`[Actuator-Pump] >>> AZIONE RICEVUTA: Avvio pompa per ${duration} secondi.`);
        console.log(`==================================================`);

        // Se la pompa è già attiva, annulliamo il timer di spegnimento precedente per estendere la durata
        if (pumpRunning && pumpTimeout) {
          clearTimeout(pumpTimeout);
          console.log("[Actuator-Pump] Pompa già in funzione. Reimpostazione del timer di spegnimento.");
        }

        // Accendiamo la pompa virtuale
        pumpRunning = true;
        console.log("[Hardware-Pump] [=== ACQUA ATTIVATA ===] L'irrigazione della serra è in corso...");

        // Impostiamo il timer per lo spegnimento automatico al termine della durata specificata
        pumpTimeout = setTimeout(() => {
          pumpRunning = false;
          pumpTimeout = null;
          console.log(`\n==================================================`);
          console.log("[Hardware-Pump] [=== ACQUA DISATTIVATA ===] Spegnimento automatico della pompa.");
          console.log(`==================================================`);
        }, duration * 1000);

        return undefined; // Restituisce undefined per soddisfare la firma dei tipi WoT.ActionHandler
      });

      // 7. Esposizione della Thing sulla rete
      // Attiva il server HTTP sulla porta 8082 per accettare le richieste esterne.
      await exposedThing.expose();
      
      console.log(`[Producer] La Exposed Thing "${tdDescription.title}" è online.`);
      console.log(`[Producer] -> Thing Description HTTP URL: http://localhost:8082/greenhouse-irrigation-pump`);
      console.log(`[Producer] -> Azione TurnOnPump: POST http://localhost:8082/greenhouse-irrigation-pump/actions/turnOnPump`);
      console.log(`[Producer] -> Proprietà pumpStatus: GET http://localhost:8082/greenhouse-irrigation-pump/properties/pumpStatus`);
      console.log(`[Producer] [Sicurezza attiva]: È necessario includere l'header 'Authorization: Bearer chiave-segreta-pompa' nelle richieste.`);
      console.log("==================================================");

    } catch (error) {
      console.error("[Producer] Impossibile creare o esporre la Thing:", error);
    }
  })
  .catch((err) => {
    console.error("[Servient] Errore critico all'avvio del Servient WoT:", err);
  });
