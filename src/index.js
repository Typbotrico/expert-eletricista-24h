import express from "express";
import pg from "pg";
import crypto from "node:crypto";
import { SYSTEM_PROMPT } from "./expert-prompt.js";

const { Pool } = pg;
const app = express();
app.disable("x-powered-by");

const SETTINGS = Object.freeze({
  model: "@cf/zai-org/glm-4.7-flash",
  monthlyQuestions: 150,
  periodDays: 30,
  maxCharsIn: 1200,
  maxCharsOut: 1500,
  freeClarificationReplies: 2,
  clarificationWindowMinutes: 30,
  defaultGlobalAiRepliesMonth: 3000
});

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

function parseExpertAnswer(raw) {
  raw = String(raw || "");
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

async function sendWhatsApp(phone,content) {
  const token = process.env.META_ACCESS_TOKEN;
  const id = process.env.WHATSAPP_PHONE_NUMBER_ID;
  if (!token || !id) throw new Error("Configuração Meta ausente");
  const version = /^v\d+\.\d+$/.test(process.env.GRAPH_API_VERSION || "") ? process.env.GRAPH_API_VERSION : "v26.0";
  const resp = await fetch(`https://graph.facebook.com/${version}/${id}/messages`,{
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
      if (await claimCounter(`notice:${decision}:${today}:${hash}`,1)) {
        await sendWhatsApp(phone,msg); sent = true;
      }
      await pool.query("UPDATE processed_messages SET status='finished' WHERE id_hash=$1",[idHash]);
      return;
    }

    const text = String(message?.text?.body || "").trim().slice(0,SETTINGS.maxCharsIn);
    if (message.type !== "text" || !text) {
      if (await claimCounter(`notice:format:${today}:${hash}`,1)) {
        await sendWhatsApp(phone,"Por enquanto, envie sua dúvida por texto. Fotos e áudios ainda não são interpretados.");
        sent = true;
      }
      await pool.query("UPDATE processed_messages SET status='finished' WHERE id_hash=$1",[idHash]);
      return;
    }

    globalCounter = `ai:${month}`;
    const maxGlobal = Number(process.env.MAX_GLOBAL_AI_ANSWERS_MONTH || SETTINGS.defaultGlobalAiRepliesMonth);
    if (!await claimCounter(globalCounter,maxGlobal)) {
      if (await claimCounter(`notice:global:${today}:${hash}`,1)) {
        await sendWhatsApp(phone,"O Expert está temporariamente indisponível. Seu saldo não foi descontado; tente mais tarde.");
        sent = true;
      }
      await pool.query("UPDATE processed_messages SET status='finished' WHERE id_hash=$1",[idHash]);
      return;
    }

    chargeType = decision;
    if (!await chargeSubscriber(hash,decision)) {
      await releaseCounter(globalCounter);
      return;
    }

    const previous = await history(hash);
    const raw = await runAI([{role:"system",content:SYSTEM_PROMPT},...previous,{role:"user",content:text}]);
    const answer = parseExpertAnswer(raw);
    if (!answer.answer) throw new Error("IA não retornou texto");

    await sendWhatsApp(phone,answer.answer);
    sent = true;
    await markPending(hash,answer.pending,decision);
    await saveHistory(hash,[...previous,{role:"user",content:text},{role:"assistant",content:answer.answer}]);
    await pool.query("UPDATE processed_messages SET status='sent' WHERE id_hash=$1",[idHash]);
  } catch (err) {
    console.error("Falha no processamento:",err?.message || "erro");
    if (!sent && chargeType) {
      await refundSubscriber(hash,chargeType);
      if (globalCounter) await releaseCounter(globalCounter);
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
    missing
  });
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
  .then(()=>app.listen(port,"0.0.0.0",()=>console.log(`Expert Eletricista 24H na porta ${port}`)))
  .catch(err=>{
    console.error("Banco indisponível:",err?.message);
    app.listen(port,"0.0.0.0",()=>console.log(`Expert Eletricista 24H na porta ${port}`));
  });
