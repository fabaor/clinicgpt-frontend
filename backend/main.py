"""API HTTP da busca de passagens aéreas.

Serve a interface estática e expõe dois endpoints: autocomplete de aeroportos
e a busca em si, que consulta o Google Flights via `fast_flights`.
"""

from __future__ import annotations

import logging
import os
from contextlib import asynccontextmanager
from datetime import date
from pathlib import Path
from typing import Annotated, Literal

from fastapi import FastAPI, HTTPException, Query as QueryParam
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field, field_validator

from . import airports, demo, search

STATIC_DIR = Path(__file__).resolve().parent.parent / "static"

logger = logging.getLogger("uvicorn.error")


@asynccontextmanager
async def lifespan(_: FastAPI):
    """Avisa quando a biblioteca instalada não tem os filtros do repositório.

    Instalar do repositório por cima de uma versão do PyPI falha em silêncio:
    o repositório ainda declara `version = "3.0.2"`, igual à publicada, então
    o pip trata o requisito como satisfeito e não substitui nada. Sem este
    aviso, a aplicação roda com menos filtros sem ninguém perceber.
    """
    if search.missing_features():
        logger.warning(
            "fast-flights instalado sem os filtros novos (provavelmente a "
            "versão do PyPI). A busca funciona, mas preço máximo, bagagens, "
            "janela de horário e duração serão ignorados. Para corrigir: "
            "pip install --force-reinstall --no-deps -r requirements.txt"
        )

    yield


app = FastAPI(
    title="Busca de passagens aéreas",
    description="Interface web para o scraper fast-flights (Google Flights).",
    version="1.0.0",
    lifespan=lifespan,
)


class SearchBody(BaseModel):
    """Corpo aceito por `POST /api/search`."""

    from_airport: str = Field(min_length=3, max_length=3)
    to_airport: str = Field(min_length=3, max_length=3)
    depart_date: date
    return_date: date | None = None
    trip: Literal["one-way", "round-trip"] = "one-way"
    seat: Literal["economy", "premium-economy", "business", "first"] = "economy"
    adults: int = Field(default=1, ge=1, le=9)
    children: int = Field(default=0, ge=0, le=8)
    infants_in_seat: int = Field(default=0, ge=0, le=8)
    infants_on_lap: int = Field(default=0, ge=0, le=8)
    currency: str = Field(default="BRL", min_length=3, max_length=3)
    language: str = Field(default="pt-BR", max_length=10)
    max_stops: int | None = Field(default=None, ge=0, le=3)
    max_price: int | None = Field(default=None, gt=0)
    carry_on_bags: int = Field(default=0, ge=0, le=9)
    checked_bags: int = Field(default=0, ge=0, le=9)
    airlines: list[str] = Field(default_factory=list, max_length=20)
    earliest_departure_hour: int | None = Field(default=None, ge=0, le=23)
    latest_departure_hour: int | None = Field(default=None, ge=0, le=23)
    max_duration_minutes: int | None = Field(default=None, ge=30, le=6000)
    less_emissions_only: bool = False
    exclude_basic_economy: bool = False
    hide_separate_and_self_transfer: bool = False

    @field_validator("from_airport", "to_airport")
    @classmethod
    def _uppercase_iata(cls, value: str) -> str:
        code = value.strip().upper()
        if not code.isalpha():
            raise ValueError("O código do aeroporto deve ter 3 letras (ex.: GRU).")
        return code

    @field_validator("currency")
    @classmethod
    def _uppercase_currency(cls, value: str) -> str:
        return value.strip().upper()

    @field_validator("airlines")
    @classmethod
    def _uppercase_airlines(cls, value: list[str]) -> list[str]:
        return [item.strip().upper() for item in value if item.strip()]

    def to_request(self) -> search.SearchRequest:
        return search.SearchRequest(
            from_airport=self.from_airport,
            to_airport=self.to_airport,
            depart_date=self.depart_date.isoformat(),
            return_date=self.return_date.isoformat() if self.return_date else None,
            trip=self.trip,
            seat=self.seat,
            adults=self.adults,
            children=self.children,
            infants_in_seat=self.infants_in_seat,
            infants_on_lap=self.infants_on_lap,
            currency=self.currency,
            language=self.language,
            max_stops=self.max_stops,
            max_price=self.max_price,
            carry_on_bags=self.carry_on_bags,
            checked_bags=self.checked_bags,
            airlines=self.airlines,
            earliest_departure_hour=self.earliest_departure_hour,
            latest_departure_hour=self.latest_departure_hour,
            max_duration_minutes=self.max_duration_minutes,
            less_emissions_only=self.less_emissions_only,
            exclude_basic_economy=self.exclude_basic_economy,
            hide_separate_and_self_transfer=self.hide_separate_and_self_transfer,
        )


def demo_mode() -> bool:
    """Modo de demonstração: resultados fixos, sem chamar o Google."""
    return os.environ.get("FLIGHTS_DEMO", "").strip().lower() in {"1", "true", "yes"}


@app.get("/api/config")
def config() -> dict[str, bool]:
    return {"demo": demo_mode()}


@app.get("/api/airports")
def list_airports(
    q: Annotated[str, QueryParam(max_length=80)] = "",
    limit: Annotated[int, QueryParam(ge=1, le=25)] = 8,
) -> dict[str, list[dict[str, object]]]:
    """Autocomplete de aeroportos e cidades por código, cidade ou nome."""
    found = airports.search(q, limit=limit)
    return {"results": [place.as_dict() for place in found]}


@app.post("/api/search")
def search_flights(body: SearchBody) -> dict[str, object]:
    """Busca voos no Google Flights com os filtros informados."""
    request = body.to_request()

    try:
        if demo_mode():
            return demo.results_for(request)
        return search.run(request, proxy=os.environ.get("FLIGHTS_PROXY") or None)
    except search.SearchError as error:
        raise HTTPException(status_code=error.status_code, detail=error.message)


@app.get("/", include_in_schema=False)
def index() -> FileResponse:
    return FileResponse(STATIC_DIR / "index.html")


app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")
