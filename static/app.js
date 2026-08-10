"use strict";

const form = document.getElementById("searchForm");
const statusBox = document.getElementById("status");
const resultsSection = document.getElementById("results");
const resultsList = document.getElementById("resultsList");
const resultsTitle = document.getElementById("resultsTitle");
const googleLink = document.getElementById("googleLink");
const submitButton = document.getElementById("submitButton");
const sortSelect = document.getElementById("sort");
const returnField = document.getElementById("returnField");

/** Última resposta da API, mantida em memória para reordenar sem nova busca. */
let lastPayload = null;

/* ------------------------------------------------------------------ datas */

const pad = (value) => String(value).padStart(2, "0");
const isoDate = (date) =>
  `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;

function initDates() {
  const today = new Date();
  const depart = form.elements.depart_date;
  const back = form.elements.return_date;

  const soon = new Date(today);
  soon.setDate(soon.getDate() + 30);
  const later = new Date(soon);
  later.setDate(later.getDate() + 7);

  depart.min = isoDate(today);
  depart.value = isoDate(soon);
  back.min = isoDate(soon);
  back.value = isoDate(later);

  depart.addEventListener("change", () => {
    back.min = depart.value;
    if (back.value && back.value < depart.value) back.value = depart.value;
  });
}

/* ------------------------------------------------- tipo de viagem e campos */

function initTripType() {
  for (const input of form.elements.trip) {
    input.addEventListener("change", () => {
      const roundTrip = input.value === "round-trip" && input.checked;
      returnField.hidden = !roundTrip;
      form.elements.return_date.required = roundTrip;
    });
  }
}

/* -------------------------------------------------------- autocomplete IATA */

function initCombobox(field) {
  const input = field.querySelector("input");
  const list = field.querySelector(".suggestions");
  let items = [];
  let active = -1;
  let timer = null;

  const close = () => {
    list.hidden = true;
    input.setAttribute("aria-expanded", "false");
    active = -1;
  };

  const pick = (place) => {
    input.value = `${place.code} — ${label(place)}`;
    input.dataset.code = place.code;
    close();
  };

  const highlight = (index) => {
    active = index;
    [...list.children].forEach((node, position) =>
      node.setAttribute("aria-selected", String(position === index))
    );
  };

  const render = (places) => {
    items = places;
    list.replaceChildren(
      ...places.map((place, index) => {
        const item = document.createElement("li");
        item.setAttribute("role", "option");
        item.setAttribute("aria-selected", "false");
        item.innerHTML =
          `<span class="code"></span><span class="place"></span><span class="country"></span>`;
        item.querySelector(".code").textContent = place.code;
        item.querySelector(".place").textContent = describe(place);
        item.querySelector(".country").textContent = place.country;
        item.addEventListener("mousedown", (event) => {
          event.preventDefault();
          pick(place);
        });
        item.addEventListener("mouseenter", () => highlight(index));
        return item;
      })
    );
    list.hidden = places.length === 0;
    input.setAttribute("aria-expanded", String(places.length > 0));
    highlight(-1);
  };

  input.addEventListener("input", () => {
    delete input.dataset.code;
    clearTimeout(timer);
    const term = input.value.trim();
    if (term.length < 2) return close();
    timer = setTimeout(async () => {
      try {
        render(await searchAirports(term));
      } catch {
        close();
      }
    }, 160);
  });

  input.addEventListener("keydown", (event) => {
    if (list.hidden) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : -1;
      highlight((active + step + items.length) % items.length);
    } else if (event.key === "Enter" && active >= 0) {
      event.preventDefault();
      pick(items[active]);
    } else if (event.key === "Escape") {
      close();
    }
  });

  input.addEventListener("blur", () => setTimeout(close, 120));
}

/** Rótulo curto de um lugar, para o campo depois da seleção. */
function label(place) {
  return place.city || place.name;
}

/** Descrição do lugar na lista de sugestões. */
function describe(place) {
  if (place.kind === "city") {
    const count = place.airports.length;
    return count > 1
      ? `${place.name} · todos os aeroportos (${count})`
      : `${place.name} · região metropolitana`;
  }
  return place.city ? `${place.city} · ${place.name}` : place.name;
}

async function searchAirports(term, limit = 8) {
  const url = `/api/airports?q=${encodeURIComponent(term)}&limit=${limit}`;
  const response = await fetch(url);
  if (!response.ok) throw new Error("falha ao buscar aeroportos");
  return (await response.json()).results;
}

/** Resolve o código IATA de um campo: seleção, código digitado ou 1º palpite. */
async function resolveAirport(input) {
  if (input.dataset.code) return input.dataset.code;

  const term = input.value.trim();
  if (/^[a-zA-Z]{3}$/.test(term)) return term.toUpperCase();

  const [first] = await searchAirports(term, 1);
  if (!first) throw new Error(`Não encontrei o aeroporto "${term}".`);
  input.value = `${first.code} — ${label(first)}`;
  input.dataset.code = first.code;
  return first.code;
}

/* ------------------------------------------------------------- passageiros */

const passengers = { adults: 1, children: 0, infants_in_seat: 0, infants_on_lap: 0 };
const LABELS = {
  adults: ["adulto", "adultos"],
  children: ["criança", "crianças"],
  infants_in_seat: ["bebê no assento", "bebês no assento"],
  infants_on_lap: ["bebê no colo", "bebês no colo"],
};

function initPassengers() {
  const toggle = document.getElementById("passengersToggle");
  const panel = document.getElementById("passengersPanel");
  const summary = document.getElementById("passengersSummary");

  const total = () => Object.values(passengers).reduce((sum, n) => sum + n, 0);

  const refresh = () => {
    for (const [key, value] of Object.entries(passengers)) {
      panel.querySelector(`output[name="${key}"]`).textContent = String(value);
    }
    for (const button of panel.querySelectorAll("[data-step]")) {
      const key = button.dataset.step;
      const delta = Number(button.dataset.delta);
      const next = passengers[key] + delta;
      button.disabled = !isValid(key, next);
    }
    summary.textContent = Object.entries(passengers)
      .filter(([, value]) => value > 0)
      .map(([key, value]) => `${value} ${LABELS[key][value > 1 ? 1 : 0]}`)
      .join(", ");
  };

  const isValid = (key, value) => {
    if (value < 0) return false;
    if (key === "adults" && value < 1) return false;
    const candidate = { ...passengers, [key]: value };
    const sum = Object.values(candidate).reduce((acc, n) => acc + n, 0);
    if (sum > 9) return false;
    return candidate.infants_on_lap <= candidate.adults;
  };

  toggle.addEventListener("click", () => {
    const open = panel.hidden;
    panel.hidden = !open;
    toggle.setAttribute("aria-expanded", String(open));
  });

  // `contains` também no botão: o clique costuma cair no <span> de dentro,
  // e comparar com o próprio botão fecharia o painel na mesma hora.
  document.addEventListener("click", (event) => {
    if (!panel.hidden && !panel.contains(event.target) && !toggle.contains(event.target)) {
      panel.hidden = true;
      toggle.setAttribute("aria-expanded", "false");
    }
  });

  panel.addEventListener("click", (event) => {
    const button = event.target.closest("[data-step]");
    if (!button) return;
    const key = button.dataset.step;
    const next = passengers[key] + Number(button.dataset.delta);
    if (isValid(key, next)) {
      passengers[key] = next;
      refresh();
    }
  });

  refresh();
}

/* ------------------------------------------------------------------ busca */

function buildBody(fromCode, toCode) {
  const data = new FormData(form);
  const number = (name) => {
    const value = data.get(name);
    return value === "" || value === null ? null : Number(value);
  };

  const body = {
    from_airport: fromCode,
    to_airport: toCode,
    depart_date: data.get("depart_date"),
    trip: data.get("trip"),
    seat: data.get("seat"),
    currency: data.get("currency") || "BRL",
    language: "pt-BR",
    max_stops: number("max_stops"),
    max_price: number("max_price"),
    carry_on_bags: number("carry_on_bags") ?? 0,
    checked_bags: number("checked_bags") ?? 0,
    airlines: String(data.get("airlines") || "")
      .split(/[,;]/)
      .map((item) => item.trim())
      .filter(Boolean),
    earliest_departure_hour: number("earliest_departure_hour"),
    latest_departure_hour: number("latest_departure_hour"),
    max_duration_minutes: (() => {
      const hours = number("max_duration_hours");
      return hours === null ? null : hours * 60;
    })(),
    less_emissions_only: data.get("less_emissions_only") === "on",
    exclude_basic_economy: data.get("exclude_basic_economy") === "on",
    hide_separate_and_self_transfer:
      data.get("hide_separate_and_self_transfer") === "on",
    ...passengers,
  };

  if (body.trip === "round-trip") body.return_date = data.get("return_date");
  return body;
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  submitButton.disabled = true;
  showStatus("Consultando o Google Flights…");
  resultsSection.hidden = true;

  try {
    const [fromCode, toCode] = await Promise.all([
      resolveAirport(form.elements.from_airport),
      resolveAirport(form.elements.to_airport),
    ]);

    const response = await fetch("/api/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(buildBody(fromCode, toCode)),
    });

    const payload = await response.json();
    if (!response.ok) throw new Error(detailOf(payload));

    lastPayload = payload;
    renderResults();
  } catch (error) {
    showStatus(error.message, { error: true });
  } finally {
    submitButton.disabled = false;
  }
});

function detailOf(payload) {
  const detail = payload?.detail;
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail) && detail.length) {
    return detail.map((item) => item.msg).join("; ");
  }
  return "Não foi possível concluir a busca.";
}

function showStatus(message, { error = false } = {}) {
  statusBox.textContent = message;
  statusBox.classList.toggle("error", error);
  statusBox.hidden = false;
}

sortSelect.addEventListener("change", () => {
  if (lastPayload) renderResults();
});

/* -------------------------------------------------------------- resultados */

function renderResults() {
  const { itineraries, currency, from_airport: origin, to_airport: destination } =
    lastPayload;

  googleLink.href = lastPayload.google_flights_url;

  if (itineraries.length === 0) {
    resultsSection.hidden = true;
    showStatus(
      "Nenhum voo encontrado para esses filtros. Tente outras datas ou remova restrições."
    );
    return;
  }

  statusBox.hidden = true;
  resultsSection.hidden = false;

  const route = `${origin.code} → ${destination.code}`;
  const plural = itineraries.length === 1 ? "opção" : "opções";
  resultsTitle.textContent = `${itineraries.length} ${plural} · ${route}`;
  renderNotice(lastPayload);

  const sorted = [...itineraries].sort(comparators[sortSelect.value]);
  resultsList.replaceChildren(
    ...sorted.map((itinerary) => renderItinerary(itinerary, currency))
  );
}

const FILTER_NAMES = {
  max_price: "preço máximo",
  carry_on_bags: "bagagem de mão",
  checked_bags: "bagagem despachada",
  airlines: "companhias",
  earliest_departure_hour: "horário mínimo de partida",
  latest_departure_hour: "horário máximo de partida",
  max_duration_minutes: "duração máxima",
  less_emissions_only: "menos emissões",
  exclude_basic_economy: "excluir tarifas básicas",
  hide_separate_and_self_transfer: "ocultar autoconexões",
};

/** Avisa quando a versão instalada do fast-flights ignorou algum filtro. */
function renderNotice(payload) {
  const notice = document.getElementById("resultsNotice");
  const messages = [];

  if (payload.trip === "round-trip") {
    messages.push(
      "Ida e volta: o preço é do total e a lista mostra o trecho de ida — " +
        "o voo de volta é escolhido no Google Flights."
    );
  }

  const names = (payload.unsupported_filters || []).map(
    (key) => FILTER_NAMES[key] || key
  );
  if (names.length) {
    messages.push(
      `Filtros ignorados pela versão instalada do fast-flights: ${names.join(", ")}. ` +
        "Instale a biblioteca a partir do repositório para usá-los."
    );
  }

  notice.hidden = messages.length === 0;
  notice.textContent = messages.join(" ");
}

const comparators = {
  price: (a, b) => a.price - b.price,
  duration: (a, b) => (a.total_minutes ?? 1e9) - (b.total_minutes ?? 1e9),
  stops: (a, b) => a.stops - b.stops || a.price - b.price,
  departure: (a, b) =>
    String(a.segments[0]?.departure).localeCompare(String(b.segments[0]?.departure)),
};

function renderItinerary(itinerary, currency) {
  const item = document.createElement("li");
  const details = document.createElement("details");
  details.className = "itinerary";

  const first = itinerary.segments[0];
  const last = itinerary.segments[itinerary.segments.length - 1];
  const offset = dayOffset(first?.departure, last?.arrival);

  const summary = document.createElement("summary");
  summary.innerHTML = `
    <div class="grow">
      <div class="times">${time(first?.departure)} – ${time(last?.arrival)}${
        offset > 0 ? `<span class="next-day">+${offset}</span>` : ""
      }</div>
      <div class="route"></div>
    </div>
    <div>
      <div class="duration">${duration(itinerary.total_minutes)}</div>
      <div class="stops ${itinerary.stops === 0 ? "nonstop" : ""}">${stopsLabel(
        itinerary
      )}</div>
    </div>
    <div class="carriers"></div>
    <div class="price">${money(itinerary.price, currency)}<small>total</small></div>
  `;
  summary.querySelector(".route").textContent = `${first?.from.code ?? "?"} → ${
    last?.to.code ?? "?"
  } · ${dateLabel(first?.departure)}`;
  summary.querySelector(".carriers").textContent = itinerary.airlines.join(", ");

  const body = document.createElement("div");
  body.className = "details";

  for (const segment of itinerary.segments) {
    if (segment.layover_minutes !== null) {
      const layover = document.createElement("div");
      layover.className = "layover";
      layover.textContent = `Conexão de ${duration(segment.layover_minutes)} em ${
        segment.from.code
      }`;
      body.append(layover);
    }
    body.append(renderSegment(segment));
  }

  body.append(renderEmissions(itinerary.carbon));
  details.append(summary, body);
  item.append(details);
  return item;
}

function renderSegment(segment) {
  const leg = document.createElement("div");
  leg.className = "leg";

  const clock = document.createElement("div");
  clock.className = "clock";
  clock.textContent = `${time(segment.departure)}\n${time(segment.arrival)}`;
  clock.style.whiteSpace = "pre";

  const info = document.createElement("div");
  const from = document.createElement("div");
  from.innerHTML = `<strong></strong> <span class="meta"></span>`;
  from.querySelector("strong").textContent = `${segment.from.code} · ${segment.from.name}`;

  const to = document.createElement("div");
  to.innerHTML = `<strong></strong> <span class="meta"></span>`;
  to.querySelector("strong").textContent = `${segment.to.code} · ${segment.to.name}`;

  const meta = document.createElement("div");
  meta.className = "meta";
  meta.textContent = [duration(segment.duration_minutes), segment.plane]
    .filter(Boolean)
    .join(" · ");

  info.append(from, to, meta);
  leg.append(clock, info);
  return leg;
}

function renderEmissions(carbon) {
  const node = document.createElement("div");
  node.className = "emissions";

  const emitted = carbon.emission_grams;
  const typical = carbon.typical_grams;
  if (!emitted) {
    node.textContent = "Emissões de CO₂ não informadas.";
    return node;
  }

  const kilos = Math.round(emitted / 1000);
  if (!typical) {
    node.textContent = `${kilos} kg de CO₂ por passageiro.`;
    return node;
  }

  const diff = Math.round(((emitted - typical) / typical) * 100);
  const comparison =
    diff === 0
      ? "na média da rota"
      : `${Math.abs(diff)}% ${diff < 0 ? "abaixo" : "acima"} da média da rota`;
  node.innerHTML = `${kilos} kg de CO₂ por passageiro · <span class="${
    diff < 0 ? "better" : ""
  }">${comparison}</span>`;
  return node;
}

/* ------------------------------------------------------------- formatação */

function time(iso) {
  if (!iso) return "--:--";
  return iso.slice(11, 16);
}

function dateLabel(iso) {
  if (!iso) return "";
  const date = new Date(iso);
  return new Intl.DateTimeFormat("pt-BR", {
    weekday: "short",
    day: "2-digit",
    month: "short",
  }).format(date);
}

function dayOffset(startIso, endIso) {
  if (!startIso || !endIso) return 0;
  const start = new Date(startIso.slice(0, 10));
  const end = new Date(endIso.slice(0, 10));
  return Math.round((end - start) / 86400000);
}

function duration(minutes) {
  if (minutes === null || minutes === undefined) return "—";
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return `${rest} min`;
  return rest === 0 ? `${hours} h` : `${hours} h ${rest} min`;
}

function money(value, currency) {
  try {
    return new Intl.NumberFormat("pt-BR", {
      style: "currency",
      currency,
      maximumFractionDigits: 0,
    }).format(value);
  } catch {
    return `${currency} ${value}`;
  }
}

function stopsLabel(itinerary) {
  if (itinerary.stops === 0) return "Voo direto";
  const via = itinerary.segments
    .slice(1)
    .map((segment) => segment.from.code)
    .join(", ");
  return itinerary.stops === 1 ? `1 escala · ${via}` : `${itinerary.stops} escalas · ${via}`;
}

/* ------------------------------------------------------------------ início */

function initHourSelects() {
  for (const name of ["earliest_departure_hour", "latest_departure_hour"]) {
    const select = form.elements[name];
    for (let hour = 0; hour < 24; hour += 1) {
      const option = document.createElement("option");
      option.value = String(hour);
      option.textContent = `${pad(hour)}:00`;
      select.append(option);
    }
  }
}

async function init() {
  initDates();
  initTripType();
  initPassengers();
  initHourSelects();
  document.querySelectorAll("[data-combobox]").forEach(initCombobox);

  document.getElementById("swap").addEventListener("click", () => {
    const from = form.elements.from_airport;
    const to = form.elements.to_airport;
    [from.value, to.value] = [to.value, from.value];
    const fromCode = from.dataset.code;
    const toCode = to.dataset.code;
    toCode ? (from.dataset.code = toCode) : delete from.dataset.code;
    fromCode ? (to.dataset.code = fromCode) : delete to.dataset.code;
  });

  try {
    const config = await (await fetch("/api/config")).json();
    document.getElementById("demoBadge").hidden = !config.demo;
  } catch {
    /* a interface funciona sem essa informação */
  }
}

init();
