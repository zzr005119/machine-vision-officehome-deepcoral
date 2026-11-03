# Office-Home 本地数据

本目录只提交数据说明和后续的划分清单。压缩包、原始图片及处理后的图片由 `.gitignore` 排除。

## 压缩包记录

以下结果于2026-11-03从当前本地文件计算。下载来源和实际下载日期尚未确认。

| 项目 | 本地结果 |
| --- | --- |
| 相对路径 | `data/downloads/OfficeHomeDataset_10072016.zip` |
| 文件字节数 | 1,132,166,928 |
| SHA-256 | `4B3EE939C181E508109064C484D59BCFF0386BDF15960E8D11305EE5C4BB81FF` |
| 压缩包目录条目数 | 15,855，含目录及其他文件 |
| JPG 条目数 | 15,588 |
| 中央目录声明的总解压字节数 | 1,187,445,785 |
| 顶层目录 | `OfficeHomeDataset_10072016/` |

| 域目录 | JPG 数量 | 类别目录数 |
| --- | ---: | ---: |
| Art | 2,427 | 65 |
| Clipart | 4,365 | 65 |
| Product | 4,439 | 65 |
| Real World | 4,357 | 65 |

这些统计基于压缩包中央目录，尚未完整读取压缩内容、逐图解码或检查跨域重复。SHA-256 用于标识当前文件；尚未与上游公布的校验值比较。

在项目根目录重新计算本地校验值：

```powershell
Get-FileHash -LiteralPath '.\data\downloads\OfficeHomeDataset_10072016.zip' -Algorithm SHA256
```

后续解压到 `data/raw/`，保留域与类别目录。数据获取及后续校验要求见[实验流程与下载说明](../题目6_OfficeHome_DeepCORAL_实验流程与下载说明.md)。
