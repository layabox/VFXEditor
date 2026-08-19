import * as React from "react";
import { editorController } from "./Controller";
import type { VfxDocument } from "./Document";
import { t } from "./I18n";
import { TypedInspector } from "./LeftPanel";
import {
    getBlockDef,
    getBlockRegistryId,
    getBlocksForContext,
    getContextDef,
    getContextRegistryId,
    getVfxCaption,
    getVfxTypeCaption,
} from "./data/NodeDefinitions";
import {
    getAttributeSpaceable,
    VFX_SETTABLE_ATTRIBUTES,
} from "./data/OperatorDefinitions";
import type {
    IVfxBlockData,
    IVfxBlockTypeDef,
    IVfxContextData,
} from "./data/Types";

const BLOCK_CLIPBOARD_KIND = "Layabox.VfxEditor.Block";
const ADD_BLOCK_MENU_ID = "VfxEditor.Block.Add";
const BLOCK_MENU_ID = "VfxEditor.Block.Item";
const SET_ATTRIBUTE_MENU_ID = "VfxEditor.Block.SetAttribute";

export function ContextBody(props: IEditor.IFlow.NodeBodyProps): React.ReactElement {
    const document = editorController.active;
    const context = props.node.data.source as IVfxContextData;
    const blocks = context?.blocks ?? [];
    const contextData = context.props ?? (context.props = {});
    const contextProperties = getContextDef(context.typeId)?.properties
        ?.filter(property => !(property as IEditor.FPropertyDescriptor & { blockHidden?: boolean }).blockHidden)
        ?? [];
    const contextNode = filterNodePorts(props.node, port => port.data?.blockId === undefined);
    const [collapsedBlocks, setCollapsedBlocks] = React.useState<ReadonlySet<number>>(
        () => new Set(),
    );
    const [portCollapseOverrides, setPortCollapseOverrides] = React.useState<
        ReadonlyMap<string, boolean>
    >(
        () => new Map(),
    );

    const addBlock = (event: React.MouseEvent<HTMLButtonElement>) => {
        if (!document)
            return;
        const items = createBlockMenuItems(
            getBlocksForContext(context.typeId),
            definition => document.addBlock(props.node.id, definition.typeId),
        );
        const menu = IEditor.Menu.getById(ADD_BLOCK_MENU_ID) ?? IEditor.Menu.create(ADD_BLOCK_MENU_ID);
        menu.setItems(items);
        menu.show(null, {
            x: event.clientX,
            y: event.clientY,
        });
    };

    return (
        <>
            <IEditor.Flow.DefaultNodeBody {...props} node={contextNode} />
            {contextProperties.length > 0 && (
                <div className="vfx-context-properties nodrag">
                    <TypedInspector
                        data={contextData}
                        type={getContextRegistryId(context.typeId)}
                        historyScope="graph"
                        onChange={() => document?.refreshNode(props.node.id)}
                    />
                </div>
            )}
            <div className="vfx-context-blocks nodrag">
                {blocks.map((block, index) => {
                    const blockNode = filterNodePorts(
                        props.node,
                        port => port.data?.blockId === block.id,
                    );
                    const blockCollapsed = collapsedBlocks.has(block.id);
                    return (
                        <div
                            className="vfx-context-block inspector-field"
                            data-kind="catalog"
                            key={block.id}
                        >
                            <div
                                className="vfx-context-block-title inspector-row inspector-row-component-catalog"
                                onClick={() => setCollapsedBlocks(current =>
                                    toggleSetValue(current, block.id))}
                            >
                                <button
                                    type="button"
                                    className="icon inspector-collapse-button"
                                    data-expanded={!blockCollapsed ? "true" : undefined}
                                    aria-label={blockCollapsed ? t("expandBlock") : t("collapseBlock")}
                                    aria-expanded={!blockCollapsed}
                                    onPointerDown={event => event.stopPropagation()}
                                    onClick={event => {
                                        event.stopPropagation();
                                        setCollapsedBlocks(current =>
                                            toggleSetValue(current, block.id));
                                    }}
                                />
                                <input
                                    className="inspector-catalog-enabled"
                                    type="checkbox"
                                    checked={block.enabled !== false}
                                    onPointerDown={event => event.stopPropagation()}
                                    onClick={event => event.stopPropagation()}
                                    onChange={event => document?.setBlockEnabled(props.node.id, block.id, event.currentTarget.checked)}
                                />
                                <label>
                                    <span className="inspector-label-text">
                                        {getBlockDisplayTitle(block)}
                                    </span>
                                </label>
                                <div
                                    className="inspector-catalog-actions"
                                    onPointerDown={event => event.stopPropagation()}
                                    onClick={event => event.stopPropagation()}
                                >
                                    {block.typeId === "setAttribute" && (
                                        <IEditor.React.ToolButton
                                            className="icon"
                                            title={t("blockSettings")}
                                            aria-label={t("blockSettings")}
                                            onClick={event => showSetAttributeSettingsMenu(
                                                event.currentTarget,
                                                document,
                                                props.node.id,
                                                block,
                                            )}
                                        >
                                            <IEditor.React.EditorImage src="~/ui/icons/cog.svg" />
                                        </IEditor.React.ToolButton>
                                    )}
                                    <IEditor.React.ToolButton
                                        className="icon"
                                        title={t("blockMenu")}
                                        aria-label={t("blockMenu")}
                                        onClick={event => showBlockMenu(
                                            event.currentTarget,
                                            document,
                                            props.node.id,
                                            context,
                                            block,
                                            index,
                                        )}
                                    >
                                        <IEditor.React.EditorImage src="~/ui/icons/icon_menu.svg" />
                                    </IEditor.React.ToolButton>
                                </div>
                                {blockCollapsed && (
                                    <CollapsedPortProxies
                                        flowProps={props}
                                        node={blockNode}
                                    />
                                )}
                            </div>
                            {!blockCollapsed && (
                                <div className="inspector-children vfx-context-block-children">
                                    <BlockPortTree
                                        flowProps={props}
                                        node={blockNode}
                                        portCollapseOverrides={portCollapseOverrides}
                                        onToggle={(portId, collapsed) =>
                                            setPortCollapseOverrides(current =>
                                                setMapValue(current, portId, !collapsed))}
                                    />
                                </div>
                            )}
                        </div>
                    );
                })}
                <div className="vfx-context-block-add">
                    <button
                        type="button"
                        className="vfx-context-add-button"
                        onPointerDown={event => event.stopPropagation()}
                        onClick={addBlock}
                    >
                        <span aria-hidden="true">+</span>
                        <span>{t("createBlock")}</span>
                    </button>
                </div>
            </div>
        </>
    );
}

interface BlockClipboardData {
    kind: typeof BLOCK_CLIPBOARD_KIND;
    block: Pick<IVfxBlockData, "typeId" | "enabled" | "props">;
}

function createBlockMenuItems(
    definitions: readonly IVfxBlockTypeDef[],
    onSelect: (definition: IVfxBlockTypeDef) => void,
): IEditor.IMenuItem[] {
    const groups = new Map<string, IVfxBlockTypeDef[]>();
    for (const definition of definitions) {
        let group = groups.get(definition.category);
        if (!group) {
            group = [];
            groups.set(definition.category, group);
        }
        group.push(definition);
    }
    return Array.from(groups, ([category, entries]) => ({
        label: getVfxCaption(category, true),
        submenu: entries.map(definition => ({
            label: getVfxTypeCaption(
                getBlockRegistryId(definition.typeId),
                definition.title,
            ),
            click: () => onSelect(definition),
        })),
    }));
}

function showBlockMenu(
    anchor: HTMLButtonElement,
    document: VfxDocument | null,
    contextNodeId: string,
    context: IVfxContextData,
    block: IVfxBlockData,
    index: number,
): void {
    if (!document)
        return;
    const clipboard = readBlockClipboard();
    const pasteDefinition = clipboard ? getBlockDef(clipboard.block.typeId) : undefined;
    const canPaste = Boolean(pasteDefinition?.affinity.includes(context.typeId));
    const items: IEditor.IMenuItem[] = [];
    items.push(
        {
            label: t("copy"),
            click: () => copyBlockToClipboard(block),
        },
        {
            label: t("pasteBelow"),
            enabled: canPaste,
            click: () => {
                if (clipboard)
                    document.pasteBlock(contextNodeId, block.id, clipboard.block);
            },
        },
        { type: "separator" },
        {
            label: t("moveUp"),
            enabled: index > 0,
            click: () => document.moveBlock(contextNodeId, block.id, -1),
        },
        {
            label: t("moveDown"),
            enabled: index < context.blocks.length - 1,
            click: () => document.moveBlock(contextNodeId, block.id, 1),
        },
        { type: "separator" },
        {
            label: t("delete"),
            click: () => document.removeBlock(contextNodeId, block.id),
        },
    );
    const menu = IEditor.Menu.getById(BLOCK_MENU_ID) ?? IEditor.Menu.create(BLOCK_MENU_ID);
    menu.setItems(items);
    menu.show(null, IEditor.Menu.getPopupPosition(anchor));
}

function showSetAttributeSettingsMenu(
    anchor: HTMLButtonElement,
    document: VfxDocument | null,
    contextNodeId: string,
    block: IVfxBlockData,
): void {
    if (!document)
        return;
    const items = createSetAttributeMenuItems(document, contextNodeId, block);
    const menu = IEditor.Menu.getById(SET_ATTRIBUTE_MENU_ID) ?? IEditor.Menu.create(SET_ATTRIBUTE_MENU_ID);
    menu.setItems(items);
    menu.show(null, IEditor.Menu.getPopupPosition(anchor));
}

function createSetAttributeMenuItems(
    document: VfxDocument,
    contextNodeId: string,
    block: IVfxBlockData,
): IEditor.IMenuItem[] {
    const props = block.props ?? {};
    const attribute = String(props.attribute ?? "position");
    const source = String(props.source ?? "Slot");
    const composition = String(props.composition ?? "Overwrite");
    const random = String(props.random ?? "Off");
    const items: IEditor.IMenuItem[] = [
        createBlockPropertyMenu(
            `${t("attribute")}：${getVfxCaption(capitalize(attribute))}`,
            VFX_SETTABLE_ATTRIBUTES.map(item => item.name),
            attribute,
            value => document.setBlockProperty(contextNodeId, block.id, "attribute", value),
            capitalize,
        ),
        createBlockPropertyMenu(
            `${t("source")}：${getVfxCaption(source)}`,
            ["Slot", "Source"],
            source,
            value => document.setBlockProperty(contextNodeId, block.id, "source", value),
        ),
        createBlockPropertyMenu(
            `${t("composition")}：${getVfxCaption(composition)}`,
            ["Overwrite", "Add", "Multiply", "Blend"],
            composition,
            value => document.setBlockProperty(contextNodeId, block.id, "composition", value),
        ),
    ];
    if (source !== "Source") {
        items.push(createBlockPropertyMenu(
            `${t("random")}：${getVfxCaption(random)}`,
            ["Off", "Per Component", "Uniform"],
            random,
            value => document.setBlockProperty(contextNodeId, block.id, "random", value),
        ));
    }
    if (getAttributeSpaceable(attribute)) {
        const space = String(props._space ?? "Local");
        items.push(createBlockPropertyMenu(
            `${t("space")}：${getVfxCaption(space)}`,
            ["Local", "World"],
            space,
            value => document.setBlockProperty(contextNodeId, block.id, "_space", value),
        ));
    }
    return items;
}

function createBlockPropertyMenuItems(
    values: readonly string[],
    selected: string,
    onSelect: (value: string) => void,
    formatLabel: (value: string) => string = value => value,
): IEditor.IMenuItem[] {
    return values.map(value => ({
        type: "radio",
        label: getVfxCaption(formatLabel(value)),
        checked: value === selected,
        click: () => onSelect(value),
    }));
}

function createBlockPropertyMenu(
    label: string,
    values: readonly string[],
    selected: string,
    onSelect: (value: string) => void,
    formatLabel: (value: string) => string = value => value,
): IEditor.IMenuItem {
    return {
        label,
        submenu: createBlockPropertyMenuItems(values, selected, onSelect, formatLabel),
    };
}

function getBlockDisplayTitle(block: IVfxBlockData): string {
    if (block.typeId !== "setAttribute")
        return getVfxTypeCaption(
            getBlockRegistryId(block.typeId),
            getBlockDef(block.typeId)?.title ?? block.typeId,
        );
    const props = block.props ?? {};
    const attribute = getVfxCaption(capitalize(String(props.attribute ?? "position")));
    const composition = String(props.composition ?? "Overwrite");
    const actionKey = composition === "Add"
        ? "addAttribute"
        : composition === "Multiply"
            ? "multiplyAttribute"
            : composition === "Blend" ? "blendAttribute" : "setAttribute";
    const sourceSuffix = props.source === "Source" ? t("fromSource") : "";
    return t(actionKey, { name: attribute }) + sourceSuffix;
}

function capitalize(value: string): string {
    return value ? value.charAt(0).toUpperCase() + value.slice(1) : value;
}

function copyBlockToClipboard(block: IVfxBlockData): void {
    const data: BlockClipboardData = {
        kind: BLOCK_CLIPBOARD_KIND,
        block: {
            typeId: block.typeId,
            enabled: block.enabled,
            props: cloneValue(block.props ?? {}),
        },
    };
    Editor.clipboard.writeText(JSON.stringify(data));
}

function readBlockClipboard(): BlockClipboardData | null {
    const text = Editor.clipboard.readText();
    if (!text)
        return null;
    try {
        const data = JSON.parse(text) as Partial<BlockClipboardData>;
        if (
            data.kind !== BLOCK_CLIPBOARD_KIND
            || typeof data.block?.typeId !== "string"
            || data.block.typeId.length === 0
            || data.block.props != null
            && (typeof data.block.props !== "object" || Array.isArray(data.block.props))
        )
            return null;
        return {
            kind: BLOCK_CLIPBOARD_KIND,
            block: {
                typeId: data.block.typeId,
                enabled: data.block.enabled !== false,
                props: cloneValue(data.block.props ?? {}),
            },
        };
    } catch {
        return null;
    }
}

function cloneValue<T>(value: T): T {
    if (value == null || typeof value !== "object")
        return value;
    return JSON.parse(JSON.stringify(value));
}

interface PortTreeNode {
    port: IEditor.IFlow.GraphPort;
    children: PortTreeNode[];
}

function BlockPortTree({
    flowProps,
    node,
    portCollapseOverrides,
    onToggle,
}: {
    flowProps: IEditor.IFlow.NodeBodyProps;
    node: IEditor.IFlow.GraphNode;
    portCollapseOverrides: ReadonlyMap<string, boolean>;
    onToggle(portId: string, collapsed: boolean): void;
}): React.ReactElement {
    const roots = buildPortTree(node.inputs);
    const outputNode: IEditor.IFlow.GraphNode = {
        ...node,
        inputs: [],
    };
    return (
        <>
            {roots.map(root => (
                <PortTreeBranch
                    key={root.port.id}
                    flowProps={flowProps}
                    node={node}
                    branch={root}
                    depth={0}
                    portCollapseOverrides={portCollapseOverrides}
                    onToggle={onToggle}
                />
            ))}
            {node.outputs.length > 0 && (
                <IEditor.Flow.DefaultNodeBody {...flowProps} node={outputNode} />
            )}
        </>
    );
}

function PortTreeBranch({
    flowProps,
    node,
    branch,
    depth,
    portCollapseOverrides,
    onToggle,
}: {
    flowProps: IEditor.IFlow.NodeBodyProps;
    node: IEditor.IFlow.GraphNode;
    branch: PortTreeNode;
    depth: number;
    portCollapseOverrides: ReadonlyMap<string, boolean>;
    onToggle(portId: string, collapsed: boolean): void;
}): React.ReactElement {
    const hasChildren = branch.children.length > 0;
    const collapsed = hasChildren && (
        portCollapseOverrides.get(branch.port.id) ?? shouldCollapseByDefault(branch)
    );
    const portNode: IEditor.IFlow.GraphNode = {
        ...node,
        inputs: [branch.port],
        outputs: [],
    };
    return (
        <div
            className="vfx-port-tree-item inspector-field"
            data-kind="property"
        >
            <div
                className={
                    "vfx-port-tree-line inspector-row"
                    + (hasChildren ? " inspector-row-collapsible" : "")
                }
                style={{ "--inspector-indent": `${depth * 12}px` } as React.CSSProperties}
            >
                {hasChildren ? (
                    <button
                        type="button"
                        className="icon inspector-collapse-button"
                        data-expanded={!collapsed ? "true" : undefined}
                        aria-label={collapsed ? t("expandProperty") : t("collapseProperty")}
                        aria-expanded={!collapsed}
                        onPointerDown={event => event.stopPropagation()}
                        onClick={() => onToggle(branch.port.id, collapsed)}
                    />
                ) : (
                    <span className="inspector-spacer" />
                )}
                <div className="vfx-port-row-content">
                    <IEditor.Flow.DefaultNodeBody {...flowProps} node={portNode} />
                </div>
                {collapsed && (
                    <CollapsedPortProxies
                        flowProps={flowProps}
                        node={{
                            ...node,
                            inputs: collectDescendantPorts(branch),
                            outputs: [],
                        }}
                    />
                )}
            </div>
            {hasChildren && !collapsed && (
                <div className="inspector-children">
                    {branch.children.map(child => (
                        <PortTreeBranch
                            key={child.port.id}
                            flowProps={flowProps}
                            node={node}
                            branch={child}
                            depth={depth + 1}
                            portCollapseOverrides={portCollapseOverrides}
                            onToggle={onToggle}
                        />
                    ))}
                </div>
            )}
        </div>
    );
}

function buildPortTree(ports: IEditor.IFlow.GraphPort[]): PortTreeNode[] {
    const roots: PortTreeNode[] = [];
    const stack: PortTreeNode[] = [];
    const paths = new Map<string, PortTreeNode>();
    for (const port of ports) {
        const branch: PortTreeNode = { port, children: [] };
        const path = port.data?.propertyPath as string[] | undefined;
        const depth = Math.max(0, Number(port.data?.depth) || 0);
        const parent = path?.length && port.data?.inputId === path.join("_")
            ? paths.get(propertyPathKey(path.slice(0, -1)))
            : stack[depth - 1];
        if (parent)
            parent.children.push(branch);
        else
            roots.push(branch);
        stack.length = depth;
        stack[depth] = branch;
        if (path?.length)
            paths.set(propertyPathKey(path), branch);
    }
    return roots;
}

function propertyPathKey(path: readonly string[]): string {
    return path.join("\u001f");
}

function toggleSetValue<T>(values: ReadonlySet<T>, value: T): ReadonlySet<T> {
    const next = new Set(values);
    if (next.has(value))
        next.delete(value);
    else
        next.add(value);
    return next;
}

function setMapValue<K, V>(
    values: ReadonlyMap<K, V>,
    key: K,
    value: V,
): ReadonlyMap<K, V> {
    const next = new Map(values);
    next.set(key, value);
    return next;
}

function shouldCollapseByDefault(branch: PortTreeNode): boolean {
    return branch.children.length > 0
        && branch.children.every(child => child.children.length === 0);
}

function collectDescendantPorts(branch: PortTreeNode): IEditor.IFlow.GraphPort[] {
    const result: IEditor.IFlow.GraphPort[] = [];
    for (const child of branch.children) {
        result.push(child.port, ...collectDescendantPorts(child));
    }
    return result;
}

function CollapsedPortProxies({
    flowProps,
    node,
}: {
    flowProps: IEditor.IFlow.NodeBodyProps;
    node: IEditor.IFlow.GraphNode;
}): React.ReactElement {
    const proxyNode = {
        ...node,
        inputs: node.inputs.map(port => proxyPort(port)),
        outputs: node.outputs.map(port => proxyPort(port)),
    };
    return (
        <div className="vfx-collapsed-port-proxies" aria-hidden="true">
            <IEditor.Flow.DefaultNodeBody {...flowProps} node={proxyNode} />
        </div>
    );
}

function proxyPort(port: IEditor.IFlow.GraphPort): IEditor.IFlow.GraphPort {
    return {
        ...port,
        label: "",
        data: {
            ...port.data,
            inline: false,
        },
    };
}

function filterNodePorts(
    node: IEditor.IFlow.GraphNode,
    predicate: (port: IEditor.IFlow.GraphPort) => boolean,
): IEditor.IFlow.GraphNode {
    return {
        ...node,
        inputs: node.inputs.filter(predicate),
        outputs: node.outputs.filter(predicate),
    };
}
