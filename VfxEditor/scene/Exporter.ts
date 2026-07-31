import fpath from "path";

@IEditorEnv.regAssetExporter(["vfx"])
export class Exporter extends IEditorEnv.AssetExporter {
    async handleExport(): Promise<void> {
        let fullPath = fpath.join(EditorEnv.projectPath, "library", this.asset.id.substring(0, 2), this.asset.id + "@0.lvfx");
        let content = await IEditorEnv.utils.readJsonAsync(fullPath);
        if (!content)
            return;

        this.exportInfo.contents[0] = { type: "json", data: content, nameSuffix: "@0.lvfx" };

        // 递归收集内部所有 res:// 依赖，加入导出队列
        const links: IEditorEnv.IAssetLinkInfo[] = [];
        collectResLinks(content, links);
        if (links.length > 0)
            this.exportInfo.deps = this.parseLinks(links);
    }
}

/**
 * 递归遍历 lvfx JSON，为每一处 `res://...` 引用（含 `{_$uuid}` 包装）收集一条 link。
 * ⚠ 不按 uuid 去重：同一 uuid 可能出现在多个 obj[prop]（如多个 system 的
 *    customShaderRes），每一处都要单独记录，write 阶段才能逐一改写成相对路径；
 *    导出队列的去重由 parseLinks → addQueue 负责，这里不需要。
 */
function collectResLinks(
    node: any,
    links: IEditorEnv.IAssetLinkInfo[],
): void {
    if (node == null || typeof node !== "object") return;

    if (Array.isArray(node)) {
        for (let i = 0; i < node.length; i++) {
            const v = node[i];
            if (typeof v === "string")
                pushLink(node, "" + i, v, links);
            else
                collectResLinks(v, links);
        }
        return;
    }

    // LayaPro 标准资源引用包装 { _$uuid, _$type }
    if (typeof node._$uuid === "string") {
        pushLink(node, "_$uuid", node._$uuid, links);
        return; // 包装对象内不再有别的资源引用
    }

    for (const key in node) {
        const v = node[key];
        if (typeof v === "string")
            pushLink(node, key, v, links);
        else
            collectResLinks(v, links);
    }
}

function pushLink(
    obj: any,
    prop: string,
    url: string,
    links: IEditorEnv.IAssetLinkInfo[],
): void {
    // 只收 res:// 资源引用；普通字符串（shader 名字、事件名等）不动
    if (typeof url !== "string" || !url.startsWith("res://")) return;
    if (url.length <= 6) return;
    links.push({ obj, prop, url });
}
