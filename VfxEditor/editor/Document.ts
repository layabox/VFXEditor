import fs from "fs";
import {
    getBlockDef,
    getContextRegistryId,
    getEventRegistryId,
    getOperatorRegistryId,
    VFX_GRAPH_PROPERTIES,
} from "./data/NodeDefinitions";
import { buildBlockSlotId, parseBlockSlotId } from "./data/SlotIds";
import {
    demoteAABoxType,
    promoteAABoxType,
    propDefaultToIDE,
    propDefaultToRuntime,
} from "./data/ValueBridge";
import type {
    IVfxBlockData,
    IVfxContextData,
    IVfxGraphData,
    IVfxPropertyDef,
} from "./data/Types";
import {
    GraphAdapter,
    nodeKind,
    sourceToGraphNode,
} from "./GraphAdapter";
import {
    closeEditorInfo,
    getGraphViewport,
    openEditorInfo,
    setGraphViewport,
} from "./EditorInfo";
import { setBlockInputValue } from "./BlockPorts";
import { createNodeRegistry, getPropertyNodeTypeId } from "./NodeRegistry";

interface DocumentMeta {
    autoID: number;
    props: Record<string, any>;
    properties: IVfxPropertyDef[];
    customAttributes: IVfxGraphData["customAttributes"];
}

const PROPERTY_TYPES = [
    { label: "Float", type: "number", default: 0 },
    { label: "Int", type: "int", default: 0 },
    { label: "Bool", type: "bool", default: false },
    { label: "Vector2", type: "vec2", default: { x: 0, y: 0 } },
    { label: "Vector3", type: "vec3", default: { x: 0, y: 0, z: 0 } },
    { label: "Vector4", type: "vec4", default: { x: 0, y: 0, z: 0, w: 0 } },
    { label: "Color", type: "color", default: { r: 1, g: 1, b: 1, a: 1 } },
    {
        label: "Gradient",
        type: "Gradient",
        default: {
            stops: [
                { t: 0, color: { r: 1, g: 1, b: 1, a: 1 } },
                { t: 1, color: { r: 1, g: 1, b: 1, a: 0 } },
            ],
        },
    },
    { label: "Curve", type: "Curve", default: { frames: [] } },
    { label: "Texture2D", type: "Texture2D", default: null as any },
    { label: "Mesh", type: "Mesh", default: null as any },
    {
        label: "Axis Aligned Box",
        type: "AABox",
        default: { center: { x: 0, y: 0, z: 0 }, size: { x: 1, y: 1, z: 1 } },
    },
] as const;

export type PropertyTypeOption = typeof PROPERTY_TYPES[number];
export const propertyTypeOptions: readonly PropertyTypeOption[] = PROPERTY_TYPES;

export class VfxDocument {
    readonly assetId: string;
    readonly filePath: string;
    readonly fileName: string;
    readonly graphStore: IEditor.FlowApi.GraphStore;
    readonly metaStore: IEditor.FlowApi.DocStore<DocumentMeta>;
    readonly registry: IEditor.FlowApi.MutableNodeRegistry;
    readonly adapter: GraphAdapter;

    selectedNodeIds: string[] = [];
    onChange: (() => void) | null = null;
    onModifiedChange: (() => void) | null = null;

    private _modified = false;
    private _disposed = false;
    private _normalizingProps = false;
    private _lastProps: Record<string, any>;
    private readonly _graphVersionTracker: IEditor.IVersionTracker;
    private readonly _metaVersionTracker: IEditor.IVersionTracker;
    private readonly _unsubscribers: Array<() => void> = [];

    private constructor(
        asset: IEditor.IAssetInfo,
        data: IVfxGraphData,
        viewport: IEditor.FlowApi.GraphViewport,
    ) {
        this.assetId = asset.id;
        this.filePath = Editor.assetDb.getFullPath(asset);
        this.fileName = asset.name;
        ensureGraphData(data);

        this._graphVersionTracker = this.createVersionTracker();
        this._metaVersionTracker = this.createVersionTracker();
        this.adapter = new GraphAdapter(() => this.allocateId());
        this.metaStore = IEditor.Flow.createDocStore<DocumentMeta>({
            autoID: data.autoID,
            props: clone(data.props ?? {}),
            properties: clone(data.properties ?? []),
            customAttributes: clone(data.customAttributes ?? []),
        }, this._metaVersionTracker);
        this.graphStore = IEditor.Flow.createGraphStore(
            this.adapter.toGraphData(data, viewport),
            this._graphVersionTracker,
        );
        this.registry = createNodeRegistry(this);
        this._lastProps = clone(this.metaStore.data.props);

        this._unsubscribers.push(
            this.graphStore.subscribe(() => {
                if (this.graphStore.transientViewportChange) {
                    setGraphViewport(this.assetId, this.graphStore.data.viewport);
                    return;
                }
                this.onChange?.();
            }),
            this.metaStore.subscribe(() => {
                this.normalizeLinkedGraphProperties();
                this.onChange?.();
            }),
        );
    }

    static async open(assetId: string): Promise<VfxDocument | null> {
        const asset = await Editor.assetDb.getAsset(assetId);
        if (!asset)
            return null;

        let data: IVfxGraphData;
        try {
            const content = await fs.promises.readFile(Editor.assetDb.getFullPath(asset), "utf8");
            data = JSON.parse(content);
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code === "ENOENT")
                return null;
            console.warn("[VfxEditor] failed to read graph, opening an empty document:", error);
            data = emptyGraphData();
        }
        ensureGraphData(data);
        migrateGraphData(data);
        for (const property of data.properties ?? []) {
            promoteAABoxType(property);
            property.default = propDefaultToIDE(property.type, property.default);
        }
        await openEditorInfo(assetId);
        try {
            return new VfxDocument(
                asset,
                data,
                getGraphViewport(assetId, data.editorData?.viewport),
            );
        } catch (error) {
            closeEditorInfo(assetId);
            throw error;
        }
    }

    get modified(): boolean {
        return this._modified;
    }

    get properties(): IVfxPropertyDef[] {
        return this.metaStore.data.properties;
    }

    get graphProps(): Record<string, any> {
        return this.metaStore.data.props;
    }

    allocateId(): number {
        this.metaStore.data.autoID++;
        return this.metaStore.data.autoID;
    }

    setSelectedNodeIds(ids: string[]): void {
        this.selectedNodeIds = ids.slice();
        this.onChange?.();
    }

    selectedNode(): IEditor.FlowApi.GraphNode | null {
        return this.selectedNodeIds.length === 1
            ? this.graphStore.data.nodes.find(node => node.id === this.selectedNodeIds[0]) ?? null
            : null;
    }

    addProperty(option: PropertyTypeOption): IVfxPropertyDef {
        const names = new Set(this.properties.map(property => property.name));
        let name = "NewProperty";
        for (let index = 1; names.has(name); index++)
            name = `NewProperty${index}`;
        const property: IVfxPropertyDef = {
            name,
            type: option.type,
            default: propDefaultToIDE(option.type, clone(option.default)),
            exposed: true,
            mode: option.type === "number" || option.type === "int" ? "Default" : undefined,
        };
        this.properties.push(property);
        return this.properties[this.properties.length - 1];
    }

    renameProperty(index: number, nextName: string): boolean {
        const property = this.properties[index];
        const name = nextName.trim();
        if (!property || !name || this.properties.some((item, itemIndex) => itemIndex !== index && item.name === name))
            return false;
        const previous = property.name;
        property.name = name;
        for (const node of this.graphStore.data.nodes) {
            if (nodeKind(node) !== "operator")
                continue;
            const source = node.data.source;
            if (source?.typeId === "getProperty" && source.props?.property === previous) {
                source.props.property = name;
                this.refreshNode(node.id);
            }
        }
        return true;
    }

    reconcilePropertyName(property: IVfxPropertyDef, previousName: string): boolean {
        const name = String(property.name ?? "").trim();
        if (!name || this.properties.some(item => item !== property && item.name === name)) {
            property.name = previousName;
            return false;
        }
        property.name = name;
        if (name === previousName)
            return true;
        for (const node of this.graphStore.data.nodes) {
            if (nodeKind(node) !== "operator")
                continue;
            const source = node.data.source;
            if (source?.typeId === "getProperty" && source.props?.property === previousName) {
                source.props.property = name;
                this.refreshNode(node.id);
            }
        }
        return true;
    }

    removeProperty(index: number): void {
        const property = this.properties[index];
        if (!property)
            return;
        const removeIds = this.graphStore.data.nodes
            .filter(node =>
                nodeKind(node) === "operator"
                && node.data.source?.typeId === "getProperty"
                && node.data.source?.props?.property === property.name)
            .map(node => node.id);
        if (removeIds.length)
            IEditor.Flow.commands.removeNodes(this.graphStore, removeIds);
        this.properties.splice(index, 1);
    }

    addPropertyNode(
        propertyName: string,
        position: IEditor.FlowApi.XY,
    ): string | undefined {
        const node = this.registry.createNode(
            getPropertyNodeTypeId(propertyName),
            position,
        );
        if (!node)
            return undefined;
        return IEditor.Flow.commands.addNode(this.graphStore, node);
    }

    addBlock(contextNodeId: string, typeId: string): void {
        const node = this.graphStore.data.nodes.find(item => item.id === contextNodeId);
        const context = node?.data.source as IVfxContextData | undefined;
        const definition = getBlockDef(typeId);
        if (!node || nodeKind(node) !== "context" || !context || !definition)
            return;
        const props: Record<string, any> = {};
        for (const property of definition.properties ?? []) {
            if (property.default != null)
                props[property.name] = clone(property.default);
        }
        const block: IVfxBlockData = {
            id: this.allocateId(),
            typeId,
            enabled: true,
            props,
        };
        (context.blocks ??= []).push(block);
        this.refreshNode(contextNodeId);
    }

    removeBlock(contextNodeId: string, blockId: number): void {
        const node = this.graphStore.data.nodes.find(item => item.id === contextNodeId);
        const context = node?.data.source as IVfxContextData | undefined;
        if (!node || nodeKind(node) !== "context" || !context)
            return;
        const index = context.blocks.findIndex(block => block.id === blockId);
        if (index < 0)
            return;
        for (const link of this.graphStore.data.links.slice()) {
            const parsed = link.to.node === contextNodeId ? parseBlockSlotId(link.to.port) : null;
            if (parsed?.blockId === blockId)
                IEditor.Flow.commands.removeLink(this.graphStore, link.id);
        }
        context.blocks.splice(index, 1);
        this.refreshNode(contextNodeId);
    }

    moveBlock(contextNodeId: string, blockId: number, offset: -1 | 1): void {
        const node = this.graphStore.data.nodes.find(item => item.id === contextNodeId);
        const context = node?.data.source as IVfxContextData | undefined;
        if (!context)
            return;
        const index = context.blocks.findIndex(block => block.id === blockId);
        const next = index + offset;
        if (index < 0 || next < 0 || next >= context.blocks.length)
            return;
        const [block] = context.blocks.splice(index, 1);
        context.blocks.splice(next, 0, block);
        this.refreshNode(contextNodeId);
    }

    pasteBlock(
        contextNodeId: string,
        afterBlockId: number,
        source: Pick<IVfxBlockData, "typeId" | "enabled" | "props">,
    ): void {
        const node = this.graphStore.data.nodes.find(item => item.id === contextNodeId);
        const context = node?.data.source as IVfxContextData | undefined;
        const definition = getBlockDef(source.typeId);
        if (!node || nodeKind(node) !== "context" || !context || !definition)
            return;
        if (!definition.affinity.includes(context.typeId))
            return;
        const index = context.blocks.findIndex(block => block.id === afterBlockId);
        if (index < 0)
            return;
        context.blocks.splice(index + 1, 0, {
            id: this.allocateId(),
            typeId: source.typeId,
            enabled: source.enabled !== false,
            props: clone(source.props ?? {}),
        });
        this.refreshNode(contextNodeId);
    }

    setBlockEnabled(contextNodeId: string, blockId: number, enabled: boolean): void {
        const node = this.graphStore.data.nodes.find(item => item.id === contextNodeId);
        const context = node?.data.source as IVfxContextData | undefined;
        const block = context?.blocks.find(item => item.id === blockId);
        if (block) {
            block.enabled = enabled;
            this.refreshNode(contextNodeId);
        }
    }

    setBlockProperty(contextNodeId: string, blockId: number, name: string, value: any): void {
        const node = this.graphStore.data.nodes.find(item => item.id === contextNodeId);
        const context = node?.data.source as IVfxContextData | undefined;
        const block = context?.blocks.find(item => item.id === blockId);
        if (!block)
            return;
        const props = block.props ??= {};
        props[name] = clone(value);
        if (name === "attribute") {
            delete props._expanded;
            delete props._expandedB;
        }
        this.refreshNode(contextNodeId);
    }

    applyInlineValue(nodeId: string, portId: string): void {
        const node = this.graphStore.data.nodes.find(item => item.id === nodeId);
        if (!node)
            return;
        const value = clone(node.data.values?.[portId]);
        const source = node.data.source;
        const blockPort = parseBlockSlotId(portId);
        if (blockPort && nodeKind(node) === "context") {
            const block = (source as IVfxContextData).blocks.find(item => item.id === blockPort.blockId);
            if (block) {
                const propertyPath = node.inputs.find(input => input.id === portId)
                    ?.data?.propertyPath as string[] | undefined;
                setBlockInputValue(block, blockPort.inputId, value, propertyPath);
                this.refreshNode(nodeId);
            }
        } else if (!portId.startsWith("shaderprop_")) {
            (source.props ??= {})[portId] = value;
        }
    }

    handleConnectionChange(link: IEditor.FlowApi.GraphLink): void {
        if (parseBlockSlotId(link.to.port))
            this.refreshNode(link.to.node);
    }

    refreshNode(nodeId: string): void {
        this.graphStore.silent(() => {
            const node = this.graphStore.data.nodes.find(item => item.id === nodeId);
            if (!node)
                return;
            this.rebuildNode(node);
        }, true);
    }

    typeIdForNode(node: IEditor.FlowApi.GraphNode): string | null {
        const source = node.data.source;
        if (!source)
            return null;
        switch (nodeKind(node)) {
            case "event": return getEventRegistryId(source.typeId);
            case "context": return getContextRegistryId(source.typeId);
            case "operator": return getOperatorRegistryId(source.typeId);
        }
    }

    undo(scope: "graph" | "meta"): void {
        if (scope === "meta") {
            this.metaStore.undo();
            return;
        }
        this.graphStore.undo();
        this.refreshAllNodes();
    }

    redo(scope: "graph" | "meta"): void {
        if (scope === "meta") {
            this.metaStore.redo();
            return;
        }
        this.graphStore.redo();
        this.refreshAllNodes();
    }

    async save(): Promise<boolean> {
        const graph = this.adapter.fromGraphData(this.graphStore.data);
        const data: IVfxGraphData = {
            ...graph,
            autoID: Math.max(graph.autoID, this.metaStore.data.autoID),
            props: clone(this.metaStore.data.props),
            properties: clone(this.metaStore.data.properties),
            customAttributes: clone(this.metaStore.data.customAttributes ?? []),
        };
        for (const property of data.properties ?? []) {
            property.default = propDefaultToRuntime(property.type, property.default);
            demoteAABoxType(property);
        }
        try {
            await fs.promises.writeFile(this.filePath, JSON.stringify(data, null, 2), "utf8");
        } catch (error) {
            console.error(`[VfxEditor] failed to save ${this.filePath}:`, error);
            return false;
        }
        this._graphVersionTracker.savePoint++;
        this._graphVersionTracker.isModified = false;
        this._metaVersionTracker.savePoint++;
        this._metaVersionTracker.isModified = false;
        this.updateModified();
        return true;
    }

    dispose(): void {
        if (this._disposed)
            return;
        this._disposed = true;
        for (const unsubscribe of this._unsubscribers)
            unsubscribe();
        this.graphStore.dispose();
        this.metaStore.dispose();
        closeEditorInfo(this.assetId);
        this.onChange = null;
        this.onModifiedChange = null;
    }

    private createVersionTracker(): IEditor.IVersionTracker {
        const tracker: IEditor.IVersionTracker = {
            savePoint: 0,
            isModified: false,
            setModified: value => {
                tracker.isModified = value;
                this.updateModified();
            },
        };
        return tracker;
    }

    private refreshAllNodes(): void {
        this.graphStore.silent(() => {
            for (const node of this.graphStore.data.nodes)
                this.rebuildNode(node);
        }, true);
    }

    private rebuildNode(node: IEditor.FlowApi.GraphNode): void {
        const shaderPorts = node.inputs.filter(port => port.id.startsWith("shaderprop_"));
        const connectedPortIds = new Set(
            this.graphStore.data.links
                .filter(link => link.to.node === node.id && parseBlockSlotId(link.to.port))
                .map(link => link.to.port),
        );
        const next = sourceToGraphNode(
            nodeKind(node),
            node.data.source,
            this.properties,
            Number(node.data.order) || 0,
            connectedPortIds,
        );
        node.typeId = next.typeId;
        node.title = next.title;
        node.inputs = [...next.inputs, ...shaderPorts];
        node.outputs = next.outputs;
        node.data.headerColor = next.data.headerColor;
        node.data.values = next.data.values ?? {};
    }

    private updateModified(): void {
        const value = this._graphVersionTracker.isModified || this._metaVersionTracker.isModified;
        if (this._modified === value)
            return;
        this._modified = value;
        this.onModifiedChange?.();
    }

    private normalizeLinkedGraphProperties(): void {
        if (this._normalizingProps)
            return;
        const props = this.metaStore.data.props;
        const previous = this._lastProps;
        this._normalizingProps = true;
        try {
            if (props.preWarmTotalTime !== previous.preWarmTotalTime) {
                if (props.preWarmTotalTime && !props.preWarmStepCount)
                    props.preWarmStepCount = 1;
                props.preWarmDeltaTime = props.preWarmStepCount > 0
                    ? props.preWarmTotalTime / props.preWarmStepCount
                    : 0;
            } else if (props.preWarmStepCount !== previous.preWarmStepCount) {
                props.preWarmDeltaTime = props.preWarmStepCount > 0
                    ? props.preWarmTotalTime / props.preWarmStepCount
                    : 0;
            } else if (props.preWarmDeltaTime !== previous.preWarmDeltaTime) {
                props.preWarmTotalTime = (props.preWarmStepCount || 0) * (props.preWarmDeltaTime || 0);
            }
            this._lastProps = clone(props);
        } finally {
            this._normalizingProps = false;
        }
    }
}

function emptyGraphData(): IVfxGraphData {
    return { autoID: 0, events: [], contexts: [], operators: [], props: {}, properties: [] };
}

function ensureGraphData(data: IVfxGraphData): void {
    data.autoID = Number(data.autoID) || 0;
    data.events ??= [];
    data.contexts ??= [];
    data.operators ??= [];
    data.properties ??= [];
    data.customAttributes ??= [];
    data.props ??= {};
    for (const event of data.events)
        event.props ??= {};
    for (const context of data.contexts) {
        context.props ??= {};
        context.blocks ??= [];
        for (const block of context.blocks)
            block.props ??= {};
    }
    for (const operator of data.operators)
        operator.props ??= {};
    for (const property of VFX_GRAPH_PROPERTIES) {
        if (data.props[property.name] == null && property.default != null)
            data.props[property.name] = clone(property.default);
    }
}

function migrateGraphData(data: IVfxGraphData): void {
    for (const operator of data.operators) {
        if (operator.typeId === "inlineSphere" && operator.props) {
            if ("space" in operator.props && !("_space" in operator.props))
                operator.props._space = operator.props.space;
            delete operator.props.space;
        }
    }
    for (const context of data.contexts) {
        for (const block of context.blocks ?? []) {
            const sphere = block.typeId === "setPositionShape"
                ? block.props?.arcSphere?.sphere
                : null;
            if (sphere && "space" in sphere)
                delete sphere.space;
        }
    }
}

function clone<T>(value: T): T {
    if (value == null || typeof value !== "object")
        return value;
    return JSON.parse(JSON.stringify(value));
}
