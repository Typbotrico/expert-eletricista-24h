import express from "express";
import pg from "pg";
import crypto from "node:crypto";
import { SYSTEM_PROMPT } from "./expert-prompt.js";
import { buildLaborPricingContext, buildLaborDirectReply, initLaborPricingGeo, laborPricingStatus } from "./labor-pricing.js";
import { buildMaterialPricingContext, buildMaterialDirectReply, initMaterialPricingGeo, materialPricingStatus } from "./material-pricing.js";

const { Pool } = pg;
const app = express();
app.disable("x-powered-by");

const SETTINGS = Object.freeze({
  model: "@cf/zai-org/glm-4.7-flash",
  audioModel: "@cf/openai/whisper-large-v3-turbo",
  visionModel: "@cf/google/gemma-4-26b-a4b-it",
  maxAudioBytes: 16 * 1024 * 1024,
  maxImageBytes: 8 * 1024 * 1024,
  monthlyQuestions: 150,
  periodDays: 30,
  maxCharsIn: 1200,
  maxCharsOut: 1000,
  freeClarificationReplies: 2,
  clarificationWindowMinutes: 30,
  defaultGlobalAiRepliesMonth: 3000
});

const normalizeIntent = s => String(s || "")
  .normalize("NFD").replace(/[\u0300-\u036f]/g,"")
  .toLowerCase().replace(/[^a-z0-9]+/g," ").trim();

function pricingIntent(text) {
  const n = normalizeIntent(text);
  const asksPrice = /(quanto|preco|valor|custa|cobrar|orcamento|fica)/.test(n);
  if (!asksPrice) return "none";

  const explicitBoth =
    /(material e mao de obra|mao de obra e material|material mais mao de obra|mao de obra mais material|material \+ mao de obra|com material e instalacao|incluindo material|material incluso|com material incluso|valor total com material|servico completo com material)/.test(n);
  if (explicitBoth) return "both";

  const labor =
    /(mao de obra|valor do servico|preco do servico|quanto cobrar|cobrar para|instalar|instalacao|instale|trocar|troca de|substituir|substituicao|montar|montagem|passar cabo|passagem de cabo|fazer ponto|novo ponto|reforma eletrica|refiacao|visita tecnica|diagnostico|reparo|conserto)/.test(n);
  if (labor) return "labor";

  const material =
    /(material|materiais|insumo|insumos|cabo|fio |metro do fio|metro do cabo|dr\b|dps\b|disjuntor|tomada|interruptor|eletroduto|conduite|quadro|barramento|haste|wago|conector|fita isolante)/.test(n);
  if (material) return "material";

  return "labor";
}

function isTechnicalElectricalQuestion(text) {
  const n = normalizeIntent(text);
  const price = /(quanto custa|quanto fica|quanto cobrar|preco|valor|orcamento|mao de obra|material incluso)/.test(n);
  if (price) return false;
  const electrical = /(dr\b|idr\b|dps\b|disjuntor|quadro|barramento|aterramento|terra\b|condutor pe|\bpe\b|\bpen\b|neutro|fase|tensao|corrente|potencia|cabo|fio\b|bitola|tomada|interruptor|chuveiro|circuito|borne|entrada|saida|ligacao|diagrama|esquema)/.test(n);
  const question = /(como|qual|quais|onde|por que|porque|o que|pra que|para que|serve|funciona|ligar|instalar|trocar|testar|medir|identificar|dimensionar|calcular|entrada|saida|borne|passo a passo|esquema|diagrama|posso|devo)/.test(n);
  return electrical && question;
}

function followUpPricingIntent(text,previous) {
  const n = normalizeIntent(text);
  if (isTechnicalElectricalQuestion(text)) return "none";

  // Só respostas curtas podem continuar um orçamento anterior.
  if (n.length > 90 || String(text || "").includes("?")) return "none";

  const lastAssistant = [...previous].reverse().find(m=>m?.role==="assistant");
  const a = normalizeIntent(lastAssistant?.content || "");
  if (!a) return "none";

  // Só mantém o modo de preço quando a última resposta estava esperando um dado do orçamento.
  const asksLocation = a.includes("qual cidade e uf") || a.includes("qual cidade do servico");
  const asksMaterial = a.includes("qual material voce quer cotar");
  const asksService = a.includes("qual servico voce quer orcar");

  if (asksLocation) {
    const priorUsers = [...previous].reverse().filter(m=>m?.role==="user");
    for (const m of priorUsers) {
      const i = pricingIntent(String(m?.content || ""));
      if (i !== "none") return i;
    }
  }
  if (asksMaterial) return "material";
  if (asksService) return "labor";

  return "none";
}

const requiredEnv = [
  "DATABASE_URL",
  "META_ACCESS_TOKEN",
  "META_APP_SECRET",
  "WEBHOOK_VERIFY_TOKEN",
  "WHATSAPP_PHONE_NUMBER_ID",
  "CLOUDFLARE_ACCOUNT_ID",
  "CLOUDFLARE_AI_TOKEN"
];

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : undefined,
  max: 5
});

const safeEqual = (a,b) => {
  if (typeof a !== "string" || typeof b !== "string") return false;
  const aa = Buffer.from(a), bb = Buffer.from(b);
  return aa.length === bb.length && crypto.timingSafeEqual(aa,bb);
};
const phoneOk = s => /^\d{10,15}$/.test(s || "");
const normalizePhone = s => String(s || "").replace(/\D/g,"");
const sha256 = s => crypto.createHash("sha256").update(s).digest("hex");
const phoneHash = phone => {
  const pepper = process.env.USER_HASH_SECRET || process.env.META_APP_SECRET || "";
  if (pepper.length < 16) throw new Error("Segredo de hash indisponível");
  if (!phoneOk(phone)) throw new Error("Número inválido");
  return sha256(`${pepper}:${phone}`);
};

function extractMessages(payload) {
  return (payload?.entry || [])
    .flatMap(e => e?.changes || [])
    .filter(c => c?.field === "messages")
    .flatMap(c => c?.value?.messages || []);
}

function chooseCharge(s) {
  const now = new Date();
  if (!s || s.status !== "active") return "inactive";
  if (!(new Date(s.period_start) <= now && now < new Date(s.period_end))) return "inactive";
  if (s.pending_until && new Date(s.pending_until) > now && s.clarification_left > 0) return "clarification";
  if (s.questions_used >= s.question_limit) return "exhausted";
  return "question";
}

function enforceElectricalSafetyText(raw) {
  let text = String(raw || "");
  const n = normalizeIntent(text);

  const saysPeThroughDr =
    /(terra|condutor pe|condutor de protecao|fio terra).{0,45}(passa|passar|entra|entrar|sai|sair).{0,30}\bdr\b/.test(n) &&
    !/(terra|condutor pe|condutor de protecao|fio terra).{0,45}(nao|nunca).{0,20}(passa|passar|entra|entrar).{0,30}\bdr\b/.test(n);

  const saysJoinAfterDr =
    /(juntar|unir|pontear|ligar).{0,25}(neutro|n).{0,20}(terra|pe).{0,35}(depois|apos).{0,20}\bdr\b/.test(n);

  if (saysPeThroughDr || saysJoinAfterDr) {
    return [
      "Correção importante:",
      "- O PE/terra NÃO passa pelo DR. Ele vai direto ao barramento PE e às carcaças/equipamentos.",
      "- Pelo DR passam somente os condutores ativos do circuito protegido; em fase + neutro, passam fase e neutro.",
      "- Depois do DR, neutro e PE não devem ser unidos.",
      "Antes de orientar a ligação: qual é o esquema de aterramento (TT, TN-S, TN-C-S ou outro) e os barramentos N e PE estão separados?"
    ].join("\n") + " [[AGUARDANDO_DADOS]]";
  }

  return text;
}

function parseExpertAnswer(raw) {
  raw = enforceElectricalSafetyText(String(raw || ""));
  return {
    answer: raw.replace(/\[\[AGUARDANDO_DADOS\]\]/g,"").trim().slice(0,SETTINGS.maxCharsOut),
    pending: raw.includes("[[AGUARDANDO_DADOS]]")
  };
}

async function initDb() {
  if (!process.env.DATABASE_URL) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS subscribers (
      user_hash TEXT PRIMARY KEY,
      status TEXT NOT NULL CHECK(status IN ('active','suspended')),
      period_start TIMESTAMPTZ NOT NULL,
      period_end TIMESTAMPTZ NOT NULL,
      question_limit INTEGER NOT NULL,
      questions_used INTEGER NOT NULL DEFAULT 0,
      pending_until TIMESTAMPTZ,
      clarification_left INTEGER NOT NULL DEFAULT 0,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS processed_messages (
      id_hash TEXT PRIMARY KEY,
      status TEXT NOT NULL DEFAULT 'received',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS usage_counters (
      quota_key TEXT PRIMARY KEY,
      qty INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS sessions (
      user_hash TEXT PRIMARY KEY,
      history_json JSONB NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS admin_audit (
      id BIGSERIAL PRIMARY KEY,
      user_hash TEXT NOT NULL,
      action TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
}

async function claimCounter(key,max) {
  await pool.query("INSERT INTO usage_counters(quota_key,qty) VALUES($1,0) ON CONFLICT(quota_key) DO NOTHING",[key]);
  const r = await pool.query("UPDATE usage_counters SET qty=qty+1 WHERE quota_key=$1 AND qty<$2 RETURNING qty",[key,max]);
  return r.rowCount === 1;
}
async function releaseCounter(key) {
  await pool.query("UPDATE usage_counters SET qty=GREATEST(0,qty-1) WHERE quota_key=$1",[key]);
}
async function userState(hash) {
  const r = await pool.query("SELECT * FROM subscribers WHERE user_hash=$1",[hash]);
  return r.rows[0] || null;
}
async function chargeSubscriber(hash,kind) {
  const sql = kind === "clarification"
    ? "UPDATE subscribers SET clarification_left=clarification_left-1,updated_at=NOW() WHERE user_hash=$1 AND status='active' AND period_start<=NOW() AND period_end>NOW() AND pending_until>NOW() AND clarification_left>0 RETURNING user_hash"
    : "UPDATE subscribers SET questions_used=questions_used+1,pending_until=NULL,clarification_left=0,updated_at=NOW() WHERE user_hash=$1 AND status='active' AND period_start<=NOW() AND period_end>NOW() AND questions_used<question_limit RETURNING user_hash";
  const r = await pool.query(sql,[hash]);
  return r.rowCount === 1;
}
async function refundSubscriber(hash,kind) {
  if (kind === "question") await pool.query("UPDATE subscribers SET questions_used=GREATEST(questions_used-1,0) WHERE user_hash=$1",[hash]);
  if (kind === "clarification") await pool.query("UPDATE subscribers SET clarification_left=LEAST(clarification_left+1,2) WHERE user_hash=$1",[hash]);
}
async function history(hash) {
  const r = await pool.query("SELECT history_json FROM sessions WHERE user_hash=$1 AND updated_at>NOW()-INTERVAL '7 days'",[hash]);
  const h = r.rows[0]?.history_json;
  return Array.isArray(h) ? h.slice(-6) : [];
}
async function saveHistory(hash,messages) {
  await pool.query(
    "INSERT INTO sessions(user_hash,history_json,updated_at) VALUES($1,$2::jsonb,NOW()) ON CONFLICT(user_hash) DO UPDATE SET history_json=EXCLUDED.history_json,updated_at=NOW()",
    [hash,JSON.stringify(messages.slice(-8))]
  );
}
async function markPending(hash,pending,chargeType) {
  const until = pending ? new Date(Date.now()+SETTINGS.clarificationWindowMinutes*60000) : null;
  if (chargeType === "clarification") {
    await pool.query("UPDATE subscribers SET pending_until=$1,clarification_left=CASE WHEN $2 THEN clarification_left ELSE 0 END WHERE user_hash=$3",[until,pending,hash]);
  } else {
    await pool.query("UPDATE subscribers SET pending_until=$1,clarification_left=$2 WHERE user_hash=$3",[until,pending?SETTINGS.freeClarificationReplies:0,hash]);
  }
}

const graphVersion = () => /^v\d+\.\d+$/.test(process.env.GRAPH_API_VERSION || "") ? process.env.GRAPH_API_VERSION : "v26.0";

async function fetchWhatsAppMedia(mediaId,maxBytes) {
  const token = process.env.META_ACCESS_TOKEN;
  if (!token || !mediaId) throw new Error("Mídia Meta indisponível");

  const metaResp = await fetch(`https://graph.facebook.com/${graphVersion()}/${encodeURIComponent(mediaId)}`,{
    headers:{Authorization:`Bearer ${token}`}
  });
  const meta = await metaResp.json().catch(()=>({}));
  if (!metaResp.ok || !meta?.url) throw new Error(`Meta mídia HTTP ${metaResp.status}`);
  if (Number(meta.file_size || 0) > maxBytes) throw new Error("Mídia acima do limite");

  const mediaResp = await fetch(meta.url,{headers:{Authorization:`Bearer ${token}`}});
  if (!mediaResp.ok) throw new Error(`Download mídia HTTP ${mediaResp.status}`);
  const buffer = Buffer.from(await mediaResp.arrayBuffer());
  if (!buffer.length || buffer.length > maxBytes) throw new Error("Tamanho de mídia inválido");

  return {
    buffer,
    mimeType:String(meta.mime_type || mediaResp.headers.get("content-type") || "application/octet-stream").split(";")[0]
  };
}

async function transcribeAudio(buffer) {
  const account = process.env.CLOUDFLARE_ACCOUNT_ID;
  const token = process.env.CLOUDFLARE_AI_TOKEN;
  const resp = await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}/ai/run/${SETTINGS.audioModel}`,{
    method:"POST",
    headers:{Authorization:`Bearer ${token}`,"Content-Type":"application/json"},
    body:JSON.stringify({
      audio:buffer.toString("base64"),
      task:"transcribe",
      language:"pt",
      vad_filter:true,
      condition_on_previous_text:false,
      initial_prompt:"Dúvida técnica de eletricista brasileiro sobre instalação elétrica residencial ou predial."
    })
  });
  const data = await resp.json().catch(()=>({}));
  if (!resp.ok || data?.success === false) throw new Error(`Transcrição HTTP ${resp.status}`);
  const text =
    data?.result?.text ??
    data?.result?.transcription_info?.text ??
    data?.transcription_info?.text ??
    data?.text;
  if (typeof text !== "string" || !text.trim()) throw new Error("Áudio sem transcrição");
  return text.trim().slice(0,SETTINGS.maxCharsIn);
}

async function inspectImage(buffer,mimeType,caption) {
  const account = process.env.CLOUDFLARE_ACCOUNT_ID;
  const token = process.env.CLOUDFLARE_AI_TOKEN;
  const dataUrl = `data:${mimeType.startsWith("image/") ? mimeType : "image/jpeg"};base64,${buffer.toString("base64")}`;
  const prompt = [
    "Analise esta foto para auxiliar um eletricista brasileiro.",
    "Descreva de forma técnica e curta SOMENTE o que estiver visível.",
    "Leia etiquetas e valores quando estiverem legíveis; identifique componentes, sinais de aquecimento, dano, improviso ou risco aparente.",
    "Não invente tensão, corrente, bitola, estado interno ou conformidade que a foto não permita confirmar.",
    caption ? `Pergunta/legenda do usuário: ${caption}` : "O usuário não enviou legenda."
  ].join("\n");

  const resp = await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}/ai/run/${SETTINGS.visionModel}`,{
    method:"POST",
    headers:{Authorization:`Bearer ${token}`,"Content-Type":"application/json"},
    body:JSON.stringify({
      messages:[
        {role:"system",content:"Você faz inspeção visual auxiliar de instalações elétricas. Seja factual e conciso."},
        {role:"user",content:prompt}
      ],
      image:dataUrl,
      temperature:0.1,
      max_completion_tokens:500,
      chat_template_kwargs:{enable_thinking:false}
    })
  });
  const data = await resp.json().catch(()=>({}));
  if (!resp.ok || data?.success === false) throw new Error(`Visão HTTP ${resp.status}`);
  const text =
    data?.result?.response ??
    data?.response ??
    data?.result?.choices?.[0]?.message?.content ??
    data?.choices?.[0]?.message?.content;
  if (typeof text !== "string" || !text.trim()) throw new Error("Imagem sem análise");
  return text.trim().slice(0,900);
}

async function messageToText(message) {
  if (message?.type === "text") {
    const text = String(message?.text?.body || "").trim().slice(0,SETTINGS.maxCharsIn);
    if (!text) throw new Error("Texto vazio");
    return text;
  }

  if (message?.type === "audio") {
    const media = await fetchWhatsAppMedia(message?.audio?.id,SETTINGS.maxAudioBytes);
    const transcript = await transcribeAudio(media.buffer);
    return `[Áudio transcrito]\n${transcript}`.slice(0,SETTINGS.maxCharsIn);
  }

  if (message?.type === "image") {
    const caption = String(message?.image?.caption || "").trim().slice(0,400);
    const media = await fetchWhatsAppMedia(message?.image?.id,SETTINGS.maxImageBytes);
    const visual = await inspectImage(media.buffer,media.mimeType,caption);
    return `[Foto enviada pelo usuário]${caption ? `\nPergunta/legenda: ${caption}` : ""}\nAnálise visual: ${visual}`.slice(0,SETTINGS.maxCharsIn);
  }

  throw new Error("Formato não suportado");
}

async function sendWhatsApp(phone,content) {
  const token = process.env.META_ACCESS_TOKEN;
  const id = process.env.WHATSAPP_PHONE_NUMBER_ID;
  if (!token || !id) throw new Error("Configuração Meta ausente");
  const resp = await fetch(`https://graph.facebook.com/${graphVersion()}/${id}/messages`,{
    method:"POST",
    headers:{Authorization:`Bearer ${token}`,"Content-Type":"application/json"},
    body:JSON.stringify({
      messaging_product:"whatsapp",
      recipient_type:"individual",
      to:phone,
      type:"text",
      text:{preview_url:false,body:content.slice(0,4000)}
    })
  });
  if (!resp.ok) throw new Error(`Meta API HTTP ${resp.status}`);
}

async function runAI(messages) {
  const account = process.env.CLOUDFLARE_ACCOUNT_ID;
  const token = process.env.CLOUDFLARE_AI_TOKEN;
  if (!account || !token) throw new Error("Configuração IA ausente");
  const resp = await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}/ai/run/${SETTINGS.model}`,{
    method:"POST",
    headers:{Authorization:`Bearer ${token}`,"Content-Type":"application/json"},
    body:JSON.stringify({messages,temperature:0.2,max_completion_tokens:1500,chat_template_kwargs:{enable_thinking:false}})
  });
  const data = await resp.json().catch(()=>({}));
  if (!resp.ok || data?.success === false) throw new Error(`Workers AI HTTP ${resp.status}`);
  const text =
    data?.result?.response ??
    data?.response ??
    data?.result?.result?.response ??
    data?.result?.choices?.[0]?.message?.content ??
    data?.choices?.[0]?.message?.content;
  if (!text && process.env.AI_DEBUG_SHAPE === "true") {
    console.log("Workers AI response keys:", Object.keys(data || {}), Object.keys(data?.result || {}));
  }
  return typeof text === "string" ? text.trim() : "";
}

async function processMessage(message) {
  const phone = message?.from;
  if (!phoneOk(phone) || !message?.id) return;
  console.log("Inbound WhatsApp:",message?.type || "unknown");

  const hash = phoneHash(phone);
  const idHash = sha256(`${process.env.USER_HASH_SECRET || process.env.META_APP_SECRET}:meta:${message.id}`);
  const inserted = await pool.query("INSERT INTO processed_messages(id_hash,status) VALUES($1,'received') ON CONFLICT(id_hash) DO NOTHING RETURNING id_hash",[idHash]);
  if (inserted.rowCount !== 1) return;

  let subscriber = await userState(hash);
  let chargeType = null, globalCounter = null, sent = false;
  try {
    if (!subscriber && process.env.PILOT_AUTO_ACTIVATE_FIRST_USER === "true") {
      const start = new Date();
      const end = new Date(start.getTime()+SETTINGS.periodDays*86400000);
      const auto = await pool.query(
        "INSERT INTO subscribers(user_hash,status,period_start,period_end,question_limit,questions_used,pending_until,clarification_left) SELECT $1,'active',$2,$3,$4,0,NULL,0 WHERE NOT EXISTS (SELECT 1 FROM subscribers) ON CONFLICT(user_hash) DO NOTHING RETURNING user_hash",
        [hash,start,end,SETTINGS.monthlyQuestions]
      );
      if (auto.rowCount === 1) {
        console.log("Pilot test user auto-activated");
        subscriber = await userState(hash);
      }
    }

    const decision = chooseCharge(subscriber);
    const today = new Date().toISOString().slice(0,10);
    const month = new Date().toISOString().slice(0,7);

    if (decision === "inactive" || decision === "exhausted") {
      const msg = decision === "inactive"
        ? "Seu acesso ao Expert Eletricista 24H não está ativo. Consulte a assinatura com o responsável pelo serviço."
        : "Você já usou suas 150 perguntas deste período. Sua franquia renova após a confirmação da próxima mensalidade.";
      await sendWhatsApp(phone,msg); sent = true;
      await pool.query("UPDATE processed_messages SET status=$1 WHERE id_hash=$2",[`finished_${decision}`,idHash]);
      console.log("Message finished:",decision);
      return;
    }

    if (!["text","audio","image"].includes(message?.type)) {
      await sendWhatsApp(phone,"Envie sua dúvida por texto, áudio ou foto. Outros formatos ainda não são interpretados.");
      sent = true;
      await pool.query("UPDATE processed_messages SET status='finished_unsupported' WHERE id_hash=$1",[idHash]);
      console.log("Message finished: unsupported",message?.type || "unknown");
      return;
    }

    globalCounter = `ai:${month}`;
    const maxGlobal = Number(process.env.MAX_GLOBAL_AI_ANSWERS_MONTH || SETTINGS.defaultGlobalAiRepliesMonth);
    if (!await claimCounter(globalCounter,maxGlobal)) {
      await sendWhatsApp(phone,"O Expert está temporariamente indisponível. Seu saldo não foi descontado; tente mais tarde.");
      sent = true;
      await pool.query("UPDATE processed_messages SET status='finished_global_limit' WHERE id_hash=$1",[idHash]);
      console.log("Message finished: global limit");
      return;
    }

    chargeType = decision;
    if (!await chargeSubscriber(hash,decision)) {
      await releaseCounter(globalCounter);
      return;
    }

    const text = await messageToText(message);
    const previous = await history(hash);
    const currentIntent = pricingIntent(text);
    const intent = currentIntent === "none" ? followUpPricingIntent(text,previous) : currentIntent;
    console.log("Intent routing:", {currentIntent,intent});
    const recentUserContext = previous.filter(m=>m?.role==="user").slice(-2).map(m=>String(m.content||""));
    const pricingQuery = [...recentUserContext,text].join("\n");

    if (intent === "labor") {
      const direct = await buildLaborDirectReply(pricingQuery);
      const answer = parseExpertAnswer(direct || "Qual serviço você quer orçar? [[AGUARDANDO_DADOS]]");
      if (globalCounter) { await releaseCounter(globalCounter); globalCounter = null; }
      await sendWhatsApp(phone,answer.answer);
      sent = true;
      await markPending(hash,answer.pending,decision);
      await saveHistory(hash,[...previous,{role:"user",content:text},{role:"assistant",content:answer.answer}]);
      await pool.query("UPDATE processed_messages SET status='sent_labor_direct' WHERE id_hash=$1",[idHash]);
      console.log("Direct labor quote sent");
      return;
    }

    if (intent === "material") {
      const direct = await buildMaterialDirectReply(pricingQuery);
      const answer = parseExpertAnswer(direct || "Qual material você quer cotar? [[AGUARDANDO_DADOS]]");
      if (globalCounter) { await releaseCounter(globalCounter); globalCounter = null; }
      await sendWhatsApp(phone,answer.answer);
      sent = true;
      await markPending(hash,answer.pending,decision);
      await saveHistory(hash,[...previous,{role:"user",content:text},{role:"assistant",content:answer.answer}]);
      await pool.query("UPDATE processed_messages SET status='sent_material_direct' WHERE id_hash=$1",[idHash]);
      console.log("Direct material quote sent");
      return;
    }

    if (intent === "both") {
      const [laborDirect,materialDirect] = await Promise.all([
        buildLaborDirectReply(pricingQuery),
        buildMaterialDirectReply(pricingQuery)
      ]);
      let direct;
      if ((laborDirect || "").includes("[[AGUARDANDO_DADOS]]") || (materialDirect || "").includes("[[AGUARDANDO_DADOS]]")) {
        direct = materialDirect?.includes("Qual material")
          ? materialDirect
          : laborDirect?.includes("Qual cidade")
            ? laborDirect
            : (materialDirect || laborDirect || "Qual cidade e UF? [[AGUARDANDO_DADOS]]");
      } else {
        direct = `MÃO DE OBRA\n${laborDirect || "Não consegui identificar o serviço."}\n\nMATERIAL\n${materialDirect || "Não consegui identificar o material."}`;
      }
      const answer = parseExpertAnswer(direct);
      if (globalCounter) { await releaseCounter(globalCounter); globalCounter = null; }
      await sendWhatsApp(phone,answer.answer);
      sent = true;
      await markPending(hash,answer.pending,decision);
      await saveHistory(hash,[...previous,{role:"user",content:text},{role:"assistant",content:answer.answer}]);
      await pool.query("UPDATE processed_messages SET status='sent_both_direct' WHERE id_hash=$1",[idHash]);
      console.log("Direct combined quote sent");
      return;
    }

    let pricingContext = "";
    let materialContext = "";
    if (intent === "labor") {
      pricingContext = await buildLaborPricingContext(text);
    } else if (intent === "material") {
      materialContext = await buildMaterialPricingContext(text);
    } else if (intent === "both") {
      [pricingContext, materialContext] = await Promise.all([
        buildLaborPricingContext(text),
        buildMaterialPricingContext(text)
      ]);
    }

    const routingContext = intent === "labor"
      ? "INTENÇÃO DE PREÇO DETECTADA: MÃO DE OBRA. Responda SOMENTE o valor do serviço/mão de obra. Não informe preço de materiais."
      : intent === "material"
        ? "INTENÇÃO DE PREÇO DETECTADA: MATERIAL. Responda SOMENTE preço do produto/insumo solicitado. Não informe mão de obra."
        : intent === "both"
          ? "INTENÇÃO DE PREÇO DETECTADA: MÃO DE OBRA + MATERIAL. Responda em dois blocos separados, sem misturar os valores."
          : "";

    const raw = await runAI([
      {role:"system",content:SYSTEM_PROMPT},
      ...(routingContext ? [{role:"system",content:routingContext}] : []),
      ...(pricingContext ? [{role:"system",content:pricingContext}] : []),
      ...(materialContext ? [{role:"system",content:materialContext}] : []),
      ...previous,
      {role:"user",content:text}
    ]);
    const answer = parseExpertAnswer(raw);
    if (!answer.answer) throw new Error("IA não retornou texto");

    await sendWhatsApp(phone,answer.answer);
    sent = true;
    await markPending(hash,answer.pending,decision);
    await saveHistory(hash,[...previous,{role:"user",content:text},{role:"assistant",content:answer.answer}]);
    await pool.query("UPDATE processed_messages SET status='sent' WHERE id_hash=$1",[idHash]);
    console.log("WhatsApp reply sent");
  } catch (err) {
    console.error("Falha no processamento:",err?.message || "erro");
    if (!sent && chargeType) {
      await refundSubscriber(hash,chargeType);
      if (globalCounter) await releaseCounter(globalCounter);
      const fallback = message?.type === "audio"
        ? "Não consegui interpretar esse áudio. Reenvie o áudio ou mande a dúvida por texto; seu saldo não foi descontado."
        : message?.type === "image"
          ? "Não consegui analisar essa foto. Reenvie uma imagem mais nítida ou mande a dúvida por texto; seu saldo não foi descontado."
          : "Não consegui processar sua pergunta agora. Seu saldo não foi descontado; tente novamente.";
      await sendWhatsApp(phone,fallback).catch(()=>{});
    }
    await pool.query("UPDATE processed_messages SET status=$1 WHERE id_hash=$2",[sent?"sent_with_storage_error":"failed",idHash]).catch(()=>{});
  }
}

app.get("/",(_req,res)=>res.type("text").send("Expert Eletricista 24H online"));

app.get("/health",async (_req,res)=>{
  const missing = requiredEnv.filter(k=>!process.env[k]);
  let db = false;
  if (process.env.DATABASE_URL) {
    try { await pool.query("SELECT 1"); db = true; } catch {}
  }
  res.json({
    service:"expert-eletricista-24h",
    status:missing.length===0 && db ? "ready" : "configuration_required",
    database:db?"ok":"unavailable",
    billing:"manual",
    price_brl:39.9,
    questions:150,
    period_days:30,
    daily_limit:null,
    live_whatsapp_tested:process.env.IS_PRODUCTION_VERIFIED==="true",
    accepts:{text:true,audio:true,image:true},
    labor_pricing:laborPricingStatus(),
    material_pricing:materialPricingStatus(),
    missing
  });
});

app.get("/diagnostics/meta-access",async (_req,res)=>{
  try {
    const token = process.env.META_ACCESS_TOKEN;
    const version = graphVersion();
    const phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID;
    const wabaId = process.env.WHATSAPP_BUSINESS_ACCOUNT_ID || "687342103880596";
    const checks = [
      ["me",`https://graph.facebook.com/${version}/me?fields=id,name`],
      ["permissions",`https://graph.facebook.com/${version}/me/permissions`],
      ["phone",`https://graph.facebook.com/${version}/${phoneId}?fields=id,display_phone_number,verified_name,quality_rating,status`],
      ["waba",`https://graph.facebook.com/${version}/${wabaId}?fields=id,name,currency,timezone_id`]
    ];
    const out = {};
    for (const [name,url] of checks) {
      const r = await fetch(url,{headers:{Authorization:`Bearer ${token}`}});
      const data = await r.json().catch(()=>({}));
      out[name] = {
        ok:r.ok,
        http:r.status,
        error:data?.error?{code:data.error.code,type:data.error.type,message:String(data.error.message||"").slice(0,180)}:undefined,
        id:data?.id,
        name:data?.name,
        status:data?.status,
        quality_rating:data?.quality_rating,
        display_phone_number:data?.display_phone_number
      };
    }
    res.json(out);
  } catch (err) {
    res.json({fatal:String(err?.message||"erro").slice(0,200)});
  }
});

app.get("/diagnostics/meta-subscription",async (req,res)=>{
  try {
    const wabaId = process.env.WHATSAPP_BUSINESS_ACCOUNT_ID || "687342103880596";
    const version = graphVersion();
    const token = process.env.META_ACCESS_TOKEN;
    const method = req.query?.repair === "1" ? "POST" : "GET";
    const url = `https://graph.facebook.com/${version}/${wabaId}/subscribed_apps`;
    const resp = await fetch(url,{
      method,
      headers:{Authorization:`Bearer ${token}`,"Content-Type":"application/json"}
    });
    const data = await resp.json().catch(()=>({}));
    res.json({
      ok:resp.ok,
      action:method==="POST"?"subscribe":"status",
      http:resp.status,
      success:data?.success===true,
      app_count:Array.isArray(data?.data)?data.data.length:undefined,
      apps:Array.isArray(data?.data)?data.data.map(x=>({id:x.id,name:x.name})).slice(0,10):undefined,
      error:data?.error?{code:data.error.code,type:data.error.type,message:String(data.error.message||"").slice(0,200)}:undefined
    });
  } catch (err) {
    res.status(500).json({ok:false,error:String(err?.message||"erro").slice(0,200)});
  }
});

app.get("/diagnostics/runtime",async (_req,res)=>{
  try {
    const month = new Date().toISOString().slice(0,7);
    const [globalUsage, recent, subs] = await Promise.all([
      pool.query("SELECT qty FROM usage_counters WHERE quota_key=$1",[`ai:${month}`]),
      pool.query("SELECT status,COUNT(*)::int AS qty,MAX(created_at) AS latest FROM processed_messages WHERE created_at>NOW()-INTERVAL '2 hours' GROUP BY status ORDER BY status"),
      pool.query("SELECT status,questions_used,question_limit,period_end FROM subscribers ORDER BY updated_at DESC LIMIT 5")
    ]);
    res.json({
      month,
      global_ai_used:Number(globalUsage.rows[0]?.qty || 0),
      global_ai_limit:Number(process.env.MAX_GLOBAL_AI_ANSWERS_MONTH || SETTINGS.defaultGlobalAiRepliesMonth),
      daily_limit:null,
      recent_messages:recent.rows,
      subscribers:subs.rows.map(s=>({
        status:s.status,
        used:s.questions_used,
        limit:s.question_limit,
        period_end:s.period_end
      }))
    });
  } catch (err) {
    res.status(500).json({error:String(err?.message || "erro").slice(0,160)});
  }
});

app.get("/webhook",(req,res)=>{
  const mode = req.query["hub.mode"];
  const token = String(req.query["hub.verify_token"] || "");
  const challenge = req.query["hub.challenge"];
  if (mode==="subscribe" && process.env.WEBHOOK_VERIFY_TOKEN && safeEqual(token,process.env.WEBHOOK_VERIFY_TOKEN) && challenge) {
    return res.type("text").send(String(challenge));
  }
  return res.status(403).type("text").send("Verificação inválida");
});

app.post("/webhook",express.raw({type:"application/json",limit:"150kb"}),(req,res)=>{
  console.log("Webhook POST received", {hasSignature:Boolean(req.headers["x-hub-signature-256"]), bytes:Buffer.isBuffer(req.body)?req.body.length:0});
  const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.from("");
  const sig = req.headers["x-hub-signature-256"] || "";
  const secret = process.env.META_APP_SECRET || "";
  if (!secret || !/^sha256=[0-9a-f]{64}$/i.test(sig)) return res.status(403).send("Assinatura Meta inválida");
  const expected = "sha256="+crypto.createHmac("sha256",secret).update(raw).digest("hex");
  if (!safeEqual(sig.toLowerCase(),expected.toLowerCase())) return res.status(403).send("Assinatura Meta inválida");

  let payload;
  try { payload = JSON.parse(raw.toString("utf8")); } catch { return res.status(400).send("JSON inválido"); }
  if (payload?.object!=="whatsapp_business_account") return res.send("OK");
  const messages = extractMessages(payload).slice(0,10);
  res.send("EVENT_RECEIVED");
  Promise.all(messages.map(processMessage)).catch(e=>console.error(e?.message));
});

app.use(express.json({limit:"50kb"}));

app.post("/admin/:action",async (req,res)=>{
  const key = process.env.ADMIN_API_KEY || "";
  if (key.length<24) return res.status(503).json({error:"Admin ainda não configurado"});
  if (!safeEqual(req.headers.authorization || "",`Bearer ${key}`)) return res.status(401).json({error:"Não autorizado"});

  const phone = normalizePhone(req.body?.phone);
  if (!phoneOk(phone)) return res.status(400).json({error:"Telefone inválido"});
  const hash = phoneHash(phone);

  if (req.params.action==="activate") {
    const start = new Date(), end = new Date(start.getTime()+SETTINGS.periodDays*86400000);
    await pool.query(
      "INSERT INTO subscribers(user_hash,status,period_start,period_end,question_limit,questions_used,pending_until,clarification_left) VALUES($1,'active',$2,$3,$4,0,NULL,0) ON CONFLICT(user_hash) DO UPDATE SET status='active',period_start=EXCLUDED.period_start,period_end=EXCLUDED.period_end,question_limit=EXCLUDED.question_limit,questions_used=0,pending_until=NULL,clarification_left=0,updated_at=NOW()",
      [hash,start,end,SETTINGS.monthlyQuestions]
    );
    await pool.query("INSERT INTO admin_audit(user_hash,action) VALUES($1,'activate')",[hash]);
    return res.json({status:"active",period_start:start.toISOString(),period_end:end.toISOString(),question_limit:150});
  }

  if (req.params.action==="suspend") {
    const r = await pool.query("UPDATE subscribers SET status='suspended',pending_until=NULL,clarification_left=0,updated_at=NOW() WHERE user_hash=$1",[hash]);
    return res.json({suspended:r.rowCount>0});
  }

  if (req.params.action==="status") {
    const s = await userState(hash);
    if (!s) return res.json({status:"not_found"});
    return res.json({status:s.status,used:s.questions_used,limit:s.question_limit,remaining:Math.max(0,s.question_limit-s.questions_used)});
  }

  res.status(404).json({error:"Rota não encontrada"});
});

setInterval(()=>{
  if (!process.env.DATABASE_URL) return;
  pool.query("DELETE FROM sessions WHERE updated_at<NOW()-INTERVAL '7 days'").catch(()=>{});
  pool.query("DELETE FROM processed_messages WHERE created_at<NOW()-INTERVAL '35 days'").catch(()=>{});
},21600000).unref();

const port = Number(process.env.PORT || 10000);
initDb()
  .then(()=>{
    Promise.allSettled([initLaborPricingGeo(),initMaterialPricingGeo()])
      .then(()=>console.log("Bases de preços carregadas",{labor:laborPricingStatus(),materials:materialPricingStatus()}))
      .catch(()=>{});
    app.listen(port,"0.0.0.0",()=>console.log(`Expert Eletricista 24H na porta ${port}`));
  })
  .catch(err=>{
    console.error("Banco indisponível:",err?.message);
    app.listen(port,"0.0.0.0",()=>console.log(`Expert Eletricista 24H na porta ${port}`));
  });
