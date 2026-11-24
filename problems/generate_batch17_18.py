#!/usr/bin/env python3
"""Generate batch_17 (Lagerhaltung) and batch_18 (Qualitätskontrolle) problems."""
import json
import sys
import os
HERE = os.path.dirname(os.path.abspath(__file__))

with open(os.path.join(HERE, "math_verified/lagerhaltung.json")) as f:
    lager_math = json.load(f)
with open(os.path.join(HERE, "math_verified/qualitätskontrolle.json")) as f:
    qk_math = json.load(f)


def fmt(n):
    if isinstance(n, float) and n == int(n):
        return str(int(n))
    if isinstance(n, int):
        return str(n)
    return str(n).replace(".", ",")


def build_zf(c, opt):
    tag = "min" if opt == "minimieren" else "max"
    return f"Z = {fmt(c[0])}x1 + {fmt(c[1])}x2 ({tag})"


def validate_highlights(problem):
    b = problem["beschreibung"]
    errors = []
    for h in problem["highlights"]["zielfunktion"]:
        if h["text"] not in b:
            errors.append(f"  ZF highlight NOT FOUND: '{h['text']}'")
    for ci, chs in enumerate(problem["highlights"]["nebenbedingungen"]):
        for h in chs:
            if h["text"] not in b:
                errors.append(f"  NB[{ci}] highlight NOT FOUND: '{h['text']}'")
    return errors


# ============================================================
# LAGERHALTUNG - 15 problems with unique scenarios & richer prose
# ============================================================
# Each entry: (titel, prod1, prod2, company, unit_name, cap_name, order_unit, intro_extra, closing_extra)
lager_configs = [
    ("Supermarkt-Frischwarenbestand", "Frischware", "Trockenware", "Ein Supermarkt in der Innenstadt",
     "Regalplätze", "Lagerkapazität", "Einheit",
     "Der Filialleiter plant die wöchentliche Bestellung, um sowohl Frische als auch Verfügbarkeit sicherzustellen.",
     "Dabei soll die Bestellung so gewählt werden, dass die Gesamtlagerkosten möglichst gering ausfallen, ohne die Kundenzufriedenheit zu gefährden."),

    ("Apotheken-Medikamentenlager", "verschreibungspflichtige Medikamente", "freiverkäufliche Produkte", "Eine Apotheke im Stadtzentrum",
     "Regalfächer", "Kühlschrankkapazität", "Packung",
     "Die Apothekenleiterin muss gesetzliche Vorratspflichten einhalten und gleichzeitig wirtschaftlich arbeiten.",
     "Das Ziel ist die Minimierung der gesamten Lager- und Bestellkosten unter Einhaltung aller regulatorischen Vorgaben."),

    ("Ersatzteillager-Elektronik", "Elektronikteile", "Mechanikteile", "Ein Ersatzteillager eines Maschinenbauunternehmens",
     "Fachbodenplätze", "Gesamtkapazität", "Einheit",
     "Der Lagerleiter muss sicherstellen, dass im Störungsfall ausreichend Ersatzteile beider Kategorien verfügbar sind.",
     "Gesucht ist die kostenminimale Bestellstrategie, die alle Versorgungsanforderungen und Kapazitätsgrenzen respektiert."),

    ("Baustoff-Palettenlager", "Zement", "Holzplatten", "Ein Baustoffhändler am Stadtrand",
     "Lagerplätze", "Hallenkapazität", "Palette",
     "Der Geschäftsführer plant den Bestand für die kommende Bausaison und möchte die Lagerhaltungskosten senken.",
     "Das Optimierungsziel ist die Minimierung der Gesamtkosten bei gleichzeitiger Absicherung der Materialverfügbarkeit für laufende Bauprojekte."),

    ("Elektronikversand-Regaloptimierung", "Smartphones", "Tablets", "Ein Elektronikversand mit Hauptlager in Leipzig",
     "Regalplätze", "Lagerkapazität", "Karton",
     "Der Logistikleiter möchte den begrenzten Lagerraum effizient nutzen und die Bestellkosten niedrig halten.",
     "Es sollen die Gesamtlagerkosten minimiert werden, wobei weder der Mindestbestand unterschritten noch die Kapazitätsgrenze überschritten werden darf."),

    ("Buchhandlung-Sortimentsplanung", "Hardcover-Bücher", "Taschenbücher", "Eine traditionsreiche Buchhandlung",
     "Regalmeter", "Lagerkapazität", "Karton",
     "Der Buchhändler bereitet die Bestellung für das nächste Quartal vor und muss Bestseller beider Kategorien vorrätig halten.",
     "Das Ziel ist eine kostenoptimale Lagerstrategie, die den Mindestbestand sichert und die verfügbare Regalfläche nicht überschreitet."),

    ("Bio-Supermarkt-Kühllagerhaltung", "Tiefkühlware", "Konserven", "Ein Bio-Supermarkt mit regionaler Ausrichtung",
     "Palettenplätze", "Kühlraumkapazität", "Einheit",
     "Die Filialleiterin achtet besonders auf die Frische der Ware und muss den Kühlraum wirtschaftlich bewirtschaften.",
     "Gesucht wird die Bestellkombination, die bei minimalen Lagerkosten alle Versorgungsanforderungen erfüllt und die begrenzte Kühlkapazität berücksichtigt."),

    ("Versandapotheke-Bestandsmanagement", "Schmerzmittel", "Erkältungspräparate", "Eine Versandapotheke mit Sitz in Hamburg",
     "Lagerplätze", "Versandkapazität", "Packung",
     "Der Apothekenleiter muss die saisonale Nachfrage nach Erkältungsmitteln berücksichtigen und den Mindestbestand vorschriftsmäßig einhalten.",
     "Es gilt, die Gesamtlagerkosten zu minimieren und dabei alle Bestandsanforderungen sowie die Versandkapazität einzuhalten."),

    ("Industrielager-Hydraulikteile", "Hydraulikkomponenten", "Dichtungen", "Ein Industrielager eines Automobilzulieferers",
     "Regalfächer", "Gesamtkapazität", "Einheit",
     "Die Lagerleiterin muss die Just-in-Time-Lieferfähigkeit für die Produktionslinie gewährleisten und gleichzeitig die Lagerkosten unter Kontrolle halten.",
     "Die optimale Lösung minimiert die Gesamtlagerkosten bei gleichzeitiger Einhaltung des Mindestbestands und der Kapazitätsobergrenze."),

    ("Baumaterial-Dämmstofflager", "Dämmstoffe", "Fliesen", "Ein Baumateriallager für Handwerksbetriebe",
     "Stellflächen", "Hallenkapazität", "Palette",
     "Die Lagerverantwortliche plant die monatliche Nachbestellung und will die Lagerhaltungskosten für beide Produktgruppen senken.",
     "Gesucht ist die kostengünstigste Bestellstrategie, die sowohl den geforderten Mindestbestand sichert als auch die begrenzte Hallenfläche nicht überlastet."),

    ("Online-Elektronik-Stellplatzoptimierung", "Laptops", "Monitore", "Ein Online-Elektronikhändler mit Zentrallager in Dortmund",
     "Stellplätze", "Lagerkapazität", "Karton",
     "Die Logistikleiterin steht vor der Herausforderung, bei begrenztem Platzangebot stets lieferfähig zu bleiben.",
     "Ziel der Optimierung ist die Minimierung der Lagergesamtkosten unter Berücksichtigung aller Mindestbestands- und Kapazitätsvorgaben."),

    ("Universitätsbuchhandlung-Bestandsplanung", "Sachbücher", "Romane", "Eine Universitätsbuchhandlung nahe dem Campus",
     "Regalplätze", "Lagerkapazität", "Einheit",
     "Die Buchhändlerin muss zu Semesterbeginn genügend Fachbücher vorrätig haben und gleichzeitig das Romanprogramm pflegen.",
     "Die Gesamtlagerkosten sollen minimiert werden, wobei der Mindestbestand für beide Kategorien und die Kapazitätsgrenze zu beachten sind."),

    ("Verbrauchermarkt-Molkereiprodukte", "Molkereiprodukte", "Backwaren", "Ein großer Verbrauchermarkt mit täglicher Frischelieferung",
     "Kühlregalmeter", "Lagerkapazität", "Einheit",
     "Der Marktleiter muss die kurze Haltbarkeit der Molkereiprodukte berücksichtigen und die Bestellmengen sorgfältig planen.",
     "Es soll die kostenoptimale Bestellmenge ermittelt werden, die den Mindestbestand gewährleistet und die verfügbare Kühlfläche nicht überschreitet."),

    ("Apotheken-Kühlschrankoptimierung", "verschreibungspflichtige Medikamente", "freiverkäufliche Produkte", "Eine Apotheke in einem Einkaufszentrum",
     "Regalfächer", "Kühlschrankkapazität", "Packung",
     "Der Apotheker muss die strengen Aufbewahrungsvorschriften für temperaturempfindliche Medikamente einhalten und die Kosten im Rahmen halten.",
     "Die Aufgabe besteht darin, die Gesamtlagerkosten zu minimieren und dabei sowohl den Mindestbestand als auch die Kühlschrankkapazität zu berücksichtigen."),

    ("Ersatzteillager-Produktionssicherung", "Elektronikteile", "Mechanikteile", "Ein Ersatzteillager eines Kraftwerks",
     "Fachbodenplätze", "Gesamtkapazität", "Einheit",
     "Der Lagerverwalter muss die Betriebssicherheit des Kraftwerks gewährleisten und die Ersatzteile beider Kategorien in ausreichender Menge bereithalten.",
     "Gesucht ist die kostenminimale Bestellstrategie, die alle vier Restriktionen gleichzeitig erfüllt und den störungsfreien Betrieb sicherstellt."),
]

lager_problems = []
for i in range(15):
    m = lager_math[i]
    c = m["c"]; A = m["A"]; b = m["b"]; ct = m["constraint_types"]
    n = len(A)
    cfg = lager_configs[i]
    titel, prod1, prod2, company, unit_name, cap_name, order_unit, intro_extra, closing_extra = cfg

    c1s = fmt(c[0]); c2s = fmt(c[1])

    if n == 2:
        a10=fmt(A[0][0]); a11=fmt(A[0][1]); b0=fmt(b[0])
        a20=fmt(A[1][0]); a21=fmt(A[1][1]); b1=fmt(b[1])

        beschreibung = (
            f"{company} optimiert die Bestellmengen für zwei Produktgruppen: {prod1} und {prod2}. "
            f"{intro_extra} "
            f"Die Lagerkosten betragen {c1s}€ pro {order_unit} {prod1} und {c2s}€ pro {order_unit} {prod2}. "
            f"Um die Versorgungssicherheit zu gewährleisten, muss ein Mindestbestand eingehalten werden: "
            f"{a10} {unit_name} pro {order_unit} {prod1} und {a11} {unit_name} pro {order_unit} {prod2} "
            f"ergeben zusammen mindestens {b0} {unit_name}. "
            f"Gleichzeitig ist die {cap_name} begrenzt: "
            f"{a20} {unit_name} pro {order_unit} {prod1} und {a21} {unit_name} pro {order_unit} {prod2} "
            f"dürfen zusammen höchstens {b1} {unit_name} belegen. "
            f"{closing_extra}"
        )
        h_zf = [
            {"text": f"{c1s}€ pro {order_unit} {prod1}", "bedeutung": f"{c1s} × x₁"},
            {"text": f"{c2s}€ pro {order_unit} {prod2}", "bedeutung": f"{c2s} × x₂"},
        ]
        h_nb = [
            [
                {"text": f"{a10} {unit_name} pro {order_unit} {prod1}", "bedeutung": f"{a10}x₁"},
                {"text": f"{a11} {unit_name} pro {order_unit} {prod2}", "bedeutung": f"+ {a11}x₂"},
                {"text": f"mindestens {b0} {unit_name}", "bedeutung": f"≥ {b0}"},
            ],
            [
                {"text": f"{a20} {unit_name} pro {order_unit} {prod1}", "bedeutung": f"{a20}x₁"},
                {"text": f"{a21} {unit_name} pro {order_unit} {prod2}", "bedeutung": f"+ {a21}x₂"},
                {"text": f"höchstens {b1} {unit_name}", "bedeutung": f"≤ {b1}"},
            ],
        ]
        nb_strings = [
            f"{a10}x1 + {a11}x2 ≥ {b0} (Mindestbestand)",
            f"{a20}x1 + {a21}x2 ≤ {b1} ({cap_name})",
            "x1, x2 ≥ 0",
        ]

    elif n == 3:
        a10=fmt(A[0][0]); a11=fmt(A[0][1]); b0=fmt(b[0])
        a20=fmt(A[1][0]); a21=fmt(A[1][1]); b1=fmt(b[1])
        a30=fmt(A[2][0]); a31=fmt(A[2][1]); b2=fmt(b[2])

        if ct[1] == "<=" and ct[2] == "<=":
            beschreibung = (
                f"{company} optimiert die Bestellmengen für zwei Produktgruppen: {prod1} und {prod2}. "
                f"{intro_extra} "
                f"Die Lagerkosten betragen {c1s}€ pro {order_unit} {prod1} und {c2s}€ pro {order_unit} {prod2}. "
                f"Um die Versorgungssicherheit zu gewährleisten, muss ein Mindestbestand eingehalten werden: "
                f"{a10} {unit_name} pro {order_unit} {prod1} und {a11} {unit_name} pro {order_unit} {prod2} "
                f"ergeben zusammen mindestens {b0} {unit_name}. "
                f"Die {cap_name} ist begrenzt: "
                f"{a20} {unit_name} pro {order_unit} {prod1} und {a21} {unit_name} pro {order_unit} {prod2} "
                f"dürfen zusammen höchstens {b1} {unit_name} belegen. "
                f"Zusätzlich gilt eine Budgetgrenze: "
                f"{a30} {unit_name} pro {order_unit} {prod1} und {a31} {unit_name} pro {order_unit} {prod2} "
                f"dürfen zusammen höchstens {b2} {unit_name} beanspruchen. "
                f"{closing_extra}"
            )
            h_nb = [
                [
                    {"text": f"{a10} {unit_name} pro {order_unit} {prod1}", "bedeutung": f"{a10}x₁"},
                    {"text": f"{a11} {unit_name} pro {order_unit} {prod2}", "bedeutung": f"+ {a11}x₂"},
                    {"text": f"mindestens {b0} {unit_name}", "bedeutung": f"≥ {b0}"},
                ],
                [
                    {"text": f"{a20} {unit_name} pro {order_unit} {prod1}", "bedeutung": f"{a20}x₁"},
                    {"text": f"{a21} {unit_name} pro {order_unit} {prod2}", "bedeutung": f"+ {a21}x₂"},
                    {"text": f"höchstens {b1} {unit_name} belegen", "bedeutung": f"≤ {b1}"},
                ],
                [
                    {"text": f"{a30} {unit_name} pro {order_unit} {prod1}", "bedeutung": f"{a30}x₁"},
                    {"text": f"{a31} {unit_name} pro {order_unit} {prod2}", "bedeutung": f"+ {a31}x₂"},
                    {"text": f"höchstens {b2} {unit_name} beanspruchen", "bedeutung": f"≤ {b2}"},
                ],
            ]
            nb_strings = [
                f"{a10}x1 + {a11}x2 ≥ {b0} (Mindestbestand)",
                f"{a20}x1 + {a21}x2 ≤ {b1} ({cap_name})",
                f"{a30}x1 + {a31}x2 ≤ {b2} (Budgetgrenze)",
                "x1, x2 ≥ 0",
            ]
        else:
            # <=, >= pattern
            beschreibung = (
                f"{company} optimiert die Bestellmengen für zwei Produktgruppen: {prod1} und {prod2}. "
                f"{intro_extra} "
                f"Die Lagerkosten betragen {c1s}€ pro {order_unit} {prod1} und {c2s}€ pro {order_unit} {prod2}. "
                f"Um die Versorgungssicherheit zu gewährleisten, muss ein Mindestbestand eingehalten werden: "
                f"{a10} {unit_name} pro {order_unit} {prod1} und {a11} {unit_name} pro {order_unit} {prod2} "
                f"ergeben zusammen mindestens {b0} {unit_name}. "
                f"Die {cap_name} ist begrenzt: "
                f"{a20} {unit_name} pro {order_unit} {prod1} und {a21} {unit_name} pro {order_unit} {prod2} "
                f"dürfen zusammen höchstens {b1} {unit_name} belegen. "
                f"Außerdem gilt eine zweite Mindestanforderung: "
                f"{a30} {unit_name} pro {order_unit} {prod1} und {a31} {unit_name} pro {order_unit} {prod2} "
                f"müssen zusammen mindestens {b2} {unit_name} erreichen. "
                f"{closing_extra}"
            )
            h_nb = [
                [
                    {"text": f"{a10} {unit_name} pro {order_unit} {prod1}", "bedeutung": f"{a10}x₁"},
                    {"text": f"{a11} {unit_name} pro {order_unit} {prod2}", "bedeutung": f"+ {a11}x₂"},
                    {"text": f"mindestens {b0} {unit_name}", "bedeutung": f"≥ {b0}"},
                ],
                [
                    {"text": f"{a20} {unit_name} pro {order_unit} {prod1}", "bedeutung": f"{a20}x₁"},
                    {"text": f"{a21} {unit_name} pro {order_unit} {prod2}", "bedeutung": f"+ {a21}x₂"},
                    {"text": f"höchstens {b1} {unit_name} belegen", "bedeutung": f"≤ {b1}"},
                ],
                [
                    {"text": f"{a30} {unit_name} pro {order_unit} {prod1}", "bedeutung": f"{a30}x₁"},
                    {"text": f"{a31} {unit_name} pro {order_unit} {prod2}", "bedeutung": f"+ {a31}x₂"},
                    {"text": f"mindestens {b2} {unit_name} erreichen", "bedeutung": f"≥ {b2}"},
                ],
            ]
            sym2 = "≥" if ct[2] == ">=" else "≤"
            nb_strings = [
                f"{a10}x1 + {a11}x2 ≥ {b0} (Mindestbestand)",
                f"{a20}x1 + {a21}x2 ≤ {b1} ({cap_name})",
                f"{a30}x1 + {a31}x2 {sym2} {b2} (Mindestanforderung)",
                "x1, x2 ≥ 0",
            ]
        h_zf = [
            {"text": f"{c1s}€ pro {order_unit} {prod1}", "bedeutung": f"{c1s} × x₁"},
            {"text": f"{c2s}€ pro {order_unit} {prod2}", "bedeutung": f"{c2s} × x₂"},
        ]

    elif n == 4:
        a10=fmt(A[0][0]); a11=fmt(A[0][1]); b0s=fmt(b[0])
        a20=fmt(A[1][0]); a21=fmt(A[1][1]); b1s=fmt(b[1])
        a30=fmt(A[2][0]); a31=fmt(A[2][1]); b2s=fmt(b[2])
        a40=fmt(A[3][0]); a41=fmt(A[3][1]); b3s=fmt(b[3])

        nb_hl = []
        c0_text = (
            f"Um die Versorgungssicherheit zu gewährleisten, muss ein Mindestbestand eingehalten werden: "
            f"{a10} {unit_name} pro {order_unit} {prod1} und {a11} {unit_name} pro {order_unit} {prod2} "
            f"ergeben zusammen mindestens {b0s} {unit_name}."
        )
        nb_hl.append([
            {"text": f"{a10} {unit_name} pro {order_unit} {prod1}", "bedeutung": f"{a10}x₁"},
            {"text": f"{a11} {unit_name} pro {order_unit} {prod2}", "bedeutung": f"+ {a11}x₂"},
            {"text": f"mindestens {b0s} {unit_name}", "bedeutung": f"≥ {b0s}"},
        ])

        if ct[1] == "<=":
            c1_text = (
                f" Die {cap_name} ist begrenzt: "
                f"{a20} {unit_name} pro {order_unit} {prod1} und {a21} {unit_name} pro {order_unit} {prod2} "
                f"dürfen zusammen höchstens {b1s} {unit_name} belegen."
            )
            nb_hl.append([
                {"text": f"{a20} {unit_name} pro {order_unit} {prod1}", "bedeutung": f"{a20}x₁"},
                {"text": f"{a21} {unit_name} pro {order_unit} {prod2}", "bedeutung": f"+ {a21}x₂"},
                {"text": f"höchstens {b1s} {unit_name} belegen", "bedeutung": f"≤ {b1s}"},
            ])
        else:
            c1_text = (
                f" Eine weitere Mindestanforderung lautet: "
                f"{a20} {unit_name} pro {order_unit} {prod1} und {a21} {unit_name} pro {order_unit} {prod2} "
                f"müssen zusammen mindestens {b1s} {unit_name} betragen."
            )
            nb_hl.append([
                {"text": f"{a20} {unit_name} pro {order_unit} {prod1}", "bedeutung": f"{a20}x₁"},
                {"text": f"{a21} {unit_name} pro {order_unit} {prod2}", "bedeutung": f"+ {a21}x₂"},
                {"text": f"mindestens {b1s} {unit_name} betragen", "bedeutung": f"≥ {b1s}"},
            ])

        if ct[2] == "<=":
            c2_text = (
                f" Zusätzlich gilt eine Budgetgrenze: "
                f"{a30} {unit_name} pro {order_unit} {prod1} und {a31} {unit_name} pro {order_unit} {prod2} "
                f"dürfen zusammen höchstens {b2s} {unit_name} beanspruchen."
            )
            nb_hl.append([
                {"text": f"{a30} {unit_name} pro {order_unit} {prod1}", "bedeutung": f"{a30}x₁"},
                {"text": f"{a31} {unit_name} pro {order_unit} {prod2}", "bedeutung": f"+ {a31}x₂"},
                {"text": f"höchstens {b2s} {unit_name} beanspruchen", "bedeutung": f"≤ {b2s}"},
            ])
        else:
            c2_text = (
                f" Zusätzlich müssen "
                f"{a30} {unit_name} pro {order_unit} {prod1} und {a31} {unit_name} pro {order_unit} {prod2} "
                f"zusammen mindestens {b2s} {unit_name} ergeben."
            )
            nb_hl.append([
                {"text": f"{a30} {unit_name} pro {order_unit} {prod1}", "bedeutung": f"{a30}x₁"},
                {"text": f"{a31} {unit_name} pro {order_unit} {prod2}", "bedeutung": f"+ {a31}x₂"},
                {"text": f"mindestens {b2s} {unit_name} ergeben", "bedeutung": f"≥ {b2s}"},
            ])

        if ct[3] == "<=":
            c3_text = (
                f" Schließlich dürfen "
                f"{a40} {unit_name} pro {order_unit} {prod1} und {a41} {unit_name} pro {order_unit} {prod2} "
                f"zusammen höchstens {b3s} {unit_name} umfassen."
            )
            nb_hl.append([
                {"text": f"{a40} {unit_name} pro {order_unit} {prod1}", "bedeutung": f"{a40}x₁"},
                {"text": f"{a41} {unit_name} pro {order_unit} {prod2}", "bedeutung": f"+ {a41}x₂"},
                {"text": f"höchstens {b3s} {unit_name} umfassen", "bedeutung": f"≤ {b3s}"},
            ])
        else:
            c3_text = (
                f" Schließlich müssen "
                f"{a40} {unit_name} pro {order_unit} {prod1} und {a41} {unit_name} pro {order_unit} {prod2} "
                f"zusammen mindestens {b3s} {unit_name} ausmachen."
            )
            nb_hl.append([
                {"text": f"{a40} {unit_name} pro {order_unit} {prod1}", "bedeutung": f"{a40}x₁"},
                {"text": f"{a41} {unit_name} pro {order_unit} {prod2}", "bedeutung": f"+ {a41}x₂"},
                {"text": f"mindestens {b3s} {unit_name} ausmachen", "bedeutung": f"≥ {b3s}"},
            ])

        beschreibung = (
            f"{company} optimiert die Bestellmengen für zwei Produktgruppen: {prod1} und {prod2}. "
            f"{intro_extra} "
            f"Die Lagerkosten betragen {c1s}€ pro {order_unit} {prod1} und {c2s}€ pro {order_unit} {prod2}. "
            + c0_text + c1_text + c2_text + c3_text
            + f" {closing_extra}"
        )
        h_zf = [
            {"text": f"{c1s}€ pro {order_unit} {prod1}", "bedeutung": f"{c1s} × x₁"},
            {"text": f"{c2s}€ pro {order_unit} {prod2}", "bedeutung": f"{c2s} × x₂"},
        ]
        h_nb = nb_hl

        nb_strings = []
        for ci in range(4):
            a1s=fmt(A[ci][0]); a2s=fmt(A[ci][1]); bs=fmt(b[ci])
            sym = "≥" if ct[ci] == ">=" else "≤"
            if ct[ci] == ">=":
                label = "Mindestbestand" if ci == 0 else "Mindestanforderung"
            else:
                label = [cap_name, cap_name, "Budgetgrenze", "Obergrenze"][ci]
            nb_strings.append(f"{a1s}x1 + {a2s}x2 {sym} {bs} ({label})")
        nb_strings.append("x1, x2 ≥ 0")

    hinweis = "Achten Sie auf die Richtung der Ungleichungen: Mindestbestände erfordern ≥, Kapazitätsgrenzen erfordern ≤."

    problem = {
        "titel": titel,
        "beschreibung": beschreibung,
        "typ": "Lagerhaltung",
        "optimierungsziel": "minimieren",
        "variablen": [f"x1 = Bestellmenge {prod1}", f"x2 = Bestellmenge {prod2}"],
        "zielfunktion": build_zf(c, "minimieren"),
        "nebenbedingungen": nb_strings,
        "hinweis": hinweis,
        "highlights": {"zielfunktion": h_zf, "nebenbedingungen": h_nb},
    }

    errors = validate_highlights(problem)
    if errors:
        print(f"LAGER Problem {i} ({titel}) ERRORS:", file=sys.stderr)
        for e in errors: print(e, file=sys.stderr)
        print(f"  beschreibung: {beschreibung[:300]}...", file=sys.stderr)
        sys.exit(1)
    lager_problems.append(problem)


# ============================================================
# QUALITÄTSKONTROLLE - 10 problems
# ============================================================
# (titel, method1, method2, company, defect_unit, cap_name, test_unit, test_unit_pl, intro_extra, closing_extra)
qk_configs = [
    ("Halbleiter-Defektprüfung", "optische Prüfung", "elektrische Prüfung", "Ein Halbleiterhersteller",
     "Defekttypen", "Prüfkapazität", "Durchlauf", "Durchläufe",
     "In der hochautomatisierten Chipfertigung müssen verschiedene Defekttypen zuverlässig identifiziert werden, bevor die Wafer die Produktion verlassen.",
     "Der Qualitätsmanager sucht die kostenoptimale Kombination beider Prüfverfahren, die alle Anforderungen an die Defekterkennung erfüllt und die Kapazitätsgrenzen einhält."),

    ("Lebensmittellabor-Kontaminationsprüfung", "Schnelltest", "Laboranalyse", "Ein Lebensmittellabor",
     "Kontaminationsarten", "Testkapazität", "Test", "Tests",
     "Das Labor untersucht eingehende Lebensmittelproben auf verschiedene Kontaminationsarten und muss dabei strenge Sicherheitsstandards einhalten.",
     "Der Laborleiter möchte die Gesamttestkosten minimieren und gleichzeitig sicherstellen, dass alle vorgeschriebenen Kontaminationsarten abgedeckt werden."),

    ("Kfz-Inspektionsoptimierung", "Sichtprüfung", "Funktionsprüfung", "Eine Kfz-Werkstatt",
     "Prüfpunkte", "Inspektionskapazität", "Prüfung", "Prüfungen",
     "Bei der Hauptuntersuchung müssen zahlreiche Prüfpunkte abgearbeitet werden, und die Werkstatt bietet zwei unterschiedlich gründliche Prüfmethoden an.",
     "Das Ziel ist die Minimierung der Gesamtprüfkosten bei vollständiger Abdeckung aller vorgeschriebenen Prüfpunkte und Einhaltung der Kapazitätsgrenze."),

    ("Medizintechnik-Sterilisationskontrolle", "Sterilisationsprüfung", "Funktionsprüfung", "Ein Medizintechnikunternehmen",
     "Qualitätsmerkmale", "Prüfkapazität", "Prüfung", "Prüfungen",
     "Medizinische Geräte müssen vor der Auslieferung umfassend auf Sterilität und einwandfreie Funktion geprüft werden, um Patientensicherheit zu gewährleisten.",
     "Der Prüfleiter sucht die kostengünstigste Prüfstrategie, die alle vorgeschriebenen Qualitätsmerkmale abdeckt und die verfügbare Prüfkapazität nicht überschreitet."),

    ("Software-Fehleranalyse", "automatisierter Test", "manueller Test", "Ein Softwareunternehmen",
     "Fehlerkategorien", "Testkapazität", "Testdurchlauf", "Testdurchläufe",
     "Vor jedem Release muss die Software gründlich auf verschiedene Fehlerkategorien getestet werden, wobei automatisierte und manuelle Tests unterschiedliche Stärken haben.",
     "Der Testmanager möchte die Gesamttestkosten minimieren und dabei alle relevanten Fehlerkategorien abdecken sowie die Testkapazität einhalten."),

    ("Brückenbauwerk-Schadenserkennung", "visuelle Inspektion", "Ultraschallprüfung", "Ein Ingenieurbüro",
     "Schadensarten", "Inspektionskapazität", "Inspektion", "Inspektionen",
     "Bei der regelmäßigen Brückeninspektion müssen verschiedene Schadensarten wie Risse, Korrosion und Materialermüdung erfasst werden.",
     "Der Chefingenieur sucht die kostengünstigste Inspektionsstrategie, die alle vorgeschriebenen Schadensarten erfasst und die verfügbare Inspektionskapazität berücksichtigt."),

    ("Chipfertigung-Röntgenkontrolle", "Röntgenprüfung", "thermische Prüfung", "Ein Chiphersteller",
     "Fehlerarten", "Testkapazität", "Durchlauf", "Durchläufe",
     "In der fortgeschrittenen Halbleiterproduktion werden Röntgen- und Thermalanalysen eingesetzt, um verborgene Defekte in mehrlagigen Chipstrukturen aufzuspüren.",
     "Die Qualitätsmanagerin sucht die kostenoptimale Kombination beider Prüfverfahren, die alle Fehlerarten abdeckt und die Kapazitäts- sowie Zeitgrenzen respektiert."),

    ("Lebensmittelbetrieb-Schadstoffanalyse", "Sensorprüfung", "chemische Analyse", "Ein Lebensmittelbetrieb",
     "Schadstoffarten", "Testkapazität", "Test", "Tests",
     "Der Betrieb muss regelmäßig Proben auf verschiedene Schadstoffarten untersuchen, um die Lebensmittelsicherheit zu garantieren und die Zulassung zu behalten.",
     "Die Laborleiterin möchte die Gesamttestkosten minimieren und dabei alle geforderten Schadstoffarten erfassen sowie die Testkapazität nicht überschreiten."),

    ("Autohaus-Diagnoseoptimierung", "manuelle Prüfung", "computergestützte Diagnose", "Ein Autohaus",
     "Fehlerarten", "Diagnosekapazität", "Durchlauf", "Durchläufe",
     "Das Autohaus bietet umfassende Fahrzeugdiagnosen an, bei denen sowohl klassische Handarbeit als auch moderne Computerdiagnostik zum Einsatz kommen.",
     "Die Werkstattleiterin möchte die Diagnosekosten minimieren und dabei sicherstellen, dass alle relevanten Fehlerarten erkannt werden und die Diagnosekapazität eingehalten wird."),

    ("Implantathersteller-Belastungstest", "optische Kontrolle", "mechanische Belastungsprüfung", "Ein Implantathersteller",
     "Defektkategorien", "Prüfkapazität", "Prüfung", "Prüfungen",
     "Medizinische Implantate unterliegen strengsten Qualitätsanforderungen und müssen vor dem Einsatz am Patienten umfassend geprüft werden.",
     "Die Prüfleiterin sucht die kostenminimale Prüfstrategie, die alle vorgeschriebenen Defektkategorien abdeckt und die verfügbare Prüfkapazität einhält."),
]

qk_problems = []
for i in range(10):
    m = qk_math[i]
    c = m["c"]; A = m["A"]; b = m["b"]; ct = m["constraint_types"]
    n = len(A)
    cfg = qk_configs[i]
    titel, method1, method2, company, defect_unit, cap_name, test_unit, test_unit_pl, intro_extra, closing_extra = cfg

    c1s = fmt(c[0]); c2s = fmt(c[1])

    if n == 2:
        a10=fmt(A[0][0]); a11=fmt(A[0][1]); b0=fmt(b[0])
        a20=fmt(A[1][0]); a21=fmt(A[1][1]); b1=fmt(b[1])

        beschreibung = (
            f"{company} setzt zwei Prüfverfahren ein: {method1} und {method2}. "
            f"{intro_extra} "
            f"Die {method1} kostet {c1s}€ pro {test_unit} und erkennt dabei {a10} {defect_unit} pro {test_unit}. "
            f"Die {method2} kostet {c2s}€ pro {test_unit} und erkennt {a11} {defect_unit} pro {test_unit}. "
            f"Pro Schicht müssen mindestens {b0} {defect_unit} abgedeckt werden, um die Qualitätsnorm zu erfüllen. "
            f"Gleichzeitig stehen pro Schicht höchstens {b1} {test_unit_pl} zur Verfügung, "
            f"wobei eine {method1} {a20} {test_unit_pl} und eine {method2} {a21} {test_unit_pl} beansprucht. "
            f"{closing_extra}"
        )
        h_zf = [
            {"text": f"{method1} kostet {c1s}€ pro {test_unit}", "bedeutung": f"{c1s} × x₁"},
            {"text": f"{method2} kostet {c2s}€ pro {test_unit}", "bedeutung": f"{c2s} × x₂"},
        ]
        h_nb = [
            [
                {"text": f"erkennt dabei {a10} {defect_unit} pro {test_unit}", "bedeutung": f"{a10}x₁"},
                {"text": f"erkennt {a11} {defect_unit} pro {test_unit}", "bedeutung": f"+ {a11}x₂"},
                {"text": f"mindestens {b0} {defect_unit} abgedeckt", "bedeutung": f"≥ {b0}"},
            ],
            [
                {"text": f"eine {method1} {a20} {test_unit_pl}", "bedeutung": f"{a20}x₁"},
                {"text": f"eine {method2} {a21} {test_unit_pl}", "bedeutung": f"+ {a21}x₂"},
                {"text": f"höchstens {b1} {test_unit_pl}", "bedeutung": f"≤ {b1}"},
            ],
        ]
        nb_strings = [
            f"{a10}x1 + {a11}x2 ≥ {b0} (Mindestabdeckung)",
            f"{a20}x1 + {a21}x2 ≤ {b1} ({cap_name})",
            "x1, x2 ≥ 0",
        ]

    elif n == 3:
        a10=fmt(A[0][0]); a11=fmt(A[0][1]); b0=fmt(b[0])
        a20=fmt(A[1][0]); a21=fmt(A[1][1]); b1=fmt(b[1])
        a30=fmt(A[2][0]); a31=fmt(A[2][1]); b2=fmt(b[2])

        if ct[1] == "<=" and ct[2] == "<=":
            beschreibung = (
                f"{company} setzt zwei Prüfverfahren ein: {method1} und {method2}. "
                f"{intro_extra} "
                f"Die {method1} kostet {c1s}€ pro {test_unit} und erkennt dabei {a10} {defect_unit} pro {test_unit}. "
                f"Die {method2} kostet {c2s}€ pro {test_unit} und erkennt {a11} {defect_unit} pro {test_unit}. "
                f"Pro Schicht müssen mindestens {b0} {defect_unit} abgedeckt werden. "
                f"Die {cap_name} ist begrenzt: "
                f"eine {method1} benötigt {a20} Stunden und eine {method2} benötigt {a21} Stunden, "
                f"insgesamt stehen höchstens {b1} Stunden zur Verfügung. "
                f"Zudem dürfen maximal {b2} {test_unit_pl} durchgeführt werden, "
                f"wobei eine {method1} {a30} {test_unit_pl} und eine {method2} {a31} {test_unit_pl} zählt. "
                f"{closing_extra}"
            )
            h_zf = [
                {"text": f"{method1} kostet {c1s}€ pro {test_unit}", "bedeutung": f"{c1s} × x₁"},
                {"text": f"{method2} kostet {c2s}€ pro {test_unit}", "bedeutung": f"{c2s} × x₂"},
            ]
            h_nb = [
                [
                    {"text": f"erkennt dabei {a10} {defect_unit} pro {test_unit}", "bedeutung": f"{a10}x₁"},
                    {"text": f"erkennt {a11} {defect_unit} pro {test_unit}", "bedeutung": f"+ {a11}x₂"},
                    {"text": f"mindestens {b0} {defect_unit} abgedeckt", "bedeutung": f"≥ {b0}"},
                ],
                [
                    {"text": f"eine {method1} benötigt {a20} Stunden", "bedeutung": f"{a20}x₁"},
                    {"text": f"eine {method2} benötigt {a21} Stunden", "bedeutung": f"+ {a21}x₂"},
                    {"text": f"höchstens {b1} Stunden", "bedeutung": f"≤ {b1}"},
                ],
                [
                    {"text": f"eine {method1} {a30} {test_unit_pl}", "bedeutung": f"{a30}x₁"},
                    {"text": f"eine {method2} {a31} {test_unit_pl}", "bedeutung": f"+ {a31}x₂"},
                    {"text": f"maximal {b2} {test_unit_pl}", "bedeutung": f"≤ {b2}"},
                ],
            ]
            nb_strings = [
                f"{a10}x1 + {a11}x2 ≥ {b0} (Mindestabdeckung)",
                f"{a20}x1 + {a21}x2 ≤ {b1} (Zeitkapazität)",
                f"{a30}x1 + {a31}x2 ≤ {b2} ({cap_name})",
                "x1, x2 ≥ 0",
            ]
        else:
            # <= >= pattern
            beschreibung = (
                f"{company} setzt zwei Prüfverfahren ein: {method1} und {method2}. "
                f"{intro_extra} "
                f"Die {method1} kostet {c1s}€ pro {test_unit} und erkennt dabei {a10} {defect_unit} pro {test_unit}. "
                f"Die {method2} kostet {c2s}€ pro {test_unit} und erkennt {a11} {defect_unit} pro {test_unit}. "
                f"Pro Schicht müssen mindestens {b0} {defect_unit} abgedeckt werden. "
                f"Die {cap_name} ist begrenzt: "
                f"eine {method1} benötigt {a20} Stunden und eine {method2} benötigt {a21} Stunden, "
                f"insgesamt stehen höchstens {b1} Stunden zur Verfügung. "
                f"Außerdem gilt eine zweite Mindestanforderung: "
                f"eine {method1} liefert {a30} Datenpunkte und eine {method2} liefert {a31} Datenpunkte, "
                f"zusammen müssen mindestens {b2} Datenpunkte erreicht werden. "
                f"{closing_extra}"
            )
            h_zf = [
                {"text": f"{method1} kostet {c1s}€ pro {test_unit}", "bedeutung": f"{c1s} × x₁"},
                {"text": f"{method2} kostet {c2s}€ pro {test_unit}", "bedeutung": f"{c2s} × x₂"},
            ]
            h_nb = [
                [
                    {"text": f"erkennt dabei {a10} {defect_unit} pro {test_unit}", "bedeutung": f"{a10}x₁"},
                    {"text": f"erkennt {a11} {defect_unit} pro {test_unit}", "bedeutung": f"+ {a11}x₂"},
                    {"text": f"mindestens {b0} {defect_unit} abgedeckt", "bedeutung": f"≥ {b0}"},
                ],
                [
                    {"text": f"eine {method1} benötigt {a20} Stunden", "bedeutung": f"{a20}x₁"},
                    {"text": f"eine {method2} benötigt {a21} Stunden", "bedeutung": f"+ {a21}x₂"},
                    {"text": f"höchstens {b1} Stunden", "bedeutung": f"≤ {b1}"},
                ],
                [
                    {"text": f"eine {method1} liefert {a30} Datenpunkte", "bedeutung": f"{a30}x₁"},
                    {"text": f"eine {method2} liefert {a31} Datenpunkte", "bedeutung": f"+ {a31}x₂"},
                    {"text": f"mindestens {b2} Datenpunkte erreicht", "bedeutung": f"≥ {b2}"},
                ],
            ]
            nb_strings = [
                f"{a10}x1 + {a11}x2 ≥ {b0} (Mindestabdeckung)",
                f"{a20}x1 + {a21}x2 ≤ {b1} (Zeitkapazität)",
                f"{a30}x1 + {a31}x2 ≥ {b2} (Mindestanforderung)",
                "x1, x2 ≥ 0",
            ]

    hinweis = "Achten Sie auf die Richtung der Ungleichungen: Die Mindestabdeckung erfordert ≥, Kapazitätsgrenzen erfordern ≤."

    problem = {
        "titel": titel,
        "beschreibung": beschreibung,
        "typ": "Qualitätskontrolle",
        "optimierungsziel": "minimieren",
        "variablen": [f"x1 = Anzahl {test_unit_pl} {method1}", f"x2 = Anzahl {test_unit_pl} {method2}"],
        "zielfunktion": build_zf(c, "minimieren"),
        "nebenbedingungen": nb_strings,
        "hinweis": hinweis,
        "highlights": {"zielfunktion": h_zf, "nebenbedingungen": h_nb},
    }

    errors = validate_highlights(problem)
    if errors:
        print(f"QK Problem {i} ({titel}) ERRORS:", file=sys.stderr)
        for e in errors: print(e, file=sys.stderr)
        print(f"  beschreibung: {beschreibung}", file=sys.stderr)
        sys.exit(1)
    qk_problems.append(problem)


# Write
with open(os.path.join(HERE, "batch_17_lagerhaltung.json"), "w", encoding="utf-8") as f:
    json.dump(lager_problems, f, ensure_ascii=False, indent=2)
with open(os.path.join(HERE, "batch_18_qualitaetskontrolle.json"), "w", encoding="utf-8") as f:
    json.dump(qk_problems, f, ensure_ascii=False, indent=2)

print(f"Generated {len(lager_problems)} Lagerhaltung problems -> batch_17_lagerhaltung.json")
print(f"Generated {len(qk_problems)} Qualitätskontrolle problems -> batch_18_qualitaetskontrolle.json")
print("All highlights validated successfully!")
