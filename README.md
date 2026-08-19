# VFX 粒子编辑器

这是 VFX 粒子编辑器的源代码和测试工程项目。

## 📁 项目结构

| 目录 | 说明 |
|------|------|
| `packages/VFXEditor` | 编辑器源代码 |
| `assets/Examples` | 测试工程示例 |

## 🚀 快速开始

在 IDE 中直接启动项目即可。

> **⚠️ 重要提示**  
> 修改源代码后需要重新刷新编辑器才能生效。

## 📦 导出安装包

### 方式一：使用 IDE 菜单

1. 点击菜单 **工具** → **导出可安装包**
2. 在弹出的界面中选择目录 `packages/VFXEditor`

### 方式二：使用命令行（需安装 layaair-cli）

```bash
layaair export-installable-package packages/VFXEditor --output /path/to/layaair-vfx.layapkg
```