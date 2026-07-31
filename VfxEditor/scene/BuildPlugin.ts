const VFX_BUILTIN_SHADER_UUIDS = [
    "046c3dc9-8ef4-4e3b-bce3-df93e11bd86e", // VFXBillboardProcedural.shader
    "9e6cee89-5666-43e3-a064-7c26d8ce36d8", // VFXCubeProcedural.shader
    "7b8f3d2e-a415-4c6b-9d8f-2e1a5c3b4d6a", // VFXDistortionQuad.shader
    "ce815578-6547-4f83-be80-a89912dc03d0", // VFXUnlit.shader
    "d29a39fc-4dd9-4e3c-8451-db6a6092d17a", // VFXStrip.shader
];

@IEditorEnv.regBuildPlugin("*")
export class BuildPlugin implements IEditorEnv.IBuildPlugin {
    onCollectAssets(task: IEditorEnv.IBuildTask, assets: Set<IEditorEnv.IAssetInfo>): void {
        if (!task.playerSettings.modules["laya.vfx"])
            return;

        for (const uuid of VFX_BUILTIN_SHADER_UUIDS) {
            const asset = EditorEnv.assetMgr.getAsset(uuid);
            if (asset)
                assets.add(asset);
            else
                task.logger.error(`VFX builtin shader not found: ${uuid}`);
        }
    }

    onBeforeExportAssets(
        task: IEditorEnv.IBuildTask,
        exportInfoMap: Map<IEditorEnv.IAssetInfo, IEditorEnv.IAssetExportInfo>,
    ): void {
        if (!task.playerSettings.modules["laya.vfx"])
            return;

        for (const uuid of VFX_BUILTIN_SHADER_UUIDS) {
            const asset = EditorEnv.assetMgr.getAsset(uuid);
            const exportInfo = asset && exportInfoMap.get(asset);
            if (exportInfo)
                exportInfo.outPath = `internal/vfx/${asset.fileName}`;
        }
    }
}
