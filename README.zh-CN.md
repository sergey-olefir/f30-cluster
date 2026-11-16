# F30 Cluster 中文说明

[English](README.md) · [原项目](https://github.com/sergey-olefir/f30-cluster)

F30 Cluster 在 BMW MGU／iDrive 7 上绘制 F 系列 6WB 风格仪表，可选择舒适、运动、节能主题，并随驾驶模式切换。界面建立在 MGU App Kit 上，通过 `cluster-render` 绘制，绘图引擎基于 bimmer-lab/apps。

**原项目状态：开发中，上游说明尚未在实车验证。** 台架或模拟器结果不代表真实仪表兼容性。可视区域参数需要针对目标车辆重新测量。图形由原作者自行绘制，不包含 BMW 原版图形或字体。

**简体中文汉化：小白151／小白科技杂物社（[JackieZ123430](https://github.com/JackieZ123430)）。** 原软件、绘图引擎和字体的作者署名及许可保留，见 [LICENSE](LICENSE) 和应用目录中的 NOTICE。

## 功能与目录

- `apps/f30_cluster/`：主题选择、跟随驾驶模式、G20 内容叠加、夜间配色、表盘和地图显示设置。
- `apps/driver_profiles/`：查看访客、代客泊车及个人档案，管理本地档案名称、头像和设置。写入操作需要确认，复制或删除还受原项目车辆状态检查限制。
- `shared/`：主题引擎、原生车机菜单和主题预览。
- `kit/`：运行库与构建工具。
- `bench/`：使用模拟车机服务的台架测试。

## 构建中文版

使用现有固定语言构建机制，英文仍为默认值：

```sh
python kit/tools/build.py --language zh-CN f30_cluster driver_profiles
```

构建需要本地 BMW SDK，具体提取方法和台架要求请参考英文 README。不要将 SDK、真实车辆数据或凭据提交到仓库。中文构建使用专门的菜单语言表和中文 UI 字库；仪表中的车型型号、单位及协议标识保留原值。

```sh
node kit/tools/test_zh_cn.js
```

已有中文词条沿用原译文。新增文字同时维护 `kit/runtime/locales/zh-CN.tsv` 和 `.json`。汉化署名存于 `kit/localization/credit.zh-CN.json`，仅在中文构建中使用。

中文 UI 字库使用 OFL-1.1 许可的 Noto Sans SC。使用 Pillow 与指定字体文件重建：

```sh
python kit/tools/bake_zh_cn.py /path/to/NotoSansSC.ttf
```

脚本验证字体哈希，输出 `kit/localization/fonts/ui-zh-CN.json`。仪表原有主题资产、车辆信号和设置键保持原项目定义。

## 使用边界

默认商店源仍按原项目的默认语言构建；发布中文包时需要明确使用 `--language zh-CN`。本次汉化验证包括电脑构建、菜单资源和字形检查，不包含真实车辆测试。驾驶员档案操作沿用原项目确认与保护规则；不要将自动化测试通过理解为已确认实车写入效果。

<!-- Localization provenance: XIAOBAI-ZHCN-20261116; translation by 小白151 / JackieZ123430. -->
