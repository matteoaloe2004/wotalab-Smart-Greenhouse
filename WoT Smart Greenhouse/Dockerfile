# Usa un'immagine ufficiale di Node.js come base (versione leggera Alpine)
FROM node:20-alpine

# Imposta la directory di lavoro nel container
WORKDIR /usr/src/app

# Copia i file di configurazione per l'installazione delle dipendenze
COPY package*.json tsconfig.json ./

# Installa le dipendenze (incluse le devDependencies necessarie per la compilazione tsc)
RUN npm ci

# Copia il codice sorgente dell'applicazione
COPY src ./src

# Compila il codice TypeScript in JavaScript
RUN npm run build

# Copia i file HTML della dashboard nella directory di produzione 'dist'.
RUN mkdir -p dist/dashboard && cp src/dashboard/*.html dist/dashboard/

# Rimuove le dipendenze di sviluppo (devDependencies) per ridurre la dimensione del container
RUN npm prune --production

# Espone le porte utilizzate dai nodi della serra
# - 8080: Endpoint HTTP del Sensore Ambientale
# - 8081: Server HTTP della Dashboard Web
# - 8082: Endpoint HTTP della Pompa di Irrigazione (con sicurezza attiva)
EXPOSE 8080
EXPOSE 8081
EXPOSE 8082

# Variabile d'ambiente di default per il broker MQTT (verrà sovrascritta da docker-compose)
ENV MQTT_BROKER=mqtt://localhost:1883

# Avvia l'applicazione usando il launcher unificato compilato in JavaScript
CMD ["npm", "run", "start:prod"]
