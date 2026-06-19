# Progetto
Gestione intelligente di una serra tramite Web of Things

## Partecipanti
Gruppo: C

Matteo Aloè - matteo.aloe3@studio.unibo.it
Elia Strazzella - Elia.strazzella@studio.unibo.it

---

## Idea generale del progetto
Il progetto ha come obiettivo la realizzazione di un sistema Web of Things (WoT) per il monitoraggio e la gestione intelligente di una serra agricola (Smart Greenhouse), con particolare attenzione al benessere termico e idrico delle coltivazioni e all'ottimizzazione dell'irrigazione per prevenire sprechi d'acqua.

L’idea è modellare i componenti della serra come Thing WoT, descritte tramite modelli semantici standardizzati, che permettano di osservare lo stato dell’ambiente in tempo reale e di attuare azioni correttive automatiche in base a regole dinamiche e proporzionali.

---

## Contesto e scenario
Il sistema rappresenta una serra dotata di sensori per il monitoraggio ambientale e di un attuatore (pompa dell'acqua), in grado di reagire a variazioni di:
* **temperatura dell'aria**
* **umidità del suolo**

Queste informazioni vengono utilizzate dall'orchestratore per prendere decisioni automatiche sulla durata dell'irrigazione, simulando un sistema industriale agricolo moderno ad alta efficienza.

---

## Thing WoT previste
Il progetto prevede la creazione delle seguenti Thing:

### 1. Sensore Ambientale (Environmental Sensor)
Rappresenta le condizioni climatiche e di salute del suolo all'interno della serra, esponendo le proprietà di:
* **Temperatura dell'aria** (in °C)
* **Umidità del suolo** (in % di umidità relativa)

### 2. Pompa di Irrigazione (Irrigation Pump Actuator)
Rappresenta l'attuatore fisico incaricato di distribuire l'acqua alle piante. Consente di:
* Monitorare lo stato di attività della pompa (**SPENTA / ATTIVA**).
* Invocare l'azione di accensione della pompa con una durata specificata.
* **Sicurezza attiva**: Trattandosi di un attuatore critico, l'accesso alle sue funzionalità è protetto tramite **Bearer Token (API Key)**.

---

## Relazioni e logica di funzionamento
Le Thing sono collegate e coordinate da un Gateway centrale che implementa una logica di controllo a ciclo chiuso proporzionale:

### Soglia Critica e Controllo Proporzionale
Quando l'umidità del suolo scende sotto il livello limite del **30%**, l'orchestratore decide di attivare l'irrigazione. Per ottimizzare l'uso dell'acqua, la durata del ciclo di irrigazione è calcolata in modo dinamico e proporzionale in base al deficit di umidità rilevato:
* **Umidità tra 25% e 29.9%**: Irrigazione leggera (**5 secondi**) per ripristinare piccoli scostamenti.
* **Umidità tra 20% e 24.9%**: Irrigazione media (**10 secondi**).
* **Umidità tra 15% e 19.9%**: Irrigazione profonda (**20 secondi**).
* **Umidità inferiore a 15%**: Stato critico di siccità, irrigazione intensa (**30 secondi**).

### Sicurezza e Autorizzazione dell'Azione
Per evitare attivazioni accidentali o attacchi maliziosi, l'azione `turnOnPump` dell'attuatore risponde con un codice HTTP `401 Unauthorized` se non viene trasmesso nell'header HTTP la chiave di sicurezza autorizzata (`Authorization: Bearer chiave-segreta-pompa`).

---

## Flusso di Esecuzione e Architettura del Sistema
Il sistema implementa lo standard W3C Web of Things (WoT) per far comunicare i dispositivi IoT usando sia il protocollo HTTP (per letture di proprietà e azioni) sia il protocollo MQTT (per la telemetria periodica). Ogni sensore e attuatore è interamente descritto da una **Thing Description (TD) in JSON-LD**, che specifica capacità, endpoint e requisiti di sicurezza.

L'infrastruttura si basa sul concetto di **Servient**, un runtime WoT a doppia responsabilità (Producer e Consumer):
* **Environmental Sensor (Producer)**: Espone i dati in tempo reale su server HTTP (porta 8080) e pubblica in modalità Pub/Sub la telemetria sul broker MQTT ogni 10 secondi.
* **Irrigation Pump (Producer)**: Espone lo stato e l'azione tramite un server HTTP protetto sulla porta 8082.
* **Gateway Orchestrator (Consumer)**: Il "cervello" della serra. Si sottoscrive al broker MQTT del sensore, riceve i dati, applica la logica proporzionale ed invia le richieste HTTP POST di irrigazione all'attuatore autenticandosi col token.

Ecco l'architettura completa delle interazioni:

```mermaid
graph TD
    %% Nodi Principali
    subgraph Host Browser
        DB[Dashboard Web & Console - Port 8081]
    end

    subgraph Docker Containers
        subgraph MQTT Container
            Broker[(Mosquitto Broker<br>Port 1883)]
        end

        subgraph Application Container
            Sensor[Exposed Thing: Environmental Sensor<br>Port 8080]
            Pump[Exposed Thing: Irrigation Pump<br>Port 8082<br>Security: Bearer Token]
            Gateway[WoT Consumer: Gateway Orchestrator]
        end
    end

    %% Flussi di Comunicazione
    Sensor -- 1. Pubblica Telemetria ad intervalli --> Broker
    Gateway -- 2. Sottoscrizione Eventi MQTT --> Broker
    Gateway -- 3. Lettura TD via HTTP --> Sensor
    Gateway -- 4. Lettura TD via HTTP --> Pump
    Gateway -- 5. Comando HTTP POST turnOnPump con Token --> Pump
    
    DB -- A. Polling HTTP dei dati --> Sensor
    DB -- B. Polling HTTP dello stato pompa --> Pump
    DB -- C. Azione manuale HTTP POST con Token --> Pump
```

---

## L'Ontologia Semantica
L'architettura del sistema affianca al livello operativo un livello semantico mappando le definizioni all'interno delle Thing Descriptions (.td.json) su standard del W3C/ETSI:
* **SOSA (Sensor, Observation, Sample, and Actuator)**: usato per dichiarare a un livello astratto se un nodo sta compiendo osservazioni sull'ambiente (`sosa:ObservableProperty` per temperatura e umidità) o ne sta alterando lo stato (`sosa:Actuator` per la pompa).

L'esposizione semantica permette una totale **Interoperabilità Esterna (Dynamic Discovery)**. Un hub domotico o industriale universale di terze parti, leggendo le Thing Descriptions, comprenderebbe immediatamente il ruolo e i canali di comunicazione di ogni dispositivo grazie ai tag standard SOSA, integrandoli nel proprio ecosistema in modo del tutto agnostico.

---

## Stack Tecnologico
| Livello | Tecnologie |
| :--- | :--- |
| **Backend / WoT Runtime** | Node.js, TypeScript, `@node-wot/core`, `@node-wot/binding-http`, `@node-wot/binding-mqtt` |
| **Frontend / Dashboard** | HTML5, CSS3 Vanilla (design moderno glassmorphic), JavaScript ES6, Chart.js |
| **Broker Messaggi** | Eclipse Mosquitto (MQTT) |
| **Containerizzazione** | Docker, Docker Compose |

---

## Interfaccia Utente (Dashboard)
Il sistema integra una piattaforma web (attiva sulla porta 8081) che offre un punto di controllo centralizzato per l'intero ambiente. La dashboard consente all'utente di:
* **Monitorare in tempo reale** lo stato dei sensori e della pompa.
* **Visualizzare lo storico FIFO** delle ultime 5 letture ricevute.
* **Eseguire l'override manuale** per forzare l'irrigazione selezionando la durata.
* **Console Interattive dei Singoli Endpoint**: Cliccando sulle card si accede a pagine dedicate per ciascuna proprietà:
  * **/temperature e /humidity**: mostrano un grafico live Chart.js delle letture e i dettagli del relativo endpoint WoT.
  * **/pump**: una console di controllo protetta. Richiede all'utente di inserire il Bearer Token (`chiave-segreta-pompa`). Se il token è valido, si sblocca il controllo manuale con un log di audit locale delle ultime attivazioni effettuate.

---

## Come avviare il progetto
L'intero sistema è containerizzato per consentire una portabilità totale ed un avvio istantaneo.

### Requisiti
* Docker e Docker Compose installati sul computer.

### Procedura di avvio
1. Posizionarsi nella directory principale del progetto (dove è presente il file `docker-compose.yml`) e lanciare la compilazione e l'avvio dei container:
   ```bash
   docker-compose up --build
   ```
2. Ad avvio completato, aprire il browser e visitare l'indirizzo:
   `http://localhost:8081/`
3. Per testare la console protetta della pompa di irrigazione, cliccare sulla card della pompa ed inserire il token di sicurezza: `chiave-segreta-pompa`.
