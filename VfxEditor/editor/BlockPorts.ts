import {
    getAttributeComponents,
    getAttributeType,
    getPropertyComponents,
    getPropertyOutputType,
} from "./data/OperatorDefinitions";
import { buildBlockSlotId } from "./data/SlotIds";
import {
    getBlockRegistryId,
    getVfxCaption,
} from "./data/NodeDefinitions";
import type {
    IVfxBlockData,
    IVfxBlockTypeDef,
    IVfxSlotDef,
} from "./data/Types";

export interface ResolvedBlockInput {
    definition: IVfxSlotDef;
    property?: IEditor.FPropertyDescriptor;
    propertyPath?: string[];
    value: any;
    inline: boolean;
    depth: number;
}

interface PropertyComponent {
    id: string;
    name: string;
    type: string;
}

const SEMANTIC_VECTOR_TYPES = new Set(["position", "direction", "vector"]);
const INLINE_TYPES = new Set([
    "float",
    "number",
    "int",
    "uint",
    "bool",
    "boolean",
    "string",
]);

export function resolveBlockInputs(
    block: IVfxBlockData,
    definition: IVfxBlockTypeDef,
    connectedPortIds: ReadonlySet<string>,
): ResolvedBlockInput[] {
    if (block.typeId === "setAttribute")
        return resolveSetAttributeInputs(block, connectedPortIds);

    const result: ResolvedBlockInput[] = [];
    const seen = new Set<string>();
    const blockType = Editor.typeRegistry.types[getBlockRegistryId(definition.typeId)];

    for (const property of definition.properties ?? []) {
        const suffix = property.name;
        const keepConnected = hasConnectedPort(block.id, suffix, connectedPortIds)
            || hasConnectedLegacyShapeRadius(block, property.name, connectedPortIds);
        if (!keepConnected && isBlockHidden(property))
            continue;
        if (!keepConnected && evaluateHidden(property.hidden, block.props ?? {}))
            continue;
        if (!isConnectableProperty(property))
            continue;
        const registeredProperty = findRegisteredProperty(blockType, property.name) ?? property;
        addPropertyTree(
            result,
            seen,
            block,
            registeredProperty,
            [property.name],
            [getPropertyCaption(blockType, registeredProperty)],
            0,
        );
    }

    for (const input of definition.inputs ?? []) {
        if (input.id === "enabled")
            continue;
        if (seen.has(input.id))
            continue;
        if (!isExplicitInputVisible(block, definition, input.id, connectedPortIds))
            continue;
        const propertyPath = explicitInputPropertyPath(block, definition, input.id);
        const property = propertyPath
            ? findTopLevelProperty(definition, propertyPath[0])
            : undefined;
        const value = propertyPath
            ? readPropertyPath(block.props ?? {}, propertyPath, input.default ?? property?.default)
            : readLegacyInputValue(block, input);
        addResolvedInput(
            result,
            seen,
            input,
            value,
            property,
            propertyPath,
            propertyPath ? propertyPath.length - 1 : 0,
        );
    }

    return result;
}

export function setBlockInputValue(
    block: IVfxBlockData,
    inputId: string,
    value: any,
    propertyPath?: readonly string[],
): void {
    if (block.typeId === "setAttribute") {
        setAttributeInputValue(block, inputId, value);
        return;
    }
    if (propertyPath?.length) {
        writePropertyPath(block.props ??= {}, propertyPath, value);
        return;
    }
    setLegacyInputValue(block, inputId, value);
}

function addPropertyTree(
    result: ResolvedBlockInput[],
    seen: Set<string>,
    block: IVfxBlockData,
    property: IEditor.FPropertyDescriptor,
    propertyPath: string[],
    captions: string[],
    depth: number,
): void {
    const suffix = propertySlotId(block, propertyPath);
    const type = slotTypeForProperty(property.type);
    const value = readPropertyPath(block.props ?? {}, propertyPath, property.default);
    addResolvedInput(
        result,
        seen,
        {
            id: suffix,
            name: captions.join(" · "),
            type,
            default: clone(property.default),
        },
        value,
        property,
        propertyPath,
        depth,
    );

    for (const component of propertyComponents(property.type)) {
        const childPath = [...propertyPath, component.id];
        const childProperty: IEditor.FPropertyDescriptor = {
            ...property,
            name: component.id,
            caption: component.name,
            type: propertyTypeForSlot(component.type),
            default: clone(readChild(value, component.id)),
        };
        addPropertyTree(
            result,
            seen,
            block,
            childProperty,
            childPath,
            [...captions, component.name],
            depth + 1,
        );
    }
}

function resolveSetAttributeInputs(
    block: IVfxBlockData,
    connectedPortIds: ReadonlySet<string>,
): ResolvedBlockInput[] {
    const props = block.props ?? {};
    const values = props._values ?? {};
    const attributeName = String(props.attribute ?? "position");
    const attributeType = getAttributeType(attributeName);
    const sourceIsSlot = (props.source ?? "Slot") === "Slot";
    const hasRandom = props.random !== "Off" && props.random != null && attributeType !== "bool";
    const hasBlend = props.composition === "Blend";
    const result: ResolvedBlockInput[] = [];
    const seen = new Set<string>();

    addSetAttributeInput(
        result,
        seen,
        block,
        connectedPortIds,
        { id: "value", name: capitalize(attributeName), type: attributeType },
        readAttributeValue(values, attributeType, ""),
        sourceIsSlot,
        0,
    );
    addSetAttributeInput(
        result,
        seen,
        block,
        connectedPortIds,
        { id: "b_value", name: "B", type: attributeType },
        readAttributeValue(values, attributeType, "b_"),
        sourceIsSlot && hasRandom,
        0,
    );
    addSetAttributeInput(
        result,
        seen,
        block,
        connectedPortIds,
        { id: "blend", name: "Blend", type: "float", default: 0.5 },
        clone(values.blend ?? 0.5),
        sourceIsSlot && hasBlend,
        0,
    );

    const components = getAttributeComponents(attributeType);
    for (const component of components) {
        addSetAttributeInput(
            result,
            seen,
            block,
            connectedPortIds,
            {
                id: `value_${component.id}`,
                name: component.name.toUpperCase(),
                type: component.type,
            },
            clone(values[component.id] ?? defaultComponentValue(attributeType, component.id)),
            sourceIsSlot,
            1,
        );
        addSetAttributeInput(
            result,
            seen,
            block,
            connectedPortIds,
            {
                id: `b_value_${component.id}`,
                name: component.name.toUpperCase(),
                type: component.type,
            },
            clone(values[`b_${component.id}`] ?? defaultComponentValue(attributeType, component.id)),
            sourceIsSlot && hasRandom,
            1,
        );
    }

    return result;
}

function capitalize(value: string): string {
    return value ? value.charAt(0).toUpperCase() + value.slice(1) : value;
}

function addSetAttributeInput(
    result: ResolvedBlockInput[],
    seen: Set<string>,
    block: IVfxBlockData,
    connectedPortIds: ReadonlySet<string>,
    definition: IVfxSlotDef,
    value: any,
    visible: boolean,
    depth: number,
): void {
    if (!visible && !connectedPortIds.has(buildBlockSlotId(block.id, definition.id)))
        return;
    addResolvedInput(result, seen, definition, value, undefined, undefined, depth);
}

function addResolvedInput(
    result: ResolvedBlockInput[],
    seen: Set<string>,
    definition: IVfxSlotDef,
    value: any,
    property: IEditor.FPropertyDescriptor | undefined,
    propertyPath: string[] | undefined,
    depth: number,
): void {
    if (seen.has(definition.id))
        return;
    seen.add(definition.id);
    result.push({
        definition: {
            ...definition,
            name: property ? definition.name : getVfxCaption(definition.name),
        },
        property: property ? { ...property } : undefined,
        propertyPath,
        value: clone(value),
        inline: INLINE_TYPES.has(definition.type),
        depth,
    });
}

function hasConnectedLegacyShapeRadius(
    block: IVfxBlockData,
    propertyName: string,
    connectedPortIds: ReadonlySet<string>,
): boolean {
    if (block.typeId !== "setPositionShape")
        return false;
    const owner = block.props?.shape === "Circle" ? "arcCircle" : "arcSphere";
    return propertyName === owner
        && connectedPortIds.has(buildBlockSlotId(block.id, "radius"));
}

function propertySlotId(block: IVfxBlockData, propertyPath: readonly string[]): string {
    if (block.typeId === "setPositionShape") {
        const circle = block.props?.shape === "Circle";
        const legacyRadiusPath = circle
            ? ["arcCircle", "circle", "radius"]
            : ["arcSphere", "sphere", "radius"];
        if (propertyPath.length === legacyRadiusPath.length
            && propertyPath.every((part, index) => part === legacyRadiusPath[index]))
            return "radius";
    }
    return propertyPath.join("_");
}

function isExplicitInputVisible(
    block: IVfxBlockData,
    definition: IVfxBlockTypeDef,
    inputId: string,
    connectedPortIds: ReadonlySet<string>,
): boolean {
    if (connectedPortIds.has(buildBlockSlotId(block.id, inputId)))
        return true;
    const propertyPath = explicitInputPropertyPath(block, definition, inputId);
    const property = propertyPath
        ? findTopLevelProperty(definition, propertyPath[0])
        : undefined;
    if (property && evaluateHidden(property.hidden, block.props ?? {}))
        return false;
    if (block.typeId === "positionSequential" && isSequentialAxis(inputId))
        return block.props?.mode === "ThreeDimensional";
    return true;
}

function explicitInputPropertyPath(
    block: IVfxBlockData,
    definition: IVfxBlockTypeDef,
    inputId: string,
): string[] | undefined {
    if (findTopLevelProperty(definition, inputId))
        return [inputId];

    const component = /^(.*)_([xyzwrgba])$/.exec(inputId);
    if (component && findTopLevelProperty(definition, component[1]))
        return [component[1], component[2]];

    if (inputId === "fieldTransform_position")
        return ["fieldTransform", "position"];
    if (inputId.startsWith("fieldTransform_position_"))
        return ["fieldTransform", "position", inputId.slice("fieldTransform_position_".length)];
    if (block.typeId === "setPositionShape" && inputId === "radius") {
        return block.props?.shape === "Circle"
            ? ["arcCircle", "circle", "radius"]
            : ["arcSphere", "sphere", "radius"];
    }
    return undefined;
}

function propertyComponents(type: IEditor.FPropertyDescriptor["type"] | undefined): PropertyComponent[] {
    const typeName = propertyTypeName(type);
    if (!typeName)
        return [];
    const typeDefinition = Editor.typeRegistry.types[typeName];
    if (SEMANTIC_VECTOR_TYPES.has(typeName)) {
        return withRegisteredCaptions(typeDefinition, [
            { id: "x", name: "X", type: "float" },
            { id: "y", name: "Y", type: "float" },
            { id: "z", name: "Z", type: "float" },
        ]);
    }
    return withRegisteredCaptions(typeDefinition, getPropertyComponents(typeName).map(component => ({
        id: component.id,
        name: component.name,
        type: component.type,
    })));
}

function withRegisteredCaptions(
    type: IEditor.FTypeDescriptor | undefined,
    components: PropertyComponent[],
): PropertyComponent[] {
    if (!type)
        return components;
    return components.map(component => {
        const property = findRegisteredProperty(type, component.id);
        return property
            ? { ...component, name: Editor.typeRegistry.getPropCaption(type, property) }
            : component;
    });
}

function findRegisteredProperty(
    type: IEditor.FTypeDescriptor | undefined,
    propertyName: string,
): IEditor.FPropertyDescriptor | undefined {
    return type?.properties?.find(property => property.name === propertyName);
}

function getPropertyCaption(
    type: IEditor.FTypeDescriptor | undefined,
    property: IEditor.FPropertyDescriptor,
): string {
    return type
        ? Editor.typeRegistry.getPropCaption(type, property)
        : property.caption ?? property.name;
}

function isConnectableProperty(property: IEditor.FPropertyDescriptor): boolean {
    return !property.name.startsWith("_");
}

function isBlockHidden(property: IEditor.FPropertyDescriptor): boolean {
    return Boolean((property as IEditor.FPropertyDescriptor & { blockHidden?: boolean }).blockHidden);
}

function findTopLevelProperty(
    definition: IVfxBlockTypeDef,
    name: string,
): IEditor.FPropertyDescriptor | undefined {
    return definition.properties?.find(property => property.name === name);
}

function isSequentialAxis(inputId: string): boolean {
    return inputId === "axisX" || inputId === "axisY" || inputId === "axisZ";
}

function hasConnectedPort(
    blockId: number,
    suffix: string,
    connectedPortIds: ReadonlySet<string>,
): boolean {
    const portId = buildBlockSlotId(blockId, suffix);
    for (const connectedPortId of connectedPortIds) {
        if (connectedPortId === portId || connectedPortId.startsWith(portId + "_"))
            return true;
    }
    return false;
}

function evaluateHidden(
    hidden: IEditor.FPropertyDescriptor["hidden"],
    data: Record<string, any>,
): boolean {
    try {
        if (typeof hidden === "boolean")
            return hidden;
        if (typeof hidden === "function")
            return Boolean(hidden(data, null as any));
        if (typeof hidden !== "string" || !hidden)
            return false;
        return Boolean(new Function("data", `return ${hidden}`)(data));
    } catch {
        return false;
    }
}

function readLegacyInputValue(block: IVfxBlockData, input: IVfxSlotDef): any {
    const props = block.props ?? {};
    if (input.id === "fieldTransform_position")
        return props.fieldTransform?.position ?? input.default;
    if (input.id.startsWith("fieldTransform_position_")) {
        const component = input.id.slice("fieldTransform_position_".length);
        return props.fieldTransform?.position?.[component] ?? input.default;
    }
    return props[input.id] ?? input.default;
}

function setLegacyInputValue(block: IVfxBlockData, inputId: string, value: any): void {
    const props = block.props ??= {};
    if (inputId === "fieldTransform_position") {
        const transform = props.fieldTransform ??= {};
        transform.position = clone(value);
        return;
    }
    if (inputId.startsWith("fieldTransform_position_")) {
        const transform = props.fieldTransform ??= {};
        const position = transform.position ??= {};
        position[inputId.slice("fieldTransform_position_".length)] = clone(value);
        return;
    }
    props[inputId] = clone(value);
}

function setAttributeInputValue(block: IVfxBlockData, inputId: string, value: any): void {
    const props = block.props ??= {};
    const values = props._values ??= {};
    const attributeType = getAttributeType(String(props.attribute ?? ""));
    if (inputId === "blend") {
        values.blend = clone(value);
    } else if (inputId === "value") {
        writeAttributeValue(values, attributeType, "", value);
    } else if (inputId === "b_value") {
        writeAttributeValue(values, attributeType, "b_", value);
    } else if (inputId.startsWith("value_")) {
        values[inputId.slice("value_".length)] = clone(value);
    } else if (inputId.startsWith("b_value_")) {
        values["b_" + inputId.slice("b_value_".length)] = clone(value);
    } else {
        props[inputId] = clone(value);
    }
}

function readPropertyPath(
    root: Record<string, any>,
    path: readonly string[],
    fallback?: any,
): any {
    let value: any = root;
    for (const segment of path) {
        value = readChild(value, segment);
        if (value == null)
            return clone(fallback);
    }
    return clone(value);
}

function writePropertyPath(
    root: Record<string, any>,
    path: readonly string[],
    value: any,
): void {
    if (path.length === 0)
        return;
    let target: any = root;
    for (let index = 0; index < path.length - 1; index++) {
        const holder = writableHolder(target, path[index]);
        const segment = writableSegment(holder, path[index]);
        target = holder[segment] ??= {};
    }
    const holder = writableHolder(target, path[path.length - 1]);
    const segment = writableSegment(holder, path[path.length - 1]);
    holder[segment] = clone(value);
}

function readChild(value: any, segment: string): any {
    if (value == null || typeof value !== "object")
        return undefined;
    if (segment in value)
        return value[segment];
    if (segment === "rotation" && "angles" in value)
        return value.angles;
    if (segment === "angles" && "rotation" in value)
        return value.rotation;
    const semantic = semanticNestedValue(value);
    if (semantic && typeof semantic === "object" && segment in semantic)
        return semantic[segment];
    return undefined;
}

function writableSegment(target: any, segment: string): string {
    const holder = writableHolder(target, segment);
    if (segment === "rotation" && holder && typeof holder === "object" && "angles" in holder)
        return "angles";
    if (segment === "angles" && holder && typeof holder === "object" && "rotation" in holder)
        return "rotation";
    return segment;
}

function writableHolder(value: any, segment: string): any {
    if (!value || typeof value !== "object" || segment in value)
        return value;
    const semantic = semanticNestedValue(value);
    if (semantic && typeof semantic === "object" && segment in semantic)
        return semantic;
    return value;
}

function semanticNestedValue(value: any): any {
    return value?.pos ?? value?.position ?? value?.direction ?? value?.vector;
}

function propertyTypeForSlot(type: string): string {
    switch (type) {
        case "float": return "number";
        case "bool": return "boolean";
        default: return type;
    }
}

function slotTypeForProperty(type: IEditor.FPropertyDescriptor["type"] | undefined): string {
    const typeName = propertyTypeName(type);
    switch (typeName) {
        case "Curve": return "curve";
        case "Gradient": return "gradient";
        case "boolean": return "bool";
        default: return getPropertyOutputType(typeName || "any");
    }
}

function propertyTypeName(
    type: IEditor.FPropertyDescriptor["type"] | undefined,
): string | undefined {
    return typeof type === "string" ? type : undefined;
}

function readAttributeValue(
    values: Record<string, any>,
    type: string,
    prefix: "" | "b_",
): any {
    if (INLINE_TYPES.has(type)) {
        if (prefix === "b_")
            return clone(values.b_value ?? values.y ?? values.b_x ?? 0);
        return clone(values.value ?? values.x ?? 0);
    }
    const result: Record<string, any> = {};
    for (const component of attributeValueComponents(type))
        result[component] = clone(values[prefix + component] ?? defaultComponentValue(type, component));
    return result;
}

function writeAttributeValue(
    values: Record<string, any>,
    type: string,
    prefix: "" | "b_",
    value: any,
): void {
    if (INLINE_TYPES.has(type)) {
        if (prefix === "b_") {
            values.b_value = clone(value);
            values.y = clone(value);
        } else {
            values.value = clone(value);
            values.x = clone(value);
        }
        return;
    }
    for (const component of attributeValueComponents(type))
        values[prefix + component] = clone(value?.[component] ?? defaultComponentValue(type, component));
}

function attributeValueComponents(type: string): string[] {
    return getAttributeComponents(type).map(component => component.id);
}

function defaultComponentValue(type: string, component: string): number {
    const isColorComponent = component === "r"
        || component === "g"
        || component === "b"
        || component === "a";
    return type === "color" && isColorComponent ? 1 : 0;
}

function clone<T>(value: T): T {
    if (value == null || typeof value !== "object")
        return value;
    return JSON.parse(JSON.stringify(value));
}
