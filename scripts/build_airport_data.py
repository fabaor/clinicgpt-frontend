"""Gera `data/airports.csv` e `data/cities.csv` a partir do fast-flights.

A base de aeroportos vem de `enums/airports.csv` do repositório
https://github.com/AWeirdDev/flights (MIT). Aqui ela é reduzida às colunas que
a aplicação usa e complementada por uma tabela de regiões metropolitanas.

    python scripts/build_airport_data.py [caminho/para/airports.csv]

Sem argumento, o arquivo é baixado do repositório.
"""

from __future__ import annotations

import csv
import sys
import urllib.request
from collections import defaultdict
from io import StringIO
from pathlib import Path

UPSTREAM = (
    "https://raw.githubusercontent.com/AWeirdDev/flights/main/enums/airports.csv"
)
DATA_DIR = Path(__file__).resolve().parent.parent / "data"

# O CSV de origem traz o município da pista (JFK fica em "Inwood"), então não
# dá para achar um aeroporto pelo nome da cidade grande. A coluna `city_code`
# guarda o código metropolitano — que o Google Flights também aceita como
# origem/destino —, e esta tabela dá nome a ele. Só entram códigos presentes
# no CSV; a checagem acontece na geração. O terceiro item traz outros nomes
# usados para a mesma cidade, porque nem todo mundo digita em português.
CITIES: dict[str, tuple[str, str, list[str]]] = {
    "AKL": ("Auckland", "NZ", []),
    "AMS": ("Amsterdã", "NL", ["Amsterdam"]),
    "ATH": ("Atenas", "GR", ["Athens", "Athina"]),
    "AUH": ("Abu Dhabi", "AE", []),
    "BCN": ("Barcelona", "ES", []),
    "BER": ("Berlim", "DE", ["Berlin"]),
    "BHZ": ("Belo Horizonte", "BR", []),
    "BJS": ("Pequim", "CN", ["Beijing", "Peking"]),
    "BKK": ("Bangcoc", "TH", ["Bangkok"]),
    "BOG": ("Bogotá", "CO", ["Bogota"]),
    "BOM": ("Mumbai", "IN", ["Bombaim", "Mumbai"]),
    "BRU": ("Bruxelas", "BE", ["Brussels", "Bruxelles"]),
    "BSB": ("Brasília", "BR", []),
    "BUE": ("Buenos Aires", "AR", []),
    "CAI": ("Cairo", "EG", ["Cairo"]),
    "CHI": ("Chicago", "US", []),
    "CPH": ("Copenhague", "DK", ["Copenhagen", "Kobenhavn"]),
    "CWB": ("Curitiba", "BR", []),
    "DEL": ("Nova Délhi", "IN", ["New Delhi", "Delhi"]),
    "DOH": ("Doha", "QA", []),
    "DUB": ("Dublin", "IE", []),
    "DXB": ("Dubai", "AE", []),
    "FOR": ("Fortaleza", "BR", []),
    "FRA": ("Frankfurt", "DE", []),
    "HEL": ("Helsinque", "FI", ["Helsinki"]),
    "HKG": ("Hong Kong", "HK", ["Hong Kong"]),
    "HOU": ("Houston", "US", []),
    "IST": ("Istambul", "TR", ["Istanbul"]),
    "JKT": ("Jacarta", "ID", ["Jakarta"]),
    "JNB": ("Joanesburgo", "ZA", ["Johannesburg"]),
    "KUL": ("Kuala Lumpur", "MY", []),
    "LAX": ("Los Angeles", "US", []),
    "LIM": ("Lima", "PE", []),
    "LIS": ("Lisboa", "PT", ["Lisbon"]),
    "LON": ("Londres", "GB", ["London"]),
    "MAD": ("Madri", "ES", ["Madrid"]),
    "MAO": ("Manaus", "BR", []),
    "MEL": ("Melbourne", "AU", []),
    "MEX": ("Cidade do México", "MX", ["Mexico City", "Ciudad de Mexico"]),
    "MIA": ("Miami", "US", []),
    "MIL": ("Milão", "IT", ["Milan", "Milano"]),
    "MNL": ("Manila", "PH", []),
    "MOW": ("Moscou", "RU", ["Moscow", "Moskva"]),
    "MUC": ("Munique", "DE", ["Munich", "Munchen"]),
    "NYC": ("Nova York", "US", ["New York"]),
    "OPO": ("Porto", "PT", ["Oporto"]),
    "OSA": ("Osaka", "JP", []),
    "OSL": ("Oslo", "NO", []),
    "PAR": ("Paris", "FR", []),
    "POA": ("Porto Alegre", "BR", []),
    "PTY": ("Cidade do Panamá", "PA", ["Panama City"]),
    "REC": ("Recife", "BR", []),
    "RIO": ("Rio de Janeiro", "BR", []),
    "ROM": ("Roma", "IT", ["Rome"]),
    "SAO": ("São Paulo", "BR", []),
    "SCL": ("Santiago", "CL", []),
    "SEL": ("Seul", "KR", ["Seoul"]),
    "SGN": ("Ho Chi Minh", "VN", ["Ho Chi Minh City", "Saigon"]),
    "SHA": ("Xangai", "CN", ["Shanghai"]),
    "SIN": ("Singapura", "SG", ["Singapore"]),
    "SSA": ("Salvador", "BR", []),
    "STO": ("Estocolmo", "SE", ["Stockholm"]),
    "SYD": ("Sydney", "AU", []),
    "TLV": ("Tel Aviv", "IL", []),
    "TPE": ("Taipé", "TW", ["Taipei"]),
    "TYO": ("Tóquio", "JP", ["Tokyo", "Tokio"]),
    "VIE": ("Viena", "AT", ["Vienna", "Wien"]),
    "WAS": ("Washington", "US", []),
    "YMQ": ("Montreal", "CA", ["Montréal"]),
    "YTO": ("Toronto", "CA", []),
    "YVR": ("Vancouver", "CA", []),
    "ZRH": ("Zurique", "CH", ["Zurich", "Zürich"]),
}


def load(source: str | None) -> list[dict[str, str]]:
    if source:
        text = Path(source).read_text(encoding="utf-8")
    else:
        print(f"baixando {UPSTREAM}")
        with urllib.request.urlopen(UPSTREAM) as response:  # noqa: S310
            text = response.read().decode("utf-8")

    return list(csv.DictReader(StringIO(text)))


def main(source: str | None) -> int:
    rows = load(source)
    DATA_DIR.mkdir(exist_ok=True)

    airports = []
    members: dict[str, list[str]] = defaultdict(list)

    for row in rows:
        code = row["code"].strip().upper()
        if len(code) != 3 or not code.isalpha():
            continue

        city_code = row["city_code"].strip().upper()
        airports.append(
            {
                "code": code,
                "name": row["name"].strip(),
                "city": row["city"].strip(),
                "country": row["country_id"].strip().upper(),
                "timezone": row["time_zone_id"].strip(),
                "city_code": city_code,
            }
        )
        if city_code:
            members[city_code].append(code)

    airports.sort(key=lambda item: item["code"])
    _write(
        DATA_DIR / "airports.csv",
        ["code", "name", "city", "country", "timezone", "city_code"],
        airports,
    )

    cities = []
    for code, (name, country, aliases) in sorted(CITIES.items()):
        airport_codes = sorted(members.get(code, []))
        if not airport_codes:
            print(f"aviso: {code} ({name}) não existe na base de origem, ignorando")
            continue

        extra = [alias for alias in dict.fromkeys(aliases) if alias != name]
        cities.append(
            {
                "code": code,
                "name": name,
                "country": country,
                "aliases": "|".join(extra),
                "airports": " ".join(airport_codes),
            }
        )

    _write(
        DATA_DIR / "cities.csv",
        ["code", "name", "country", "aliases", "airports"],
        cities,
    )
    print(f"{len(airports)} aeroportos e {len(cities)} cidades gravados em {DATA_DIR}")
    return 0


def _write(path: Path, columns: list[str], rows: list[dict[str, str]]) -> None:
    with path.open("w", encoding="utf-8", newline="") as file:
        writer = csv.DictWriter(file, fieldnames=columns)
        writer.writeheader()
        writer.writerows(rows)


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1] if len(sys.argv) > 1 else None))
