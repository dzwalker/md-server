#!/usr/bin/env node
/**
 * 从 env 文件渲染空间 set 配置（deploy/sets.json.tpl → sets.json）。
 *
 * 为什么要有这一层：sets.json 含真实目录名与语义索引开关，属于「本机部署配置」，
 * 不进 git（.gitignore）。但配置又不能只存在某台机器上——模板进 git、值进 .env，
 * 于是换机/重装时 `node deploy/render-config.mjs` 一条命令即可复原，且不会把
 * 敏感目录名或 key 泄露到仓库里。
 *
 * 模板语法：
 *   ${KEY}         必填；缺失或为空 → 报错退出（不写半成品）
 *   ${KEY:-默认值}  可选；缺失时用默认值
 *
 * 用法：
 *   node deploy/render-config.mjs                  # 用 ./.env 渲染到 ./sets.json
 *   node deploy/render-config.mjs --env x.env --out /tmp/sets.json
 *   node deploy/render-config.mjs --check          # 只校验：渲染结果与现有 sets.json 是否一致
 *   node deploy/render-config.mjs --print          # 打印渲染结果（目录名可见，勿贴公开处）
 *
 * 安全：默认只打印摘要（set 数量/id/embed），绝不打印 env 值本身。
 */
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
function opt(name, fallback) {
  const i = args.indexOf(`--${name}`);
  if (i === -1) return fallback;
  const v = args[i + 1];
  if (!v || v.startsWith('--')) return true; // 开关型参数
  return v;
}
const flag = (name) => args.includes(`--${name}`);

const root = process.cwd();
const envFile = path.resolve(root, String(opt('env', '.env')));
const tplFile = path.resolve(root, String(opt('tpl', 'deploy/sets.json.tpl')));
const outFile = path.resolve(root, String(opt('out', 'sets.json')));
const checkOnly = flag('check');
const printOut = flag('print');

function fail(msg) {
  console.error(`✖ ${msg}`);
  process.exit(1);
}

function parseEnv(text) {
  const map = new Map();
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const m = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!m) continue;
    let val = m[2].trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    } else {
      // 行尾注释：`KEY=value  # comment`（值里含 # 的请加引号）
      const hash = val.indexOf(' #');
      if (hash >= 0) val = val.slice(0, hash).trim();
    }
    map.set(m[1], val);
  }
  return map;
}

if (!fs.existsSync(envFile)) fail(`找不到 env 文件：${envFile}`);
if (!fs.existsSync(tplFile)) fail(`找不到模板：${tplFile}`);

const env = parseEnv(fs.readFileSync(envFile, 'utf8'));
const tpl = fs.readFileSync(tplFile, 'utf8');

const missing = [];
const rendered = tpl.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)(?::-([^}]*))?\}/g, (_all, key, dflt) => {
  const v = env.get(key);
  if (v !== undefined && v !== '') return v;
  if (dflt !== undefined) return dflt;
  missing.push(key);
  return `__MISSING_${key}__`;
});

if (missing.length) {
  fail(`env 缺少变量：${[...new Set(missing)].join(', ')}（参考 .env.example 的 SET_* 段）`);
}

let parsed;
try {
  parsed = JSON.parse(rendered);
} catch (e) {
  const line = (() => {
    const m = /position (\d+)/.exec(String(e.message));
    if (!m) return '?';
    return String(rendered.slice(0, Number(m[1])).split('\n').length);
  })();
  fail(`渲染结果不是合法 JSON（约第 ${line} 行）：${e.message}\n  多半是 SET_*_DIRS / SET_*_EXCLUDE 不是合法 JSON 数组，例如 ["a","b"]`);
}
if (!Array.isArray(parsed) || !parsed.length) fail('渲染结果不是非空数组');
for (const s of parsed) {
  if (!s || typeof s.id !== 'string' || typeof s.name !== 'string' || !Array.isArray(s.dirs)) {
    fail(`set 字段不全（需要 id/name/dirs）：${JSON.stringify(s)}`);
  }
}

const pretty = JSON.stringify(parsed, null, 2) + '\n';

if (printOut) process.stdout.write(pretty);

if (checkOnly) {
  const cur = fs.existsSync(outFile) ? fs.readFileSync(outFile, 'utf8') : '';
  const same = cur.trim() === pretty.trim();
  console.log(`${same ? '✔' : '✖'} --check：${path.basename(outFile)} ${same ? '与模板一致' : '与模板不一致（需要重新渲染）'}`);
  process.exit(same ? 0 : 1);
}

const tmp = outFile + '.tmp';
fs.writeFileSync(tmp, pretty, { mode: 0o644 });
fs.renameSync(tmp, outFile);

const summary = parsed.map((s) => `${s.id}${s.embed ? '(embed' + ((s.exclude || []).length ? `，排除 ${s.exclude.length} 项` : '') + ')' : ''}`).join(' · ');
console.log(`✔ 已渲染 ${parsed.length} 个 set → ${path.relative(root, outFile)}`);
console.log(`  ${summary}`);
