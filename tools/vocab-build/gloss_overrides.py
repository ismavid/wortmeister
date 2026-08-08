#!/usr/bin/env python3
"""Hand-written glosses for entries where Wiktionary only offered a
derivational note ("agent noun of messen") instead of a translation."""
import json

OVERRIDES = {
    "Empfänger": "recipient, receiver, addressee",
    "Verkäufer": "salesperson, shop assistant, seller",
    "Schalter": "counter, service window; switch",
    "Messer": "knife",
    "Leiter": "leader, manager; ladder",
    "Sender": "broadcaster, (TV/radio) station; transmitter",
    "Maler": "painter",
    "Hörer": "listener; telephone receiver",
    "Hörerin": "listener (female)",
    "Anzeigen": "advertisements, notices",
    "Zahlen": "numbers, figures",
    "Anhänger": "supporter, follower; trailer; pendant",
    "Vorhaben": "plan, project, undertaking",
    "Vorgehen": "procedure, course of action, approach",
    "Anleger": "investor",
    "Nutzen": "benefit, use, usefulness",
    "Räuber": "robber",
    "Spender": "donor; dispenser",
    "Treiben": "goings-on, bustle, activity",
    "Sammler": "collector",
    "Anlieger": "resident, adjoining owner",
    "Ausscheiden": "elimination, retirement, withdrawal",
    "Absteiger": "relegated team, one who is relegated",
    "Bäcker": "baker",
    "Schwimmer": "swimmer; float",
    "Nachdenken": "reflection, thinking, contemplation",
    "Förderer": "supporter, patron, sponsor",
    "Erscheinen": "appearance, publication, attendance",
    "Schläger": "racket, bat, club; thug",
    "Bemühen": "effort, endeavour",
    "Fahnder": "investigator, detective",
    "Versagen": "failure, breakdown",
    "Wohnen": "living, residing, housing",
    "Wandern": "hiking, walking",
    "Springen": "jumping, leaping",
    "Vernehmen": "hearing, questioning; report",
    "Verursacher": "causer, party responsible",
    "Gelingen": "success, successful outcome",
    "Hacker": "hacker",
    "Deutsche": "German (person); the German language",
}

if __name__ == "__main__":
    vocab = json.load(open("/tmp/de/vocab.json", encoding="utf-8"))
    n = 0
    for r in vocab:
        new = OVERRIDES.get(r["lemma"])
        if new and any(k in r["en"].lower()
                       for k in ("agent noun of", "gerund of", "degree of",
                                 "imperative of", "nominalization of",
                                 "singular of", "plural of")):
            r["en"] = new
            r["en_senses"] = new
            r["review"] = False
            n += 1
    json.dump(vocab, open("/tmp/de/vocab.json", "w", encoding="utf-8"),
              ensure_ascii=False, indent=1)
    left = sum(1 for r in vocab if any(
        k in r["en"].lower() for k in ("agent noun of", "gerund of",
                                       "degree of", "imperative of")))
    print(f"glosses overridden: {n}; placeholder glosses remaining: {left}")
