# 🌍 GENESIS — Du bist Gott

Eine lebende Welt im Browser. Menschen mit Gedanken, Erinnerungen, Beziehungen und
Tatendrang bauen Dörfer, verlieben sich, bekommen Kinder, erkranken, verbreiten
**Verschwörungstheorien** — und führen Kriege. Ihre Gedanken, Dialoge und großen
Entscheidungen kommen aus **deinem lokalen Ollama-Modell**. Du schaust zu, oder du
greifst ein. Du bist Gott. 👁️

## Schnellstart

```bash
# 1. Ollama muss laufen (mit irgendeinem Modell, z.B. einem 3B):
ollama serve

# 2. Im Projektordner einen Mini-Webserver starten:
python3 -m http.server 8000

# 3. Im Browser öffnen:
#    http://localhost:8000
```

> **Wichtig:** Die Seite muss über `http://localhost:8000` laufen (nicht als Datei
> geöffnet werden), sonst blockiert Ollama die Anfragen aus dem Browser.
> Ohne KI-Verbindung läuft die Welt trotzdem — mit einfachen Ersatz-Gedanken.

Alternativ: `./start.sh` (Linux/Mac) oder `start.bat` (Windows).

## Wie die Welt funktioniert

### Zwei Schichten

- **Welt-Engine** (regelbasiert, immer flüssig): Hunger, Schlaf, Arbeit, Bauen,
  Ansteckung, Kämpfe, Geburt, Tod — die Physik der Welt.
- **KI-Schicht** (dein lokales Modell, mit Prioritäts-Warteschlange): alles
  *Menschliche* — innere Monologe, Dialoge, Kriegsentscheidungen der Anführer,
  und die Texte der Gerüchte. KI-generierte Gedanken erkennst du am ✨.

### Der Lauf der Dinge

1. **Urknall:** 8 Fremde betreten die prozedural generierte Insel und suchen
   einen guten Siedlungsplatz (Wasser, Wald, fruchtbares Land).
2. **Aufbau:** Sie sammeln, bauen Hütten → Farmen → Brunnen → Heilerhütte →
   Tempel. Jobs werden nach Talent verteilt (Sammler, Holzfäller, Bauer,
   Baumeister, Heiler, Wache, Priester, Anführer).
3. **Leben:** Beim Reden entstehen Freundschaften und Feindschaften. Paare
   verlieben sich, Kinder werden geboren, Generationen vergehen.
4. **Spaltung:** Wird ein Dorf zu groß, zieht ein Ehrgeiziger mit Gefolgsleuten
   aus und gründet ein neues — Fraktionen entstehen.
5. **Konflikt:** Grenzzwischenfälle, Neid und Gerüchte vergiften die Beziehungen
   zwischen Dörfern. Fällt das Verhältnis tief genug, entscheidet der Anführer
   (per KI!) über Krieg: Überfall, Beute, brennende Gebäude, Tote — und
   Rache-Gerüchte, die den nächsten Krieg säen.
6. **Verschwörungstheorien:** Seuchen, Dürren, Todesfälle erzeugen Gerüchte
   („*Die aus Süddorf haben den Brunnen vergiftet…*"). Sie wandern von Gespräch
   zu Gespräch, Abergläubische glauben alles, Skeptiker wenig — und
   Schuldzuweisungen können echte Kriege auslösen.

### Du bist Gott

| Werkzeug | Wirkung |
|---|---|
| 👁️ **Flüstern** | Der ausgewählten Person einen Gedanken einpflanzen — sie reagiert per KI und erzählt es vielleicht weiter |
| ☄️ **Meteor** | Einschlag auf Klick: Tote, zerstörte Gebäude, verbrannter Wald — und Legenden |
| ⚡ **Blitz** | Eine Person aus heiterem Himmel erschlagen („die Götter zürnen!") |
| 🦠 **Seuche** | Krankheitsausbruch, der sich von Mensch zu Mensch frisst |
| ☀️ **Dürre** | Beeren und Ernten verdorren — Hunger macht Dörfer aggressiv |
| 🔮 **Prophet** | Jemand bekommt eine Vision und verbreitet sie als Glaubenslehre |

Klicke auf jeden Menschen: aktueller Gedanke, Bedürfnisse, Beziehungen,
Erinnerungen, Glauben. Klicke auf ein Dorf: Vorräte, Gebäude, Verhältnis zu den
Nachbarn. Links läuft die **Chronik der Welt** mit. Zeitraffer bis 16×.

## Technik

- Reines HTML/JS/Canvas, keine Dependencies, kein Build-Schritt.
- KI über die OpenAI-kompatible API (`/v1/chat/completions`) — funktioniert mit
  **Ollama** und **LM Studio** (URL im ⚙️-Dialog einstellbar, oben rechts).
- Die Warteschlange priorisiert: Gottes Flüstern > Dialoge/Entscheidungen >
  Gedanken/Gerüchte. Bei Überlast greifen regelbasierte Fallbacks — die Welt
  wartet nie auf die KI.

## Test

```bash
node test/smoke.mjs   # 20 Tage Headless-Simulation mit Plausibilitäts-Checks
```
