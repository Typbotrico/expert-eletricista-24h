const NATIONAL_SINAPI_M2 = 1999.73;

const STATE_SINAPI_M2 = Object.freeze({
  AC:2309.23, AL:1810.89, AP:2031.00, AM:2000.18, BA:1873.15, CE:1883.20,
  DF:2051.00, ES:1802.13, GO:2009.13, MA:1969.07, MT:2068.00, MS:1940.98,
  MG:1864.57, PA:1991.46, PB:1926.40, PR:2161.78, PE:1789.90, PI:1877.25,
  RJ:2174.65, RN:1866.99, RS:1962.32, RO:2190.83, RR:2137.37, SC:2249.47,
  SP:2089.88, SE:1768.44, TO:2072.43
});

const STATE_NAMES = Object.freeze({
  acre:"AC", alagoas:"AL", amapa:"AP", amazonas:"AM", bahia:"BA", ceara:"CE",
  "distrito federal":"DF", "espirito santo":"ES", goias:"GO", maranhao:"MA",
  "mato grosso":"MT", "mato grosso do sul":"MS", "minas gerais":"MG", para:"PA",
  paraiba:"PB", parana:"PR", pernambuco:"PE", piaui:"PI", "rio de janeiro":"RJ",
  "rio grande do norte":"RN", "rio grande do sul":"RS", rondonia:"RO", roraima:"RR",
  "santa catarina":"SC", "sao paulo":"SP", sergipe:"SE", tocantins:"TO"
});

const CAPITALS = new Set([
  "rio branco|AC","maceio|AL","macapa|AP","manaus|AM","salvador|BA","fortaleza|CE",
  "brasilia|DF","vitoria|ES","goiania|GO","sao luis|MA","cuiaba|MT","campo grande|MS",
  "belo horizonte|MG","belem|PA","joao pessoa|PB","curitiba|PR","recife|PE","teresina|PI",
  "rio de janeiro|RJ","natal|RN","porto alegre|RS","porto velho|RO","boa vista|RR",
  "florianopolis|SC","sao paulo|SP","aracaju|SE","palmas|TO"
]);

// Amostras públicas de mercado consultadas em out/2026. São usadas só para calibrar,
// de forma limitada, o multiplicador local; não são tratadas como tabela oficial.
const MARKET_HOURLY = Object.freeze({
  "sao paulo|SP":171, "rio de janeiro|RJ":158, "belo horizonte|MG":118,
  "salvador|BA":65, "recife|PE":94, "curitiba|PR":145, "brasilia|DF":197,
  "manaus|AM":107, "guarulhos|SP":133, "sao bernardo do campo|SP":161,
  "francisco morato|SP":117, "mairinque|SP":117, "aracariguama|SP":117,
  "itaquaquecetuba|SP":117, "paulinia|SP":243, "ribeirao preto|SP":144,
  "simoes filho|BA":126, "cabo frio|RJ":105, "rondonopolis|MT":138,
  "canoas|RS":171, "coronel fabriciano|MG":89, "governador valadares|MG":89,
  "balneario camboriu|SC":119
});

export const LABOR_SERVICES = Object.freeze([
  {id:"hora", label:"Hora técnica residencial", unit:"hora", min:80, max:150, rec:110, keywords:["hora tecnica","por hora","eletricista por hora"]},
  {id:"visita", label:"Visita técnica + diagnóstico simples", unit:"visita", min:90, max:180, rec:130, keywords:["visita","diagnostico","avaliacao","vistoria"]},
  {id:"emergencia", label:"Atendimento emergencial fora do horário", unit:"chamado", min:200, max:450, rec:300, keywords:["emergencia","emergencial","urgente","24h","noturno","madrugada"]},
  {id:"tomada-troca", label:"Troca de tomada/interruptor no ponto existente", unit:"ponto", min:70, max:150, rec:100, keywords:["troca de tomada","trocar tomada","troca de interruptor","trocar interruptor"]},
  {id:"tomada-inst", label:"Instalação de tomada/interruptor em caixa e fiação existentes", unit:"ponto", min:90, max:180, rec:125, keywords:["instalar tomada","instalacao de tomada","instalar interruptor","instalacao de interruptor"]},
  {id:"ponto-eletroduto", label:"Novo ponto elétrico com eletroduto existente", unit:"ponto", min:160, max:320, rec:220, keywords:["novo ponto","ponto eletrico","ponto de tomada","ponto de energia","ponto novo"]},
  {id:"ponto-alvenaria", label:"Novo ponto com abertura/rasgo e passagem", unit:"ponto", min:260, max:520, rec:360, keywords:["rasgo","quebrar parede","alvenaria","sem eletroduto","novo ponto"]},
  {id:"luminaria", label:"Instalação/troca de luminária simples", unit:"unidade", min:80, max:170, rec:120, keywords:["luminaria","plafon","troca de lampada","bocal"]},
  {id:"lustre", label:"Instalação de lustre/pendente", unit:"unidade", min:130, max:320, rec:210, keywords:["lustre","pendente"]},
  {id:"spot", label:"Instalação de spot/downlight", unit:"ponto", min:75, max:160, rec:110, keywords:["spot","downlight","ponto de luz"]},
  {id:"ventilador", label:"Instalação de ventilador de teto", unit:"unidade", min:180, max:360, rec:260, keywords:["ventilador de teto","instalar ventilador","ventilador"]},
  {id:"sensor", label:"Instalação de sensor de presença/fotocélula", unit:"unidade", min:100, max:220, rec:150, keywords:["sensor de presenca","fotocelula","rele fotoeletrico","sensor"]},
  {id:"campainha", label:"Troca/instalação de campainha", unit:"unidade", min:90, max:200, rec:140, keywords:["campainha"]},
  {id:"interfone", label:"Troca/instalação simples de interfone", unit:"unidade", min:140, max:320, rec:220, keywords:["interfone","video porteiro","porteiro eletronico"]},
  {id:"chuveiro-troca", label:"Troca/instalação de chuveiro com circuito já adequado", unit:"unidade", min:130, max:280, rec:190, keywords:["chuveiro","ducha eletrica","torneira eletrica"]},
  {id:"chuveiro-circuito", label:"Novo circuito dedicado para chuveiro", unit:"circuito", min:380, max:800, rec:560, keywords:["circuito de chuveiro","fio do chuveiro","chuveiro novo circuito","chuveiro ate o quadro"]},
  {id:"disjuntor", label:"Troca de disjuntor no quadro", unit:"unidade", min:110, max:240, rec:160, keywords:["troca de disjuntor","trocar disjuntor","disjuntor"]},
  {id:"dr", label:"Instalação/adequação de DR em quadro existente", unit:"serviço", min:180, max:380, rec:260, keywords:["dr","diferencial residual"]},
  {id:"dps", label:"Instalação/adequação de DPS em quadro existente", unit:"serviço", min:180, max:380, rec:260, keywords:["dps","surto","protetor de surto"]},
  {id:"circuito-15", label:"Novo circuito dedicado até 15 m em eletroduto existente", unit:"circuito", min:280, max:520, rec:380, keywords:["novo circuito","circuito dedicado","circuito novo"]},
  {id:"circuito-30", label:"Novo circuito dedicado de 16 a 30 m em eletroduto existente", unit:"circuito", min:400, max:760, rec:550, keywords:["novo circuito","circuito dedicado","circuito novo","30 metros","20 metros"]},
  {id:"ar-condicionado", label:"Circuito elétrico dedicado para ar-condicionado", unit:"circuito", min:320, max:680, rec:480, keywords:["ar condicionado","split","circuito do ar"]},
  {id:"forno-cooktop", label:"Circuito dedicado para forno/cooktop elétrico", unit:"circuito", min:360, max:760, rec:540, keywords:["forno eletrico","cooktop","forno","circuito cozinha"]},
  {id:"quadro-revisao", label:"Revisão, reaperto e organização de quadro", unit:"serviço", min:260, max:600, rec:420, keywords:["revisao do quadro","organizar quadro","reaperto","balanceamento","quadro eletrico"]},
  {id:"quadro-pequeno", label:"Substituição/montagem de quadro até 12 circuitos", unit:"serviço", min:550, max:1100, rec:780, keywords:["quadro 12","quadro pequeno","trocar quadro","montar quadro","quadro de distribuicao"]},
  {id:"quadro-medio", label:"Substituição/montagem de quadro de 13 a 24 circuitos", unit:"serviço", min:850, max:1700, rec:1200, keywords:["quadro 18","quadro 24","quadro medio","trocar quadro","montar quadro","quadro de distribuicao"]},
  {id:"aterramento", label:"Instalação de haste/aterramento simples", unit:"ponto", min:280, max:600, rec:420, keywords:["aterramento","haste de terra","haste aterramento","terra"]},
  {id:"pe-retrofit", label:"Levar condutor de proteção (PE) a ponto/circuito existente", unit:"ponto", min:130, max:280, rec:200, keywords:["fio terra","condutor pe","aterramento no ponto","levar terra"]},
  {id:"refiacao-ponto", label:"Refiação de circuito/ponto usando eletroduto existente", unit:"ponto", min:140, max:300, rec:210, keywords:["refiacao","trocar fiacao","troca de fiacao","passar fio","passagem de fio"]},
  {id:"instalacao-ponto", label:"Instalação elétrica nova completa por ponto", unit:"ponto", min:150, max:300, rec:215, keywords:["instalacao completa","instalacao eletrica nova","por ponto","pontos eletricos"]},
  {id:"reforma-ponto", label:"Reforma elétrica completa por ponto", unit:"ponto", min:180, max:360, rec:260, keywords:["reforma eletrica","refazer instalacao","reforma completa","trocar toda fiacao"]},
  {id:"instalacao-m2", label:"Instalação elétrica residencial nova", unit:"m²", min:45, max:85, rec:62, keywords:["instalacao eletrica completa","instalacao nova","casa nova","por metro quadrado"]},
  {id:"reforma-m2", label:"Reforma/refiação elétrica residencial", unit:"m²", min:60, max:115, rec:82, keywords:["reforma eletrica completa","refiacao completa","trocar toda fiacao","reforma da instalacao"]},
  {id:"curto", label:"Diagnóstico e correção de curto/defeito localizado", unit:"serviço", min:180, max:500, rec:300, keywords:["curto circuito","curto-circuito","queda de disjuntor","desarmando","achar defeito"]},
  {id:"padrao-entrada", label:"Mão de obra de padrão de entrada residencial", unit:"serviço", min:800, max:1900, rec:1250, keywords:["padrao de entrada","padrao light","padrao enel","padrao cemig","padrao energia"]},
  {id:"bomba", label:"Ligação elétrica de bomba residencial", unit:"serviço", min:220, max:500, rec:340, keywords:["bomba dagua","bomba de agua","bomba residencial","boia eletrica"]},
  {id:"portao", label:"Alimentação elétrica para motor de portão", unit:"circuito", min:250, max:550, rec:380, keywords:["portao eletrico","motor de portao","portao automatico"]},
  {id:"emergencia-condominio", label:"Instalação de luminária de emergência em condomínio", unit:"unidade", min:100, max:220, rec:150, keywords:["luminaria de emergencia","iluminacao de emergencia","condominio"]},
  {id:"corredor-condominio", label:"Ponto/sensor de iluminação em corredor/escada", unit:"ponto", min:120, max:260, rec:180, keywords:["corredor","escada","area comum","condominio","sensor de presenca"]}
]);

let municipalities = [];
let byName = new Map();
let geoLoadedAt = 0;

const clamp = (v,min,max) => Math.max(min,Math.min(max,v));
const round5 = v => Math.round(v/5)*5;
const normalize = s => String(s || "")
  .normalize("NFD").replace(/[\u0300-\u036f]/g,"")
  .toLowerCase().replace(/[^a-z0-9]+/g," ").trim();

function stateFromText(text) {
  const raw = String(text || "");
  const upper = raw.toUpperCase();
  for (const uf of Object.keys(STATE_SINAPI_M2)) {
    if (new RegExp(`(^|[^A-Z])${uf}([^A-Z]|$)`).test(upper)) return uf;
  }
  const n = normalize(raw);
  for (const [name,uf] of Object.entries(STATE_NAMES)) {
    if (n.includes(name)) return uf;
  }
  return null;
}

export async function initLaborPricingGeo(force=false) {
  if (!force && municipalities.length && Date.now()-geoLoadedAt < 7*86400000) return;
  const url = "https://apisidra.ibge.gov.br/values/t/6579/n6/all/v/9324/p/2026?formato=json";
  const resp = await fetch(url,{headers:{"User-Agent":"Expert-Eletricista-24H/1.0"}});
  if (!resp.ok) throw new Error(`IBGE SIDRA HTTP ${resp.status}`);
  const rows = await resp.json();
  const parsed = [];
  for (const row of rows.slice(1)) {
    const full = String(row.D1N || "");
    const m = full.match(/^(.*) - ([A-Z]{2})$/);
    if (!m) continue;
    const population = Number(String(row.V || "").replace(/\D/g,""));
    if (!Number.isFinite(population) || population <= 0) continue;
    parsed.push({code:String(row.D1C || ""),city:m[1],uf:m[2],population,norm:normalize(m[1])});
  }
  if (parsed.length < 5500) throw new Error("IBGE retornou poucos municípios");
  const map = new Map();
  for (const item of parsed) {
    if (!map.has(item.norm)) map.set(item.norm,[]);
    map.get(item.norm).push(item);
  }
  municipalities = parsed;
  byName = map;
  geoLoadedAt = Date.now();
}

function detectCity(text) {
  if (!municipalities.length) return null;
  const n = ` ${normalize(text)} `;
  const hintedUf = stateFromText(text);
  let best = null;

  for (const [name,items] of byName.entries()) {
    if (name.length < 5) continue;
    if (!n.includes(` ${name} `)) continue;
    const filtered = hintedUf ? items.filter(x=>x.uf===hintedUf) : items;
    if (filtered.length !== 1) continue;
    const item = filtered[0];
    if (!best || name.length > best.norm.length) best = item;
  }
  return best;
}

function populationFactor(pop) {
  if (pop < 20000) return 0.86;
  if (pop < 50000) return 0.90;
  if (pop < 100000) return 0.94;
  if (pop < 250000) return 1.00;
  if (pop < 500000) return 1.06;
  if (pop < 1000000) return 1.12;
  if (pop < 2000000) return 1.18;
  return 1.24;
}

function cityFactor(city) {
  if (!city) return 1;
  const stateRaw = STATE_SINAPI_M2[city.uf] || NATIONAL_SINAPI_M2;
  const stateFactor = 0.78 + 0.22*(stateRaw/NATIONAL_SINAPI_M2);
  const capital = CAPITALS.has(`${city.norm}|${city.uf}`);
  let structural = stateFactor * populationFactor(city.population) * (capital ? 1.05 : 1);
  structural = clamp(structural,0.82,1.35);

  const market = MARKET_HOURLY[`${city.norm}|${city.uf}`];
  if (market) {
    const marketFactor = clamp(market/110,0.75,1.65);
    structural = 0.55*structural + 0.45*marketFactor;
  }
  return clamp(structural,0.82,1.45);
}

function hasPriceIntent(text) {
  const n = normalize(text);
  return /(quanto cobrar|quanto custa|preco|valor|orcamento|mao de obra|cobrar por|tabela de preco|faixa de preco)/.test(n);
}

function serviceMatches(text) {
  const n = normalize(text);
  const scored = LABOR_SERVICES.map(s=>{
    let score = 0;
    for (const k of s.keywords) {
      const nk = normalize(k);
      if (n.includes(nk)) score += Math.max(1,nk.split(" ").length);
    }
    return {service:s,score};
  }).filter(x=>x.score>0).sort((a,b)=>b.score-a.score || b.service.rec-a.service.rec);
  const out = [];
  const seen = new Set();
  for (const x of scored) {
    if (seen.has(x.service.id)) continue;
    out.push(x.service); seen.add(x.service.id);
    if (out.length >= 4) break;
  }
  return out;
}

function quantityFromText(text) {
  const n = normalize(text);
  const m = n.match(/\b(\d{1,3})\s*(pontos?|tomadas?|interruptores?|spots?|luminarias?|unidades?)\b/);
  if (!m) return null;
  const qty = Number(m[1]);
  return qty > 0 ? qty : null;
}

function areaFromText(text) {
  const n = normalize(text);
  const m = n.match(/\b(\d{2,4})\s*(m2|metros quadrados|metro quadrado)\b/);
  if (!m) return null;
  const area = Number(m[1]);
  return area > 0 ? area : null;
}

function bulkDiscount(qty) {
  if (!qty || qty < 4) return 0;
  if (qty <= 10) return 0.05;
  if (qty <= 25) return 0.10;
  return 0.15;
}

function formatBRL(v) {
  return "R$ " + Math.round(v).toLocaleString("pt-BR");
}

function adjustedService(s,factor,discount=0) {
  const f = factor*(1-discount);
  return {
    ...s,
    min:round5(s.min*f),
    max:round5(s.max*f),
    rec:round5(s.rec*f)
  };
}

export async function buildLaborPricingContext(conversationText) {
  if (!hasPriceIntent(conversationText)) return "";
  if (!municipalities.length) {
    try { await initLaborPricingGeo(); } catch {}
  }

  const city = detectCity(conversationText);
  const hintedUf = stateFromText(conversationText);
  const services = serviceMatches(conversationText);
  const qty = quantityFromText(conversationText);
  const area = areaFromText(conversationText);

  if (!city) {
    return [
      "REFERÊNCIA INTERNA DE PREÇOS DE MÃO DE OBRA — OUT/2026.",
      "O usuário está pedindo preço/orçamento, mas a cidade não foi identificada com segurança.",
      hintedUf ? `UF percebida: ${hintedUf}. Pergunte somente a cidade.` : "Pergunte somente: 'Qual cidade e UF do serviço?'",
      "Não dê valor local definitivo sem cidade. Se o usuário insistir, forneça apenas referência nacional e diga que é provisória.",
      "MATERIAIS: separe totalmente da mão de obra; não some material a menos que o usuário peça."
    ].join("\n");
  }

  const factor = cityFactor(city);
  const discount = bulkDiscount(qty);
  const candidates = services.length ? services : [
    LABOR_SERVICES.find(s=>s.id==="hora"),
    LABOR_SERVICES.find(s=>s.id==="visita")
  ];

  const lines = [
    "REFERÊNCIA INTERNA DE PREÇOS DE MÃO DE OBRA — OUT/2026.",
    `Local identificado: ${city.city} - ${city.uf}; população IBGE 2026: ${city.population.toLocaleString("pt-BR")}.`,
    `Multiplicador local estimado: ${factor.toFixed(2)}x. Base geográfica: população municipal IBGE 2026 + ajuste estadual SINAPI set/2026 + calibração limitada de mercado onde disponível.`,
    "Os valores abaixo são SOMENTE MÃO DE OBRA. Materiais, peças, taxa da concessionária, ART/TRT e reparo civil não estão incluídos, salvo se explicitamente dito.",
    "Não trate como tabela oficial ou cotação exata. É faixa orientativa para autônomo formar preço.",
    "Serviços mais compatíveis com a conversa:"
  ];

  for (const s of candidates) {
    const a = adjustedService(s,factor,discount);
    let extra = "";
    if (qty && ["ponto","unidade"].includes(a.unit)) {
      extra = ` | ${qty}x: ${formatBRL(a.min*qty)}–${formatBRL(a.max*qty)}; recomendado ~${formatBRL(a.rec*qty)}`;
    } else if (area && a.unit==="m²") {
      extra = ` | ${area} m²: ${formatBRL(a.min*area)}–${formatBRL(a.max*area)}; recomendado ~${formatBRL(a.rec*area)}`;
    }
    lines.push(`- ${a.label}: ${formatBRL(a.min)}–${formatBRL(a.max)} por ${a.unit}; recomendado ~${formatBRL(a.rec)}${extra}`);
  }

  if (discount>0) lines.push(`Foi aplicado desconto de escala de ${Math.round(discount*100)}% por quantidade; não aplique outro desconto automático.`);
  lines.push(
    "Ajustes de execução: instalação antiga/difícil +15% a +35%; rasgo/alvenaria/acesso ruim +20% a +50%; altura relevante +20% a +40%; urgência/noite/fim de semana +30% a +60%; deslocamento fora da área habitual: cobrar separado.",
    "Ao responder, dê PRIMEIRO a mão de obra: 'Faixa: R$ X–Y. Eu cobraria: R$ Z.' Depois diga em uma frase o que está incluso. Materiais só em bloco separado se forem solicitados.",
    "Se faltarem detalhes que mudam muito o preço, não faça interrogatório: pergunte no máximo 1 ou 2 itens decisivos (por exemplo, existe eletroduto? haverá quebra?)."
  );
  return lines.join("\n");
}

export function laborPricingStatus() {
  return {
    reference:"2026-10",
    municipalities_loaded:municipalities.length,
    geo_loaded:municipalities.length>0,
    service_count:LABOR_SERVICES.length
  };
}
