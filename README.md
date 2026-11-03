# 机器视觉大作业：Office-Home / Deep CORAL

课程题目6：在 Office-Home 数据集上自实现 Deep CORAL，研究无监督域自适应，并与 Source-only、Target-supervised 对照。

当前处于项目初始化与数据准备阶段，尚无训练、评估或前端代码。

## 项目文件

- [课程实验任务书](./20261028-机器视觉-实验课程-分组实验任务书.docx)：课程要求和验收依据。
- [实验流程与下载说明](./题目6_OfficeHome_DeepCORAL_实验流程与下载说明.md)：实验方案、数据协议和交付要求；暂定配置在文中单独标明。
- [数据说明](./data/README.md)：本地压缩包位置、SHA-256 和目录统计。
- [项目状态](./PROJECT.md)：当前阶段、关键决策及下一步。

## 数据准备

本地已有 `data/downloads/OfficeHomeDataset_10072016.zip`。原始图片、数据压缩包、模型权重和训练输出不提交 Git。

2026-11-03 已读取压缩包中央目录并计算 SHA-256：四个域各有65类，共15,588张 JPG。尚未完整解压、逐图解码或进行重复检查，不能据此认定数据完整可用。

在项目根目录的 PowerShell 中执行以下命令解压；当前尚未执行：

```powershell
New-Item -ItemType Directory -Path '.\data\raw' -Force | Out-Null
Expand-Archive -LiteralPath '.\data\downloads\OfficeHomeDataset_10072016.zip' -DestinationPath '.\data\raw'
```

克隆仓库后需自行准备数据，压缩包不随 Git 下载；来源线索见实验流程与下载说明。

## 后续工作

1. 确认抽样方案提交情况及老师指定的数据协议。
2. 完成解压、逐图检查、去重和固定划分。
3. 先完成一个迁移方向的三组对照，再扩展到三个方向、分析与前端。

暂定使用 Python、PyTorch 2.x、torchvision ResNet18，具体依赖版本、训练设备和运行入口在实现时确认。
