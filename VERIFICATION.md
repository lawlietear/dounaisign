# 验证记录

## 1.0.3 · 2026-10-23

使用分享目录已有的本地mise Node24.21.0及自身node_modules（playwright-core1.62.1），未使用外部NODE_PATH或安装依赖。该本机mise配置不随Windows包发布，接收方继续使用原Node/PowerShell入口。完整 `npm test` **41项通过、0失败**，包括原30项、新增3项等号补正、7项隔离route浏览器测试及1项共享额度runner测试。

覆盖最后分隔等号前完整操作数位置按2补正、单尾等号/错位等号/零除/非整除/低分拒绝；五次识别失败只关闭四次、五张新图及原文/分数独立留存、第5次成功单次提交、账户/输入/图像变化及填入后异常停止。每次账户读取均核验可配置expectedAccount；外层三分钟补试保持同一个五次额度对象。login与status既有行为通过回归。

受影响JS语法、3个Python AST及PowerShell ASCII/参数转发检查通过；Windows .venv/Scripts/python.exe及UTF-8环境保留。package-lock仅根版本号更新，实际依赖、OCR锁、模型和字典哈希不变，1.0.2升级到1.0.3无需因版本元数据重新setup。28项Mac生产/Windows依赖与本机环境保护指纹匹配。

最初受限执行环境启动测试Chrome发生一次应用注册阶段SIGABRT；之后直接在获准执行环境完成隔离测试，没有新增崩溃报告。所有浏览器测试仅由本地route fixture提供页面、阻断其他请求，使用临时profile并已清理；OCR输出由mock提供，没有真实登录、OCR、签到或调度操作。

以上不代表Windows实机、PowerShell运行时、安装、原生OCR或真实网站验收。这些仍需接收方在Windows本人账户完成。

## 1.0.2 · 2026-10-23

沿用现有mise/Node24.21.0、外部NODE_PATH及系统Chrome隔离本地route fixture，完整30项回归通过、0失败（原21项、新增诊断fixture与8项retry/runner mock）。首次因执行沙箱阻止Chrome启动，8项纯mock通过、22项未完成；同一受限命令授权重跑后30项全过。没有安装包内依赖或访问真实站点。

覆盖不同失败状态共用两轮、三次模拟60000ms、network_error后captcha_rejected不得第三轮、默认拒绝不补和显式RetryCaptcha开启、同包profile重新建页、关闭释放锁先于等待、前后证据独立、可配置账户、login不签到且不进入signin补试、status只读。本地浏览器验证了输入变化前后截图字节相同、URL去query/fragment、页面错误原文及处理前图保存；截图为synthetic，不是实际签到证据。

17个JS语法与3个Python AST检查通过；Windows专用Python路径/UTF-8、账户/配置/验证码保护模块均保留，PowerShell新RetryCaptcha开关通过ASCII及静态参数转发检查。package-lock除顶层和根包version外逐项相同，OCR依赖、模型和字典哈希不变。仅升级1.0.1到1.0.2不需重装Node或OCR依赖。临时profile及输出已清理，初始分享包不含运行后资料。

这些是Mac上的本地mock/fixture及静态检查，Windows本机、PowerShell实际执行、安装/原生OCR和真实签到仍待接收方验收。

## 1.0.1 · 2026-10-22

沿用下方相同mise/Node 24.21.0、外部NODE_PATH及Chrome本地route fixture命令，21项通过、0失败。新增等号左侧纯数字/中文混排转换、前导零保留、非法/不完整输入及低分拒绝；模拟`玖5=`经实际文本解析器得到95，填写并仅提交一次，出现明确已签到标记才成功。OCR文字来自模拟桩，未实测本次规则对应的真实验证码图片。

13个JS文件通过Node语法检查，3个Python文件通过AST解析；数字归一化及算式解析函数与Mac版本逐字一致，Windows专用Python路径和UTF-8设置保留。本地测试没有安装依赖、访问真实账户或改变Mac生产文件。以上是发布前的本地验证；GitHub发布后的克隆与文件哈希验收另行核对，不代表Windows实机安装、PowerShell或真实签到已通过。

新增GitHub发布/更新说明、私人文件忽略及关闭换行转换的.gitattributes，供后续独立仓库使用。本包没有新增自动更新执行器。

## 1.0.0 历史验证

日期：2026-10-20。此记录区分本机模拟和静态检查，不表示 Windows 或真实站点验收。

## 本机模拟

测试命令使用 `dailysign` 项目的 mise Node 环境和项目内 Playwright 依赖；以下路径均为运行者本机路径的占位符：

```text
mise -C <dailysign-project> exec -- env NODE_PATH=<dailysign-project>/node_modules DOUNAI_TEST_CHROME_PATH=<Chrome executable> node --test <package>/tests/*.test.js
```

Node.js 24.21.0、npm 11.19.0、Google Chrome 155.0.8059.81；19 项通过，0 项失败。运行依赖通过外部 `NODE_PATH` 提供，没有在分享包内安装 Node 依赖。

浏览器回归使用本机 Chrome 和系统临时目录中的一次性 profile。测试只允许 `https://dounai.pro/user/panel` 由本地 synthetic fixture 响应，其余浏览器请求全部中止；测试结束关闭并清理临时 profile。没有访问真实豆奶账户，也没有执行实际签到。

覆盖配置账户校验、Windows 常见 Chrome 安装路径和显式路径、账户冲突、无验证码和已签到零点击、`陆x五=$` 由实际解析器得到30并仅提交一次、拒绝和低分识别不重试、识别期间账户改变时不填入或提交、登录只等待账户确认、北京时间当天状态与失败退出码、带空格的临时 `baseDir`、OCR 子进程 UTF-8 环境、模型文件哈希及 PowerShell 静态特征。登录入口的主程序分支通过注入的 mock Chromium 检查；profile 路径由绝对 `baseDir` 构造，mock 未创建 profile 或签到结果文件。

## 静态检查

- `requirements.lock.txt` 的21个依赖版本与 `source-uv.lock` 对应。每项都存在 Windows x64 或通用 wheel，选中 wheel 的 SHA-256 均保留在 requirements 锁中；未下载或安装这些 Windows wheel。
- `scripts/doctor.js` 的模型清单校验通过，模型和字典文件哈希与 `assets.json` 一致。
- Python 入口 `scripts/check-python.py`、`tools/ocr/check-env.py` 和 `tools/ocr/recognize.py` 均通过语法解析；静态核对了 64 位 Python 限制及 OCR 子进程 UTF-8 设置。
- PowerShell 入口和公共脚本为无 BOM ASCII；静态检查覆盖初始化参数、哈希与 wheel 安装选项、Node 参数传递和原生退出码转发。当前环境没有 `pwsh` 或 Windows，未执行 PowerShell 语法检查或 Windows PowerShell 5.1 运行。
- 本次个人用户名和 Mac 绝对路径扫描无命中。测试结束后，分享包没有 `node_modules`、`.venv`、`profiles`、`data`、`logs` 或 `temp` 目录。

## 尚未验收

Windows 上的安装脚本、PowerShell 5.1、CPython 3.12 x64 环境、ONNX Runtime Windows 原生库与 Chrome 启动仍待接收方验证。真实登录、真实签到和 `status.ps1` 实机结果也未验证；19项通过只说明本机本地 fixture 回归通过，不替代 Windows 或真实站点验收。
