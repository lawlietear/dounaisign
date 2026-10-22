# 第三方来源与分发记录

本包提供独立整理的豆奶运行代码，以及以下公共模型/字典；不包含Node、Python、Chrome、已安装npm/Python包或私人浏览器资料。它们由接收者准备或按锁文件安装，各自许可证继续适用。

## 随包模型与字典

- 上游：PaddlePaddle/PaddleOCR；上游项目许可为Apache-2.0，完整文本见 `licenses/PaddleOCR-LICENSE.txt`，来源：https://github.com/PaddlePaddle/PaddleOCR/blob/main/LICENSE 。
- 分发/转换来源：RapidAI/RapidOCR v3.10.0模型注册表，识别模型为 `ch_PP-OCRv5_rec_mobile.onnx`，中文PP-OCRv5 mobile。模型与字典均原样复制，未训练、修改权重或转换格式；ONNX版本由RapidOCR上游提供。
- 模型原作者权利归PaddleOCR/Baidu及相关权利人；RapidOCR工程代码权利归RapidOCR Authors。不表示任何上游对本包的背书。
- 各文件的原始URL、大小和SHA256见 `tools/ocr/assets.json`；不以同名文件替代同一版本/哈希确认。
- RapidOCR已安装发行版自带的许可与模型说明保留在 `licenses/RapidOCR-LICENSE.txt`、`licenses/RapidOCR-MODEL_LICENSES.md`。该说明的模型覆盖范围应结合具体PP-OCRv5来源记录阅读；不能将其他模型条款推及任意模型。

## 初始化安装的依赖

Node包锁定playwright-core1.62.1（Apache-2.0）；Python固定RapidOCR3.10.0、ONNX Runtime1.31.0及哈希清单中的全部依赖。包安装后的license/NOTICE随原发行物保留，具体来源及完整性见npm锁与Python哈希锁。`tools/ocr/source-uv.lock`是导出Python依赖所依据的原始锁快照，仅供追溯，不用于安装Mac虚拟环境。

官方资料：[Playwright](https://github.com/microsoft/playwright)、[RapidOCR](https://github.com/RapidAI/RapidOCR)、[PaddleOCR](https://github.com/PaddlePaddle/PaddleOCR)、[ONNX Runtime](https://github.com/microsoft/onnxruntime)。

## 本包适配范围

从原豆奶脚本中只提取本网站逻辑，移除其他站点与Swift路径；适配WindowsPython调用、可配置预期账户、独立profile、PowerShell初始化/执行和只读当天结果检查。没有复制原使用者配置、账户、会话或运行结果。
