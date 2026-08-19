import { componentTypes } from "../editor/ComponentTypes";
import "./Importer";
import "./Exporter";

/**
 * VFX 插件 scene 进程入口
 *
 * 必须单独成文件、不能和 IEditor.xxx 混在同一个 .ts 里 —— LayaPro 按文件里
 * 第一个装饰器判定 scriptType（DecoratorUtils.getScriptType），混在一起会
 * 把整个文件归到错误的进程，运行时拿不到对应命名空间。
 *
 * - @IEditorEnv.onPreload 在 scene 进程启动早期（AssetManager 已就绪后）执行
 * - 注册 VisualEffect / VFXRenderer 组件类型描述（让组件菜单 + Inspector 认）
 * - 预加载 5 个内置默认 material / shader,触发 Shader3D.add 注册,让
 *   VFXRenderer fallback 路径能通过 Shader3D.find 命中
 */

/** vfx 内置默认资源（com.layabox.vfx/runtime/ 下，UUID 与 .meta 一致）
 * 加载顺序约定：.shader 先于 .lmat —— material 引用 shader name，加载 .lmat 不会主动 Shader3D.add，
 *               必须先加载 .shader 触发 shader 注册，否则 VFXRenderer fallback Shader3D.find 失败
 *               报 `'VFXUnlit' shader not registered`。
 */
// const VFX_BUILTIN_UUIDS = [
//     // .shader 文件 — 加载触发 Shader3D.add 注册 shader name
//     "ce815578-6547-4f83-be80-a89912dc03d0", // VFXUnlit.shader
//     "d29a39fc-4dd9-4e3c-8451-db6a6092d17a", // VFXStrip.shader
//     "046c3dc9-8ef4-4e3b-bce3-df93e11bd86e", // VFXBillboardProcedural.shader
//     "9e6cee89-5666-43e3-a064-7c26d8ce36d8", // VFXCubeProcedural.shader
//     "7b8f3d2e-a415-4c6b-9d8f-2e1a5c3b4d6a", // VFXDistortionQuad.shader
// ];

@IEditorEnv.regClass()
export class Main {
    @IEditorEnv.onPreload
    static onPreload() {
        // 注册组件类型（VisualEffect 出现在"添加组件"菜单 + Inspector 属性识别）
        EditorEnv.typeRegistry.addTypes(componentTypes, true);
    }

    @IEditorEnv.onLoad
    static async onLoad() {
        let absPath = EditorEnv.assetMgr.getFullPath(EditorEnv.assetMgr.getAsset("editorResources/vfx/runtime", true));
        [
            "VFXBillboardProcedural.shader",
            "VFXCubeProcedural.shader",
            "VFXDistortionQuad.shader",
            "VFXUnlit.shader",
            "VFXStrip.shader"
        ].map(name => EditorEnv.liveServer.addFileRoute("internal/vfx/" + name, absPath + "/" + name));
    }
}
