"""Busca de aeroportos e cidades para o autocomplete da interface.

A base vem de `enums/airports.csv` do projeto AWeirdDev/flights, reduzida pelo
script `scripts/build_airport_data.py`, que também monta a tabela de regiões
metropolitanas — o CSV de origem guarda o município da pista (JFK aparece em
"Inwood"), então sem elas não dá para achar um aeroporto pelo nome da cidade.

Tanto o código do aeroporto quanto o da região metropolitana servem de origem
ou destino: o Google Flights aceita os dois.
"""

from __future__ import annotations

import csv
import unicodedata
from dataclasses import dataclass, field
from functools import lru_cache
from pathlib import Path

DATA_DIR = Path(__file__).resolve().parent.parent / "data"


@dataclass(frozen=True)
class Place:
    """Um aeroporto ou uma região metropolitana."""

    code: str
    name: str
    country: str
    kind: str = "airport"
    city: str = ""
    timezone: str = ""
    city_code: str = ""
    airports: tuple[str, ...] = ()
    terms: tuple[str, ...] = field(default=(), compare=False)

    def as_dict(self) -> dict[str, object]:
        return {
            "code": self.code,
            "name": self.name,
            "city": self.city,
            "country": self.country,
            "kind": self.kind,
            "airports": list(self.airports),
        }


def normalize(text: str) -> str:
    """Minúsculas e sem acentos, para casar "sao paulo" com "São Paulo"."""
    decomposed = unicodedata.normalize("NFD", text.casefold())
    return "".join(c for c in decomposed if unicodedata.category(c) != "Mn")


@lru_cache(maxsize=1)
def _places() -> tuple[list[Place], dict[str, Place], dict[str, Place]]:
    """Carrega cidades e aeroportos, com os termos de busca normalizados."""
    places: list[Place] = []

    with (DATA_DIR / "cities.csv").open(encoding="utf-8") as file:
        for row in csv.DictReader(file):
            aliases = [alias for alias in row["aliases"].split("|") if alias]
            places.append(
                Place(
                    code=row["code"].strip().upper(),
                    name=row["name"].strip(),
                    country=row["country"].strip().upper(),
                    kind="city",
                    city=row["name"].strip(),
                    airports=tuple(row["airports"].split()),
                    terms=tuple(
                        normalize(term) for term in (row["name"], *aliases)
                    ),
                )
            )

    with (DATA_DIR / "airports.csv").open(encoding="utf-8") as file:
        for row in csv.DictReader(file):
            places.append(
                Place(
                    code=row["code"].strip().upper(),
                    name=row["name"].strip(),
                    country=row["country"].strip().upper(),
                    kind="airport",
                    city=row["city"].strip(),
                    timezone=row["timezone"].strip(),
                    city_code=row["city_code"].strip().upper(),
                    terms=(normalize(row["city"]), normalize(row["name"])),
                )
            )

    # Cidades entram antes, então uma sigla compartilhada (LIS, SHA…) resolve
    # para a região metropolitana, que é o que o usuário costuma querer.
    index: dict[str, Place] = {}
    airport_index: dict[str, Place] = {}

    for place in places:
        index.setdefault(place.code, place)
        if place.kind == "airport":
            airport_index.setdefault(place.code, place)

    return places, index, airport_index


def get(code: str) -> Place | None:
    """Busca um aeroporto ou cidade pelo código de três letras."""
    _, index, _ = _places()
    return index.get(code.strip().upper())


def airport(code: str) -> Place | None:
    """Busca especificamente um aeroporto (para fuso horário, por exemplo)."""
    _, _, airport_index = _places()
    return airport_index.get(code.strip().upper())


def search(query: str, limit: int = 10) -> list[Place]:
    """Lugares que casam com `query`, dos mais para os menos relevantes.

    A ordem vai do código exato até uma menção solta no nome do aeroporto.
    Regiões metropolitanas ganham dos aeroportos individuais, e entre
    aeroportos empatados os internacionais vêm primeiro — sem dados de
    tráfego, é o melhor indício de qual o usuário procura.
    """
    term = normalize(query.strip())
    if not term:
        return []

    places, _, _ = _places()
    ranked: list[tuple[int, int, str, Place]] = []

    for place in places:
        rank = _rank(place, term)
        if rank is None:
            continue

        major = 0 if "international" in normalize(place.name) else 1
        ranked.append((rank, major, place.city or place.name, place))

    ranked.sort(key=lambda item: item[:3])

    # Alguns códigos servem à cidade e a um aeroporto (MIA, LIS, BSB). Mostrar
    # os dois só confunde: a cidade já cobre o aeroporto de mesmo código.
    cities = {place.code for *_, place in ranked if place.kind == "city"}
    results = [
        place
        for *_, place in ranked
        if place.kind == "city" or place.code not in cities
    ]

    return results[:limit]


def _rank(place: Place, term: str) -> int | None:
    """Quão bem `place` casa com `term`; menor é melhor, `None` não casa."""
    code = place.code.casefold()
    city_ranks = (0, 2, 4, 6) if place.kind == "city" else (1, 3, 5, 7)
    exact, prefix, contains, name_hit = city_ranks

    if code == term:
        return exact

    if any(candidate == term for candidate in place.terms):
        return exact

    if code.startswith(term):
        return prefix

    if any(candidate.startswith(term) for candidate in place.terms):
        return prefix

    if place.kind == "city":
        return contains if any(term in c for c in place.terms) else None

    if term in normalize(place.city):
        return contains

    if term in normalize(place.name):
        return name_hit

    return None
