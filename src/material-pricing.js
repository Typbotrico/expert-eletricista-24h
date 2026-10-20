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

// Faixas nacionais de varejo observadas em out/2026. Não representam uma marca específica.
// Valores são somente material, sem frete, mão de obra ou acessórios não citados.
export const MATERIALS = Object.freeze([
  {id:"cabo-1.5", label:"Cabo flexível cobre 1,5 mm² 750 V", unit:"m", min:1.55, max:2.30, rec:1.85, keys:["cabo 1,5","cabo 1.5","fio 1,5","fio 1.5","1,5mm","1.5mm"]},
  {id:"cabo-2.5", label:"Cabo flexível cobre 2,5 mm² 750 V", unit:"m", min:2.30, max:3.20, rec:2.65, keys:["cabo 2,5","cabo 2.5","fio 2,5","fio 2.5","2,5mm","2.5mm"]},
  {id:"cabo-4", label:"Cabo flexível cobre 4 mm² 750 V", unit:"m", min:4.00, max:5.80, rec:4.60, keys:["cabo 4mm","cabo 4 mm","fio 4mm","fio 4 mm","4mm2","4 mm2"]},
  {id:"cabo-6", label:"Cabo flexível cobre 6 mm² 750 V", unit:"m", min:6.00, max:8.50, rec:6.90, keys:["cabo 6mm","cabo 6 mm","fio 6mm","fio 6 mm","6mm2","6 mm2"]},
  {id:"cabo-10", label:"Cabo flexível cobre 10 mm² 750 V", unit:"m", min:10.50, max:14.50, rec:12.00, keys:["cabo 10mm","cabo 10 mm","fio 10mm","fio 10 mm","10mm2","10 mm2"]},
  {id:"cabo-16", label:"Cabo flexível cobre 16 mm² 750 V", unit:"m", min:16.00, max:22.00, rec:18.50, keys:["cabo 16mm","cabo 16 mm","fio 16mm","fio 16 mm","16mm2","16 mm2"]},
  {id:"cabo-25", label:"Cabo flexível cobre 25 mm² 750 V", unit:"m", min:25.00, max:35.00, rec:29.00, keys:["cabo 25mm","cabo 25 mm","fio 25mm","fio 25 mm","25mm2","25 mm2"]},

  {id:"disj-1p", label:"Disjuntor DIN monopolar curva C residencial", unit:"un", min:10, max:22, rec:15, keys:["disjuntor monopolar","disjuntor 1p","disjuntor unipolar"]},
  {id:"disj-2p", label:"Disjuntor DIN bipolar curva C residencial", unit:"un", min:37, max:62, rec:46, keys:["disjuntor bipolar","disjuntor 2p"]},
  {id:"disj-3p", label:"Disjuntor DIN tripolar curva C residencial/predial", unit:"un", min:55, max:90, rec:68, keys:["disjuntor tripolar","disjuntor 3p"]},

  {id:"dr-2p-40", label:"DR bipolar 40 A / 30 mA", unit:"un", min:125, max:225, rec:160, keys:["dr 2p 40","dr bipolar 40","dr 40a bipolar","dr 40 a bipolar"]},
  {id:"dr-2p-63", label:"DR bipolar 63 A / 30 mA", unit:"un", min:145, max:260, rec:185, keys:["dr 2p 63","dr bipolar 63","dr 63a bipolar","dr 63 a bipolar"]},
  {id:"dr-4p-40", label:"DR tetrapolar 40 A / 30 mA", unit:"un", min:140, max:240, rec:175, keys:["dr 4p 40","dr tetrapolar 40","dr 40a tetrapolar","dr 40 a tetrapolar"]},
  {id:"dr-4p-63", label:"DR tetrapolar 63 A / 30 mA", unit:"un", min:155, max:280, rec:195, keys:["dr 4p 63","dr tetrapolar 63","dr 63a tetrapolar","dr 63 a tetrapolar"]},
  {id:"dr-generico", label:"DR 30 mA residencial (corrente/polos a definir)", unit:"un", min:130, max:280, rec:180, keys:["preco do dr","valor do dr","quanto custa o dr","interruptor diferencial residual"]},

  {id:"dps-20", label:"DPS Classe II 20 kA 275 V", unit:"un", min:45, max:80, rec:60, keys:["dps 20ka","dps 20 ka","dps 20k","dps 20 k"]},
  {id:"dps-40", label:"DPS Classe II 40 kA 275 V", unit:"un", min:70, max:110, rec:85, keys:["dps 40ka","dps 40 ka","dps 40k","dps 40 k"]},
  {id:"dps-generico", label:"DPS Classe II residencial (capacidade a definir)", unit:"un", min:50, max:110, rec:75, keys:["preco do dps","valor do dps","quanto custa o dps","protetor de surto"]},

  {id:"tomada-10", label:"Conjunto tomada 2P+T 10 A 4x2", unit:"un", min:6, max:25, rec:15, keys:["tomada 10a","tomada 10 a","tomada de 10"]},
  {id:"tomada-20", label:"Conjunto tomada 2P+T 20 A 4x2", unit:"un", min:12, max:30, rec:19, keys:["tomada 20a","tomada 20 a","tomada de 20"]},
  {id:"interruptor-simples", label:"Conjunto interruptor simples 10 A 4x2", unit:"un", min:8, max:25, rec:15, keys:["interruptor simples","interruptor 10a","interruptor 10 a"]},
  {id:"interruptor-paralelo", label:"Módulo/conjunto interruptor paralelo", unit:"un", min:15, max:35, rec:22, keys:["interruptor paralelo","three way","interruptor 3 way"]},

  {id:"caixa-4x2", label:"Caixa elétrica de embutir 4x2", unit:"un", min:1.50, max:5.50, rec:3.00, keys:["caixa 4x2","caixinha 4x2"]},
  {id:"caixa-4x4", label:"Caixa elétrica de embutir 4x4", unit:"un", min:5.50, max:13, rec:9, keys:["caixa 4x4","caixinha 4x4"]},

  {id:"eletroduto-20", label:"Eletroduto corrugado PVC 20 mm", unit:"m", min:1.60, max:3.80, rec:2.40, keys:["eletroduto 20mm","eletroduto 20 mm","conduite 20mm","conduite 20 mm","corrugado 20mm","corrugado 20 mm"]},
  {id:"eletroduto-25", label:"Eletroduto corrugado PVC 25 mm", unit:"m", min:2.40, max:4.20, rec:3.20, keys:["eletroduto 25mm","eletroduto 25 mm","conduite 25mm","conduite 25 mm","corrugado 25mm","corrugado 25 mm"]},
  {id:"eletroduto-32", label:"Eletroduto corrugado PVC 32 mm", unit:"m", min:4.60, max:7.00, rec:5.80, keys:["eletroduto 32mm","eletroduto 32 mm","conduite 32mm","conduite 32 mm","corrugado 32mm","corrugado 32 mm"]},

  {id:"quadro-8", label:"Quadro de distribuição 8 DIN com barramento básico", unit:"un", min:65, max:110, rec:80, keys:["quadro 8 din","quadro 8 disjuntores","quadro de 8"]},
  {id:"quadro-12", label:"Quadro de distribuição 12/16 DIN", unit:"un", min:110, max:210, rec:145, keys:["quadro 12 din","quadro 12 disjuntores","quadro 16 din","quadro 16 disjuntores"]},
  {id:"quadro-24", label:"Quadro de distribuição 24 DIN com barramento", unit:"un", min:125, max:260, rec:170, keys:["quadro 24 din","quadro 24 disjuntores","quadro de 24"]},
  {id:"barramento", label:"Barramento neutro/terra para quadro", unit:"un", min:25, max:55, rec:40, keys:["barramento neutro","barramento terra","barramento de neutro","barramento de terra"]},

  {id:"haste-terra", label:"Haste de aterramento cobreada 2,4 m", unit:"un", min:55, max:90, rec:70, keys:["haste de aterramento","haste aterramento","haste de terra","haste 2,4","haste 2.4"]},
  {id:"conector-wago2", label:"Conector alavanca 2 vias 32/41 A", unit:"un", min:5, max:11, rec:8, keys:["wago 2","conector 2 vias","conector duas vias"]},
  {id:"conector-wago3", label:"Conector alavanca 3 vias 32/41 A", unit:"un", min:5, max:12, rec:8, keys:["wago 3","conector 3 vias","conector tres vias"]},
  {id:"fita-20", label:"Fita isolante 18/19 mm x 20 m", unit:"rolo", min:8, max:22, rec:12, keys:["fita isolante 20m","fita isolante 20 m","fita isolante"]},
  {id:"porcelana", label:"Conector de porcelana tripolar", unit:"un", min:8, max:16, rec:11, keys:["conector porcelana","borne porcelana","conector de porcelana"]}
]);

let municipalities = [];
let byName = new Map();
let geoLoadedAt = 0;

const clamp = (v,min,max) => Math.max(min,Math.min(max,v));
const roundMoney = v => v < 10 ? Math.round(v*100)/100 : Math.round(v);
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
  for (const [name,uf] of Object.entries(STATE_NAMES)) if (n.includes(name)) return uf;
  return null;
}

export async function initMaterialPricingGeo(force=false) {
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
    parsed.push({code:String(row.D1C||""),city:m[1],uf:m[2],population,norm:normalize(m[1])});
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
    if (name.length < 5 || !n.includes(` ${name} `)) continue;
    const filtered = hintedUf ? items.filter(x=>x.uf===hintedUf) : items;
    if (filtered.length !== 1) continue;
    const item = filtered[0];
    if (!best || name.length > best.norm.length) best = item;
  }
  return best;
}

function materialLocationFactor(city,uf) {
  const state = uf || city?.uf;
  const ratio = state && STATE_SINAPI_M2[state] ? STATE_SINAPI_M2[state]/NATIONAL_SINAPI_M2 : 1;
  let factor = 0.88 + 0.12*ratio;

  if (city) {
    let cityAdj = 1;
    if (city.population < 20000) cityAdj = 1.05;
    else if (city.population < 50000) cityAdj = 1.03;
    else if (city.population < 100000) cityAdj = 1.02;
    else if (city.population < 500000) cityAdj = 1.00;
    else if (city.population < 2000000) cityAdj = 1.01;
    else cityAdj = 1.02;
    if (CAPITALS.has(`${city.norm}|${city.uf}`)) cityAdj *= 1.01;
    factor *= cityAdj;
  }
  return clamp(factor,0.90,1.15);
}

function hasExplicitMaterialIntent(text) {
  const n = normalize(text);
  if (/(material|materiais|insumo|insumos|lista de compra|lista de material|custo do material|valor do material|preco do material|quanto sai o material)/.test(n)) return true;
  const price = /(quanto custa|qual o preco|preco|valor|quanto sai|quanto ta|quanto esta)/.test(n);
  const item = /(cabo|fio |dr |dps|disjuntor|tomada|interruptor|caixa 4x|eletroduto|conduite|quadro|barramento|haste|aterramento|wago|conector|fita isolante)/.test(n);
  const service = /(mao de obra|servico|instalar|instalacao|trocar|troca|montar|montagem|fazer um ponto|cobrar para)/.test(n);
  return price && item && !service;
}

function findMaterials(text) {
  const n = normalize(text);
  const scored = [];
  for (const item of MATERIALS) {
    let score = 0;
    for (const k of item.keys) {
      const nk = normalize(k);
      if (n.includes(nk)) score += Math.max(1,nk.split(" ").length);
    }
    if (score>0) scored.push({item,score});
  }
  scored.sort((a,b)=>b.score-a.score || b.item.rec-a.item.rec);
  const out = [];
  const seen = new Set();
  for (const x of scored) {
    if (seen.has(x.item.id)) continue;
    // Evita devolver genérico se já existe versão específica do mesmo grupo.
    if (x.item.id.endsWith("generico") && out.some(o=>o.id.startsWith(x.item.id.split("-")[0]+"-"))) continue;
    out.push(x.item);
    seen.add(x.item.id);
    if (out.length >= 6) break;
  }
  return out;
}

function lengthQty(text,item) {
  const n = normalize(text);
  if (item.unit === "m") {
    const m = n.match(/\b(\d{1,4}(?:[.,]\d+)?)\s*(m|metros|metro)\b/);
    if (m) return Number(m[1].replace(",","."));
  }
  const u = n.match(/\b(\d{1,3})\s*(un|unidade|unidades|peca|pecas)\b/);
  if (u) return Number(u[1]);
  return null;
}

function fmt(v) {
  return "R$ " + roundMoney(v).toLocaleString("pt-BR",{minimumFractionDigits:v<10?2:0,maximumFractionDigits:2});
}

export async function buildMaterialPricingContext(conversationText) {
  if (!hasExplicitMaterialIntent(conversationText)) return "";
  if (!municipalities.length) {
    try { await initMaterialPricingGeo(); } catch {}
  }

  const city = detectCity(conversationText);
  const uf = city?.uf || stateFromText(conversationText);
  const items = findMaterials(conversationText);

  if (!city && !uf) {
    return [
      "REFERÊNCIA INTERNA DE PREÇOS DE MATERIAIS ELÉTRICOS — OUT/2026.",
      "O usuário pediu PREÇO DE MATERIAL, mas não informou localização.",
      "Pergunte somente: 'Qual cidade e UF?'",
      "Não responda mão de obra. Não misture serviço com material."
    ].join("\n");
  }

  if (!items.length) {
    return [
      "REFERÊNCIA INTERNA DE PREÇOS DE MATERIAIS ELÉTRICOS — OUT/2026.",
      city ? `Local: ${city.city} - ${city.uf}.` : `UF: ${uf}.`,
      "O pedido é sobre material, mas o item não foi identificado com segurança.",
      "Pergunte somente qual material/modelo/bitola/corrente a pessoa quer cotar.",
      "Não responda mão de obra."
    ].join("\n");
  }

  const factor = materialLocationFactor(city,uf);
  const loc = city ? `${city.city} - ${city.uf}` : uf;
  const lines = [
    "REFERÊNCIA INTERNA DE PREÇOS DE MATERIAIS ELÉTRICOS — OUT/2026.",
    `Local de referência: ${loc}.`,
    `Fator regional estimado de material: ${factor.toFixed(3)}x.`,
    "Base: faixas nacionais de varejo online observadas em out/2026, ajustadas moderadamente por UF com sinal regional SINAPI e por porte/logística municipal. Não é cotação de loja específica nem preço oficial.",
    "RESPONDA SOMENTE MATERIAL. Não inclua mão de obra, instalação ou serviço a menos que o usuário peça explicitamente ambos.",
    "Frete não incluído. Marca/linha pode alterar bastante o valor; prefira informar faixa.",
    "Itens compatíveis:"
  ];

  for (const item of items) {
    const min = item.min*factor, max=item.max*factor, rec=item.rec*factor;
    const qty = lengthQty(conversationText,item);
    let total = "";
    if (qty && qty>0) total = ` | ${qty} ${item.unit}: ${fmt(min*qty)}–${fmt(max*qty)}; referência ~${fmt(rec*qty)}`;
    lines.push(`- ${item.label}: ${fmt(min)}–${fmt(max)} por ${item.unit}; referência ~${fmt(rec)}${total}`);
  }

  lines.push(
    "Formato de resposta: 'Material: [item]. Faixa: R$ X–Y por unidade/metro. Referência: ~R$ Z.'",
    "Se o usuário pedir preço de cabo, informe por metro e, se a metragem estiver clara, também o total.",
    "Se perguntar apenas 'valor do serviço', NÃO use esta tabela. Serviço = mão de obra.",
    "Se perguntar material + mão de obra, separe em dois blocos: MÃO DE OBRA e MATERIAL."
  );

  return lines.join("\n");
}

export async function buildMaterialDirectReply(text) {
  if (!municipalities.length) {
    try { await initMaterialPricingGeo(); } catch {}
  }

  const city = detectCity(text);
  const uf = city?.uf || stateFromText(text);
  if (!city && !uf) return "Qual cidade e UF? [[AGUARDANDO_DADOS]]";

  const items = findMaterials(text);
  if (!items.length) return "Qual material você quer cotar? [[AGUARDANDO_DADOS]]";

  const factor = materialLocationFactor(city,uf);
  const loc = city ? city.city : uf;
  const lines = [];

  for (const item of items.slice(0,3)) {
    const min = item.min*factor;
    const max = item.max*factor;
    const rec = item.rec*factor;
    const qty = lengthQty(text,item);

    if (qty && qty>0) {
      lines.push(`${item.label}: ${fmt(min)} a ${fmt(max)} por ${item.unit}.`);
      lines.push(`${qty} ${item.unit}: ${fmt(min*qty)} a ${fmt(max*qty)}. Referência: ~${fmt(rec*qty)}.`);
    } else {
      lines.push(`${item.label} em ${loc}: ${fmt(min)} a ${fmt(max)} por ${item.unit}. Referência: ~${fmt(rec)}.`);
    }
  }

  return lines.join("\n");
}

export function materialPricingStatus() {
  return {
    reference:"2026-10",
    municipalities_loaded:municipalities.length,
    geo_loaded:municipalities.length>0,
    material_count:MATERIALS.length
  };
}
