import {
    VFX_CONTEXT_DEFS,
    VFX_EVENT_DEFS,
    VFX_OPERATOR_DEFS,
    getContextRegistryId,
    getEventRegistryId,
    getOperatorRegistryId,
    getVfxCaption,
    getVfxTypeCaption,
} from "./data/NodeDefinitions";
import {
    canConnect,
    createNodeSource,
    sourceToGraphNode,
    type NodeKind,
} from "./GraphAdapter";
import { t } from "./I18n";
import type { IVfxOperatorData, IVfxPropertyDef } from "./data/Types";

export interface RegistryOwner {
    allocateId(): number;
    readonly properties: IVfxPropertyDef[];
}

const PROPERTY_NODE_TYPE = "operator/getProperty";
const PROPERTY_NODE_TYPE_PREFIX = PROPERTY_NODE_TYPE + ":";

export function getPropertyNodeTypeId(propertyName: string): string {
    return PROPERTY_NODE_TYPE_PREFIX + encodeURIComponent(propertyName);
}

export function createNodeRegistry(owner: RegistryOwner): IEditor.IFlow.MutableNodeRegistry {
    const definitions: IEditor.IFlow.NodeDefinition[] = [];

    for (const definition of VFX_EVENT_DEFS) {
        const title = getVfxTypeCaption(
            getEventRegistryId(definition.typeId),
            definition.title,
        );
        definitions.push(flowDefinition(
            owner,
            "event",
            definition.typeId,
            title,
            `Event/${definition.title}`,
            `${t("eventCategory")}/${title}`,
            definition.color,
        ));
    }

    for (const definition of VFX_CONTEXT_DEFS) {
        const title = getVfxTypeCaption(
            getContextRegistryId(definition.typeId),
            definition.title,
        );
        definitions.push(flowDefinition(
            owner,
            "context",
            definition.typeId,
            title,
            `Context/${definition.title}`,
            `${t("contextCategory")}/${title}`,
            definition.color,
            "context",
        ));
    }

    for (const definition of VFX_OPERATOR_DEFS) {
        if (definition.hidden)
            continue;
        const category = definition.category || "Other";
        const displayCategory = definition.category
            ? definition.category
                .split("/")
                .map(segment => getVfxCaption(segment, true))
                .join("/")
            : t("otherCategory");
        const title = getVfxTypeCaption(
            getOperatorRegistryId(definition.typeId),
            definition.title,
        );
        definitions.push(flowDefinition(
            owner,
            "operator",
            definition.typeId,
            title,
            `Operator/${category}/${definition.title}`,
            `${t("operatorCategory")}/${displayCategory}/${title}`,
            definition.color,
        ));
    }

    return new VfxNodeRegistry(owner, definitions);
}

export { canConnect };

class VfxNodeRegistry implements IEditor.IFlow.MutableNodeRegistry {
    private readonly base: IEditor.IFlow.MutableNodeRegistry;

    constructor(
        private readonly owner: RegistryOwner,
        definitions: IEditor.IFlow.NodeDefinition[],
    ) {
        this.base = new IEditor.Flow.NodeRegistry(definitions);
    }

    add(definition: IEditor.IFlow.NodeDefinition): void {
        this.base.add(definition);
    }

    getDefinition(typeId: string): IEditor.IFlow.NodeDefinition | undefined {
        return this.base.getDefinition(typeId);
    }

    list(): IEditor.IFlow.NodeDefinition[] {
        return this.base.list();
    }

    menuItems(): IEditor.IFlow.NodeMenuItem[] {
        const items = this.base.menuItems()
            .filter(item => item.typeId !== PROPERTY_NODE_TYPE);
        const category = getVfxCaption("Property", true);

        for (const property of this.owner.properties) {
            items.push({
                typeId: getPropertyNodeTypeId(property.name),
                label: property.name,
                path: `Operator/Property/${encodeURIComponent(property.name)}`,
                displayPath: `${t("operatorCategory")}/${category}/${property.name.replace(/\//g, "／")}`,
                keywords: ["Get Property", property.name, property.type],
            });
        }
        return items;
    }

    createNode(
        typeId: string,
        position: IEditor.IFlow.XY,
    ): IEditor.IFlow.GraphNode | undefined {
        if (!typeId.startsWith(PROPERTY_NODE_TYPE_PREFIX))
            return this.base.createNode(typeId, position);

        const propertyName = decodeURIComponent(typeId.slice(PROPERTY_NODE_TYPE_PREFIX.length));
        const property = this.owner.properties.find(
            item => item.name === propertyName,
        );
        if (!property)
            return undefined;

        const source = createNodeSource(
            "operator",
            "getProperty",
            this.owner.allocateId(),
            position,
        ) as IVfxOperatorData;
        (source.props ??= {}).property = property.name;
        return sourceToGraphNode("operator", source, this.owner.properties);
    }
}

function flowDefinition(
    owner: RegistryOwner,
    kind: NodeKind,
    typeId: string,
    title: string,
    menuPath: string,
    displayMenuPath: string,
    headerColor?: string,
    bodyRenderer?: string,
): IEditor.IFlow.NodeDefinition {
    return {
        typeId: `${kind}/${typeId}`,
        title,
        menuPath,
        displayMenuPath,
        headerColor,
        bodyRenderer,
        create(position) {
            const source = createNodeSource(kind, typeId, owner.allocateId(), position);
            if (kind === "operator") {
                const operator = source as IVfxOperatorData;
                if (typeId === "getAttribute" && !operator.props?.attribute)
                    (operator.props ??= {}).attribute = "position";
                if (typeId === "getProperty" && !operator.props?.property)
                    (operator.props ??= {}).property = owner.properties[0]?.name ?? "";
            }
            return sourceToGraphNode(kind, source, owner.properties);
        },
    };
}
