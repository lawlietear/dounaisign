# 豆奶 Windows 分享版：Agent执行说明

这是独立代码包，只操作本目录。先读 `README.md` 和 `VERIFICATION.md`；不要寻找或依赖作者的Mac项目、旧目录、Codex聊天或系统定时任务。

## 初始化

1. 核对Windows x64、Node24 x64、CPython3.12 x64及Chrome；缺少全局运行时请说明缺项，按使用者允许的安装方式处理，不擅自更改全局环境。
2. 首次需要使用者的豆奶**用户名**，写入 `config.json/expectedAccount`。不要索取、读取、输出、复制或记录密码/Cookie。代理和Chrome路径使用本机实际值。
3. 执行 `setup.ps1 -Account "使用者用户名"`，核对退出码；然后 `doctor.ps1` 应返回 `ok=true/status=ready`。setup和doctor都不能访问网站或自动签到。
4. 执行 `login.ps1`，由本人在本包专用Chrome完成登录。确认登录返回0后再运行签到；登录本身不算签到成功。

PowerShell脚本受限制时，可用 `powershell.exe -NoProfile -ExecutionPolicy Bypass -File <脚本绝对路径> ...`，仅影响该进程。不要修改持久策略、系统代理、注册表或已有任务来“修复”。如果组织策略限制，交给本人处理。

## 用户要求签到时

执行 `signin.ps1`（或 `node app.js signin`）一次，并读取最终JSON及退出码。验证码分支默认开启，无验证码直接签到；算式或等号左侧纯数字由包内RapidOCR处理。唯一等号右侧忽略，左侧须通过严格语法及分数校验；无运算符时直接填入归一化数字并保留前导零。最多一次签到点击、一次验证码提交。不得自行降低门槛、猜测字符、刷新挑战或循环重试。

出现登录缺失、账户不符、验证要求或结果不明时，报告真实状态与受限诊断；需要本人接管时执行 `signin.ps1 -Interactive` 或 `login.ps1`。Cloudflare、图片选择、拼图与二次认证由本人处理，不改成算式OCR。

如果仅要求“检查”，只运行 `status.ps1`；不要自动登录、启动浏览器或补签。成功判据必须同时满足 `completionOk=true`、真实结果为当天 `signed/already_done`。使用北京时间日期，不能把旧成功刷新timestamp，也不能用登录成功、HTTP200、OCR分数、模拟截图或其他账户结果代替。

`busy` 表示同包操作持锁，不要杀浏览器、删除活锁或另开并发。登录/签到只使用 `profiles/chrome/`，不要读写日常Chrome资料；不要复制别人的profile。程序会关闭它自己启动的专用Chrome。

## 验证与维护

- 本包没有定时任务；用户没要求时不要创建计划任务或后台服务。
- 依赖按 `package-lock.json` 和 `tools/ocr/requirements.lock.txt` 安装，不静默升级。模型哈希必须匹配 `assets.json`；失败应停止，不从不明地址替换。
- 改动后先运行相应本地测试，浏览器测试仅允许本地route fixture和临时profile。真实签到必须来自使用者的请求，不能当作离线测试的一部分。
- 本包整理于Mac。Windows环境、安装和真实站点验收见VERIFICATION；缺失项如实标注，不把静态审查称为Windows运行通过。
- 输出简短说明：运行时间、状态、执行方式、是否当天完成、需要本人处理的事项。不要输出浏览器资料、密码或Cookie。
- 继续分享时使用初始干净ZIP；不得打包运行后的config.json、profiles、data、logs、node_modules或venv。
- 用户要求从GitHub更新时按GITHUB_UPDATES.md操作：先确认任务结束、查看本地修改，再git pull --ff-only；逐条检查退出码。有分叉或本地代码修改时停止并保留，不强制覆盖。仅锁文件变化才重新setup，再doctor；更新不自动登录或签到。
