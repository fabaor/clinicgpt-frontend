import pytest
from fast_flights.model import (
    Airport,
    CarbonEmission,
    Flights,
    SimpleDatetime,
    SingleFlight,
)

from backend import search


def leg(
    origem: str,
    destino: str,
    saida: tuple[int, int, int, int, int],
    chegada: tuple[int, int, int, int, int],
    minutos: int,
) -> SingleFlight:
    return SingleFlight(
        from_airport=Airport(code=origem, name=origem),
        to_airport=Airport(code=destino, name=destino),
        departure=SimpleDatetime(date=saida[:3], time=saida[3:]),
        arrival=SimpleDatetime(date=chegada[:3], time=chegada[3:]),
        duration=minutos,
        plane_type="Airbus A350",
    )


def itinerary(*legs: SingleFlight, price: int = 4200) -> Flights:
    return Flights(
        type="1",
        price=price,
        airlines=["LATAM"],
        flights=list(legs),
        carbon=CarbonEmission(typical_on_route=900_000, emission=810_000),
    )


def request(**extra) -> search.SearchRequest:
    base = {
        "from_airport": "GRU",
        "to_airport": "JFK",
        "depart_date": "2026-09-15",
    }
    return search.SearchRequest(**{**base, **extra})


class TestBuildQuery:
    def test_ida_e_volta_exige_data_de_volta(self):
        with pytest.raises(search.SearchError, match="data de volta"):
            search.build_query(request(trip="round-trip"))

    def test_origem_igual_ao_destino_e_recusada(self):
        with pytest.raises(search.SearchError, match="diferentes"):
            search.build_query(request(to_airport="GRU"))

    def test_excesso_de_passageiros_vira_erro_tratado(self):
        with pytest.raises(search.SearchError):
            search.build_query(request(adults=9, children=3))

    def test_ida_e_volta_gera_dois_trechos(self):
        query = search.build_query(
            request(trip="round-trip", return_date="2026-09-25")
        )
        assert len(query.flight_data) == 2
        assert query.flight_data[1].from_airport.airport == "JFK"

    def test_url_carrega_idioma_e_moeda(self):
        query = search.build_query(request(currency="USD", language="en-US"))
        assert "curr=USD" in query.url()
        assert "hl=en-US" in query.url()

    def test_filtro_desconhecido_e_ignorado_e_registrado(self, monkeypatch):
        monkeypatch.setattr(search, "QUERY_FEATURES", frozenset({"flights", "seat"}))
        descartados: set[str] = set()

        search.build_query(request(max_price=3000), descartados)

        assert "max_price" in descartados

    def test_filtro_nao_preenchido_nao_vira_aviso(self, monkeypatch):
        monkeypatch.setattr(search, "QUERY_FEATURES", frozenset({"flights", "seat"}))
        descartados: set[str] = set()

        search.build_query(request(), descartados)

        assert descartados == set()


class TestSerializacao:
    def test_voo_direto(self):
        dados = search.serialize_itinerary(
            itinerary(
                leg("GRU", "JFK", (2026, 9, 15, 22, 10), (2026, 9, 16, 7, 5), 535)
            )
        )

        assert dados["stops"] == 0
        assert dados["segments"][0]["departure"] == "2026-09-15T22:10:00"
        assert dados["segments"][0]["layover_minutes"] is None
        # GRU (UTC-3) 22:10 até JFK (UTC-4) 07:05: 9h55 de porta a porta.
        assert dados["total_minutes"] == 595

    def test_conexao_tem_escala_e_tempo_de_espera(self):
        dados = search.serialize_itinerary(
            itinerary(
                leg("GRU", "GIG", (2026, 9, 15, 8, 0), (2026, 9, 15, 9, 5), 65),
                leg("GIG", "JFK", (2026, 9, 15, 11, 0), (2026, 9, 15, 20, 0), 540),
            )
        )

        assert dados["stops"] == 1
        assert dados["segments"][1]["layover_minutes"] == 115
        assert dados["flight_minutes"] == 605

    def test_meia_noite_vira_o_dia(self):
        dados = search.serialize_itinerary(
            itinerary(
                leg("GRU", "JFK", (2026, 9, 15, 20, 0), (2026, 9, 15, 24, 0), 240)
            )
        )

        assert dados["segments"][0]["arrival"] == "2026-09-16T00:00:00"

    def test_horario_ausente_nao_quebra(self):
        voo = leg("GRU", "JFK", (2026, 9, 15, 8, 0), (2026, 9, 15, 18, 0), 600)
        voo.arrival.date = None  # o payload do Google nem sempre traz tudo

        dados = search.serialize_itinerary(itinerary(voo))

        assert dados["segments"][0]["arrival"] is None
        assert dados["total_minutes"] == 600  # cai para a soma dos trechos

    def test_sem_fuso_conhecido_soma_trechos_e_conexoes(self):
        dados = search.serialize_itinerary(
            itinerary(
                # códigos fora da base: sem fuso, não dá para datar os voos
                leg("QQQ", "QQX", (2026, 9, 15, 8, 0), (2026, 9, 15, 10, 0), 120),
                leg("QQX", "QQZ", (2026, 9, 15, 11, 0), (2026, 9, 15, 13, 0), 120),
            )
        )

        assert dados["segments"][1]["layover_minutes"] is None
        assert dados["total_minutes"] == 240

    def test_resposta_completa(self):
        pedido = request(currency="USD")
        query = search.build_query(pedido)

        payload = search.serialize_results(
            [itinerary(leg("GRU", "JFK", (2026, 9, 15, 8, 0), (2026, 9, 15, 18, 0), 600))],
            query=query,
            request=pedido,
            unsupported=["max_price"],
        )

        assert payload["count"] == 1
        assert payload["currency"] == "USD"
        assert payload["from_airport"]["city"] == "Guarulhos"
        assert payload["unsupported_filters"] == ["max_price"]


class TestRun:
    def test_sem_voos_devolve_lista_vazia(self, monkeypatch):
        from fast_flights.exceptions import FlightsNotFound

        def falha(*args, **kwargs):
            raise FlightsNotFound("nada")

        monkeypatch.setattr(search, "get_flights", falha)
        payload = search.run(request())

        assert payload["count"] == 0
        assert payload["itineraries"] == []

    def test_erro_de_rede_vira_502(self, monkeypatch):
        def falha(*args, **kwargs):
            raise ConnectionError("sem rede")

        monkeypatch.setattr(search, "get_flights", falha)

        with pytest.raises(search.SearchError) as erro:
            search.run(request())

        assert erro.value.status_code == 502
