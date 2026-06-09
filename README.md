# 🧬 Bio-Lab — Evolution-Sim

Ein künstliches Ökosystem im Browser. Kleine Kreaturen mit eigenem **Genom** und
Mini-"Gehirn" schwimmen über den Bildschirm, suchen Futter, vermehren sich und
**mutieren**. Niemand sagt ihnen, wie sie sich verhalten sollen — über Generationen
setzt sich durch, was überlebt. Reine Evolution in Echtzeit, eine einzige HTML-Datei,
keine Installation.

## Starten

`index.html` im Browser öffnen. Fertig.

## Was passiert da?

Jede Kreatur trägt ein Genom mit vererbbaren Eigenschaften:

| Gen | Wirkung |
|-----|---------|
| `speed` | Maximalgeschwindigkeit |
| `size` | Körpergröße (größer = mehr Energiebedarf) |
| `sense` | Sichtweite für Futter & Artgenossen |
| `foodDrive` | wie stark Futter anzieht |
| `social` | Anziehung (+) oder Abstoßung (−) zu Artgenossen → Schwärme |
| `metabolism` | Energieverbrauch |
| `efficiency` | Futterverwertung |
| `hue` | Farbe — wird vererbt, dadurch werden **Sippen sichtbar** |

Wer genug Energie sammelt, pflanzt sich fort und gibt sein (leicht mutiertes) Genom
weiter. Wer verhungert, stirbt und wird zu Futter. Der Rest ist Selektion.

## Steuerung

- **Klicken / Ziehen** — Futter spawnen
- **🌱 Futter** — Futter-Boost
- **☄️ Meteor** — Katastrophe: tötet ~60 % der Population und erzeugt Selektionsdruck
- **🧬 Mutation+** — Mutationsrate hochdrehen (×1 → ×2 → ×4)
- **Slider** — Zeit beschleunigen (🐢 ↔ ⚡), um Evolution im Zeitraffer zu sehen
- **⏸ / ↻** — Pause / Neustart

## Beobachten lohnt sich

Dreh die Zeit hoch und schau auf die Statistik **„Ø Speed-Gen"**: Bei viel Futter
tendiert die Population oft zu kleineren, sparsamen Kreaturen — nach einem Meteor
gewinnen plötzlich schnelle, weitsichtige Typen. Gleiche Farben = verwandte Sippen.
