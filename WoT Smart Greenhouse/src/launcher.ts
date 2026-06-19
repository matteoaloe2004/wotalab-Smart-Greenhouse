/**
 * ============================================================================
 * PROGETTO ESAME: SERRA INTELLIGENTE WoT - LAUNCHER UNIFICATO
 * ============================================================================
 * Questo script consente di avviare contemporaneamente sia il sensore ambientale
 * (con la dashboard integrata) sia l'attuatore della pompa di irrigazione.
 * 
 * Entrambi i componenti girano su porte HTTP differenti (8080/8081 e 8082),
 * permettendo l'esecuzione in parallelo senza conflitti nello stesso processo Node.js.
 */

console.log("====================================================================");
console.log("AVVIO UNIFICATO DEL SISTEMA SERRA INTELLIGENTE (W3C Web of Things)");
console.log("====================================================================");

// Importiamo e avviamo i due moduli produttori (Sensore e Pompa)
import "./things/sensor-env/index";
import "./things/actuator-pump/index";

// Avviamo l'orchestratore (Gateway Consumer) dopo 1.5 secondi per dare il tempo
// ai server HTTP e MQTT di completare l'inizializzazione.
setTimeout(() => {
  console.log("\n[Launcher] Inizializzazione Gateway / Orchestratore in corso...");
  import("./gateway");
}, 1500);
