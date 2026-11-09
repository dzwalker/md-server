# deploy/ —— 本机部署配置（模板进 git，值进 .env）

`sets.json`（空间 set 布局）与 `.env`（运行时密钥）都是**本机配置**，不进 git。
但配置只存在某一台机器上就等于不可复原——所以这里放**模板 + 渲染脚本**：

| 文件 | 作用 |
|---|---|
| `sets.json.tpl` | 空间 set 模板，用 `${SET_X_*}` 占位（不含任何真实目录名/公司名） |
| `render-config.mjs` | 读 `.env` → 渲染 `sets.json`，校验 JSON 与字段，原子写入 |
| `deploy.sh` | 一键：渲染配置 → 重建镜像/容器 → 等健康检查 → 自检 |

## 标准流程

```bash
cp .env.example .env && chmod 600 .env   # 首次：填 R2_* / EMBED_* / SET_* 的值
./deploy/deploy.sh                       # 渲染 + 重建 + 健康检查
```

日常三种改动：

| 改了什么 | 命令 |
|---|---|
| 只改了 `sets.json` 布局（增删空间/开关语义索引） | `./deploy/deploy.sh --no-build` |
| 改了 `.env`（密钥、模型） | `./deploy/deploy.sh --no-build`（**必须重建容器**，`restart` 不重读 env_file） |
| 改了代码 | `./deploy/deploy.sh` |

只校验不入容器：`./deploy/deploy.sh --check-only`，或 `node deploy/render-config.mjs --check`。

## 渲染脚本的约束

- 占位符缺失 → 直接报错退出，**不写半成品**；支持 `${KEY:-默认值}`
- 渲染结果必须是合法 JSON、每一项都有 `id`/`name`/`dirs`，否则报错并提示常见原因
- 原子写入（先写 `.tmp` 再 rename），不会出现半个文件被容器读到
- 默认只打印摘要（set 数量 / id / embed 状态），**不打印 env 值**

## 为什么不复用 A 方案（提交脱敏版 sets.json）

提交一份脱敏 sets.json 只能解决"仓库里有示例"，解决不了"本机配置丢失后无法复原"：
真实值仍然散落在某个机器的隐藏文件里，且容易和示例混淆。模板 + `.env` 的组合让
**代码仓只管结构、运行时只管值**，换机时 `cp .env.example .env` 填值 + 一条命令即可复原。
