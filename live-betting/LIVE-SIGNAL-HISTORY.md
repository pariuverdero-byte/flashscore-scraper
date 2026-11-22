# Istoricul semnalelor afișate

Scriptul citește feedul public al paginii Live, fără autentificare. Înregistrează separat fiecare interval vizibil pe fiecare site. Păstrează minutul, scorul și statisticile observate prima dată, încrederea, cota minimă recomandată, ultima observare și primul instantaneu în care semnalul lipsește. Orele sunt UTC. Instantaneele repetate sunt ignorate.

Rezultatul este verificat separat în Flashscore pentru timpul regulamentar. Un semnal dispărut rămâne în așteptare până la un final confirmat. Pentru „următorul gol”, ordinea ambiguă rămâne neconfirmată, iar absența oricărui gol ulterior are o stare proprie. Pentru cornere, scriptul așteaptă o statistică finală explicită. Înregistrările nerezolvate după 48 de ore sunt marcate ca neconfirmate. La calibrare, analizează site-urile separat sau deduplică semnalele comune.

Intervalele descriu observarea la frecvența de colectare. Un semnal care apare și dispare între două colectări poate lipsi din jurnal, iar primul scor observat poate fi ulterior emiterii efective.

## Rulare pe hosting

Pune checkout-ul repository-ului într-un director privat, cu Node.js 20.18.1+ și dependențele instalate prin `npm install --omit=dev`. Alege o cale absolută privată pentru fișierul persistent JSON, în afara checkout-ului și a directoarelor publice. Testează scriptul o dată din terminal.

```sh
LIVE_SIGNAL_LOG_FILE="$HOME/live-signal-history.json" node live-betting/scripts/log-published-signals.js
```

Adaugă o singură intrare cron la cinci minute, cu blocare prin `flock`. Înlocuiește căile către Node și checkout cu cele de pe server.

```cron
*/5 * * * * LIVE_SIGNAL_LOG_FILE=/home/bizyouri/live-signal-history.json /usr/bin/flock -n /home/bizyouri/live-signal-history.lock /cale/absoluta/node /cale/privata/flashscore-scraper/live-betting/scripts/log-published-signals.js >> /home/bizyouri/live-signal-history.log 2>&1
```

Pentru a colecta un singur site, adaugă `pariuverde.ro` sau `greenbettips.com` după calea scriptului și înaintea redirecționării. Colectorul nu pornește workflow-uri GitHub.
