import * as React from "react";
import { useEffect, useMemo, useState } from "react";
import { readCurve, writeCurve } from "./CurveField";
import { t } from "./I18n";

interface AssetProperty {
    name: string;
    type: string;
    default?: any;
    displayName?: string;
    group?: string;
    exposed?: boolean;
    prefabOverridden?: boolean;
}

type Overrides = Record<string, any>;

@IEditor.inspectorField("VfxEditor.PropertyOverrides")
export class PropertyOverridesField extends IEditor.PropertyField {
    private _assetKey = "";
    private _assetVersion = -1;
    private _properties: AssetProperty[] | null = null;
    private _loading: Promise<AssetProperty[] | null> | null = null;
    private _cacheGeneration = 0;

    get assetVersion(): number {
        return this._assetVersion;
    }

    create(): IEditor.IPropertyFieldCreateResult {
        return {
            stretchWidth: true,
            captionDisplay: "none",
            noMinHeight: true,
        };
    }

    render(): React.ReactNode {
        return <OverridesView field={this} version={this.react?.version ?? 0} />;
    }

    refresh(): void {
        this.syncAssetVersion(assetKey(this.target.data?.asset));
    }

    readOverrides(): Overrides {
        const value = this.target.getValue();
        if (value && typeof value === "object")
            return { ...value };
        if (typeof value !== "string" || !value)
            return {};
        try {
            const parsed = JSON.parse(value);
            return parsed && typeof parsed === "object" ? parsed : {};
        } catch {
            return {};
        }
    }

    commit(overrides: Overrides): boolean {
        return this.target.setValue(JSON.stringify(overrides));
    }

    async loadProperties(): Promise<AssetProperty[] | null> {
        const asset = this.target.data?.asset;
        const key = assetKey(asset);
        this.syncAssetVersion(key);
        if (Array.isArray(asset?.properties))
            return exposedProperties(asset.properties);

        if (!key) {
            return null;
        }
        if (this._assetKey === key && this._properties)
            return this._properties;
        if (this._assetKey === key && this._loading)
            return this._loading;

        const generation = this._cacheGeneration;
        let loading: Promise<AssetProperty[] | null>;
        loading = this.readAssetProperties(key).then(properties => {
            if (generation === this._cacheGeneration)
                this._properties = properties;
            return properties;
        }).finally(() => {
            if (this._loading === loading)
                this._loading = null;
        });
        this._loading = loading;
        return loading;
    }

    private syncAssetVersion(key: string): void {
        const version = getAssetVersion(key);
        if (this._assetKey === key && this._assetVersion === version)
            return;
        this._assetKey = key;
        this._assetVersion = version;
        this._properties = null;
        this._loading = null;
        this._cacheGeneration++;
    }

    private async readAssetProperties(key: string): Promise<AssetProperty[] | null> {
        try {
            const sourceKey = key.split("@")[0];
            const asset = await Editor.assetDb.getAsset(sourceKey)
                ?? (sourceKey !== key ? await Editor.assetDb.getAsset(key) : null);
            if (!asset)
                return null;
            const data = await IEditor.utils.readJsonAsync(Editor.assetDb.getFullPath(asset));
            if (!this.target.data?.initialEvent)
                this.target.data.initialEvent = data?.initialEventName ?? data?.props?.initialEventName ?? "OnPlay";
            return exposedProperties(data?.properties);
        } catch (error) {
            console.warn("[VfxEditor] failed to load exposed properties:", error);
            return null;
        }
    }
}

function OverridesView({
    field,
    version,
}: {
    field: PropertyOverridesField;
    version: number;
}): React.ReactElement {
    const [properties, setProperties] = useState<AssetProperty[] | null>(null);
    const [loading, setLoading] = useState(false);
    const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(
        () => new Set(),
    );
    const overrides = useMemo(() => field.readOverrides(), [field, version]);
    const asset = field.target.data?.asset;
    const key = assetKey(asset);
    const assetVersion = field.assetVersion;

    useEffect(() => {
        let disposed = false;
        setLoading(true);
        setProperties(null);
        void field.loadProperties().then(value => {
            if (!disposed)
                setProperties(value);
        }).finally(() => {
            if (!disposed)
                setLoading(false);
        });
        return () => {
            disposed = true;
        };
    }, [field, key, assetVersion]);

    const commit = (next: Overrides) => {
        field.commit(next);
        field.refresh();
    };
    const toggleGroup = (name: string) => {
        setCollapsedGroups(current => {
            const next = new Set(current);
            next.has(name) ? next.delete(name) : next.add(name);
            return next;
        });
    };
    const groups = groupProperties(properties ?? []);

    if (loading)
        return <div className="text-muted" style={EMPTY_STYLE}>{t("loadingVfxProperties")}</div>;
    if (!asset)
        return <div className="text-muted" style={EMPTY_STYLE}>{t("selectVfxAssetFirst")}</div>;
    if (!properties?.length)
        return <div className="text-muted" style={EMPTY_STYLE}>{t("noVfxExposedProperties")}</div>;

    return (
        <div style={OVERRIDES_STYLE}>
            {groups.map(group => {
                const expanded = !collapsedGroups.has(group.name);
                return (
                    <section key={group.name}>
                        <div
                            className="inspector-row"
                            style={GROUP_HEADER_STYLE}
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
                            <span style={GROUP_TITLE_STYLE}>{group.name}</span>
                        </div>
                        {expanded && group.properties.map(property => {
                            const hasEntry = Object.prototype.hasOwnProperty.call(overrides, property.name);
                            const enabled = hasEntry
                                ? overrides[property.name] !== null
                                : property.prefabOverridden === true;
                            const value = enabled && overrides[property.name] != null
                                ? overrides[property.name]
                                : defaultOverrideValue(property);
                            return (
                                <div
                                    className="inspector-row"
                                    style={PROPERTY_ROW_STYLE}
                                    key={property.name}
                                >
                                    <input
                                        type="checkbox"
                                        checked={enabled}
                                        style={OVERRIDE_CHECKBOX_STYLE}
                                        aria-label={t("overrideProperty", {
                                            name: property.displayName || property.name,
                                        })}
                                        onChange={event => {
                                            const next = { ...overrides };
                                            next[property.name] = event.currentTarget.checked
                                                ? defaultOverrideValue(property)
                                                : null;
                                            commit(next);
                                        }}
                                    />
                                    <label
                                        title={property.name}
                                        style={enabled ? undefined : DISABLED_LABEL_STYLE}
                                    >
                                        {property.displayName || property.name}
                                    </label>
                                    <div className="inspector-control">
                                        <OverrideEditor
                                            property={property}
                                            value={value}
                                            disabled={!enabled}
                                            onCommit={nextValue => commit({ ...overrides, [property.name]: nextValue })}
                                        />
                                    </div>
                                </div>
                            );
                        })}
                    </section>
                );
            })}
        </div>
    );
}

function OverrideEditor({
    property,
    value,
    disabled,
    onCommit,
}: {
    property: AssetProperty;
    value: any;
    disabled: boolean;
    onCommit(value: any): void;
}): React.ReactElement {
    const type = property.type.toLowerCase();
    if (type === "bool" || type === "boolean") {
        return (
            <input
                type="checkbox"
                checked={Boolean(Array.isArray(value) ? value[0] : value)}
                disabled={disabled}
                onChange={event => onCommit([event.currentTarget.checked ? 1 : 0])}
            />
        );
    }
    if (type === "float" || type === "number" || type === "int") {
        const number = Number(Array.isArray(value) ? value[0] : value) || 0;
        return (
            <IEditor.React.NumericInput
                value={number}
                disabled={disabled}
                step={type === "int" ? 1 : undefined}
                onCommit={next => onCommit([type === "int" ? Math.round(next) : next])}
            />
        );
    }
    const axes = vectorAxes(type);
    if (axes) {
        const values = numericArray(value, axes.length);
        return (
            <div style={VECTOR_STYLE}>
                {axes.map((axis, index) => (
                    <IEditor.React.NumericInput
                        key={axis}
                        prefix={axis.toUpperCase()}
                        value={values[index]}
                        disabled={disabled}
                        fractionDigits={3}
                        onCommit={next => {
                            const output = values.slice();
                            output[index] = next;
                            onCommit(output);
                        }}
                    />
                ))}
            </div>
        );
    }
    if (type === "texture2d" || type === "mesh") {
        const resource = Array.isArray(value) ? value[0] : value;
        return (
            <IEditor.React.ResourceInput
                value={typeof resource === "string" ? resource.replace(/^res:\/\//, "") : ""}
                disabled={disabled}
                typeFilter={type === "mesh" ? ["Mesh"] : ["Image"]}
                onCommit={(text, selected) => onCommit(
                    selected
                        ? `res://${selected.id}`
                        : text ? `res://${text.replace(/^res:\/\//, "")}` : "",
                )}
            />
        );
    }
    if (type === "curve") {
        const curve = readCurve(value);
        return (
            <IEditor.React.CurveInput
                value={curve.value}
                readonly={disabled}
                isCurve
                isWeight
                forceStartEndKeys
                onCommit={next => onCommit(writeCurve(next, curve.format))}
            />
        );
    }
    return (
        <IEditor.React.TextInput
            value={typeof value === "string" ? value : JSON.stringify(value ?? null)}
            readonly={disabled}
            multiline={type === "gradient" || type === "aabox"}
            onCommit={text => {
                if (type !== "gradient" && type !== "aabox") {
                    onCommit(text);
                    return true;
                }
                try {
                    onCommit(JSON.parse(text));
                    return true;
                } catch {
                    return false;
                }
            }}
        />
    );
}

const OVERRIDES_STYLE: React.CSSProperties = {
    display: "flex",
    flexDirection: "column",
    gap: 4,
    width: "100%",
    minWidth: 0,
};

const GROUP_HEADER_STYLE: React.CSSProperties = {
    gridTemplateColumns: "22px minmax(0, 1fr)",
    minHeight: 22,
    paddingTop: 0,
    paddingBottom: 0,
    cursor: "default",
};

const GROUP_TITLE_STYLE: React.CSSProperties = {
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    color: "var(--text-bright)",
    lineHeight: "22px",
};

const PROPERTY_ROW_STYLE: React.CSSProperties = {
    minHeight: 24,
    paddingLeft: 22,
    paddingTop: 0,
    paddingBottom: 0,
};

const OVERRIDE_CHECKBOX_STYLE: React.CSSProperties = {
    justifySelf: "center",
    alignSelf: "start",
    margin: "4px 0 0",
};

const DISABLED_LABEL_STYLE: React.CSSProperties = {
    color: "var(--text-muted)",
};

const VECTOR_STYLE: React.CSSProperties = {
    display: "grid",
    gridTemplateColumns: "repeat(2, minmax(56px, 1fr))",
    gap: 2,
    minWidth: 0,
    width: "100%",
};

const EMPTY_STYLE: React.CSSProperties = {
    padding: 8,
    textAlign: "center",
};

function exposedProperties(value: any): AssetProperty[] {
    return Array.isArray(value)
        ? value.filter(property => property && property.name && property.exposed !== false)
        : [];
}

function assetKey(asset: any): string {
    if (typeof asset === "string")
        return asset.replace(/^res:\/\//, "");
    return asset?._$uuid ?? asset?.uuid ?? asset?._uuid ?? asset?.id ?? "";
}

function getAssetVersion(key: string): number {
    if (!key)
        return -1;
    const sourceKey = key.split("@")[0];
    return Editor.assetDb.getAssetSync(sourceKey)?.ver
        ?? (sourceKey !== key ? Editor.assetDb.getAssetSync(key)?.ver : undefined)
        ?? -1;
}

function groupProperties(properties: AssetProperty[]): Array<{ name: string; properties: AssetProperty[] }> {
    const result: Array<{ name: string; properties: AssetProperty[] }> = [];
    const map = new Map<string, AssetProperty[]>();
    for (const property of properties) {
        const name = property.group?.trim() || t("properties");
        let group = map.get(name);
        if (!group) {
            group = [];
            map.set(name, group);
            result.push({ name, properties: group });
        }
        group.push(property);
    }
    return result;
}

function defaultOverrideValue(property: AssetProperty): any {
    const type = property.type.toLowerCase();
    if (type === "gradient" || type === "curve" || type === "aabox")
        return clone(property.default ?? (type === "gradient" ? { stops: [] } : {}));
    if (type === "texture2d" || type === "mesh") {
        const value = Array.isArray(property.default) ? property.default[0] : property.default;
        return typeof value === "string" ? value : "";
    }
    if (type === "bool" || type === "boolean")
        return [property.default ? 1 : 0];
    return numericArray(property.default, vectorAxes(type)?.length ?? 1);
}

function vectorAxes(type: string): string[] | null {
    switch (type) {
        case "vec2": return ["x", "y"];
        case "vec3": return ["x", "y", "z"];
        case "vec4": return ["x", "y", "z", "w"];
        case "color": return ["r", "g", "b", "a"];
        default: return null;
    }
}

function numericArray(value: any, size: number): number[] {
    if (Array.isArray(value))
        return Array.from({ length: size }, (_, index) => Number(value[index]) || 0);
    if (typeof value === "number")
        return [value];
    const axes = size === 4 && value && ("r" in value || "g" in value)
        ? ["r", "g", "b", "a"]
        : ["x", "y", "z", "w"];
    return Array.from({ length: size }, (_, index) => Number(value?.[axes[index]]) || 0);
}

function clone<T>(value: T): T {
    return value == null || typeof value !== "object"
        ? value
        : JSON.parse(JSON.stringify(value));
}
