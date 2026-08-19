/**
 * VFX Graph 节点类型 — 聚合入口
 *
 * 具体定义分布在各自文件中：
 *   ContextDefinitions.ts  — Context 类型（生命周期容器）
 *   BlockDefinitions.ts    — Block 类型（Context 内的操作）
 *   OperatorDefinitions.ts — Operator 类型（独立数据计算节点）
 *
 * 本文件负责：
 *   1. 聚合 re-export 三类定义数组
 *   2. 图级属性定义
 *   3. 查找辅助函数
 *   4. typeRegistry 批量注册
 */

import type { IVfxEventTypeDef, IVfxContextTypeDef, IVfxBlockTypeDef, IVfxOperatorTypeDef } from "./Types";

// ─── Re-export 三类定义 ──────────────────────────────

export { VFX_EVENT_DEFS } from "./EventDefinitions";
export { VFX_CONTEXT_DEFS } from "./ContextDefinitions";
export { VFX_BLOCK_DEFS } from "./BlockDefinitions";
export { VFX_OPERATOR_DEFS } from "./OperatorDefinitions";

import { VFX_EVENT_DEFS } from "./EventDefinitions";
import { VFX_CONTEXT_DEFS } from "./ContextDefinitions";
import { VFX_BLOCK_DEFS } from "./BlockDefinitions";
import { TYPE_COMPONENTS, VFX_OPERATOR_DEFS } from "./OperatorDefinitions";

// ═══════════════════════════════════════════════════
//  图级属性
// ═══════════════════════════════════════════════════

/** 图级属性 typeRegistry ID */
export const VFX_GRAPH_TYPE_ID = "Layabox.VfxEditor.Graph";
const VFX_CAPTIONS_TYPE_ID = "Layabox.VfxEditor.Captions";

/** 图级属性定义 — 添加新属性只需在此数组追加 */
export const VFX_GRAPH_PROPERTIES: IEditor.FPropertyDescriptor[] = [
    { name: "fixedDeltaTime", caption: "Fixed Delta Time", type: "boolean", default: false },
    { name: "exactFixedTime", caption: "Exact Fixed Time", type: "boolean", default: false },
    { name: "ignoreTimeScale", caption: "Ignore Time Scale", type: "boolean", default: false },
    { name: "preWarmTotalTime", caption: "PreWarm Total Time", type: "number", default: 0, min: 0 },
    { name: "preWarmStepCount", caption: "PreWarm Step Count", type: "number", default: 0, min: 0, step: 1 },
    { name: "preWarmDeltaTime", caption: "PreWarm Delta Time", type: "number", default: 0, min: 0 },
    { name: "initialEventName", caption: "Initial Event Name", type: "string", default: "OnPlay" },
];

// ─── 查找辅助 ──────────────────────────────────────

const _eventDefMap = new Map(VFX_EVENT_DEFS.map(d => [d.typeId, d]));
const _contextDefMap = new Map(VFX_CONTEXT_DEFS.map(d => [d.typeId, d]));
const _blockDefMap = new Map(VFX_BLOCK_DEFS.map(d => [d.typeId, d]));
const _operatorDefMap = new Map(VFX_OPERATOR_DEFS.map(d => [d.typeId, d]));

export function getEventDef(typeId: string): IVfxEventTypeDef | undefined {
    return _eventDefMap.get(typeId);
}

export function getContextDef(typeId: string): IVfxContextTypeDef | undefined {
    return _contextDefMap.get(typeId);
}

export function getBlockDef(typeId: string): IVfxBlockTypeDef | undefined {
    return _blockDefMap.get(typeId);
}

export function getOperatorDef(typeId: string): IVfxOperatorTypeDef | undefined {
    return _operatorDefMap.get(typeId);
}

/** 获取指定 Context 可添加的 Block 定义列表 */
export function getBlocksForContext(contextTypeId: string): IVfxBlockTypeDef[] {
    return VFX_BLOCK_DEFS.filter(b => b.affinity.includes(contextTypeId));
}

// ─── Property Settings 类型定义 ──────────────────────

/** Property 设置面板的 typeRegistry ID */
export function getPropSettingsRegistryId(vfxType: string): string {
    return "Layabox.VfxEditor.Property." + vfxType;
}

/** AABox 值的嵌套对象类型 ID（center/size 两组 vec3，catalogBarStyle:hidden 内联渲染） */
export const VFX_AABOX_VALUE_TYPE_ID = "Layabox.VfxEditor.AABox";

/** 根据 VFX 属性类型生成 Property 设置面板的属性描述符 */
function buildPropSettingsDescriptors(vfxType: string): IEditor.FPropertyDescriptor[] {
    const props: IEditor.FPropertyDescriptor[] = [
        { name: "name", caption: "Name", type: "string" },
        { name: "type", caption: "Type", type: "string", readonly: true },
        { name: "exposed", caption: "Exposed", type: "boolean", default: true },
        { name: "group", caption: "Group", type: "string", default: "" },
        // displayName 已从属性详情移除（对齐 Unity，Unity 用属性名本身；组件 Properties 面板缺它时回退属性名）
    ];

    switch (vfxType) {
        case "number":
        case "float":  // .vfx 文件里实际存的是 "float"，editor PROPERTY_TYPES 用 "number"，两者等价
            props.push({ name: "default", caption: "Value", type: "number", default: 0 });
            break;
        case "int":
            props.push({ name: "default", caption: "Value", type: "number", default: 0, step: 1 });
            break;
        case "bool":
            props.push({ name: "default", caption: "Value", type: "boolean", default: false });
            break;
        case "vec2":
            props.push({ name: "default", caption: "Value", type: "vec2", default: { x: 0, y: 0 } } as any);
            break;
        case "vec3":
            props.push({ name: "default", caption: "Value", type: "vec3", default: { x: 0, y: 0, z: 0 } } as any);
            break;
        case "vec4":
            props.push({ name: "default", caption: "Value", type: "vec4", default: { x: 0, y: 0, z: 0, w: 0 } } as any);
            break;
        case "color":
            props.push({ name: "default", caption: "Value", inspector: "color", default: { r: 1, g: 1, b: 1, a: 1 } } as any);
            break;
        case "Gradient":
            // LayaIDE 内置 type "Gradient"（Particle.ts:5），复用其 inspector 渲染关键帧编辑
            props.push({ name: "default", caption: "Value", type: "Gradient" } as any);
            break;
        case "Curve":
            props.push({ name: "default", caption: "Value", inspector: "VfxEditor.Curve" } as any);
            break;
        case "Texture2D":
        case "Mesh":
            // IDE Asset.ts 已注册 Texture2D/Mesh 为 isAsset 类型，AssetField 自动渲染资源选择框。
            // 值在内存里是 { _$uuid }（IDE 格式），存盘时由 ValueBridge 转回 ["res://uuid"]
            props.push({ name: "default", caption: "Value", type: vfxType } as any);
            break;
        case "AABox":
            // 轴对齐包围盒（对齐 Unity "Axis Aligned Box"）：default = { center:{x,y,z}, size:{x,y,z} }。
            // 用嵌套类型 vfx_aabox_value（catalogBarStyle:hidden）让 Center/Size 两组 vec3 内联平铺。
            props.push({ name: "default", caption: "Value", type: VFX_AABOX_VALUE_TYPE_ID, nullable: false } as any);
            break;
    }

    props.push({ name: "tooltip", caption: "Tooltip", type: "string", default: "" });

    if (vfxType === "number" || vfxType === "int") {
        props.push(
            { name: "mode", caption: "Mode", type: "string", enumSource: ["Default", "Range"] as any, default: "Default" },
            { name: "min", caption: "Min", type: "number", default: 0, hidden: "data.mode !== 'Range'" },
            { name: "max", caption: "Max", type: "number", default: 0, hidden: "data.mode !== 'Range'" },
        );
    }

    return props;
}

/** Property 设置面板支持的 VFX 属性类型 */
const VFX_PROPSET_TYPES = ["number", "float", "int", "bool", "vec2", "vec3", "vec4", "color", "Gradient", "Curve", "Texture2D", "Mesh", "AABox"];

// ─── typeRegistry 批量注册 ─────────────────────────

/** typeRegistry 中 Event 类型 ID 前缀 */
export function getEventRegistryId(typeId: string): string { return "Layabox.VfxEditor.Event." + typeId; }
/** typeRegistry 中 Context 类型 ID 前缀 */
export function getContextRegistryId(typeId: string): string { return "Layabox.VfxEditor.Context." + typeId; }
/** typeRegistry 中 Block 类型 ID 前缀 */
export function getBlockRegistryId(typeId: string): string { return "Layabox.VfxEditor.Block." + typeId; }
/** typeRegistry 中 Operator 类型 ID 前缀 */
export function getOperatorRegistryId(typeId: string): string { return "Layabox.VfxEditor.Operator." + typeId; }

/**
 * 将所有 VFX 类型一次性注册到 typeRegistry。
 * 在编辑器启动时调用一次即可。
 */
/** 将 VFX 属性定义转为 Inspector FPropertyDescriptor（自动解析枚举类型如 space） */
function resolveProps(props: IEditor.FPropertyDescriptor[]): IEditor.FPropertyDescriptor[] {
    return props
        .filter(p => !(p as IEditor.FPropertyDescriptor & { blockHidden?: boolean }).blockHidden)
        .map(p => {
            const enumSource = p.enumSource;
            p = {
                ...p,
                enumSource: p.type === "flags"
                    ? enumSource
                    : localizeEnumSource(enumSource) as any,
            };
            if (p.type === "space")
                return {
                    ...p,
                    type: "string",
                    enumSource: localizeEnumSource(["Local", "World", "None"]) as any,
                };
            if (p.type === "flags")
                return { ...p, type: "number", inspector: "VfxEditor.Flags" };
            if (p.type === "curve" || p.type === "Curve")
                return { ...p, type: "object", inspector: "VfxEditor.Curve" } as any;
            if (p.type === "gradient")
                return { ...p, type: "Gradient" } as any;
            if (p.type === "ShaderBlueprint") {
                return {
                    ...p,
                    type: "string",
                    inspector: "asset",
                    assetTypeFilter: "ShaderBlueprint",
                } as any;
            }
            return p;
        });
}

/**
 * 注册所有 vfx 节点类型到 IDE typeRegistry。
 * @param captionTrans 中文术语表。节点标题使用 typeId，字段和枚举使用英文显示名。
 *                     英文环境不加载该表，直接使用定义中的 title/caption。
 */
export function registerAllVfxTypes(captionTrans?: Record<string, string>): void {
    registerCaptionType(captionTrans);

    const types: Array<any> = [];
    // 图级属性
    types.push({
        name: VFX_GRAPH_TYPE_ID,
        caption: "Graph Properties",
        isEngineSymbol: true,
        captionTranslation: createCaptionTranslation(captionTrans, "Graph Properties", VFX_GRAPH_PROPERTIES),
        properties: resolveProps(VFX_GRAPH_PROPERTIES),
    });

    // AABox 值的嵌套对象类型（Center/Size 两组 vec3）。catalogBarStyle:hidden → 子属性内联平铺，
    // 不出额外折叠头，效果对齐 Unity "Axis Aligned Box" 的 Center / Size 布局。
    types.push({
        name: VFX_AABOX_VALUE_TYPE_ID,
        caption: "Axis Aligned Box",
        isEngineSymbol: true,
        catalogBarStyle: "hidden",
        captionTranslation: createCaptionTranslation(captionTrans, "Axis Aligned Box", [
            { name: "center", caption: "Center", type: "vec3", default: { x: 0, y: 0, z: 0 } },
            { name: "size", caption: "Size", type: "vec3", default: { x: 0, y: 0, z: 0 } },
        ]),
        properties: resolveProps([
            { name: "center", caption: "Center", type: "vec3", default: { x: 0, y: 0, z: 0 } },
            { name: "size", caption: "Size", type: "vec3", default: { x: 0, y: 0, z: 0 } },
        ]),
    } as any);

    for (const [name, components] of Object.entries(TYPE_COMPONENTS)) {
        if (name === "vec2" || name === "vec3" || name === "vec4" || name === "color")
            continue;
        const properties: IEditor.FPropertyDescriptor[] = components.map(component => ({
            name: component.id,
            type: component.type,
        }));
        types.push({
            name,
            isEngineSymbol: true,
            catalogBarStyle: "hidden",
            captionTranslation: createCaptionTranslation(captionTrans, name, properties),
            properties,
        });
    }

    // Event
    for (const def of VFX_EVENT_DEFS)
        types.push({
            name: getEventRegistryId(def.typeId),
            caption: def.title,
            isEngineSymbol: true,
            captionTranslation: createCaptionTranslation(captionTrans, def.typeId, def.properties),
            properties: resolveProps(def.properties ?? []),
        });

    // Context
    for (const def of VFX_CONTEXT_DEFS)
        types.push({
            name: getContextRegistryId(def.typeId),
            caption: def.title,
            // Spawn / Initialize / Update / Output 是图中的生命周期阶段标题，
            // 不是需要保留英文的 VFX 数据类型，应始终按当前语言显示。
            isEngineSymbol: false,
            captionTranslation: createCaptionTranslation(captionTrans, def.typeId, def.properties),
            properties: resolveProps(def.properties ?? []),
        });

    // Block
    for (const def of VFX_BLOCK_DEFS)
        types.push({
            name: getBlockRegistryId(def.typeId),
            caption: def.title,
            isEngineSymbol: true,
            captionTranslation: createCaptionTranslation(captionTrans, def.typeId, def.properties),
            properties: resolveProps(def.properties ?? []),
        });

    // Operator
    for (const def of VFX_OPERATOR_DEFS)
        types.push({
            name: getOperatorRegistryId(def.typeId),
            caption: def.title,
            isEngineSymbol: true,
            captionTranslation: createCaptionTranslation(captionTrans, def.typeId, def.properties),
            properties: resolveProps(def.properties ?? []),
        });

    // Property Settings
    for (const vfxType of VFX_PROPSET_TYPES) {
        const descs = buildPropSettingsDescriptors(vfxType);
        if (descs.length > 0) {
            types.push({
                name: getPropSettingsRegistryId(vfxType),
                caption: "Property Settings",
                isEngineSymbol: true,
                captionTranslation: createCaptionTranslation(captionTrans, "Property Settings", descs),
                properties: resolveProps(descs),
            });
        }
    }

    // 这些名称都属于 VFX 插件。重新注册可在插件热重载后替换旧描述，
    // 避免 captionTranslation / isEngineSymbol 等元数据继续使用缓存版本。
    Editor.typeRegistry.addTypes(types);
}

export function createCaptionTranslation(
    captions: Record<string, string> | undefined,
    typeCaptionKey: string,
    properties?: readonly IEditor.FPropertyDescriptor[],
): Record<string, string> | undefined {
    if (!captions)
        return undefined;
    const translation: Record<string, string> = {};
    const typeCaption = captions[typeCaptionKey] ?? captions[splitIdentifier(typeCaptionKey)];
    if (typeCaption)
        translation["#"] = typeCaption;
    for (const property of properties ?? []) {
        const captionKey = property.caption ?? splitIdentifier(property.name);
        const translated = captions[captionKey];
        if (translated)
            translation[property.name] = translated;
    }
    return Object.keys(translation).length > 0 ? translation : undefined;
}

export function getVfxCaption(value: string, forceLocalize = false): string {
    const type = Editor.typeRegistry.types[VFX_CAPTIONS_TYPE_ID];
    if (!type)
        return value;
    const split = splitIdentifier(value);
    const translation = type.captionTranslation as Record<string, string> | undefined;
    const propertyName = translation?.[value] ? value : split;
    return Editor.typeRegistry.getPropCaption(type, {
        name: propertyName,
        caption: split,
    } as IEditor.FPropertyDescriptor, undefined, forceLocalize ? false : undefined);
}

export function getVfxTypeCaption(typeName: string, fallback: string): string {
    const type = Editor.typeRegistry.types[typeName];
    return type ? Editor.typeRegistry.getTypeCaption(type) : fallback;
}

function registerCaptionType(captions?: Record<string, string>): void {
    if (Editor.typeRegistry.types[VFX_CAPTIONS_TYPE_ID])
        return;
    const captionTranslation: Record<string, string> = {};
    for (const [key, value] of Object.entries(captions ?? {})) {
        if (!key.startsWith("_"))
            captionTranslation[key] = value;
    }
    Editor.typeRegistry.addTypes([{
        name: VFX_CAPTIONS_TYPE_ID,
        isEngineSymbol: true,
        captionTranslation,
        properties: [],
    }]);
}

function localizeEnumSource(source: unknown): unknown {
    if (!Array.isArray(source))
        return source;
    return source.map(item => typeof item === "string"
        ? { name: getVfxCaption(item), value: item }
        : item);
}

function splitIdentifier(value: string): string {
    return value
        .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
        .replace(/^./, char => char.toUpperCase());
}
