#!/usr/bin/env python3
"""Generate batch_13 (Schichtplanung) and batch_14 (Energiemix) problems."""

import json
import sys
import os
HERE = os.path.dirname(os.path.abspath(__file__))

def fmt(n):
    """Format number with German decimal comma."""
    if isinstance(n, float):
        s = f"{n:.2f}".rstrip('0').rstrip('.')
        return s.replace('.', ',')
    return str(n)

def ucfirst(s):
    """Uppercase first character only, leave rest intact."""
    if not s:
        return s
    return s[0].upper() + s[1:]

def fmt_coeff(c, var, first=False):
    """Format coefficient*variable for constraint/objective string."""
    if c == 0:
        return ""
    sign = "" if first else " + " if c > 0 else " - "
    ac = abs(c) if not first else c
    if ac == 1:
        return f"{sign}{var}"
    if isinstance(ac, float) and ac != int(ac):
        return f"{sign}{fmt(ac)}{var}"
    return f"{sign}{int(ac)}{var}"

def build_objective(c, mode):
    """Build zielfunktion string from c array."""
    parts = []
    for i, coeff in enumerate(c):
        var = f"x{i+1}"
        parts.append(fmt_coeff(coeff, var, first=(i==0)))
    tag = "min" if mode == "minimieren" else "max"
    return f"Z = {''.join(parts)} ({tag})"

def build_constraint(A_row, b_val, ctype, label):
    """Build a single constraint string."""
    parts = []
    for i, coeff in enumerate(A_row):
        var = f"x{i+1}"
        parts.append(fmt_coeff(coeff, var, first=(i==0)))
    sym = "≤" if ctype == "<=" else "≥" if ctype == ">=" else "="
    return f"{''.join(parts)} {sym} {fmt(b_val)} ({label})"


def verify_highlights(beschreibung, highlights):
    """Verify every highlight text is an exact substring of beschreibung."""
    errors = []
    for h in highlights.get("zielfunktion", []):
        if h["text"] not in beschreibung:
            errors.append(f"ZF highlight not found: '{h['text']}'")
    for ci, constraint_hl in enumerate(highlights.get("nebenbedingungen", [])):
        for h in constraint_hl:
            if h["text"] not in beschreibung:
                errors.append(f"NB[{ci}] highlight not found: '{h['text']}'")
    return errors

# ============================================================
# SCHICHTPLANUNG
# ============================================================

with open(os.path.join(HERE, "math_verified/schichtplanung.json")) as f:
    schicht_math = json.load(f)


def make_schicht_problem(idx, math):
    c = math["c"]
    A = math["A"]
    b = math["b"]
    ct = math["constraint_types"]

    scenarios = [
        make_krankenhaus,
        make_callcenter,
        make_fabrik,
        make_hotel,
        make_supermarkt,
        make_feuerwehr,
        make_polizei,
        make_gastronomie,
    ]
    scenario_fn = scenarios[idx % len(scenarios)]
    return scenario_fn(idx, c, A, b, ct)


def make_krankenhaus(idx, c, A, b, ct):
    n = len(A)
    time_slots = ["am Vormittag", "am Nachmittag", "am Abend", "in der Nacht"]
    constraint_labels = []
    nb_highlights = []
    constraint_descs = []

    for i in range(n):
        slot = time_slots[i % len(time_slots)]
        a1, a2 = A[i]
        if ct[i] == ">=":
            desc = (f"{ucfirst(slot)} müssen mindestens {b[i]} Pflegestunden abgedeckt werden. "
                    f"Jede Frühschicht leistet {a1} Pflegestunden {slot} und "
                    f"jede Spätschicht leistet {a2} Pflegestunden {slot}.")
            label = slot.replace("am ", "").replace("in der ", "")
            label = ucfirst(label)
            constraint_labels.append(label)
            nb_highlights.append([
                {"text": f"Frühschicht leistet {a1} Pflegestunden {slot}", "bedeutung": f"{a1}x₁"},
                {"text": f"Spätschicht leistet {a2} Pflegestunden {slot}", "bedeutung": f"+ {a2}x₂"},
                {"text": f"mindestens {b[i]} Pflegestunden", "bedeutung": f"≥ {b[i]}"}
            ])
        else:
            desc = (f"Aus organisatorischen Gründen dürfen {slot} höchstens {b[i]} Pflegestunden geleistet werden. "
                    f"Jede Frühschicht beansprucht {a1} Pflegestunden {slot} und "
                    f"jede Spätschicht beansprucht {a2} Pflegestunden {slot}.")
            label = f"Limit {ucfirst(slot.replace('am ', '').replace('in der ', ''))}"
            constraint_labels.append(label)
            nb_highlights.append([
                {"text": f"Frühschicht beansprucht {a1} Pflegestunden {slot}", "bedeutung": f"{a1}x₁"},
                {"text": f"Spätschicht beansprucht {a2} Pflegestunden {slot}", "bedeutung": f"+ {a2}x₂"},
                {"text": f"höchstens {b[i]} Pflegestunden", "bedeutung": f"≤ {b[i]}"}
            ])
        constraint_descs.append(desc)

    constraints_text = " ".join(constraint_descs)

    beschreibung = (
        f"Ein Krankenhaus plant die Personalbesetzung auf der Notaufnahme. "
        f"Es werden Frühschichten und Spätschichten vergeben. "
        f"Jede Frühschicht kostet {c[0]}€ pro Schicht und jede Spätschicht kostet {c[1]}€ pro Schicht. "
        f"{constraints_text} "
        f"Die Personalkosten sollen minimiert werden."
    )

    highlights = {
        "zielfunktion": [
            {"text": f"Frühschicht kostet {c[0]}€ pro Schicht", "bedeutung": f"{c[0]} × x₁"},
            {"text": f"Spätschicht kostet {c[1]}€ pro Schicht", "bedeutung": f"{c[1]} × x₂"}
        ],
        "nebenbedingungen": nb_highlights
    }

    return {
        "titel": "Schichtplanung Krankenhaus",
        "beschreibung": beschreibung,
        "variablen": ["x1 = Anzahl Frühschichten", "x2 = Anzahl Spätschichten"],
        "constraint_labels": constraint_labels,
        "highlights": highlights
    }


def make_callcenter(idx, c, A, b, ct):
    n = len(A)
    time_slots = ["am Morgen", "am Nachmittag", "am Abend", "in der Nacht"]
    constraint_labels = []
    nb_highlights = []
    constraint_descs = []

    for i in range(n):
        slot = time_slots[i % len(time_slots)]
        a1, a2 = A[i]
        if ct[i] == ">=":
            desc = (f"{ucfirst(slot)} müssen mindestens {b[i]} Anrufe bearbeitet werden. "
                    f"Jede Tagschicht bearbeitet {a1} Anrufe {slot} und "
                    f"jede Nachtschicht bearbeitet {a2} Anrufe {slot}.")
            label = ucfirst(slot.replace("am ", "").replace("in der ", ""))
            constraint_labels.append(label)
            nb_highlights.append([
                {"text": f"Tagschicht bearbeitet {a1} Anrufe {slot}", "bedeutung": f"{a1}x₁"},
                {"text": f"Nachtschicht bearbeitet {a2} Anrufe {slot}", "bedeutung": f"+ {a2}x₂"},
                {"text": f"mindestens {b[i]} Anrufe", "bedeutung": f"≥ {b[i]}"}
            ])
        else:
            desc = (f"Aus Kapazitätsgründen können {slot} höchstens {b[i]} Anrufe bearbeitet werden. "
                    f"Jede Tagschicht belegt {a1} Leitungen {slot} und "
                    f"jede Nachtschicht belegt {a2} Leitungen {slot}.")
            label = f"Limit {ucfirst(slot.replace('am ', '').replace('in der ', ''))}"
            constraint_labels.append(label)
            nb_highlights.append([
                {"text": f"Tagschicht belegt {a1} Leitungen {slot}", "bedeutung": f"{a1}x₁"},
                {"text": f"Nachtschicht belegt {a2} Leitungen {slot}", "bedeutung": f"+ {a2}x₂"},
                {"text": f"höchstens {b[i]} Anrufe", "bedeutung": f"≤ {b[i]}"}
            ])
        constraint_descs.append(desc)

    constraints_text = " ".join(constraint_descs)

    beschreibung = (
        f"Ein Callcenter plant den Einsatz von Tagschichten und Nachtschichten. "
        f"Jede Tagschicht kostet {c[0]}€ und jede Nachtschicht kostet {c[1]}€. "
        f"{constraints_text} "
        f"Die Gesamtkosten sollen minimiert werden."
    )

    highlights = {
        "zielfunktion": [
            {"text": f"Tagschicht kostet {c[0]}€", "bedeutung": f"{c[0]} × x₁"},
            {"text": f"Nachtschicht kostet {c[1]}€", "bedeutung": f"{c[1]} × x₂"}
        ],
        "nebenbedingungen": nb_highlights
    }

    return {
        "titel": "Schichtplanung Callcenter",
        "beschreibung": beschreibung,
        "variablen": ["x1 = Anzahl Tagschichten", "x2 = Anzahl Nachtschichten"],
        "constraint_labels": constraint_labels,
        "highlights": highlights
    }


def make_fabrik(idx, c, A, b, ct):
    n = len(A)
    areas = ["in Halle A", "in Halle B", "in Halle C", "in Halle D"]
    constraint_labels = []
    nb_highlights = []
    constraint_descs = []

    for i in range(n):
        area = areas[i % len(areas)]
        a1, a2 = A[i]
        if ct[i] == ">=":
            desc = (f"{ucfirst(area)} müssen mindestens {b[i]} Arbeitsstunden erbracht werden. "
                    f"Jede Frühschicht leistet {a1} Stunden {area} und "
                    f"jede Spätschicht leistet {a2} Stunden {area}.")
            label = area.replace("in ", "")
            constraint_labels.append(label)
            nb_highlights.append([
                {"text": f"Frühschicht leistet {a1} Stunden {area}", "bedeutung": f"{a1}x₁"},
                {"text": f"Spätschicht leistet {a2} Stunden {area}", "bedeutung": f"+ {a2}x₂"},
                {"text": f"mindestens {b[i]} Arbeitsstunden", "bedeutung": f"≥ {b[i]}"}
            ])
        else:
            desc = (f"Die Maschinenkapazität {area} erlaubt höchstens {b[i]} Arbeitsstunden. "
                    f"Jede Frühschicht nutzt {a1} Stunden {area} und "
                    f"jede Spätschicht nutzt {a2} Stunden {area}.")
            label = f"Kapazität {area.replace('in ', '')}"
            constraint_labels.append(label)
            nb_highlights.append([
                {"text": f"Frühschicht nutzt {a1} Stunden {area}", "bedeutung": f"{a1}x₁"},
                {"text": f"Spätschicht nutzt {a2} Stunden {area}", "bedeutung": f"+ {a2}x₂"},
                {"text": f"höchstens {b[i]} Arbeitsstunden", "bedeutung": f"≤ {b[i]}"}
            ])
        constraint_descs.append(desc)

    constraints_text = " ".join(constraint_descs)

    beschreibung = (
        f"Eine Fabrik plant die Schichtbesetzung für die Produktion. "
        f"Es werden Frühschichten und Spätschichten eingesetzt. "
        f"Jede Frühschicht kostet {c[0]}€ und jede Spätschicht kostet {c[1]}€. "
        f"{constraints_text} "
        f"Die Schichtkosten sollen minimiert werden."
    )

    highlights = {
        "zielfunktion": [
            {"text": f"Frühschicht kostet {c[0]}€", "bedeutung": f"{c[0]} × x₁"},
            {"text": f"Spätschicht kostet {c[1]}€", "bedeutung": f"{c[1]} × x₂"}
        ],
        "nebenbedingungen": nb_highlights
    }

    return {
        "titel": "Schichtplanung Fabrik",
        "beschreibung": beschreibung,
        "variablen": ["x1 = Anzahl Frühschichten", "x2 = Anzahl Spätschichten"],
        "constraint_labels": constraint_labels,
        "highlights": highlights
    }


def make_hotel(idx, c, A, b, ct):
    n = len(A)
    periods = ["am Morgen", "am Mittag", "am Abend", "in der Nacht"]
    constraint_labels = []
    nb_highlights = []
    constraint_descs = []

    for i in range(n):
        period = periods[i % len(periods)]
        a1, a2 = A[i]
        if ct[i] == ">=":
            desc = (f"{ucfirst(period)} müssen mindestens {b[i]} Servicestunden abgedeckt werden. "
                    f"Jede Tagschicht leistet {a1} Servicestunden {period} und "
                    f"jede Nachtschicht leistet {a2} Servicestunden {period}.")
            label = ucfirst(period.replace("am ", "").replace("in der ", ""))
            constraint_labels.append(label)
            nb_highlights.append([
                {"text": f"Tagschicht leistet {a1} Servicestunden {period}", "bedeutung": f"{a1}x₁"},
                {"text": f"Nachtschicht leistet {a2} Servicestunden {period}", "bedeutung": f"+ {a2}x₂"},
                {"text": f"mindestens {b[i]} Servicestunden", "bedeutung": f"≥ {b[i]}"}
            ])
        else:
            desc = (f"Wegen Ruhezeitenregelung dürfen {period} höchstens {b[i]} Servicestunden geleistet werden. "
                    f"Jede Tagschicht beansprucht {a1} Servicestunden {period} und "
                    f"jede Nachtschicht beansprucht {a2} Servicestunden {period}.")
            label = f"Limit {ucfirst(period.replace('am ', '').replace('in der ', ''))}"
            constraint_labels.append(label)
            nb_highlights.append([
                {"text": f"Tagschicht beansprucht {a1} Servicestunden {period}", "bedeutung": f"{a1}x₁"},
                {"text": f"Nachtschicht beansprucht {a2} Servicestunden {period}", "bedeutung": f"+ {a2}x₂"},
                {"text": f"höchstens {b[i]} Servicestunden", "bedeutung": f"≤ {b[i]}"}
            ])
        constraint_descs.append(desc)

    constraints_text = " ".join(constraint_descs)

    beschreibung = (
        f"Ein Hotel plant die Rezeptionsbesetzung mit Tagschichten und Nachtschichten. "
        f"Jede Tagschicht kostet {c[0]}€ und jede Nachtschicht kostet {c[1]}€. "
        f"{constraints_text} "
        f"Die Personalkosten sollen minimiert werden."
    )

    highlights = {
        "zielfunktion": [
            {"text": f"Tagschicht kostet {c[0]}€", "bedeutung": f"{c[0]} × x₁"},
            {"text": f"Nachtschicht kostet {c[1]}€", "bedeutung": f"{c[1]} × x₂"}
        ],
        "nebenbedingungen": nb_highlights
    }

    return {
        "titel": "Schichtplanung Hotel",
        "beschreibung": beschreibung,
        "variablen": ["x1 = Anzahl Tagschichten", "x2 = Anzahl Nachtschichten"],
        "constraint_labels": constraint_labels,
        "highlights": highlights
    }


def make_supermarkt(idx, c, A, b, ct):
    n = len(A)
    periods = ["am Vormittag", "am Nachmittag", "am Abend", "zur Stoßzeit"]
    constraint_labels = []
    nb_highlights = []
    constraint_descs = []

    for i in range(n):
        period = periods[i % len(periods)]
        a1, a2 = A[i]
        if ct[i] == ">=":
            desc = (f"{ucfirst(period)} müssen mindestens {b[i]} Kassenstunden besetzt werden. "
                    f"Jede Frühschicht deckt {a1} Kassenstunden {period} ab und "
                    f"jede Spätschicht deckt {a2} Kassenstunden {period} ab.")
            label = ucfirst(period.replace("am ", "").replace("zur ", ""))
            constraint_labels.append(label)
            nb_highlights.append([
                {"text": f"Frühschicht deckt {a1} Kassenstunden {period} ab", "bedeutung": f"{a1}x₁"},
                {"text": f"Spätschicht deckt {a2} Kassenstunden {period} ab", "bedeutung": f"+ {a2}x₂"},
                {"text": f"mindestens {b[i]} Kassenstunden", "bedeutung": f"≥ {b[i]}"}
            ])
        else:
            desc = (f"Die Kassenanzahl erlaubt {period} höchstens {b[i]} Kassenstunden. "
                    f"Jede Frühschicht belegt {a1} Kassenstunden {period} und "
                    f"jede Spätschicht belegt {a2} Kassenstunden {period}.")
            label = f"Limit {ucfirst(period.replace('am ', '').replace('zur ', ''))}"
            constraint_labels.append(label)
            nb_highlights.append([
                {"text": f"Frühschicht belegt {a1} Kassenstunden {period}", "bedeutung": f"{a1}x₁"},
                {"text": f"Spätschicht belegt {a2} Kassenstunden {period}", "bedeutung": f"+ {a2}x₂"},
                {"text": f"höchstens {b[i]} Kassenstunden", "bedeutung": f"≤ {b[i]}"}
            ])
        constraint_descs.append(desc)

    constraints_text = " ".join(constraint_descs)

    beschreibung = (
        f"Ein Supermarkt plant die Kassenbesetzung mit Frühschichten und Spätschichten. "
        f"Jede Frühschicht kostet {c[0]}€ und jede Spätschicht kostet {c[1]}€. "
        f"{constraints_text} "
        f"Die Personalkosten sollen minimiert werden."
    )

    highlights = {
        "zielfunktion": [
            {"text": f"Frühschicht kostet {c[0]}€", "bedeutung": f"{c[0]} × x₁"},
            {"text": f"Spätschicht kostet {c[1]}€", "bedeutung": f"{c[1]} × x₂"}
        ],
        "nebenbedingungen": nb_highlights
    }

    return {
        "titel": "Schichtplanung Supermarkt",
        "beschreibung": beschreibung,
        "variablen": ["x1 = Anzahl Frühschichten", "x2 = Anzahl Spätschichten"],
        "constraint_labels": constraint_labels,
        "highlights": highlights
    }


def make_feuerwehr(idx, c, A, b, ct):
    n = len(A)
    periods = ["tagsüber", "nachts", "am Wochenende", "an Feiertagen"]
    constraint_labels = []
    nb_highlights = []
    constraint_descs = []

    for i in range(n):
        period = periods[i % len(periods)]
        a1, a2 = A[i]
        if ct[i] == ">=":
            desc = (f"{ucfirst(period)} müssen mindestens {b[i]} Einsatzstunden gewährleistet werden. "
                    f"Jede Tagschicht stellt {a1} Einsatzstunden {period} bereit und "
                    f"jede Nachtschicht stellt {a2} Einsatzstunden {period} bereit.")
            label = ucfirst(period)
            constraint_labels.append(label)
            nb_highlights.append([
                {"text": f"Tagschicht stellt {a1} Einsatzstunden {period} bereit", "bedeutung": f"{a1}x₁"},
                {"text": f"Nachtschicht stellt {a2} Einsatzstunden {period} bereit", "bedeutung": f"+ {a2}x₂"},
                {"text": f"mindestens {b[i]} Einsatzstunden", "bedeutung": f"≥ {b[i]}"}
            ])
        else:
            desc = (f"Das Personalbudget erlaubt {period} höchstens {b[i]} Einsatzstunden. "
                    f"Jede Tagschicht bindet {a1} Einsatzstunden {period} und "
                    f"jede Nachtschicht bindet {a2} Einsatzstunden {period}.")
            label = f"Limit {ucfirst(period)}"
            constraint_labels.append(label)
            nb_highlights.append([
                {"text": f"Tagschicht bindet {a1} Einsatzstunden {period}", "bedeutung": f"{a1}x₁"},
                {"text": f"Nachtschicht bindet {a2} Einsatzstunden {period}", "bedeutung": f"+ {a2}x₂"},
                {"text": f"höchstens {b[i]} Einsatzstunden", "bedeutung": f"≤ {b[i]}"}
            ])
        constraint_descs.append(desc)

    constraints_text = " ".join(constraint_descs)

    beschreibung = (
        f"Eine Feuerwache plant die Besetzung mit Tagschichten und Nachtschichten. "
        f"Jede Tagschicht kostet {c[0]}€ und jede Nachtschicht kostet {c[1]}€. "
        f"{constraints_text} "
        f"Die Gesamtkosten sollen minimiert werden."
    )

    highlights = {
        "zielfunktion": [
            {"text": f"Tagschicht kostet {c[0]}€", "bedeutung": f"{c[0]} × x₁"},
            {"text": f"Nachtschicht kostet {c[1]}€", "bedeutung": f"{c[1]} × x₂"}
        ],
        "nebenbedingungen": nb_highlights
    }

    return {
        "titel": "Schichtplanung Feuerwehr",
        "beschreibung": beschreibung,
        "variablen": ["x1 = Anzahl Tagschichten", "x2 = Anzahl Nachtschichten"],
        "constraint_labels": constraint_labels,
        "highlights": highlights
    }


def make_polizei(idx, c, A, b, ct):
    n = len(A)
    areas = ["im Stadtgebiet", "im Außenbezirk", "in der Innenstadt", "am Bahnhof"]
    constraint_labels = []
    nb_highlights = []
    constraint_descs = []

    for i in range(n):
        area = areas[i % len(areas)]
        a1, a2 = A[i]
        if ct[i] == ">=":
            desc = (f"{ucfirst(area)} müssen mindestens {b[i]} Streifenstunden abgedeckt werden. "
                    f"Jede Tagschicht leistet {a1} Streifenstunden {area} und "
                    f"jede Nachtschicht leistet {a2} Streifenstunden {area}.")
            label = area.replace("im ", "").replace("in der ", "").replace("am ", "")
            label = ucfirst(label)
            constraint_labels.append(label)
            nb_highlights.append([
                {"text": f"Tagschicht leistet {a1} Streifenstunden {area}", "bedeutung": f"{a1}x₁"},
                {"text": f"Nachtschicht leistet {a2} Streifenstunden {area}", "bedeutung": f"+ {a2}x₂"},
                {"text": f"mindestens {b[i]} Streifenstunden", "bedeutung": f"≥ {b[i]}"}
            ])
        else:
            desc = (f"Die Dienstplanregelung erlaubt {area} höchstens {b[i]} Streifenstunden. "
                    f"Jede Tagschicht erfordert {a1} Streifenstunden {area} und "
                    f"jede Nachtschicht erfordert {a2} Streifenstunden {area}.")
            label = area.replace("im ", "").replace("in der ", "").replace("am ", "")
            label = f"Limit {ucfirst(label)}"
            constraint_labels.append(label)
            nb_highlights.append([
                {"text": f"Tagschicht erfordert {a1} Streifenstunden {area}", "bedeutung": f"{a1}x₁"},
                {"text": f"Nachtschicht erfordert {a2} Streifenstunden {area}", "bedeutung": f"+ {a2}x₂"},
                {"text": f"höchstens {b[i]} Streifenstunden", "bedeutung": f"≤ {b[i]}"}
            ])
        constraint_descs.append(desc)

    constraints_text = " ".join(constraint_descs)

    beschreibung = (
        f"Eine Polizeidienststelle plant die Streifenbesetzung mit Tagschichten und Nachtschichten. "
        f"Jede Tagschicht kostet {c[0]}€ und jede Nachtschicht kostet {c[1]}€. "
        f"{constraints_text} "
        f"Die Gesamtkosten sollen minimiert werden."
    )

    highlights = {
        "zielfunktion": [
            {"text": f"Tagschicht kostet {c[0]}€", "bedeutung": f"{c[0]} × x₁"},
            {"text": f"Nachtschicht kostet {c[1]}€", "bedeutung": f"{c[1]} × x₂"}
        ],
        "nebenbedingungen": nb_highlights
    }

    return {
        "titel": "Schichtplanung Polizei",
        "beschreibung": beschreibung,
        "variablen": ["x1 = Anzahl Tagschichten", "x2 = Anzahl Nachtschichten"],
        "constraint_labels": constraint_labels,
        "highlights": highlights
    }


def make_gastronomie(idx, c, A, b, ct):
    n = len(A)
    periods = ["mittags", "abends", "am Wochenende", "bei Veranstaltungen"]
    constraint_labels = []
    nb_highlights = []
    constraint_descs = []

    for i in range(n):
        period = periods[i % len(periods)]
        a1, a2 = A[i]
        if ct[i] == ">=":
            desc = (f"{ucfirst(period)} müssen mindestens {b[i]} Bedienungsstunden geleistet werden. "
                    f"Jede Frühschicht leistet {a1} Bedienungsstunden {period} und "
                    f"jede Spätschicht leistet {a2} Bedienungsstunden {period}.")
            label = ucfirst(period)
            constraint_labels.append(label)
            nb_highlights.append([
                {"text": f"Frühschicht leistet {a1} Bedienungsstunden {period}", "bedeutung": f"{a1}x₁"},
                {"text": f"Spätschicht leistet {a2} Bedienungsstunden {period}", "bedeutung": f"+ {a2}x₂"},
                {"text": f"mindestens {b[i]} Bedienungsstunden", "bedeutung": f"≥ {b[i]}"}
            ])
        else:
            desc = (f"Die Raumkapazität erlaubt {period} höchstens {b[i]} Bedienungsstunden. "
                    f"Jede Frühschicht beansprucht {a1} Bedienungsstunden {period} und "
                    f"jede Spätschicht beansprucht {a2} Bedienungsstunden {period}.")
            label = f"Limit {ucfirst(period)}"
            constraint_labels.append(label)
            nb_highlights.append([
                {"text": f"Frühschicht beansprucht {a1} Bedienungsstunden {period}", "bedeutung": f"{a1}x₁"},
                {"text": f"Spätschicht beansprucht {a2} Bedienungsstunden {period}", "bedeutung": f"+ {a2}x₂"},
                {"text": f"höchstens {b[i]} Bedienungsstunden", "bedeutung": f"≤ {b[i]}"}
            ])
        constraint_descs.append(desc)

    constraints_text = " ".join(constraint_descs)

    beschreibung = (
        f"Ein Restaurant plant die Personalbesetzung mit Frühschichten und Spätschichten. "
        f"Jede Frühschicht kostet {c[0]}€ und jede Spätschicht kostet {c[1]}€. "
        f"{constraints_text} "
        f"Die Personalkosten sollen minimiert werden."
    )

    highlights = {
        "zielfunktion": [
            {"text": f"Frühschicht kostet {c[0]}€", "bedeutung": f"{c[0]} × x₁"},
            {"text": f"Spätschicht kostet {c[1]}€", "bedeutung": f"{c[1]} × x₂"}
        ],
        "nebenbedingungen": nb_highlights
    }

    return {
        "titel": "Schichtplanung Gastronomie",
        "beschreibung": beschreibung,
        "variablen": ["x1 = Anzahl Frühschichten", "x2 = Anzahl Spätschichten"],
        "constraint_labels": constraint_labels,
        "highlights": highlights
    }


# Generate Schichtplanung batch
schicht_problems = []
for i in range(15):
    math = schicht_math[i]
    result = make_schicht_problem(i, math)

    nbs = []
    for j in range(len(math["A"])):
        nb = build_constraint(math["A"][j], math["b"][j], math["constraint_types"][j], result["constraint_labels"][j])
        nbs.append(nb)
    nbs.append("x1, x2 ≥ 0")

    has_geq = any(ct == ">=" for ct in math["constraint_types"])
    has_leq = any(ct == "<=" for ct in math["constraint_types"])
    if has_geq and has_leq:
        hinweis = "Hier gibt es sowohl ≥-Nebenbedingungen (Mindestanforderungen) als auch ≤-Nebenbedingungen (Obergrenzen). Achten Sie auf die Richtung der Ungleichungen."
    elif has_geq:
        hinweis = "Beachten Sie die ≥-Richtung: Es müssen mindestens so viele Stunden erbracht werden wie gefordert."
    else:
        hinweis = "Alle Nebenbedingungen sind Obergrenzen (≤). Die Kosten sollen minimiert werden."

    problem = {
        "titel": result["titel"],
        "beschreibung": result["beschreibung"],
        "typ": "Schichtplanung",
        "optimierungsziel": "minimieren",
        "variablen": result["variablen"],
        "zielfunktion": build_objective(math["c"], "minimieren"),
        "nebenbedingungen": nbs,
        "hinweis": hinweis,
        "highlights": result["highlights"]
    }

    errors = verify_highlights(problem["beschreibung"], problem["highlights"])
    if errors:
        print(f"ERROR in Schichtplanung problem {i}: {errors}", file=sys.stderr)
        sys.exit(1)

    schicht_problems.append(problem)
    print(f"Schichtplanung #{i}: OK ({result['titel']})")

with open(os.path.join(HERE, "batch_13_schichtplanung.json"), "w", encoding="utf-8") as f:
    json.dump(schicht_problems, f, ensure_ascii=False, indent=2)
print(f"\nWrote {len(schicht_problems)} Schichtplanung problems to batch_13_schichtplanung.json")


# ============================================================
# ENERGIEMIX
# ============================================================

with open(os.path.join(HERE, "math_verified/energiemix.json")) as f:
    energy_math = json.load(f)

def make_energy_problem(idx, math):
    c = math["c"]
    A = math["A"]
    b = math["b"]
    ct = math["constraint_types"]

    scenarios = [
        make_solar_wind,
        make_biomasse_wasserkraft,
        make_geothermie_pv,
        make_bhkw_waermepumpe,
    ]
    scenario_fn = scenarios[idx % len(scenarios)]
    return scenario_fn(idx, c, A, b, ct)


def make_solar_wind(idx, c, A, b, ct):
    n = len(A)
    resource_types = ["Leistung", "Netzeinspeisung", "Speicherkapazität", "CO2-Einsparung"]
    constraint_labels = []
    nb_highlights = []
    constraint_descs = []

    for i in range(n):
        rtype = resource_types[i % len(resource_types)]
        a1, a2 = A[i]
        if ct[i] == ">=":
            desc = (f"Das Unternehmen muss mindestens {b[i]} MWh {rtype} bereitstellen. "
                    f"Jede Solaranlage liefert {a1} MWh {rtype} und "
                    f"jede Windkraftanlage liefert {a2} MWh {rtype}.")
            constraint_labels.append(f"Mindest-{rtype}")
            nb_highlights.append([
                {"text": f"Solaranlage liefert {a1} MWh {rtype}", "bedeutung": f"{a1}x₁"},
                {"text": f"Windkraftanlage liefert {a2} MWh {rtype}", "bedeutung": f"+ {a2}x₂"},
                {"text": f"mindestens {b[i]} MWh {rtype}", "bedeutung": f"≥ {b[i]}"}
            ])
        else:
            desc = (f"Die Netzkapazität begrenzt die {rtype} auf höchstens {b[i]} MWh. "
                    f"Jede Solaranlage beansprucht {a1} MWh {rtype} und "
                    f"jede Windkraftanlage beansprucht {a2} MWh {rtype}.")
            constraint_labels.append(f"Max-{rtype}")
            nb_highlights.append([
                {"text": f"Solaranlage beansprucht {a1} MWh {rtype}", "bedeutung": f"{a1}x₁"},
                {"text": f"Windkraftanlage beansprucht {a2} MWh {rtype}", "bedeutung": f"+ {a2}x₂"},
                {"text": f"höchstens {b[i]} MWh", "bedeutung": f"≤ {b[i]}"}
            ])
        constraint_descs.append(desc)

    constraints_text = " ".join(constraint_descs)

    beschreibung = (
        f"Ein Energieversorger plant den Ausbau mit Solaranlagen und Windkraftanlagen. "
        f"Jede Solaranlage kostet {c[0]}€ pro MWh und jede Windkraftanlage kostet {c[1]}€ pro MWh. "
        f"{constraints_text} "
        f"Die Gesamtkosten sollen minimiert werden."
    )

    highlights = {
        "zielfunktion": [
            {"text": f"Solaranlage kostet {c[0]}€ pro MWh", "bedeutung": f"{c[0]} × x₁"},
            {"text": f"Windkraftanlage kostet {c[1]}€ pro MWh", "bedeutung": f"{c[1]} × x₂"}
        ],
        "nebenbedingungen": nb_highlights
    }

    return {
        "titel": "Energiemix Solar und Wind",
        "beschreibung": beschreibung,
        "variablen": ["x1 = MWh aus Solaranlagen", "x2 = MWh aus Windkraftanlagen"],
        "constraint_labels": constraint_labels,
        "highlights": highlights
    }


def make_biomasse_wasserkraft(idx, c, A, b, ct):
    n = len(A)
    resource_types = ["Stromerzeugung", "Wärmeleistung", "Netzeinspeisung", "Grundlast"]
    constraint_labels = []
    nb_highlights = []
    constraint_descs = []

    for i in range(n):
        rtype = resource_types[i % len(resource_types)]
        a1, a2 = A[i]
        if ct[i] == ">=":
            desc = (f"Das Stadtwerk muss mindestens {b[i]} MWh {rtype} erzeugen. "
                    f"Jede Biomasseanlage liefert {a1} MWh {rtype} und "
                    f"jedes Wasserkraftwerk liefert {a2} MWh {rtype}.")
            constraint_labels.append(f"Mindest-{rtype}")
            nb_highlights.append([
                {"text": f"Biomasseanlage liefert {a1} MWh {rtype}", "bedeutung": f"{a1}x₁"},
                {"text": f"Wasserkraftwerk liefert {a2} MWh {rtype}", "bedeutung": f"+ {a2}x₂"},
                {"text": f"mindestens {b[i]} MWh {rtype}", "bedeutung": f"≥ {b[i]}"}
            ])
        else:
            desc = (f"Die Netzkapazität für {rtype} beträgt höchstens {b[i]} MWh. "
                    f"Jede Biomasseanlage beansprucht {a1} MWh {rtype} und "
                    f"jedes Wasserkraftwerk beansprucht {a2} MWh {rtype}.")
            constraint_labels.append(f"Max-{rtype}")
            nb_highlights.append([
                {"text": f"Biomasseanlage beansprucht {a1} MWh {rtype}", "bedeutung": f"{a1}x₁"},
                {"text": f"Wasserkraftwerk beansprucht {a2} MWh {rtype}", "bedeutung": f"+ {a2}x₂"},
                {"text": f"höchstens {b[i]} MWh", "bedeutung": f"≤ {b[i]}"}
            ])
        constraint_descs.append(desc)

    constraints_text = " ".join(constraint_descs)

    beschreibung = (
        f"Ein Stadtwerk plant die Energieerzeugung mit Biomasseanlagen und Wasserkraftwerken. "
        f"Jede Biomasseanlage kostet {c[0]}€ pro MWh und jedes Wasserkraftwerk kostet {c[1]}€ pro MWh. "
        f"{constraints_text} "
        f"Die Betriebskosten sollen minimiert werden."
    )

    highlights = {
        "zielfunktion": [
            {"text": f"Biomasseanlage kostet {c[0]}€ pro MWh", "bedeutung": f"{c[0]} × x₁"},
            {"text": f"Wasserkraftwerk kostet {c[1]}€ pro MWh", "bedeutung": f"{c[1]} × x₂"}
        ],
        "nebenbedingungen": nb_highlights
    }

    return {
        "titel": "Energiemix Biomasse und Wasserkraft",
        "beschreibung": beschreibung,
        "variablen": ["x1 = MWh aus Biomasseanlagen", "x2 = MWh aus Wasserkraftwerken"],
        "constraint_labels": constraint_labels,
        "highlights": highlights
    }


def make_geothermie_pv(idx, c, A, b, ct):
    n = len(A)
    resource_types = ["Grundlastversorgung", "Spitzenlast", "Wärmeversorgung", "Stromeinspeisung"]
    constraint_labels = []
    nb_highlights = []
    constraint_descs = []

    for i in range(n):
        rtype = resource_types[i % len(resource_types)]
        a1, a2 = A[i]
        if ct[i] == ">=":
            desc = (f"Für die {rtype} müssen mindestens {b[i]} MWh bereitgestellt werden. "
                    f"Jede Geothermieanlage liefert {a1} MWh {rtype} und "
                    f"jede Photovoltaikanlage liefert {a2} MWh {rtype}.")
            constraint_labels.append(f"Mindest-{rtype}")
            nb_highlights.append([
                {"text": f"Geothermieanlage liefert {a1} MWh {rtype}", "bedeutung": f"{a1}x₁"},
                {"text": f"Photovoltaikanlage liefert {a2} MWh {rtype}", "bedeutung": f"+ {a2}x₂"},
                {"text": f"mindestens {b[i]} MWh", "bedeutung": f"≥ {b[i]}"}
            ])
        else:
            desc = (f"Die {rtype} darf höchstens {b[i]} MWh betragen. "
                    f"Jede Geothermieanlage benötigt {a1} MWh {rtype} und "
                    f"jede Photovoltaikanlage benötigt {a2} MWh {rtype}.")
            constraint_labels.append(f"Max-{rtype}")
            nb_highlights.append([
                {"text": f"Geothermieanlage benötigt {a1} MWh {rtype}", "bedeutung": f"{a1}x₁"},
                {"text": f"Photovoltaikanlage benötigt {a2} MWh {rtype}", "bedeutung": f"+ {a2}x₂"},
                {"text": f"höchstens {b[i]} MWh", "bedeutung": f"≤ {b[i]}"}
            ])
        constraint_descs.append(desc)

    constraints_text = " ".join(constraint_descs)

    beschreibung = (
        f"Ein Energieversorger plant den Einsatz von Geothermieanlagen und Photovoltaikanlagen. "
        f"Jede Geothermieanlage kostet {c[0]}€ pro MWh und jede Photovoltaikanlage kostet {c[1]}€ pro MWh. "
        f"{constraints_text} "
        f"Die Gesamtkosten sollen minimiert werden."
    )

    highlights = {
        "zielfunktion": [
            {"text": f"Geothermieanlage kostet {c[0]}€ pro MWh", "bedeutung": f"{c[0]} × x₁"},
            {"text": f"Photovoltaikanlage kostet {c[1]}€ pro MWh", "bedeutung": f"{c[1]} × x₂"}
        ],
        "nebenbedingungen": nb_highlights
    }

    return {
        "titel": "Energiemix Geothermie und Photovoltaik",
        "beschreibung": beschreibung,
        "variablen": ["x1 = MWh aus Geothermieanlagen", "x2 = MWh aus Photovoltaikanlagen"],
        "constraint_labels": constraint_labels,
        "highlights": highlights
    }


def make_bhkw_waermepumpe(idx, c, A, b, ct):
    n = len(A)
    resource_types = ["Stromversorgung", "Wärmeversorgung", "Netzeinspeisung", "Grundlast"]
    constraint_labels = []
    nb_highlights = []
    constraint_descs = []

    for i in range(n):
        rtype = resource_types[i % len(resource_types)]
        a1, a2 = A[i]
        if ct[i] == ">=":
            desc = (f"Für die {rtype} müssen mindestens {b[i]} kW bereitgestellt werden. "
                    f"Jedes BHKW liefert {a1} kW {rtype} und "
                    f"jede Wärmepumpe liefert {a2} kW {rtype}.")
            constraint_labels.append(f"Mindest-{rtype}")
            nb_highlights.append([
                {"text": f"BHKW liefert {a1} kW {rtype}", "bedeutung": f"{a1}x₁"},
                {"text": f"Wärmepumpe liefert {a2} kW {rtype}", "bedeutung": f"+ {a2}x₂"},
                {"text": f"mindestens {b[i]} kW", "bedeutung": f"≥ {b[i]}"}
            ])
        else:
            desc = (f"Die {rtype} darf höchstens {b[i]} kW betragen. "
                    f"Jedes BHKW beansprucht {a1} kW {rtype} und "
                    f"jede Wärmepumpe beansprucht {a2} kW {rtype}.")
            constraint_labels.append(f"Max-{rtype}")
            nb_highlights.append([
                {"text": f"BHKW beansprucht {a1} kW {rtype}", "bedeutung": f"{a1}x₁"},
                {"text": f"Wärmepumpe beansprucht {a2} kW {rtype}", "bedeutung": f"+ {a2}x₂"},
                {"text": f"höchstens {b[i]} kW", "bedeutung": f"≤ {b[i]}"}
            ])
        constraint_descs.append(desc)

    constraints_text = " ".join(constraint_descs)

    beschreibung = (
        f"Ein Wohnquartier plant die Energieversorgung mit Blockheizkraftwerken und Wärmepumpen. "
        f"Jedes BHKW kostet {c[0]}€ pro kW und jede Wärmepumpe kostet {c[1]}€ pro kW. "
        f"{constraints_text} "
        f"Die Gesamtkosten sollen minimiert werden."
    )

    highlights = {
        "zielfunktion": [
            {"text": f"BHKW kostet {c[0]}€ pro kW", "bedeutung": f"{c[0]} × x₁"},
            {"text": f"Wärmepumpe kostet {c[1]}€ pro kW", "bedeutung": f"{c[1]} × x₂"}
        ],
        "nebenbedingungen": nb_highlights
    }

    return {
        "titel": "Energiemix BHKW und Wärmepumpe",
        "beschreibung": beschreibung,
        "variablen": ["x1 = kW aus Blockheizkraftwerken", "x2 = kW aus Wärmepumpen"],
        "constraint_labels": constraint_labels,
        "highlights": highlights
    }


# Generate Energiemix batch
energy_problems = []
for i in range(15):
    math = energy_math[i]
    result = make_energy_problem(i, math)

    nbs = []
    for j in range(len(math["A"])):
        nb = build_constraint(math["A"][j], math["b"][j], math["constraint_types"][j], result["constraint_labels"][j])
        nbs.append(nb)
    nbs.append("x1, x2 ≥ 0")

    has_geq = any(ct == ">=" for ct in math["constraint_types"])
    has_leq = any(ct == "<=" for ct in math["constraint_types"])
    if has_geq and has_leq:
        hinweis = "Achten Sie auf die unterschiedlichen Richtungen der Nebenbedingungen: Mindestanforderungen erfordern ≥, Kapazitätsgrenzen erfordern ≤."
    elif has_geq:
        hinweis = "Alle Nebenbedingungen sind Mindestanforderungen (≥). Die Kosten sollen minimiert werden."
    else:
        hinweis = "Alle Nebenbedingungen sind Kapazitätsgrenzen (≤). Die Kosten sollen minimiert werden."

    problem = {
        "titel": result["titel"],
        "beschreibung": result["beschreibung"],
        "typ": "Energiemix",
        "optimierungsziel": "minimieren",
        "variablen": result["variablen"],
        "zielfunktion": build_objective(math["c"], "minimieren"),
        "nebenbedingungen": nbs,
        "hinweis": hinweis,
        "highlights": result["highlights"]
    }

    errors = verify_highlights(problem["beschreibung"], problem["highlights"])
    if errors:
        print(f"ERROR in Energiemix problem {i}: {errors}", file=sys.stderr)
        sys.exit(1)

    energy_problems.append(problem)
    print(f"Energiemix #{i}: OK ({result['titel']})")

with open(os.path.join(HERE, "batch_14_energiemix.json"), "w", encoding="utf-8") as f:
    json.dump(energy_problems, f, ensure_ascii=False, indent=2)
print(f"\nWrote {len(energy_problems)} Energiemix problems to batch_14_energiemix.json")

print("\nDone! All highlights verified.")
