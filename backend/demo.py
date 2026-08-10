"""Resultados sintéticos para rodar a interface sem acessar o Google.

Ative com `FLIGHTS_DEMO=1`. Útil para desenvolver o front-end, para demonstrar
a aplicação offline e em ambientes onde `google.com` está bloqueado.
"""

from __future__ import annotations

from datetime import date, datetime, timedelta
from typing import Any

from fast_flights.model import (
    Airport,
    CarbonEmission,
    Flights,
    SimpleDatetime,
    SingleFlight,
)

from . import airports, search

# (companhias, escalas, preço base, minutos de voo, hora do embarque)
TEMPLATES: list[tuple[list[str], list[str], int, int, int]] = [
    (["LATAM"], [], 2890, 590, 22),
    (["GOL"], ["GIG"], 2450, 640, 8),
    (["American"], ["MIA"], 3120, 690, 14),
    (["Azul", "United"], ["VCP", "IAD"], 2280, 780, 6),
    (["Copa"], ["PTY"], 2670, 720, 11),
    (["Delta", "LATAM"], ["ATL"], 3480, 610, 19),
]


def results_for(request: search.SearchRequest) -> dict[str, Any]:
    """Monta uma resposta completa, no mesmo formato da busca real."""
    query = search.build_query(request)
    depart = date.fromisoformat(request.depart_date)
    passengers = request.adults + request.children + request.infants_in_seat

    itineraries = [
        _itinerary(request, depart, template, passengers) for template in TEMPLATES
    ]
    itineraries = [item for item in itineraries if _matches(item, request)]
    itineraries.sort(key=lambda flights: flights.price)

    payload = search.serialize_results(itineraries, query=query, request=request)
    payload["demo"] = True
    return payload


def _matches(itinerary: Flights, request: search.SearchRequest) -> bool:
    """Aplica os filtros do formulário — na busca real quem filtra é o Google."""
    stops = len(itinerary.flights) - 1
    if request.max_stops is not None and stops > request.max_stops:
        return False

    if request.max_price is not None and itinerary.price > request.max_price:
        return False

    minutes = sum(flight.duration for flight in itinerary.flights)
    if request.max_duration_minutes is not None and minutes > request.max_duration_minutes:
        return False

    hour = itinerary.flights[0].departure.time[0]
    if request.earliest_departure_hour is not None and hour < request.earliest_departure_hour:
        return False
    if request.latest_departure_hour is not None and hour > request.latest_departure_hour:
        return False

    if request.less_emissions_only:
        return itinerary.carbon.emission <= itinerary.carbon.typical_on_route

    return True


def _itinerary(
    request: search.SearchRequest,
    depart: date,
    template: tuple[list[str], list[str], int, int, int],
    passengers: int,
) -> Flights:
    carriers, stopovers, base_price, flight_minutes, boarding_hour = template

    codes = [request.from_airport, *stopovers, request.to_airport]
    legs = len(codes) - 1
    leg_minutes = flight_minutes // legs
    layover = 95

    segments: list[SingleFlight] = []
    cursor = datetime.combine(depart, datetime.min.time()) + timedelta(
        hours=boarding_hour
    )

    for origin, destination in zip(codes, codes[1:]):
        landing = cursor + timedelta(minutes=leg_minutes)
        segments.append(
            SingleFlight(
                from_airport=_airport(origin),
                to_airport=_airport(destination),
                departure=_moment(cursor),
                arrival=_moment(landing),
                duration=leg_minutes,
                plane_type="Boeing 787",
            )
        )
        cursor = landing + timedelta(minutes=layover)

    seat_multiplier = {
        "economy": 1.0,
        "premium-economy": 1.6,
        "business": 3.1,
        "first": 4.8,
    }[request.seat]
    trip_multiplier = 1.75 if request.trip == "round-trip" else 1.0
    price = round(base_price * seat_multiplier * trip_multiplier * max(passengers, 1))

    return Flights(
        type="demo",
        price=price,
        airlines=carriers,
        flights=segments,
        carbon=CarbonEmission(
            typical_on_route=flight_minutes * 1_400,
            emission=flight_minutes * (1_250 if len(segments) == 1 else 1_600),
        ),
    )


def _airport(code: str) -> Airport:
    found = airports.get(code)
    return Airport(code=code, name=found.name if found else code)


def _moment(value: datetime) -> SimpleDatetime:
    return SimpleDatetime(
        date=(value.year, value.month, value.day),
        time=(value.hour, value.minute),
    )
