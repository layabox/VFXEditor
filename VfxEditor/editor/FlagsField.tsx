import * as React from "react";
import { t } from "./I18n";
import { getVfxCaption } from "./data/NodeDefinitions";

const FLAGS_MENU_ID = "VfxEditor.Flags";

@IEditor.inspectorField("VfxEditor.Flags")
export class FlagsField extends IEditor.PropertyField {
    create(): IEditor.IPropertyFieldCreateResult {
        return { stretchWidth: true };
    }

    render(): React.ReactNode {
        const options = (this.property.enumSource as string[]) ?? [];
        const mask = Number(this.target.getValue()) || 0;
        const selected = options.filter((_, index) => (mask & (1 << index)) !== 0);
        const label = selected.length === 0
            ? t("none")
            : selected.length === options.length
                ? t("all")
                : selected.map(s => getVfxCaption(s)).join(", ");

        return (
            <button
                type="button"
                className="select-input"
                disabled={this.react?.readonly}
                onClick={(event) => this.showMenu(event.currentTarget, options, mask)}
            >
                {label}
            </button>
        );
    }

    private showMenu(anchor: HTMLButtonElement, options: string[], mask: number): void {
        const allMask = (1 << options.length) - 1;
        const menu = IEditor.Menu.getById(FLAGS_MENU_ID) ?? IEditor.Menu.create(FLAGS_MENU_ID);
        menu.setItems([
            { label: t("none"), click: () => this.target.setValue(0) },
            { label: t("all"), click: () => this.target.setValue(allMask) },
            { type: "separator" },
            ...options.map((label, index) => ({
                label: getVfxCaption(label),
                type: "checkbox" as const,
                checked: (mask & (1 << index)) !== 0,
                click: () => this.target.setValue(mask ^ (1 << index)),
            })),
        ]);
        menu.show(null, IEditor.Menu.getPopupPosition(anchor));
    }
}
