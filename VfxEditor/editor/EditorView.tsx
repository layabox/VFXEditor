import * as React from "react";
import { useCallback, useMemo, useSyncExternalStore } from "react";
import { editorController } from "./Controller";
import { ContextBody } from "./ContextBody";
import { t } from "./I18n";
import {
    LeftPanel,
    VFX_PROPERTY_DRAG_MIME,
    type VfxPropertyDragItem,
} from "./LeftPanel";
import { canConnect } from "./NodeRegistry";
import { renderPortInput } from "./PortInput";

const PORT_COLORS = {
    flow: "#FFFFFF",
    number: "#9EFB44",
    integer: "#1DE0AC",
    boolean: "#5FD3BC",
    vector2: "#7AD1FF",
    vector3: "#FDC086",
    vector4: "#FFD45E",
    color: "#E077A4",
    gradient: "#C792EA",
    curve: "#B5784A",
    texture: "#F0883E",
    mesh: "#60A5FA",
    box: "#4FC3D9",
    buffer: "#8B5CF6",
    transform: "#9AA0A6",
    other: "#CCCCCC",
} as const;

const PORT_TYPES: IEditor.FlowApi.PortTypeInfo[] = [
    { key: "flow", label: "Flow", color: PORT_COLORS.flow },
    { key: "float", label: "Float", color: PORT_COLORS.number },
    { key: "number", label: "Number", color: PORT_COLORS.number },
    { key: "int", label: "Int", color: PORT_COLORS.integer },
    { key: "uint", label: "UInt", color: PORT_COLORS.integer },
    { key: "bool", label: "Bool", color: PORT_COLORS.boolean },
    { key: "boolean", label: "Bool", color: PORT_COLORS.boolean },
    { key: "string", label: "String", color: PORT_COLORS.other },
    { key: "vec2", label: "Vector2", color: PORT_COLORS.vector2 },
    { key: "vec3", label: "Vector3", color: PORT_COLORS.vector3 },
    { key: "vec4", label: "Vector4", color: PORT_COLORS.vector4 },
    { key: "position", label: "Position", color: PORT_COLORS.vector3 },
    { key: "direction", label: "Direction", color: PORT_COLORS.vector3 },
    { key: "vector", label: "Vector", color: PORT_COLORS.vector3 },
    { key: "color", label: "Color", color: PORT_COLORS.color },
    { key: "Curve", label: "Curve", color: PORT_COLORS.curve },
    { key: "curve", label: "Curve", color: PORT_COLORS.curve },
    { key: "Gradient", label: "Gradient", color: PORT_COLORS.gradient },
    { key: "gradient", label: "Gradient", color: PORT_COLORS.gradient },
    { key: "transform", label: "Transform", color: PORT_COLORS.transform },
    { key: "camera", label: "Camera", color: PORT_COLORS.transform },
    { key: "aaBox", label: "AABox", color: PORT_COLORS.box },
    { key: "AABox", label: "AABox", color: PORT_COLORS.box },
    { key: "Texture2D", label: "Texture2D", color: PORT_COLORS.texture },
    { key: "Texture3D", label: "Texture3D", color: PORT_COLORS.texture },
    { key: "TextureCube", label: "TextureCube", color: PORT_COLORS.texture },
    { key: "Texture2DArray", label: "Texture2DArray", color: PORT_COLORS.texture },
    { key: "Mesh", label: "Mesh", color: PORT_COLORS.mesh },
    { key: "GraphicsBuffer", label: "GraphicsBuffer", color: PORT_COLORS.buffer },
    { key: "sphere", label: "Sphere", color: PORT_COLORS.other },
    { key: "arcSphere", label: "Arc Sphere", color: PORT_COLORS.other },
    { key: "plane", label: "Plane", color: PORT_COLORS.other },
    { key: "orientedBox", label: "Oriented Box", color: PORT_COLORS.other },
    { key: "cone", label: "Cone", color: PORT_COLORS.other },
    { key: "arcCone", label: "Arc Cone", color: PORT_COLORS.other },
    { key: "torus", label: "Torus", color: PORT_COLORS.other },
    { key: "arcTorus", label: "Arc Torus", color: PORT_COLORS.other },
    { key: "circle", label: "Circle", color: PORT_COLORS.other },
    { key: "arcCircle", label: "Arc Circle", color: PORT_COLORS.other },
    { key: "line", label: "Line", color: PORT_COLORS.other },
    { key: "flags", label: "Flags", color: PORT_COLORS.other },
    { key: "object", label: "Object", color: PORT_COLORS.other },
    { key: "space", label: "Space", color: PORT_COLORS.other },
    { key: "Material", label: "Material", color: PORT_COLORS.other },
    { key: "ShaderBlueprint", label: "ShaderBlueprint", color: PORT_COLORS.other },
    { key: "any", label: "Any", color: PORT_COLORS.other },
];

export function EditorView(): React.ReactElement {
    useSyncExternalStore(editorController.subscribe, editorController.getSnapshot);
    const portTypes = useMemo(() => new IEditor.Flow.PortTypeRegistry(PORT_TYPES), []);
    const document = editorController.active;
    const onSelectionChange = useCallback((ids: string[]) => {
        editorController.active?.setSelectedNodeIds(ids);
        editorController.setHistoryScope("graph");
    }, []);
    const onCanvasDrop = useCallback((info: IEditor.FlowApi.CanvasDropInfo) => {
        if (!document)
            return;
        const data = info.dataTransfer.getData(VFX_PROPERTY_DRAG_MIME)
            || info.dataTransfer.getData("text/plain");
        if (!data)
            return;
        let item: VfxPropertyDragItem;
        try {
            item = JSON.parse(data) as VfxPropertyDragItem;
        } catch {
            return;
        }
        if (
            item.kind !== "vfx-property"
            || item.assetId !== document.assetId
            || typeof item.name !== "string"
        )
            return;
        editorController.setHistoryScope("graph");
        document.addPropertyNode(item.name, info.flow);
    }, [document]);
    const FileTabBarView = IEditor.React.FileTabBarView;

    return (
        <div className="vfx-editor">
            <div className="vfx-file-tabs">
                <FileTabBarView
                    tabBar={editorController.tabBar}
                    variant="light"
                    showSaveButtons
                />
            </div>
            {!document ? (
                <div className="vfx-empty-document">
                    <span>{t("emptyDocument")}</span>
                </div>
            ) : (
                <div className="vfx-workspace">
                    <aside className="vfx-left-host" style={{ width: editorController.leftWidth }}>
                        <LeftPanel document={document} />
                    </aside>
                    <IEditor.React.ResizeHandle
                        orientation="vertical"
                        className="vfx-workspace-resize"
                        ariaLabel={t("resizeBlackboard")}
                        value={editorController.leftWidth}
                        min={220}
                        max={560}
                        onResize={value => editorController.setLeftWidth(value)}
                        onReset={() => editorController.setLeftWidth(320)}
                    />
                    <main
                        className="vfx-stage"
                        onPointerDownCapture={() => editorController.setHistoryScope("graph")}
                        onFocusCapture={() => editorController.setHistoryScope("graph")}
                    >
                        <IEditor.Flow.GraphEditor
                            key={document.assetId}
                            store={document.graphStore}
                            registry={document.registry}
                            portTypes={portTypes}
                            canConnect={canConnect}
                            bodyRenderers={{ context: ContextBody }}
                            renderPortInput={renderPortInput}
                            onInputValueChange={(_store, node, port) => document.applyInlineValue(node.id, port.id)}
                            onConnectionChange={(_store, link) => document.handleConnectionChange(link)}
                            onCanvasDrop={onCanvasDrop}
                            directAddNodeMenuOnCanvasContextMenu
                            initialSelectedNodeIds={document.selectedNodeIds}
                            onNodeSelectionChange={onSelectionChange}
                            historyHotkeys={false}
                        />
                    </main>
                </div>
            )}
        </div>
    );
}
