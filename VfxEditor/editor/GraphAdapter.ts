import {
    getContextDef,
    getContextRegistryId,
    getBlockDef,
    getEventDef,
    getEventRegistryId,
    getOperatorDef,
    getOperatorRegistryId,
    getVfxCaption,
    getVfxTypeCaption,
} from "./data/NodeDefinitions";
import {
    canConvertType,
    getAttributeType,
    getPropertyOutputType,
} from "./data/OperatorDefinitions";
import {
    resolveBlockInputs,
    setBlockInputValue,
} from "./BlockPorts";
import {
    buildBlockSlotId,
    normalizeBlockSlotId,
    parseBlockSlotId,
} from "./data/SlotIds";
import type {
    IVfxBlockData,
    IVfxConnectionData,
    IVfxContextData,
    IVfxEventData,
    IVfxFlowTarget,
    IVfxGraphData,
    IVfxOperatorData,
    IVfxPropertyDef,
    IVfxSlotDef,
} from "./data/Types";

export type NodeKind = "event" | "context" | "operator";
export type VfxNodeSource = IVfxEventData | IVfxContextData | IVfxOperatorData;

type GraphData = IEditor.FlowApi.GraphData;
type GraphLink = IEditor.FlowApi.GraphLink;
type GraphNode = IEditor.FlowApi.GraphNode;
type GraphPort = IEditor.FlowApi.GraphPort;

export class GraphAdapter {
    constructor(private readonly allocateId: () => number) {}

    toGraphData(
        save: IVfxGraphData,
        editorViewport?: IEditor.FlowApi.GraphViewport,
    ): GraphData {
        const connectedPorts = collectConnectedBlockPorts(save.operators ?? []);
        const nodes: GraphNode[] = [
            ...(save.events ?? []).map((source, order) =>
                sourceToGraphNode("event", source, save.properties, order)),
            ...(save.contexts ?? []).map((source, order) =>
                sourceToGraphNode(
                    "context",
                    source,
                    save.properties,
                    order,
                    connectedPorts.get(source.id),
                )),
            ...(save.operators ?? []).map((source, order) =>
                sourceToGraphNode("operator", source, save.properties, order)),
        ];
        const nodeMap = new Map(nodes.map(node => [node.id, node]));
        const links: GraphLink[] = [];

        for (const source of [...(save.events ?? []), ...(save.contexts ?? [])]) {
            for (const [portId, rawTargets] of Object.entries(source.flowLinks ?? {})) {
                const sourcePortId = normalizeBlockSlotId(portId);
                const targets = Array.isArray(rawTargets) ? rawTargets : [rawTargets];
                targets.forEach((target, index) => {
                    if (!target || !nodeMap.has(String(target.targetId)))
                        return;
                    links.push({
                        id: linkId("flow", source.id, sourcePortId, target.targetId, target.targetSlotId, index),
                        from: { node: String(source.id), port: sourcePortId },
                        to: { node: String(target.targetId), port: target.targetSlotId },
                        data: { kind: "flow" },
                    });
                });
            }
        }

        for (const source of save.operators ?? []) {
            for (const [portId, output] of Object.entries(source.output ?? {})) {
                (output?.infoArr ?? []).forEach((connection, index) => {
                    if (!nodeMap.has(String(connection.nodeId)))
                        return;
                    const targetPortId = normalizeBlockSlotId(connection.slotId);
                    links.push({
                        id: linkId("data", source.id, portId, connection.nodeId, targetPortId, index),
                        from: { node: String(source.id), port: portId },
                        to: { node: String(connection.nodeId), port: targetPortId },
                        data: { kind: "data" },
                    });
                });
            }
        }

        for (const context of save.contexts ?? []) {
            const target = nodeMap.get(String(context.id));
            if (!target)
                continue;
            const bindings = context.props?.shaderBindingLinks;
            if (!bindings || typeof bindings !== "object")
                continue;
            for (const [bindingKey, rawIds] of Object.entries(bindings)) {
                const targetPort = "shaderprop_" + bindingKey;
                if (!target.inputs.some(port => port.id === targetPort)) {
                    target.inputs.push({
                        id: targetPort,
                        kind: "in",
                        dataType: "any",
                        label: bindingKey,
                        data: { bindingKey },
                    });
                }
                const operatorIds = Array.isArray(rawIds) ? rawIds : [rawIds];
                operatorIds.forEach((operatorId, index) => {
                    const operatorNode = nodeMap.get(String(operatorId));
                    const outputPort = operatorNode?.outputs[0];
                    if (!operatorNode || !outputPort)
                        return;
                    links.push({
                        id: linkId("binding", operatorId, outputPort.id, context.id, targetPort, index),
                        from: { node: String(operatorId), port: outputPort.id },
                        to: { node: String(context.id), port: targetPort },
                        data: { kind: "binding", bindingKey },
                    });
                });
            }
        }

        return {
            nodes,
            links,
            comments: clone(save.editorData?.comments ?? []),
            viewport: IEditor.Flow.normalizeGraphViewport(
                editorViewport ?? save.editorData?.viewport,
            ),
        };
    }

    fromGraphData(data: GraphData): Pick<
        IVfxGraphData,
        "autoID" | "events" | "contexts" | "operators" | "editorData"
    > {
        const usedIds = new Set<number>();
        let maxId = 0;
        const numericNodeIds = new Map<string, number>();
        const nextId = (): number => {
            let id = this.allocateId();
            while (usedIds.has(id))
                id = this.allocateId();
            usedIds.add(id);
            maxId = Math.max(maxId, id);
            return id;
        };
        const mapNodeId = (id: string): number => {
            const existing = numericNodeIds.get(id);
            if (existing != null)
                return existing;
            const candidate = Number(id);
            const value = Number.isSafeInteger(candidate) && candidate > 0 && !usedIds.has(candidate)
                ? candidate
                : nextId();
            numericNodeIds.set(id, value);
            usedIds.add(value);
            maxId = Math.max(maxId, value);
            return value;
        };

        for (const node of data.nodes)
            mapNodeId(node.id);
        const graphNodeMap = new Map(data.nodes.map(node => [node.id, node]));

        const blockIdsByNode = new Map<string, Map<number, number>>();
        const events: Array<{ order: number; value: IVfxEventData }> = [];
        const contexts: Array<{ order: number; value: IVfxContextData }> = [];
        const operators: Array<{ order: number; value: IVfxOperatorData }> = [];

        for (const node of data.nodes) {
            const kind = nodeKind(node);
            const source = clone(node.data.source) as VfxNodeSource;
            source.id = mapNodeId(node.id);
            source.uiData = { x: Math.round(node.position.x), y: Math.round(node.position.y) };
            const order = Number(node.data.order) || 0;

            if (kind === "event") {
                const event = source as IVfxEventData;
                delete event.flowLinks;
                applyValues(event.props ??= {}, node);
                events.push({ order, value: event });
            } else if (kind === "context") {
                const context = source as IVfxContextData;
                delete context.flowLinks;
                applyValues(context.props ??= {}, node);
                delete context.props.shaderBindingLinks;
                applyBlockValues(context.blocks ?? [], node);
                const blockMap = new Map<number, number>();
                for (const block of context.blocks ?? []) {
                    const oldId = block.id;
                    const id = oldId > 0 && !usedIds.has(oldId) ? oldId : nextId();
                    usedIds.add(id);
                    maxId = Math.max(maxId, id);
                    block.id = id;
                    blockMap.set(oldId, id);
                }
                blockIdsByNode.set(node.id, blockMap);
                contexts.push({ order, value: context });
            } else {
                const operator = source as IVfxOperatorData;
                operator.output = {};
                applyValues(operator.props ??= {}, node);
                operators.push({ order, value: operator });
            }
        }

        const eventMap = new Map(events.map(item => [item.value.id, item.value]));
        const contextMap = new Map(contexts.map(item => [item.value.id, item.value]));
        const operatorMap = new Map(operators.map(item => [item.value.id, item.value]));
        const bindingMaps = new Map<number, Record<string, number[]>>();

        for (const link of data.links) {
            const fromId = numericNodeIds.get(link.from.node);
            const toId = numericNodeIds.get(link.to.node);
            if (fromId == null || toId == null)
                continue;
            const fromEvent = eventMap.get(fromId);
            const fromContext = contextMap.get(fromId);
            const fromOperator = operatorMap.get(fromId);
            const targetNode = graphNodeMap.get(link.to.node);
            if (!targetNode)
                continue;

            if (link.data?.kind === "binding" && fromOperator && contextMap.has(toId)) {
                const key = String(link.data.bindingKey ?? link.to.port.replace(/^shaderprop_/, ""));
                const map = bindingMaps.get(toId) ?? {};
                (map[key] ??= []).push(fromId);
                bindingMaps.set(toId, map);
                continue;
            }

            const fromPort = graphNodeMap
                .get(link.from.node)
                ?.outputs.find(port => port.id === link.from.port);
            const toPort = targetNode.inputs.find(port => port.id === link.to.port);
            const isFlow = link.data?.kind === "flow" || !!fromPort?.isExec || !!toPort?.isExec;
            if (isFlow && (fromEvent || fromContext)) {
                const owner = (fromEvent ?? fromContext)!;
                addFlowTarget(owner, remapBlockPort(link.from.port, blockIdsByNode.get(link.from.node)), {
                    targetId: toId,
                    targetSlotId: remapBlockPort(link.to.port, blockIdsByNode.get(link.to.node)),
                });
                continue;
            }

            if (fromOperator) {
                const connection: IVfxConnectionData = {
                    nodeId: toId,
                    slotId: remapBlockPort(link.to.port, blockIdsByNode.get(link.to.node)),
                };
                const output = (fromOperator.output ??= {});
                (output[link.from.port] ??= { infoArr: [] }).infoArr.push(connection);
            }
        }

        for (const [contextId, bindings] of bindingMaps) {
            const context = contextMap.get(contextId);
            if (!context)
                continue;
            context.props ??= {};
            const serialized: Record<string, number | number[]> = {};
            for (const [key, values] of Object.entries(bindings))
                serialized[key] = values.length === 1 ? values[0] : values;
            context.props.shaderBindingLinks = serialized;
        }

        const byOrder = <T extends { order: number }>(a: T, b: T) => a.order - b.order;
        return {
            autoID: maxId,
            events: events.sort(byOrder).map(item => item.value),
            contexts: contexts.sort(byOrder).map(item => item.value),
            operators: operators.sort(byOrder).map(item => item.value),
            editorData: data.comments.length
                ? { comments: clone(data.comments) }
                : undefined,
        };
    }
}

export function sourceToGraphNode(
    kind: NodeKind,
    source: VfxNodeSource,
    properties: IVfxPropertyDef[] = [],
    order = 0,
    connectedPortIds: ReadonlySet<string> = new Set(),
): GraphNode {
    if (kind === "event")
        return eventToNode(source as IVfxEventData, order);
    if (kind === "context")
        return contextToNode(source as IVfxContextData, order, connectedPortIds);
    return operatorToNode(source as IVfxOperatorData, properties, order);
}

export function createNodeSource(
    kind: NodeKind,
    typeId: string,
    id: number,
    position: IEditor.FlowApi.XY,
): VfxNodeSource {
    const definition = kind === "event"
        ? getEventDef(typeId)
        : kind === "context" ? getContextDef(typeId) : getOperatorDef(typeId);
    const props: Record<string, any> = {};
    for (const property of definition?.properties ?? []) {
        if (property.default != null)
            props[property.name] = clone(property.default);
    }
    const base = {
        id,
        typeId,
        uiData: { x: Math.round(position.x), y: Math.round(position.y) },
        props,
    };
    return kind === "context" ? { ...base, blocks: [] } as IVfxContextData : base as VfxNodeSource;
}

export function nodeKind(node: GraphNode): NodeKind {
    return node.data.kind as NodeKind;
}

export function canConnect(ctx: IEditor.FlowApi.ConnectionContext): boolean {
    if (ctx.fromPort.isExec || ctx.toPort.isExec)
        return !!ctx.fromPort.isExec && !!ctx.toPort.isExec;
    if (ctx.fromPort.dataType === "any" || ctx.toPort.dataType === "any")
        return true;
    return canConvertType(ctx.fromPort.dataType, ctx.toPort.dataType);
}

function eventToNode(source: IVfxEventData, order: number): GraphNode {
    const definition = getEventDef(source.typeId);
    return {
        id: String(source.id),
        typeId: "event/" + source.typeId,
        title: getVfxTypeCaption(
            getEventRegistryId(source.typeId),
            definition?.title ?? source.typeId,
        ),
        position: { ...source.uiData },
        inputs: ports(definition?.flowInputs, "in", true),
        outputs: ports(definition?.flowOutputs, "out", true),
        data: {
            kind: "event",
            source: clone(source),
            order,
            headerColor: definition?.color,
        },
    };
}

function contextToNode(
    source: IVfxContextData,
    order: number,
    connectedPortIds: ReadonlySet<string>,
): GraphNode {
    const definition = getContextDef(source.typeId);
    const inputs = ports(definition?.flowInputs, "in", true);
    const outputs = ports(definition?.flowOutputs, "out", true);
    const values: Record<string, any> = {};
    for (const block of source.blocks ?? []) {
        const blockDefinition = getBlockDef(block.typeId);
        if (!blockDefinition)
            continue;
        for (const resolved of resolveBlockInputs(block, blockDefinition, connectedPortIds)) {
            const input = resolved.definition;
            const id = buildBlockSlotId(block.id, input.id);
            inputs.push({
                ...port(input, "in", false),
                id,
                label: blockPortLabel(input.name, resolved.depth),
                data: {
                    blockId: block.id,
                    inputId: input.id,
                    property: clone(resolved.property),
                    propertyPath: clone(resolved.propertyPath),
                    inline: resolved.inline,
                    depth: resolved.depth,
                },
            });
            values[id] = clone(resolved.value);
        }
        for (const output of blockDefinition.outputs ?? []) {
            outputs.push({
                ...port(output, "out", output.type === "flow"),
                id: buildBlockSlotId(block.id, output.id),
                label: getVfxCaption(output.name),
                data: {
                    blockId: block.id,
                    outputId: output.id,
                },
            });
        }
    }
    return {
        id: String(source.id),
        typeId: "context/" + source.typeId,
        title: getVfxTypeCaption(
            getContextRegistryId(source.typeId),
            definition?.title ?? source.typeId,
        ),
        position: { ...source.uiData },
        inputs,
        outputs,
        data: {
            kind: "context",
            source: clone(source),
            order,
            values,
            headerColor: definition?.color,
        },
    };
}

function operatorToNode(
    source: IVfxOperatorData,
    properties: IVfxPropertyDef[],
    order: number,
): GraphNode {
    const definition = getOperatorDef(source.typeId);
    const registryType = getOperatorRegistryId(source.typeId);
    const values: Record<string, any> = {};
    const inputs = (definition?.inputs ?? []).map(input => {
        values[input.id] = clone(source.props?.[input.id] ?? input.default);
        return {
            ...port(input, "in", false),
            data: { property: propertyForInput(registryType, definition?.properties, input.id) },
        };
    });
    const outputs = (definition?.outputs ?? []).map(output => {
        const next = port(output, "out", false);
        if (source.typeId === "getAttribute")
            next.dataType = getAttributeType(String(source.props?.attribute ?? ""));
        if (source.typeId === "getProperty") {
            const property = properties.find(item => item.name === source.props?.property);
            if (property) {
                next.dataType = getPropertyOutputType(property.type);
                next.label = property.name;
            }
        }
        return next;
    });
    const titleSuffix = source.typeId === "getAttribute"
        ? getVfxCaption(capitalize(String(source.props?.attribute ?? "")))
        : source.typeId === "getProperty" ? source.props?.property : "";
    const title = getVfxTypeCaption(
        registryType,
        definition?.title ?? source.typeId,
    );
    const displayTitle = source.typeId === "getProperty" && titleSuffix
        ? titleSuffix
        : titleSuffix ? `${title}: ${titleSuffix}` : title;
    return {
        id: String(source.id),
        typeId: "operator/" + source.typeId,
        title: displayTitle,
        position: { ...source.uiData },
        inputs,
        outputs,
        compact: source.typeId === "getProperty",
        data: {
            kind: "operator",
            source: clone(source),
            order,
            values,
            headerColor: definition?.color,
        },
    };
}

function ports(
    definitions: IVfxSlotDef[] | undefined,
    kind: GraphPort["kind"],
    flow: boolean,
): GraphPort[] {
    return (definitions ?? []).map(definition => port(definition, kind, flow));
}

function port(
    definition: IVfxSlotDef,
    kind: GraphPort["kind"],
    flow: boolean,
): GraphPort {
    return {
        id: definition.id,
        kind,
        dataType: flow ? "flow" : definition.type,
        isExec: flow,
        multi: kind === "out",
        label: getVfxCaption(definition.name),
    };
}

function propertyForInput(
    typeName: string,
    properties: IEditor.FPropertyDescriptor[] | undefined,
    inputId: string,
): IEditor.FPropertyDescriptor | undefined {
    const type = Editor.typeRegistry.types[typeName];
    const registered = type?.properties?.find(item => item.name === inputId);
    const property = registered ?? properties?.find(item => item.name === inputId);
    if (!property)
        return undefined;
    const result = clone(property);
    if (type && registered)
        result.caption = Editor.typeRegistry.getPropCaption(type, registered);
    return result;
}

function blockPortLabel(name: string, depth: number): string {
    if (depth <= 0)
        return name;
    const separator = name.lastIndexOf(" · ");
    return separator < 0 ? name : name.slice(separator + 3);
}

function capitalize(value: string): string {
    return value ? value.charAt(0).toUpperCase() + value.slice(1) : value;
}

function applyValues(props: Record<string, any>, node: GraphNode): void {
    for (const [key, value] of Object.entries(node.data.values ?? {})) {
        if (!parseBlockSlotId(key) && !key.startsWith("shaderprop_"))
            props[key] = clone(value);
    }
}

function applyBlockValues(blocks: IVfxBlockData[], node: GraphNode): void {
    const byId = new Map(blocks.map(block => [block.id, block]));
    const inputs = new Map(node.inputs.map(input => [input.id, input]));
    for (const [key, value] of Object.entries(node.data.values ?? {})) {
        const parsed = parseBlockSlotId(key);
        if (!parsed)
            continue;
        const block = byId.get(parsed.blockId);
        if (!block)
            continue;
        const propertyPath = inputs.get(key)?.data?.propertyPath as string[] | undefined;
        setBlockInputValue(block, parsed.inputId, value, propertyPath);
    }
}

function collectConnectedBlockPorts(
    operators: IVfxOperatorData[],
): Map<number, Set<string>> {
    const result = new Map<number, Set<string>>();
    for (const operator of operators) {
        for (const output of Object.values(operator.output ?? {})) {
            for (const connection of output.infoArr ?? []) {
                if (!parseBlockSlotId(connection.slotId))
                    continue;
                const ports = result.get(connection.nodeId) ?? new Set<string>();
                ports.add(normalizeBlockSlotId(connection.slotId));
                result.set(connection.nodeId, ports);
            }
        }
    }
    return result;
}

function addFlowTarget(
    source: IVfxEventData | IVfxContextData,
    portId: string,
    target: IVfxFlowTarget,
): void {
    const links = (source.flowLinks ??= {});
    const current = links[portId];
    if (!current) {
        links[portId] = target;
    } else if (Array.isArray(current)) {
        current.push(target);
    } else {
        links[portId] = [current, target];
    }
}

function remapBlockPort(portId: string, idMap?: Map<number, number>): string {
    const parsed = parseBlockSlotId(portId);
    if (!parsed || !idMap)
        return portId;
    const blockId = idMap.get(parsed.blockId);
    return blockId == null ? portId : buildBlockSlotId(blockId, parsed.inputId);
}

function linkId(
    kind: string,
    fromNode: number,
    fromPort: string,
    toNode: number,
    toPort: string,
    index: number,
): string {
    return `${kind}:${fromNode}:${fromPort}->${toNode}:${toPort}:${index}`;
}

function clone<T>(value: T): T {
    if (value == null || typeof value !== "object")
        return value;
    return JSON.parse(JSON.stringify(value));
}
