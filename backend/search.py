"""Ponte entre a API HTTP e a biblioteca `fast_flights`.

Monta a query do Google Flights a partir do formulário, dispara a busca e
converte as dataclasses da biblioteca em JSON pronto para a interface.
"""

from __future__ import annotations

import inspect
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from typing import Any, Literal, Sequence
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from fast_flights import FlightQuery, Passengers, Query, create_query, get_flights
from fast_flights.model import Flights, SimpleDatetime, SingleFlight

from . import airports

SeatType = Literal["economy", "premium-economy", "business", "first"]
TripType = Literal["one-way", "round-trip"]


def _accepted(target: Callable[..., Any]) -> frozenset[str]:
    """Nomes de parâmetros que `target` aceita nesta versão instalada."""
    return frozenset(inspect.signature(target).parameters)


# A versão publicada no PyPI (3.0.2) ainda não tem os filtros mais novos do
# repositório. Descobrimos o que existe para não quebrar em nenhuma das duas.
QUERY_FEATURES = _accepted(create_query)
LEG_FEATURES = _accepted(FlightQuery.__init__)


def _supported(
    values: dict[str, Any], features: frozenset[str], dropped: set[str]
) -> dict[str, Any]:
    """Remove os filtros que a versão instalada não conhece, anotando quais."""
    kept: dict[str, Any] = {}

    for name, value in values.items():
        if name in features:
            kept[name] = value
        elif value not in (None, 0, False, [], ""):
            dropped.add(name)

    return kept


class SearchError(Exception):
    """Erro previsto durante a busca, com mensagem exibível ao usuário."""

    def __init__(self, message: str, *, status_code: int = 400) -> None:
        super().__init__(message)
        self.message = message
        self.status_code = status_code


@dataclass
class SearchRequest:
    """Parâmetros de uma busca, já validados."""

    from_airport: str
    to_airport: str
    depart_date: str
    return_date: str | None = None
    trip: TripType = "one-way"
    seat: SeatType = "economy"
    adults: int = 1
    children: int = 0
    infants_in_seat: int = 0
    infants_on_lap: int = 0
    currency: str = "BRL"
    language: str = "pt-BR"
    max_stops: int | None = None
    max_price: int | None = None
    carry_on_bags: int = 0
    checked_bags: int = 0
    airlines: list[str] = field(default_factory=list)
    earliest_departure_hour: int | None = None
    latest_departure_hour: int | None = None
    max_duration_minutes: int | None = None
    less_emissions_only: bool = False
    exclude_basic_economy: bool = False
    hide_separate_and_self_transfer: bool = False


def build_query(request: SearchRequest, dropped: set[str] | None = None) -> Query:
    """Traduz a busca para uma `Query` do fast-flights.

    Filtros que a versão instalada da biblioteca não suporta são ignorados e
    registrados em `dropped`, para a interface avisar o usuário.
    """
    if request.trip == "round-trip" and not request.return_date:
        raise SearchError("Informe a data de volta para uma viagem de ida e volta.")

    if request.from_airport == request.to_airport:
        raise SearchError("Origem e destino precisam ser aeroportos diferentes.")

    if dropped is None:
        dropped = set()

    leg_filters = _supported(
        {
            "airlines": request.airlines or None,
            "earliest_departure_hour": request.earliest_departure_hour,
            "latest_departure_hour": request.latest_departure_hour,
            "max_duration_minutes": request.max_duration_minutes,
            "less_emissions_only": request.less_emissions_only,
        },
        LEG_FEATURES,
        dropped,
    )

    legs = [
        FlightQuery(
            date=request.depart_date,
            from_airport=request.from_airport,
            to_airport=request.to_airport,
            **leg_filters,
        )
    ]

    if request.trip == "round-trip":
        legs.append(
            FlightQuery(
                date=request.return_date or "",
                from_airport=request.to_airport,
                to_airport=request.from_airport,
                **leg_filters,
            )
        )

    try:
        passengers = Passengers(
            adults=request.adults,
            children=request.children,
            infants_in_seat=request.infants_in_seat,
            infants_on_lap=request.infants_on_lap,
        )
    except AssertionError as error:
        raise SearchError(str(error)) from error

    query_filters = _supported(
        {
            "max_price": request.max_price,
            "carry_on_bags": request.carry_on_bags,
            "checked_bags": request.checked_bags,
            "exclude_basic_economy": request.exclude_basic_economy,
            "hide_separate_and_self_transfer": request.hide_separate_and_self_transfer,
        },
        QUERY_FEATURES,
        dropped,
    )

    return create_query(
        flights=legs,
        seat=request.seat,
        trip=request.trip,
        passengers=passengers,
        language=request.language,
        currency=request.currency,
        max_stops=request.max_stops,
        **query_filters,
    )


def run(request: SearchRequest, *, proxy: str | None = None) -> dict[str, Any]:
    """Executa a busca e devolve o payload da API."""
    dropped: set[str] = set()
    query = build_query(request, dropped)

    # FlightsNotFound é lançada quando o Google responde sem resultados; os
    # demais erros da biblioteca são de rede/parsing e viram 502.
    from fast_flights.exceptions import FlightsNotFound

    try:
        results = get_flights(query, proxy=proxy)
    except FlightsNotFound:
        results = []
    except Exception as error:  # noqa: BLE001 - a origem é o scraping do Google
        raise SearchError(
            "Não foi possível consultar o Google Flights agora "
            f"({type(error).__name__}). Tente de novo em alguns instantes.",
            status_code=502,
        ) from error

    return serialize_results(
        results, query=query, request=request, unsupported=sorted(dropped)
    )


def serialize_results(
    results: Sequence[Flights],
    *,
    query: Query,
    request: SearchRequest,
    unsupported: list[str] | None = None,
) -> dict[str, Any]:
    """Monta o JSON da resposta a partir dos resultados da biblioteca."""
    itineraries = [serialize_itinerary(item) for item in results]

    return {
        "unsupported_filters": unsupported or [],
        "currency": request.currency,
        "trip": request.trip,
        "google_flights_url": query.url(),
        "from_airport": _airport_payload(request.from_airport),
        "to_airport": _airport_payload(request.to_airport),
        "count": len(itineraries),
        "itineraries": itineraries,
    }


def serialize_itinerary(itinerary: Flights) -> dict[str, Any]:
    """Converte um itinerário em dicionário, com durações e escalas."""
    segments = [_serialize_segment(segment) for segment in itinerary.flights]
    _fill_layovers(segments)

    return {
        "price": itinerary.price,
        "airlines": list(itinerary.airlines),
        "stops": max(len(segments) - 1, 0),
        "total_minutes": _total_minutes(segments),
        "flight_minutes": sum(
            segment["duration_minutes"] or 0 for segment in segments
        ),
        "carbon": {
            "emission_grams": itinerary.carbon.emission,
            "typical_grams": itinerary.carbon.typical_on_route,
        },
        "segments": segments,
    }


def _serialize_segment(segment: SingleFlight) -> dict[str, Any]:
    departure = _isoformat(segment.departure)
    arrival = _isoformat(segment.arrival)

    return {
        "from": {
            "code": segment.from_airport.code,
            "name": segment.from_airport.name,
        },
        "to": {
            "code": segment.to_airport.code,
            "name": segment.to_airport.name,
        },
        "departure": departure,
        "arrival": arrival,
        "duration_minutes": segment.duration,
        "plane": segment.plane_type,
        "layover_minutes": None,
    }


def _fill_layovers(segments: list[dict[str, Any]]) -> None:
    """Preenche o tempo de conexão entre cada par de trechos consecutivos."""
    for previous, current in zip(segments, segments[1:]):
        landed = _instant(previous["arrival"], previous["to"]["code"])
        departs = _instant(current["departure"], current["from"]["code"])

        if landed is None or departs is None:
            continue

        minutes = round((departs - landed).total_seconds() / 60)
        if minutes >= 0:
            current["layover_minutes"] = minutes


def _total_minutes(segments: list[dict[str, Any]]) -> int | None:
    """Duração total da viagem, do primeiro embarque ao último desembarque.

    Usa os fusos dos aeroportos para chegar ao tempo real; sem eles, cai para
    a soma dos trechos com as conexões conhecidas.
    """
    if not segments:
        return None

    start = _instant(segments[0]["departure"], segments[0]["from"]["code"])
    end = _instant(segments[-1]["arrival"], segments[-1]["to"]["code"])

    if start is not None and end is not None:
        minutes = round((end - start).total_seconds() / 60)
        if minutes > 0:
            return minutes

    fallback = sum(segment["duration_minutes"] or 0 for segment in segments)
    fallback += sum(segment["layover_minutes"] or 0 for segment in segments)
    return fallback or None


def _instant(iso: str | None, airport_code: str) -> datetime | None:
    """Converte o horário local do aeroporto em um instante absoluto (UTC)."""
    if not iso:
        return None

    try:
        local = datetime.fromisoformat(iso)
    except ValueError:
        return None

    airport = airports.airport(airport_code)
    if airport is None or not airport.timezone:
        return None

    try:
        zone = ZoneInfo(airport.timezone)
    except (ZoneInfoNotFoundError, ValueError):
        return None

    return local.replace(tzinfo=zone).astimezone(ZoneInfo("UTC"))


def _isoformat(value: SimpleDatetime | None) -> str | None:
    """Formata a data/hora local da biblioteca como ISO 8601 sem fuso."""
    if value is None:
        return None

    date = _as_ints(value.date, 3)
    time = _as_ints(value.time, 2)

    if date is None:
        return None

    year, month, day = date
    hour, minute = time or (0, 0)

    try:
        # O Google usa 24:00 para meia-noite do dia seguinte em alguns voos.
        if hour == 24:
            return (
                datetime(year, month, day) + timedelta(days=1, minutes=minute)
            ).isoformat()
        return datetime(year, month, day, hour, minute).isoformat()
    except ValueError:
        return None


def _as_ints(value: Any, size: int) -> tuple[int, ...] | None:
    """Lê uma sequência de inteiros do payload do Google, se for válida."""
    if not isinstance(value, (list, tuple)) or len(value) < size:
        return None

    parts = value[:size]
    if any(not isinstance(part, int) for part in parts):
        return None

    return tuple(parts)


def _airport_payload(code: str) -> dict[str, str]:
    airport = airports.get(code)
    if airport is None:
        return {"code": code, "name": "", "city": "", "country": ""}
    return airport.as_dict()
