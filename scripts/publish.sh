#!/usr/bin/env bash
# LayaAirVFXEditor 插件构建脚本
# 由 LayaAirPackagesPublish/buildPacakge.sh 调用：bash scripts/publish.sh <output_dir> [args]
# 输出目录由调用方提前 mkdir，本脚本只需把插件源码内容复制进去
set -euo pipefail

OUT_DIR="${1:?用法: publish.sh <输出目录> [--prod]}"
REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC_DIR="${REPO_DIR}/VfxEditor"

[ -d "${SRC_DIR}" ] || { echo "[publish] 源目录不存在: ${SRC_DIR}" >&2; exit 1; }

mkdir -p "${OUT_DIR}"

# 复制 VfxEditor 子目录内容到输出目录（含 package.json / .meta 等 IDE 必需文件）
cp -r "${SRC_DIR}/." "${OUT_DIR}/"

echo "[publish] LayaAirVFXEditor 源码已复制到: ${OUT_DIR}"
