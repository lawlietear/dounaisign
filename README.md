# 豆奶 Windows 独立签到代码包 1.0.3

公开仓库：[lawlietear/dounaisign](https://github.com/lawlietear/dounaisign)。首次可克隆代码，后续按 [更新说明](GITHUB_UPDATES.md) 拉取变化。

面向 **Windows 10/11 x64**，由 Agent 或使用者通过 PowerShell 执行。无需桌面界面或 Codex 专用工具，不连接原项目、不创建定时任务。包含豆奶签到、本地 RapidOCR 算式验证码识别、填写、每轮最多一次提交及网页结果核验；可选择明确拒绝后等待3分钟补试一次。

当前代码从已成功签到的 Mac 版本独立整理，改为每位使用者自己的账户配置和专用 Chrome 资料。Windows 安装与真实签到尚需接收方验收，具体已执行验证见 [VERIFICATION.md](VERIFICATION.md)。分享前的包内文件指纹见 `MANIFEST.sha256.json`。

## 首次准备

解压到自己可写的普通目录，例如 `D:/Tools/dounai-windows`。不要直接在ZIP、系统保护目录或别人的浏览器资料目录运行。

电脑需已安装：

- Node.js **24.x x64**，包含 npm；开发基线为24.21.0，依赖锁定 `playwright-core=1.62.1`。
- CPython **3.12.x x64**，包含 pip/venv，并有 `py -3.12` 或 `python.exe` 命令。
- 普通 Google Chrome。程序自动寻找 Program Files / Program Files (x86) / LocalAppData；找不到时显式设置路径。
- ONNX Runtime所需的Microsoft Visual C++ x64运行库。若电脑缺失或导入时报DLL错误，请本人按 [官方安装说明](https://onnxruntime.ai/docs/install/#requirements) 处理；本包不自动安装系统运行库。

官方入口：[Node.js](https://nodejs.org/en/download)、[Python Windows](https://www.python.org/downloads/windows/)、[Google Chrome](https://www.google.com/chrome/)。本包不安装全局运行时、不修改PATH、系统代理或PowerShell持久策略。首次初始化需访问npm和PyPI，之后OCR只读取随包模型，不上传验证码图片；签到仍需联网访问豆奶网站。

进入包目录，在PowerShell运行（用户名替换成自己的，不要填写密码）：

```powershell
.\setup.ps1 -Account "你的豆奶用户名"
.\login.ps1
.\signin.ps1
.\status.ps1
```

`setup.ps1` 只安装包内依赖、创建配置并做环境检查，不打开浏览器、不登录或签到。它用 `npm ci` 安装锁定Node依赖；在 `tools/ocr/.venv/` 创建Windows虚拟环境，以完整版本/哈希锁及 `--only-binary=:all:` 安装OCR依赖，不静默升级或源码编译。安装失败时停止，不能跳过错误当成可用。重复初始化不覆盖已有配置。

如果PowerShell限制执行本地脚本，可仅对本次子进程指定策略，不修改CurrentUser/LocalMachine：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\setup.ps1 -Account "你的豆奶用户名"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\login.ps1
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\signin.ps1
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\status.ps1
```

组织策略可能优先于上述进程参数；这种情况请本人或管理员处理，不修改注册表绕过。依据：[PowerShell执行策略](https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.core/about/about_execution_policies)。

## 登录与配置

`login.ps1` 打开**本包自己的** Chrome profile，最多等待5分钟供本人登录。确认配置账户后关闭该浏览器，保存会话；不会点击签到，不读取密码或Cookie，也不会把登录结果写成签到成功。

`setup.ps1` 生成 `config.json`，它不属于初始分享文件。字段如下：

```json
{
  "expectedAccount": "你的豆奶用户名",
  "proxy": "",
  "chromePath": "",
  "headless": false,
  "timeoutMs": 60000
}
```

代理留空表示不额外给Chrome指定代理，仍可能受系统代理或网络环境影响；需要显式代理时填自己的地址，例如 `http://127.0.0.1:7890`，不要沿用他人端口。浏览器路径可填写 `C:/Program Files/Google/Chrome/Application/chrome.exe`。初次创建也可传 `setup.ps1 -Account "用户名" -Proxy "地址" -ChromePath "路径"`；配置已存在时请直接编辑，初始化不会覆盖它。

默认前台运行，更方便看到验证和错误。`headless=true` 是可选配置，未验收其在豆奶上的稳定性。普通日常Chrome的会话与本包profile不共享；复制代码到另一台电脑后需要那位使用者重新登录。

## 日常执行与判定

```powershell
.\doctor.ps1               # 依赖、模型哈希、CPU模型会话检查；不访问网站
.\signin.ps1               # 签到；普通临时故障/缺少登录证据可补试一次
.\signin.ps1 -RetryCaptcha # 同时允许验证码明确拒绝后3分钟补试一次
.\signin.ps1 -Interactive  # 需要本人接管登录/验证时前台等待
.\status.ps1               # 只读检查当天结果，不打开浏览器或补签
```

Agent也可直接调用 `node app.js doctor|login|signin|status`；交互签到为 `node app.js signin --interactive`；验证码拒绝补试为 `node app.js signin --retry-captcha`，两开关可同时使用。各命令与当前工作目录无关，数据始终写到本包目录。执行后必须读取退出码和JSON，不能仅凭命令已启动报告完成。

- 签到前已有正确账户及可见、禁用的“今日已签到”按钮：`already_done`，不点击。
- 未签到：出现支持的豆奶算式验证码时，本地识别、校验、填写并每轮浏览器最多提交一次。只有页面按钮明确变为“今日已签到”才返回 `signed`。
- 填入前识别文字/分数/语法失败，允许正常关闭验证码弹窗并重新点击签到获取新图，包含首次最多识别5次；外层3分钟浏览器补试也共用这5次额度。账户冲突、验证码变化、用户已输入、填入或提交后的异常均停止快速重开，不覆盖本人输入。验证码明确被拒只有启用 -RetryCaptcha 时才允许一次延迟新页面尝试，结果未确认不重提。
- HTTP 200、OCR得到答案、填入或点击提交均不代表成功。缺少明确成功标记记为 `unconfirmed`。
- `status` 只有 `site=dounai`、`ok=true`、`status=signed/already_done`，且timestamp在 **Asia/Shanghai今天** 才返回 `completionOk=true`。

正常完成退出码0，失败/需要本人处理/旧状态或缺失状态为1，命令参数错误为2。`login`的0只表示登录已确认，不代表当天签到。

## 合并重试与失败诊断

`signin` 默认对 `network_error`、`runner_error`、`busy`、`auth_required` 等故障先保存首次实际结果，关闭本包Chrome、释放锁，分三次各60秒等待后，用同一包内profile新建浏览器和页面再尝试一次。等待期间不会持锁。缺少登录证据只会复查，不新增自动密码输入或提交；需要本人登录时使用login或交互模式。

加 `-RetryCaptcha`（Node为 `--retry-captcha`）后，网站明确返回 `captcha_rejected` 也加入同一个补试预算，第二轮重新读取图片，不复用旧答案。所有可重试故障合计最多两轮，不按状态分别叠加：例如第一轮网络失败，第二轮验证码拒绝，就立即停止，不会第三轮。成功、`unconfirmed`、`verification_required`、账户不符和账户未确认均不自动补试。默认未开此选项时，普通故障的补试轮也不自动处理新验证码，需本人接管。独立 `login` 命令不执行签到或该补试循环。

每次登录/签到尝试单独保存 `data/dounai-diagnostics/<UTC时间-随机标识>/result.json`。可取得页面时，失败在关闭前截图为failure.png，遮盖所有输入框/文本框/可编辑区；记录剔除query/fragment的页面URL、标题、登录框/验证码状态和页面错误原文。浏览器启动失败没有页面可截图，如实保留错误。原图在处理前保存为captcha-before-processing.png；网站拒绝或未确认时，已有rawText、expression、confidence也会保留。截图失败只附警告，不覆盖实际结果。

最新结果仍写入原状态文件，历史日志逐次追加；最终结果用attempt、retry.previousRecord关联首次证据，后续成功不会删除失败目录。截图、原图和日志都是私人运行数据，已被Git排除，不能重新打包分享。

## 验证码识别范围

固定 RapidOCR3.10.0 + ONNX Runtime1.31.0、PP-OCRv5中文mobile，CPU执行；模型和字典随包提供，来源及SHA256见 `tools/ocr/assets.json`。只识别截图中的单行文字，不调用在线OCR服务。

支持阿拉伯/全角数字、普通及财务中文数字，与加减乘除运算词混排；两个0–999整数之间一次运算，除法须整除。唯一 `=`（含归一化的全角等号、等于/等於）及其右侧全部字符不参与计算，左侧仍严格校验。例如 `陆x五=$` 计算左侧 `6*5`。

RapidOCR严格解析失败时，可按作者指定的形近字约定局部补正：保留最后一个 `=` 为分隔符，把它左侧完整操作数位置的 `=` 按2处理，如 `陆除==`→`6/2`→`3`。不替换数字中间的等号，不凭空补数字；只有一个等号的 `陆除=`、`95==?`、非整除和零除仍拒绝。此规则无法证明原图就是二，不能作为准确率提升的证据；rawText和原始confidence保持。

等号左侧没有运算符且全部为合法数字时直接填入数字：`玖5=`→`95`、`００７=`→`007`，逐字数字可多位且保留前导零；规范中文十/百位序沿用0–999规则（`九十五=`→`95`）。空左侧、未知字符、不完整算式及没有等号的纯数字仍拒绝。这按OCR文字执行，不能判断原图是否漏识别运算符。原始文字和分数仍记录，分数至少0.5才接受，但**分数不是准确率**，也不能保证每张真实验证码都识别正确。

Cloudflare、图片选择、拼图、二次认证不走此算式OCR分支；需要本人处理时使用交互命令。页面字段或规则改变后，应先更新本地fixture验证，不能靠重复提交猜答案。

### 识别失败关闭重开

普通 `signin.ps1` / `node app.js signin` 默认启用，无需新开关。仅在OCR识别阶段抛出 `uncertain_recognition`、`unsupported_expression` 或 `ocr_failed`，且正确账户的验证码输入框仍为空时，正常点击弹窗关闭按钮；确认关闭、账户一致及签到入口可用后重新签到，等待图片DOM确已变化才识别新题。连续失败最多关闭重开4次、识别5次；成功立即停止。模型/环境缺失、关闭按钮不可用或关闭失败、新图未到达、输入已填写、填入/提交后的错误及其他验证不走此循环。网站明确拒绝仍沿用 `-RetryCaptcha` 的三分钟单次补试；所有浏览器轮次共用5次识别额度。

`details.captchaAttempts` 记录各次错误、原文、分数和图像路径，恢复成功后也保留早前失败。处理前原图首张为 `captcha-before-processing.png`，后续使用 `captcha-before-processing-N.png`，各轮目录独立，互不覆盖。达到上限仍未成功时记录真实失败，不额外启动脚本叠加次数。

## 文件与清理

| 路径 | 用途 |
| --- | --- |
| `app.js`、`lib/`、`sites/` | 独立运行与签到逻辑 |
| `setup/login/signin/status/doctor.ps1` | Windows命令入口 |
| `tools/ocr/` | 固定识别器、哈希依赖清单、公共模型与字典 |
| `profiles/chrome/` | 初始化登录后产生的私人浏览器资料 |
| `config.json` | 本人账户、代理、Chrome设置 |
| `data/dounai-signin-status.json` | 本轮真实结果，失败也覆盖旧结果 |
| `data/login-status.json` | 独立登录结果，不算签到 |
| `data/dounai-signin-YYYY-MM-DD.png` | 明确成功后的按钮截图 |
| `data/dounai-diagnostics/` | 每轮独立结果、失败截图、处理前原图及诊断 |
| `logs/` | 本机运行历史 |
| `temp/` | 包内安装缓存与本地测试临时文件 |

初始化后的目录已经包含私人数据，**不要整个重新压缩分享**。对外继续发原始ZIP。删除本包即可移除程序、包内虚拟环境与浏览器资料；本包没有安装系统服务或定时任务。仅删 `temp/` 可清理安装缓存；`.venv/` 或 `node_modules/` 被删除后需重新初始化，模型须保留。

第三方来源及许可见 [THIRD_PARTY.md](THIRD_PARTY.md)。为Agent准备的执行说明见 [AGENTS.md](AGENTS.md)。可直接复制给Windows Agent的完整提示词见 [WINDOWS_AGENT_PROMPT.txt](WINDOWS_AGENT_PROMPT.txt)，发送前把其中 `D:/Tools/dounai-windows` 替换成实际解压路径。

## GitHub部分更新

可将本包目录作为独立GitHub仓库。朋友首次git clone，后续git pull --ff-only拉取有变化的代码；私人配置、profile和本地依赖由.gitignore排除。依赖锁没变时通常不需重新初始化。完整发布命令、旧ZIP迁移和Agent更新指令见 [GITHUB_UPDATES.md](GITHUB_UPDATES.md)。本包不自行后台更新；版本变化见 [CHANGELOG.md](CHANGELOG.md)。

## Windows验收

接收方需完成：首次setup与doctor、本人登录、关闭重开后识别会话、单次真实签到和status核对、失败时正确非零退出。未完成前请把它称为“Windows待验收分享版”，不要把Mac测试或模拟成功写成Windows真实验收。

运行 `npm test` 执行配置、解析、状态检查与浏览器模拟回归。浏览器测试使用本机Chrome的隔离临时profile与本地route fixture，不访问豆奶真实账户；测试不替代上述真实验收。非标准Chrome位置可通过 `DOUNAI_TEST_CHROME_PATH` 环境变量指定，仅影响测试。
