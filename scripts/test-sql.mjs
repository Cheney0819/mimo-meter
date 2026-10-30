#!/usr/bin/env node
/**
 * 统计口径回归：证明改写后的 SQL 与 v2.0.0 的结果逐字段一致。
 *
 * 用真实 mimocode.db（只读）跑旧实现与新实现，逐会话比对。
 * 唯一允许的差异：cost 从 null 变成 0（v2.0.1 起不再把真实的 0 元当成「无数据」）。
 * 注意 SQL 里是 COALESCE(SUM(...),0)，「没有 cost 字段」也会变成 0，
 * 所以这条修的是「0 被 || 吃掉」，不是「缺失值能被识别出来」。
 *
 * 用法：
 *   node scripts/test-sql.mjs                # 用默认路径
 *   node scripts/test-sql.mjs /path/to.db    # 指定库
 *   node scripts/test-sql.mjs --synthetic    # 没有真机库时用合成数据自测
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const SRC = path.join(ROOT, "src", "mimo-meter.mjs");

const args = process.argv.slice(2);
const synthetic = args.includes("--synthetic");
const dbArg = args.find((a) => !a.startsWith("--"));

const candidates = [
  dbArg,
  process.env.MIMOCODE_DB,
  path.join(os.homedir(), ".local", "share", "mimocode", "mimocode.db"),
  path.join(process.env.LOCALAPPDATA || "", "mimocode", "mimocode.db"),
].filter(Boolean);

const realDb = candidates.find((p) => {
  try { return fs.existsSync(p) && fs.statSync(p).isFile(); } catch { return false; }
});

/* ---------- 从源码里取出 SQL（保证测的是真实实现，不是抄一份） ---------- */
const src = fs.readFileSync(SRC, "utf8");
function extract(name) {
  const m = new RegExp("const " + name + " = `([\\s\\S]*?)`;").exec(src);
  if (!m) throw new Error("源码里找不到 " + name);
  return m[1];
}
const Q = {
  SESSION: extract("Q_SESSION"),
  RECENT: extract("Q_RECENT"),
  TITLE: extract("Q_TITLE"),
  TOOLS: extract("Q_TOOLS"),
  STEPS: extract("Q_STEPS"),
};

/* ---------- v2.0.0 的原版 SQL（用于对照） ---------- */
const OLD_SESSION = `
SELECT
  s.title AS title,
  COALESCE(SUM(CASE WHEN json_extract(m.data,'$.role')='user' THEN 1 ELSE 0 END),0)      AS rounds,
  COALESCE(SUM(CASE WHEN json_extract(m.data,'$.role')='assistant' THEN 1 ELSE 0 END),0)   AS assistants,
  COALESCE(SUM(CASE WHEN json_extract(m.data,'$.role')='assistant' THEN json_extract(m.data,'$.tokens.input') END),0)      AS t_input,
  COALESCE(SUM(CASE WHEN json_extract(m.data,'$.role')='assistant' THEN json_extract(m.data,'$.tokens.output') END),0)     AS t_output,
  COALESCE(SUM(CASE WHEN json_extract(m.data,'$.role')='assistant' THEN json_extract(m.data,'$.tokens.reasoning') END),0)  AS t_reasoning,
  COALESCE(SUM(CASE WHEN json_extract(m.data,'$.role')='assistant' THEN json_extract(m.data,'$.tokens.cache.read') END),0)  AS t_cache_read,
  COALESCE(SUM(CASE WHEN json_extract(m.data,'$.role')='assistant' THEN json_extract(m.data,'$.tokens.cache.write') END),0) AS t_cache_write,
  COALESCE(SUM(CASE WHEN json_extract(m.data,'$.role')='assistant' THEN json_extract(m.data,'$.cost') END),0)              AS cost,
  MAX(CASE WHEN json_extract(m.data,'$.role')='assistant' THEN json_extract(m.data,'$.modelID') END)                  AS model,
  COALESCE(SUM(CASE WHEN json_extract(m.data,'$.role')='assistant'
                     AND json_extract(m.data,'$.time.completed') IS NOT NULL
               THEN json_extract(m.data,'$.time.completed') - json_extract(m.data,'$.time.created')
               ELSE 0 END),0)                                        AS model_ms,
  MAX(m.time_created) AS last_at,
  MIN(m.time_created) AS first_at
FROM session s LEFT JOIN message m ON m.session_id = s.id
WHERE s.id = ? GROUP BY s.id`;
const OLD_STEPS = `SELECT COUNT(*) AS steps FROM part WHERE session_id = ? AND json_extract(data,'$.type') = 'step-finish'`;
const OLD_TOOLS = `SELECT COALESCE(SUM(json_extract(data,'$.state.time.end') - json_extract(data,'$.state.time.start')),0) AS tool_ms FROM part WHERE session_id = ? AND json_extract(data,'$.type') = 'tool' AND json_extract(data,'$.state.time.end') IS NOT NULL`;
const OLD_RECENT = `SELECT id FROM session WHERE time_archived IS NULL ORDER BY time_updated DESC LIMIT 1`;
const OLD_TITLE = `SELECT id FROM session WHERE title = ? ORDER BY time_updated DESC LIMIT 1`;

const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

function stats(database, sid, useNew) {
  const row = database.prepare(useNew ? Q.SESSION : OLD_SESSION).get(sid);
  if (!row) return null;
  let steps = database.prepare(useNew ? Q.STEPS : OLD_STEPS).get(sid)?.steps ?? 0;
  if (!steps) steps = row.assistants || 0;
  const toolMs = num(database.prepare(useNew ? Q.TOOLS : OLD_TOOLS).get(sid)?.tool_ms);
  const input = num(row.t_input), output = num(row.t_output), reasoning = num(row.t_reasoning);
  const read = num(row.t_cache_read), write = num(row.t_cache_write);
  return {
    title: row.title ?? null,
    model: row.model ?? null,
    rounds: num(row.rounds),
    steps: num(steps),
    total: input + output + reasoning + read + write,
    input, output, reasoning, read, write,
    // 唯一的有意差异：新版用 == null 判断，0 会保留
    cost: useNew ? (row.cost == null ? null : num(row.cost)) : (num(row.cost) || null),
    modelMs: num(row.model_ms),
    toolMs,
    firstAt: num(row.first_at) || null,
    lastAt: num(row.last_at) || null,
  };
}

/* ---------- 造合成库（没有真机环境时也能跑） ---------- */
function makeSynthetic() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mm-sql-"));
  const file = path.join(dir, "synthetic.db");
  const db = new DatabaseSync(file);
  db.exec(`
    CREATE TABLE session (id TEXT PRIMARY KEY, project_id TEXT NOT NULL DEFAULT 'p',
      slug TEXT NOT NULL DEFAULT 's', directory TEXT NOT NULL DEFAULT '/',
      title TEXT NOT NULL DEFAULT '', version TEXT NOT NULL DEFAULT '1',
      time_created INTEGER NOT NULL, time_updated INTEGER NOT NULL, time_archived INTEGER);
    CREATE TABLE message (id TEXT PRIMARY KEY, session_id TEXT NOT NULL,
      time_created INTEGER NOT NULL, time_updated INTEGER NOT NULL, data TEXT NOT NULL);
    CREATE TABLE part (id TEXT PRIMARY KEY, message_id TEXT NOT NULL,
      session_id TEXT NOT NULL, time_created INTEGER NOT NULL,
      time_updated INTEGER NOT NULL, data TEXT NOT NULL);
  `);

  const mkSession = (sid, title, paid) => {
    db.prepare("INSERT INTO session (id,title,time_created,time_updated) VALUES (?,?,?,?)")
      .run(sid, title, 1000, 2000);
    const insM = db.prepare("INSERT INTO message (id,session_id,time_created,time_updated,data) VALUES (?,?,?,?,?)");
    const insP = db.prepare("INSERT INTO part (id,message_id,session_id,time_created,time_updated,data) VALUES (?,?,?,?,?,?)");
    for (let i = 0; i < 12; i++) {
      // 用户消息
      insM.run(`${sid}-u${i}`, sid, 1000 + i, 1000 + i, JSON.stringify({ role: "user", time: { created: 1000 + i } }));
      // 助手消息：付费会话带 cost，免费会话 cost 为 0
      const tk = { input: 100 + i, output: 50 + i, reasoning: i, total: 150 + 2 * i + 900, cache: { read: 900, write: 5 } };
      insM.run(`${sid}-a${i}`, sid, 2000 + i, 2000 + i, JSON.stringify({
        role: "assistant", modelID: "mimo-v2", cost: paid ? 0.001 * (i + 1) : 0,
        tokens: tk, time: { created: 2000 + i, completed: 3000 + i },
      }));
      insP.run(`${sid}-p${i}`, `${sid}-a${i}`, sid, 2000 + i, 2000 + i,
        JSON.stringify({ type: "step-finish", tokens: tk }));
      if (i % 3 === 0) {
        insP.run(`${sid}-t${i}`, `${sid}-a${i}`, sid, 2000 + i, 2000 + i,
          JSON.stringify({ type: "tool", state: { time: { start: 5000, end: 5600 } } }));
      }
    }
  };
  mkSession("ses_paid000000000001", "付费会话", true);
  mkSession("ses_free000000000001", "免费会话", false);

  // 故意塞一条「老库没有 cost 字段」的消息，验证 null 与 0 的区分
  db.prepare("INSERT INTO message (id,session_id,time_created,time_updated,data) VALUES (?,?,?,?,?)")
    .run("ses_free000000000001-nocost", "ses_free000000000001", 9000, 9000,
      JSON.stringify({ role: "assistant", tokens: { input: 1, output: 1, reasoning: 0, cache: { read: 0, write: 0 } } }));

  return { db, file, dir };
}

/* ---------- 主流程 ---------- */
let database, cleanup = null, source;

/* Windows 上必须先关掉数据库句柄才能删文件，否则 EBUSY。
   所有退出路径都走这里。 */
function shutdown() {
  try { if (database) database.close(); } catch {}
  database = null;
  if (cleanup) {
    try { fs.rmSync(cleanup, { recursive: true, force: true }); } catch {}
    /* 删不掉说明还有句柄没释放（Windows 上会 EBUSY）。
       这里不抛错，但要明确报出来，否则 CI 只会看到莫名其妙的退出码。 */
    if (fs.existsSync(cleanup)) {
      console.error("警告：临时目录未能删除（可能有未关闭的数据库句柄）：" + cleanup);
    }
    cleanup = null;
  }
}

if (realDb && !synthetic) {
  database = new DatabaseSync(realDb, { readOnly: true });
  source = realDb;
} else {
  const s = makeSynthetic();
  database = s.db;
  cleanup = s.dir;
  source = s.file + "（合成）";
}

console.log("测试库：" + source);

const sessions = database.prepare("SELECT id, title FROM session").all();
if (!sessions.length) {
  console.error("库里没有会话，无法比对");
  shutdown();
  process.exit(2);
}

let fails = 0;
let intended = 0;
for (const s of sessions) {
  const a = stats(database, s.id, false);
  const b = stats(database, s.id, true);
  if (!a || !b) { console.log(`  ✗ ${s.id} 有一边取不到数据`); fails++; continue; }
  for (const k of Object.keys(a)) {
    if (JSON.stringify(a[k]) === JSON.stringify(b[k])) continue;
    if (k === "cost" && a[k] === null && b[k] === 0) {
      intended++;
      console.log(`  · ${s.id.slice(0, 14)}… cost: null → 0（有意：真实 0 元不再隐藏）`);
      continue;
    }
    console.log(`  ✗ ${s.id.slice(0, 14)}… ${k}: 旧=${JSON.stringify(a[k])} 新=${JSON.stringify(b[k])}`);
    fails++;
  }
  console.log(`  ${s.id.slice(0, 14)}… rounds=${a.rounds} steps=${a.steps} total=${a.total} cost=${a.cost}`);
}

// RECENT / TITLE 一致性
const r1 = database.prepare(OLD_RECENT).get();
const r2 = database.prepare(Q.RECENT).get();
if (JSON.stringify(r1) !== JSON.stringify(r2)) {
  console.log(`  ✗ Q_RECENT 不一致：${JSON.stringify(r1)} vs ${JSON.stringify(r2)}`);
  fails++;
}
for (const s of sessions) {
  const t1 = database.prepare(OLD_TITLE).get(s.title);
  const t2 = database.prepare(Q.TITLE).get(s.title);
  if (JSON.stringify(t1) !== JSON.stringify(t2)) {
    console.log(`  ✗ Q_TITLE 不一致（${s.title}）：${JSON.stringify(t1)} vs ${JSON.stringify(t2)}`);
    fails++;
  }
}

shutdown();

console.log("");
if (fails) {
  console.log(`FAILED：${fails} 处非预期差异`);
  process.exit(1);
}
console.log(`ALL PASS：${sessions.length} 个会话逐字段一致` + (intended ? `（${intended} 处有意变更）` : ""));
