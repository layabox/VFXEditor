import * as React from "react";

export function renderPortInput(
    context: IEditor.FlowApi.PortInputContext,
): React.ReactNode | undefined {
    const { node, port, store, onValueChange } = context;
    if (port.data?.inline !== true)
        return null;

    const property = port.data?.property as IEditor.FPropertyDescriptor | undefined;
    const value = node.data.values?.[port.id];
    const commit = (next: any) => {
        IEditor.Flow.commands.setInputValue(store, node.id, port.id, next);
        onValueChange?.();
    };

    if (Array.isArray(property?.enumSource)) {
        const items = property.enumSource.map((item: any) =>
            typeof item === "string"
                ? { value: item, label: item }
                : {
                    value: String(item.value ?? item.name ?? ""),
                    label: String(item.name ?? item.value ?? ""),
                });
        return (
            <span className="flow-control nodrag">
                <IEditor.React.SelectInput
                    value={value == null ? "" : String(value)}
                    items={items}
                    onChange={commit}
                />
            </span>
        );
    }

    if (isNumberType(port.dataType)) {
        return (
            <span className="flow-control nodrag nowheel">
                <IEditor.React.NumericInput
                    value={numberValue(value)}
                    min={property?.min}
                    max={property?.max}
                    step={property?.step}
                    fractionDigits={isIntegerType(port.dataType) ? 0 : 3}
                    onCommit={commit}
                />
            </span>
        );
    }

    if (port.dataType === "bool" || port.dataType === "boolean") {
        return (
            <span className="vfx-inline-boolean nodrag">
                <input
                    type="checkbox"
                    checked={Boolean(value)}
                    onChange={event => commit(event.currentTarget.checked)}
                />
            </span>
        );
    }

    if (port.dataType === "string") {
        return (
            <span className="flow-control nodrag">
                <IEditor.React.TextInput
                    value={value == null ? "" : String(value)}
                    onCommit={next => {
                        commit(next);
                        return true;
                    }}
                />
            </span>
        );
    }

    return null;
}

function isNumberType(type: string): boolean {
    return type === "float"
        || type === "number"
        || type === "int"
        || type === "uint";
}

function isIntegerType(type: string): boolean {
    return type === "int" || type === "uint";
}

function numberValue(value: any): number {
    const number = Number(value);
    return Number.isFinite(number) ? number : 0;
}
