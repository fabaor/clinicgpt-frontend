# Busca de passagens aéreas

Interface web para buscar voos no Google Flights, construída sobre a
biblioteca [fast-flights](https://github.com/AWeirdDev/flights) — um scraper
que monta a query do Google Flights em Protobuf e lê os resultados direto da
página.

Como a biblioteca é Python, a aplicação tem duas partes: uma API em FastAPI que
conversa com o `fast_flights` e uma página estática (HTML, CSS e JavaScript sem
dependências) servida por essa mesma API.

<p align="center">
  <img src="docs/screenshot.png" alt="Tela de resultados da busca" width="820">
</p>

## Como rodar

```bash
python -m venv .venv
source .venv/bin/activate        # Windows: .venv\Scripts\activate
pip install -r requirements.txt

uvicorn backend.main:app --reload
```

A interface fica em <http://127.0.0.1:8000> e a documentação da API em
<http://127.0.0.1:8000/docs>.

Para navegar pela interface sem consultar o Google — útil para desenvolver o
front-end ou em redes que bloqueiam o `google.com`:

```bash
FLIGHTS_DEMO=1 uvicorn backend.main:app --reload
```

### Variáveis de ambiente

| Variável | Efeito |
|----------|--------|
| `FLIGHTS_DEMO` | `1` liga o modo demonstração: resultados sintéticos, sem rede |
| `FLIGHTS_PROXY` | Proxy repassado ao `fast_flights` (ex.: `http://user:senha@host:porta`) |

## O que a interface faz

- Só ida ou ida e volta, com origem e destino por autocomplete
- Passageiros por faixa etária, com as regras do Google (até 9 pessoas, um
  adulto por bebê no colo)
- Classe econômica, econômica premium, executiva ou primeira
- Filtros de escalas, preço máximo, bagagens, companhias ou alianças, janela de
  horário de partida, duração máxima, tarifas básicas, autoconexões e emissões
- Resultados com horários, duração real de porta a porta, escalas, tempo de
  conexão, aeronave e comparação de emissões de CO₂
- Ordenação por preço, duração, escalas ou horário de partida
- Link para a mesma busca no Google Flights, onde a compra é concluída

## Busca de origem e destino

O CSV de aeroportos do fast-flights guarda o município da pista — o JFK aparece
em "Inwood" e o Galeão em "Duque de Caxias" —, então procurar pelo nome da
cidade grande não funcionaria. O `scripts/build_airport_data.py` resolve isso
usando a coluna `city_code` do CSV, que agrupa os aeroportos por região
metropolitana, e dá nome a 72 dessas regiões (com nomes alternativos, para quem
digita "London" em vez de "Londres").

O resultado são dois arquivos em `data/`:

- `airports.csv` — 9.766 aeroportos com código, nome, cidade, país e fuso
- `cities.csv` — regiões metropolitanas e os aeroportos de cada uma

Tanto o código do aeroporto (`GRU`) quanto o da região (`SAO`, todos os
aeroportos de São Paulo) valem como origem ou destino: o Google Flights aceita
os dois.

Para regenerar os arquivos a partir do repositório original:

```bash
python scripts/build_airport_data.py
```

## Versão do fast-flights

O `requirements.txt` instala a biblioteca a partir do repositório, com o commit
fixado, e não do PyPI. A versão publicada (3.0.2, de junho/2026) só aceita
`max_stops` e `airlines`; os demais filtros — preço máximo, bagagens, janela de
horário, duração, tarifas básicas, autoconexões e emissões — foram adicionados
depois e só existem no código do repositório.

**Cuidado com uma armadilha:** o repositório ainda declara `version = "3.0.2"`,
o mesmo número da versão publicada. Se você já tem o pacote do PyPI instalado,
o `pip install -r requirements.txt` considera o requisito satisfeito e **não
troca nada, sem emitir aviso** — nem com `--upgrade`, nem fixando o commit. Só
`--force-reinstall` resolve:

```bash
pip install --force-reinstall --no-deps -r requirements.txt
```

Num ambiente virtual novo isso não acontece: a instalação normal já traz a
versão do repositório.

Para conferir qual versão está valendo:

```bash
python -c "import inspect, fast_flights as f; \
print('filtros novos:', 'max_price' in inspect.signature(f.create_query).parameters)"
```

A aplicação também avisa sozinha: o backend descobre em tempo de execução quais
filtros a versão instalada conhece, registra um aviso no log ao iniciar se
faltarem, descarta os não suportados e devolve os nomes em
`unsupported_filters` para a interface mostrar. Com a versão do PyPI a busca
continua funcionando, apenas com menos filtros.

Para atualizar o commit fixado quando o repositório receber correções:

```bash
pip install --force-reinstall --no-deps "fast-flights @ git+https://github.com/AWeirdDev/flights.git"
pip freeze | grep fast-flights    # copie o commit novo para o requirements.txt
```

Vale saber ainda que o `fast_flights` importa `typing_extensions` sem declará-lo
como dependência — instalado sozinho, ele quebra no import. Por isso o pacote
aparece explicitamente no `requirements.txt`.

## Estrutura

```
backend/
  main.py       API FastAPI: /api/airports, /api/search, /api/config
  search.py     Ponte com o fast_flights e normalização dos resultados
  airports.py   Busca de aeroportos e cidades
  demo.py       Resultados sintéticos do modo demonstração
static/         Página, estilos e JavaScript da interface
data/           Aeroportos e regiões metropolitanas (gerados)
scripts/        Gerador dos arquivos de dados
tests/          Testes com pytest
```

## Testes

```bash
pip install pytest httpx2
pytest
```

## Duração real das viagens

O Google informa horários locais de cada aeroporto, o que torna a soma dos
trechos menor que a viagem de verdade — ela ignora conexões e fusos. Como o CSV
de aeroportos traz o fuso de cada um, a API converte cada horário para um
instante absoluto e calcula a duração de porta a porta e o tempo de cada
conexão. Quando o fuso é desconhecido, o cálculo cai para a soma dos trechos.

## Limitações

- O `fast-flights` faz scraping: mudanças no Google Flights podem quebrar a
  leitura dos resultados, e requisições em excesso podem ser bloqueadas. Use
  `FLIGHTS_PROXY` ou as integrações da biblioteca (BrightData, SearchApi) se
  precisar de volume.
- Em buscas de ida e volta o Google devolve as opções de ida com o preço total
  da viagem; a escolha do voo de volta acontece no site dele. A interface avisa
  isso nos resultados.
- Os preços são estimativas do Google, sem garantia de disponibilidade — a
  compra é feita na companhia ou agência.

## Créditos

A biblioteca `fast-flights` e a base de aeroportos são de
[AWeirdDev/flights](https://github.com/AWeirdDev/flights), sob licença MIT.
