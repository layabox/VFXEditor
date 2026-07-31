import * as React from "react";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { editorController } from "./Controller";
import { t } from "./I18n";
import {
    propertyTypeOptions,
    type PropertyTypeOption,
    VfxDocument,
} from "./Document";
import {
    getPropSettingsRegistryId,
    VFX_GRAPH_TYPE_ID,
} from "./data/NodeDefinitions";
import type { IVfxPropertyDef } from "./data/Types";

const HIDDEN_CATALOG_OPTIONS = { catalogBarStyle: "hidden" as const };
const ADD_PROPERTY_MENU_ID = "VfxEditor.Property.Add";
const PROPERTY_MENU_ID = "VfxEditor.Property.Item";

export const VFX_PROPERTY_DRAG_MIME = "application/x-laya-vfx-property";

export interface VfxPropertyDragItem {
    kind: "vfx-property";
    assetId: string;
    name: string;
}

interface PropertyListItem {
    property: IVfxPropertyDef;
    index: number;
}

interface PropertyListGroup {
    name: string;
    items: PropertyListItem[];
}

function startPropertyDrag(
    event: React.DragEvent,
    assetId: string,
    propertyName: string,
): void {
    const item: VfxPropertyDragItem = {
        kind: "vfx-property",
        assetId,
        name: propertyName,
    };
    const data = JSON.stringify(item);
    event.dataTransfer.setData(VFX_PROPERTY_DRAG_MIME, data);
    event.dataTransfer.setData("text/plain", data);
    event.dataTransfer.effectAllowed = "copy";
}

export function LeftPanel({ document }: { document: VfxDocument }): React.ReactElement {
    useSyncExternalStore(document.metaStore.subscribe, document.metaStore.getSnapshot);
    const [selectedProperty, setSelectedProperty] = useState<IVfxPropertyDef | null>(null);
    const [propertiesOpen, setPropertiesOpen] = useState(true);
    const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(() => new Set());
    const inspectorHeight = editorController.inspectorHeight;
    const propertyGroups = groupProperties(document.properties);

    useEffect(() => {
        if (selectedProperty && !document.properties.includes(selectedProperty))
            setSelectedProperty(null);
    }, [document, document.properties.length, selectedProperty]);

    const addProperty = (anchor: HTMLButtonElement) => {
        const menu = IEditor.Menu.getById(ADD_PROPERTY_MENU_ID) ?? IEditor.Menu.create(ADD_PROPERTY_MENU_ID);
        menu.setItems(propertyTypeOptions.map(option => ({
            label: option.label,
            click: () => setSelectedProperty(
                document.addProperty(option as PropertyTypeOption),
            ),
        })));
        menu.show(null, IEditor.Menu.getPopupPosition(anchor));
    };

    const toggleGroup = (group: string) => {
        const key = getGroupStateKey(document.assetId, group);
        setCollapsedGroups(current => {
            const next = new Set(current);
            if (next.has(key))
                next.delete(key);
            else
                next.add(key);
            return next;
        });
    };

    const removeProperty = (
        property: IVfxPropertyDef,
        index: number,
        event: React.MouseEvent,
    ) => {
        event.preventDefault();
        const menu = IEditor.Menu.getById(PROPERTY_MENU_ID) ?? IEditor.Menu.create(PROPERTY_MENU_ID);
        menu.setItems([{
            label: t("deleteProperty"),
            click: () => {
                document.removeProperty(index);
                if (selectedProperty === property)
                    setSelectedProperty(null);
            },
        }]);
        menu.show(null, { x: event.clientX, y: event.clientY });
    };

    return (
        <div
            className="vfx-left"
            onPointerDownCapture={() => editorController.setHistoryScope("meta")}
            onFocusCapture={() => editorController.setHistoryScope("meta")}
        >
            <div className="vfx-left-list">
                <TypedInspector
                    data={document.graphProps}
                    type={VFX_GRAPH_TYPE_ID}
                    historyScope="meta"
                />
                <section
                    className="vfx-property-list-section inspector-field"
                    data-kind="catalog"
                >
                    <header
                        className="inspector-row"
                        onClick={() => setPropertiesOpen(current => !current)}
                    >
                        <button
                            type="button"
                            className="icon inspector-collapse-button"
                            data-expanded={propertiesOpen ? "true" : undefined}
                            aria-expanded={propertiesOpen}
                            aria-label={propertiesOpen
                                ? t("collapseExposedProperties")
                                : t("expandExposedProperties")}
                            onClick={event => {
                                event.stopPropagation();
                                setPropertiesOpen(current => !current);
                            }}
                        />
                        <label>
                            <span className="inspector-label-text">
                                {t("exposedProperties")}
                            </span>
                        </label>
                        <span className="inspector-catalog-actions">
                            <IEditor.React.ToolButton
                                className="icon vfx-property-add"
                                title={t("addProperty")}
                                aria-label={t("addProperty")}
                                onClick={event => {
                                    event.stopPropagation();
                                    addProperty(event.currentTarget);
                                }}
                            >
                                +
                            </IEditor.React.ToolButton>
                        </span>
                    </header>
                    {propertiesOpen && (
                        <div className="inspector-children">
                            {document.properties.length === 0 && (
                                <div className="vfx-property-list-empty text-muted">
                                    {t("noExposedProperties")}
                                </div>
                            )}
                            {propertyGroups.ungrouped.map(({ property, index }) => (
                                <PropertyListRow
                                    key={`property:${index}`}
                                    assetId={document.assetId}
                                    property={property}
                                    selected={selectedProperty === property}
                                    onSelect={() => setSelectedProperty(property)}
                                    onContextMenu={event =>
                                        removeProperty(property, index, event)}
                                />
                            ))}
                            {propertyGroups.groups.map(group => {
                                const key = getGroupStateKey(document.assetId, group.name);
                                const expanded = !collapsedGroups.has(key);
                                return (
                                    <React.Fragment key={`group:${group.name}`}>
                                        <div
                                            className="vfx-property-list-group inspector-row"
                                            onClick={() => toggleGroup(group.name)}
                                        >
                                            <button
                                                type="button"
                                                className="icon inspector-collapse-button"
                                                data-expanded={expanded ? "true" : undefined}
                                                aria-expanded={expanded}
                                                aria-label={group.name}
                                                onClick={event => {
                                                    event.stopPropagation();
                                                    toggleGroup(group.name);
                                                }}
                                            />
                                            <span>{group.name}</span>
                                        </div>
                                        {expanded && group.items.map(({ property, index }) => (
                                            <PropertyListRow
                                                key={`property:${index}`}
                                                assetId={document.assetId}
                                                property={property}
                                                selected={selectedProperty === property}
                                                grouped
                                                onSelect={() => setSelectedProperty(property)}
                                                onContextMenu={event =>
                                                    removeProperty(property, index, event)}
                                            />
                                        ))}
                                    </React.Fragment>
                                );
                            })}
                        </div>
                    )}
                </section>
            </div>
            <IEditor.React.ResizeHandle
                orientation="horizontal"
                className="vfx-left-resize"
                reverse
                value={inspectorHeight}
                min={140}
                max={420}
                onResize={value => editorController.setInspectorHeight(value)}
                onReset={() => editorController.setInspectorHeight(240)}
            >
                <span className="vfx-left-resize-line resize-handle-line" />
            </IEditor.React.ResizeHandle>
            <div className="vfx-left-inspector" style={{ height: inspectorHeight }}>
                <PropertyInspector
                    document={document}
                    property={selectedProperty}
                />
            </div>
        </div>
    );
}

function PropertyListRow({
    assetId,
    property,
    selected,
    grouped = false,
    onSelect,
    onContextMenu,
}: {
    assetId: string;
    property: IVfxPropertyDef;
    selected: boolean;
    grouped?: boolean;
    onSelect(): void;
    onContextMenu(event: React.MouseEvent): void;
}): React.ReactElement {
    const typeLabel = propertyTypeOptions.find(option => option.type === property.type)?.label
        ?? property.type;
    return (
        <div
            className={
                `vfx-property-list-row${grouped ? " grouped" : ""}${selected ? " active" : ""}`
            }
            tabIndex={0}
            draggable
            onClick={onSelect}
            onContextMenu={onContextMenu}
            onDragStart={event => startPropertyDrag(event, assetId, property.name)}
        >
            <span className="vfx-property-list-name">{property.name}</span>
            <span className="vfx-property-list-type">{typeLabel}</span>
        </div>
    );
}

function groupProperties(properties: IVfxPropertyDef[]): {
    ungrouped: PropertyListItem[];
    groups: PropertyListGroup[];
} {
    const ungrouped: PropertyListItem[] = [];
    const groups: PropertyListGroup[] = [];
    const groupsByName = new Map<string, PropertyListGroup>();
    properties.forEach((property, index) => {
        const groupName = property.group?.trim();
        if (!groupName) {
            ungrouped.push({ property, index });
            return;
        }

        let group = groupsByName.get(groupName);
        if (!group) {
            group = { name: groupName, items: [] };
            groupsByName.set(groupName, group);
            groups.push(group);
        }
        group.items.push({ property, index });
    });
    return { ungrouped, groups };
}

function getGroupStateKey(assetId: string, group: string): string {
    return `${assetId}\0${group}`;
}

function PropertyInspector({
    document,
    property,
}: {
    document: VfxDocument;
    property: IVfxPropertyDef | null;
}): React.ReactElement {
    const model = useMemo(() => {
        const next = new IEditor.React.InspectorPanelModel();
        next.allowUndo = false;
        return next;
    }, []);
    const typeName = property ? getPropSettingsRegistryId(property.type) : null;

    useEffect(() => {
        model.resetInspectors();
        if (property && typeName)
            model.inspect(property, typeName, HIDDEN_CATALOG_OPTIONS);
        return () => model.resetInspectors();
    }, [model, property, typeName]);

    useEffect(() => {
        if (!property)
            return undefined;
        const handleChange = (
            _sender: any,
            dataPath: string[],
            _value: any,
            oldValue: any,
        ) => {
            if (dataPath.length === 1 && dataPath[0] === "name")
                document.reconcilePropertyName(property, String(oldValue ?? ""));
        };
        model.onDataChanged.add(handleChange);
        return () => model.onDataChanged.remove(handleChange);
    }, [document, model, property]);

    if (!property) {
        return (
            <div className="vfx-left-inspector-empty text-muted">
                {t("selectPropertyToEdit")}
            </div>
        );
    }

    return (
        <IEditor.React.InspectorPanel
            model={model}
            className="vfx-embedded-inspector"
        />
    );
}

export function TypedInspector({
    data,
    type,
    historyScope,
    onChange,
}: {
    data: any;
    type: string;
    historyScope: "graph" | "meta";
    onChange?(): void;
}): React.ReactElement {
    const model = useMemo(() => {
        const next = new IEditor.React.InspectorPanelModel();
        next.allowUndo = false;
        return next;
    }, []);
    const onChangeRef = useRef(onChange);
    onChangeRef.current = onChange;
    useEffect(() => {
        const handleChange = () => onChangeRef.current?.();
        model.onDataChanged.add(handleChange);
        model.inspect(data, type);
        return () => {
            model.onDataChanged.remove(handleChange);
            model.resetInspectors();
        };
    }, [data, model, type]);
    useEffect(() => {
        editorController.setHistoryScope(historyScope);
    }, [historyScope]);
    return (
        <IEditor.React.InspectorPanel
            model={model}
            className="vfx-embedded-inspector"
            captionWidthRatio={0.5}
        />
    );
}
