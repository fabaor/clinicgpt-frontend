import pytest
from fastapi.testclient import TestClient

from backend.main import app


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setenv("FLIGHTS_DEMO", "1")
    return TestClient(app)


def busca(client, **extra):
    corpo = {
        "from_airport": "GRU",
        "to_airport": "JFK",
        "depart_date": "2026-09-15",
        **extra,
    }
    return client.post("/api/search", json=corpo)


def test_pagina_inicial_responde(client):
    resposta = client.get("/")
    assert resposta.status_code == 200
    assert "Busca de passagens" in resposta.text


def test_config_expoe_o_modo_demonstracao(client):
    assert client.get("/api/config").json() == {"demo": True}


def test_autocomplete(client):
    resultados = client.get("/api/airports", params={"q": "gru"}).json()["results"]
    assert resultados[0]["code"] == "GRU"
    assert resultados[0]["kind"] == "airport"


def test_autocomplete_limita_a_resposta(client):
    resultados = client.get(
        "/api/airports", params={"q": "a", "limit": 3}
    ).json()["results"]
    assert len(resultados) <= 3


def test_busca_devolve_itinerarios(client):
    payload = busca(client).json()

    assert payload["count"] > 0
    assert payload["currency"] == "BRL"
    assert payload["google_flights_url"].startswith("https://www.google.com/travel/")

    primeiro = payload["itineraries"][0]
    assert primeiro["price"] > 0
    assert primeiro["segments"][0]["from"]["code"] == "GRU"


def test_precos_vem_em_ordem_crescente(client):
    precos = [item["price"] for item in busca(client).json()["itineraries"]]
    assert precos == sorted(precos)


def test_codigo_do_aeroporto_e_normalizado(client):
    payload = busca(client, from_airport="gru").json()
    assert payload["from_airport"]["code"] == "GRU"


def test_filtro_de_escalas(client):
    payload = busca(client, max_stops=0).json()
    assert all(item["stops"] == 0 for item in payload["itineraries"])


def test_filtro_de_preco(client):
    payload = busca(client, max_price=2500).json()
    assert all(item["price"] <= 2500 for item in payload["itineraries"])


def test_ida_e_volta_sem_data_de_volta_e_400(client):
    resposta = busca(client, trip="round-trip")
    assert resposta.status_code == 400
    assert "data de volta" in resposta.json()["detail"]


def test_mesma_origem_e_destino_e_400(client):
    resposta = busca(client, to_airport="GRU")
    assert resposta.status_code == 400


def test_codigo_invalido_e_422(client):
    assert busca(client, from_airport="GRUX").status_code == 422
    assert busca(client, from_airport="12A").status_code == 422


def test_passageiros_demais_e_422(client):
    assert busca(client, adults=12).status_code == 422
