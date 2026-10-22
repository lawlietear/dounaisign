# GitHub发布与增量更新

本包版本1.0.1。推荐将**本包目录**作为单独仓库根目录；首次通过Git克隆，之后由Agent执行拉取更新。Git仅传输需要的仓库对象并更新有变化的文件；未变化的模型无需作为完整ZIP反复发送。本包没有自动更新服务，也不会在签到前自行拉取或执行远程代码。

正式公开仓库：https://github.com/lawlietear/dounaisign 。朋友可直接使用下方克隆命令。

## 作者首次发布

以下为作者首次发布的流程参考；已创建的正式仓库无需重复创建。发布新的独立副本时先创建空仓库，不预建README或.gitignore，并将下列远程地址换成自己的目标仓库。

在本包目录执行，先查看待提交文件再提交；不要从android-automation或dailysign生产目录上传：

```sh
git init -b main
git add .
git status --short
git diff --cached --stat
git commit -m "Release dounai Windows 1.0.1"
git remote add origin https://github.com/lawlietear/dounaisign.git
git push -u origin main
git tag v1.0.1
git push origin v1.0.1
```

首次发布应使用干净分享目录。`.gitignore`排除config.json、profiles、data、logs、node_modules、OCR虚拟环境与缓存；不要加入这些文件。已被提交的文件不能靠新增ignore规则从历史中移除。`.gitattributes`关闭换行转换，使模型及MANIFEST中的文件字节哈希在Windows检出后保持一致。发布ZIP放GitHub Releases附件，仓库内不反复提交ZIP。

## 朋友首次获取

需已安装Git（缺失时按本人允许的方式安装）。私有仓库由本人完成GitHub凭据授权，不要将令牌放入代码、配置或仓库URL。

```powershell
git clone https://github.com/lawlietear/dounaisign.git D:/Tools/dounai-windows
Set-Location D:/Tools/dounai-windows
.\setup.ps1 -Account "自己的豆奶用户名"
.\login.ps1
.\signin.ps1
.\status.ps1
```

仅下载ZIP的目录没有Git历史，不能直接git pull。旧ZIP使用者应先关闭本包Chrome，备份自己的config.json及profiles目录，在新路径clone并setup后，仅迁入本人配置与profiles（需要历史时还可迁入自己的data/logs）。不要迁移旧node_modules或.venv；虚拟环境与安装路径有关，需在新路径初始化。首次核验登录和doctor成功后再停用旧目录，避免同时执行两个副本。

## 后续部分更新

先等本包登录、签到、doctor和初始化命令结束，并关闭本包Chrome。在仓库根目录执行：

```powershell
git status --short
git log -1 --oneline
git pull --ff-only
git log -1 --oneline
.\doctor.ps1
```

Agent须逐条检查退出码；pull失败时停止，不继续运行后续命令。工作区有本地代码修改或分支分叉时先报告差异，保留修改，不强制覆盖。`--ff-only`在不能快进时停止，不自动合并。私有配置和登录资料从未纳入跟踪时，普通代码更新会保留它们。不要使用git clean -fdx或删除profiles来更新。

依赖锁文件没变化时不需重复setup。package-lock.json或OCR依赖清单变化时，在pull成功后运行setup.ps1，再doctor；setup保留已有config.json。模型变化会随Git更新，由doctor核对哈希。更新本身不登录、不签到；需要真实签到时另外执行signin.ps1，并按状态与网页回执验收。

可发给朋友的更新指令：

> 请在本包目录按GITHUB_UPDATES.md执行一次更新。先确认没有本包任务运行，查看git status；有本地代码修改先报告并保留。执行git pull --ff-only并检查退出码，必要时按锁文件重新setup，再doctor。保留我的配置、profiles和历史；不要改全局环境或创建定时任务。只更新和检查，不登录、不签到。

## 作者后续发布

在这个独立包更新代码、版本号、对应测试、验证记录和逐文件MANIFEST，再提交并推送main。每次发布用新标签（例如v1.0.2）和对应ZIP；Git使用者pull代码，ZIP使用者下载该版本。MANIFEST不包含自身和.git目录。尚未在Windows实机执行的版本须如实标注，不能将Mac模拟测试当作Windows验收。

参考：[Git pull](https://git-scm.com/docs/git-pull)、[GitHub忽略文件](https://docs.github.com/en/get-started/git-basics/ignoring-files)。
