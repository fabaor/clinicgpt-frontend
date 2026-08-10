from backend import airports


def codes(query: str, limit: int = 5) -> list[str]:
    return [place.code for place in airports.search(query, limit=limit)]


def test_codigo_exato_vem_primeiro():
    assert codes("GRU")[0] == "GRU"
    assert codes("jfk")[0] == "JFK"


def test_cidade_ganha_do_aeroporto_individual():
    resultado = airports.search("são paulo", limit=4)
    assert resultado[0].code == "SAO"
    assert resultado[0].kind == "city"
    assert "GRU" in resultado[0].airports
    assert "GRU" in [place.code for place in resultado[1:]]


def test_acentos_e_caixa_sao_ignorados():
    assert codes("sao paulo")[0] == "SAO"
    assert codes("SÃO PAULO")[0] == "SAO"


def test_nome_alternativo_em_outro_idioma():
    assert codes("new york")[0] == "NYC"
    assert codes("london")[0] == "LON"


def test_codigo_repetido_aparece_uma_vez():
    resultado = codes("miami", limit=6)
    assert resultado.count("MIA") == 1


def test_busca_vazia_nao_retorna_nada():
    assert airports.search("") == []
    assert airports.search("   ") == []


def test_get_prefere_a_cidade_e_airport_o_aeroporto():
    cidade = airports.get("LIS")
    assert cidade is not None and cidade.kind == "city"

    aeroporto = airports.airport("LIS")
    assert aeroporto is not None and aeroporto.kind == "airport"
    assert aeroporto.timezone == "Europe/Lisbon"


def test_aeroportos_tem_fuso_horario():
    assert airports.airport("GRU").timezone == "America/Sao_Paulo"
    assert airports.airport("JFK").timezone == "America/New_York"
