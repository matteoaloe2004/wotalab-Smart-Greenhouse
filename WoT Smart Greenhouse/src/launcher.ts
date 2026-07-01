// Launcher unificato per avviare sensori, attuatori e orchestratore

console.log("====================================================================");
console.log("AVVIO DEL SISTEMA SERRA INTELLIGENTE (WoT)");
console.log("====================================================================");

// Avvia i due moduli Thing (Sensori e Attuatori)
import "./sensors";
import "./actuators";

// Avvia l'orchestratore dopo 1.5 secondi per dare tempo ai nodi di inizializzarsi
setTimeout(() => {
  console.log("\n[Launcher] Avvio dell'Orchestratore...");
  import("./orchestrator");
}, 1500);
