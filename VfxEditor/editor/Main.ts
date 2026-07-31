import { componentTypes } from "./ComponentTypes";
import { editorController } from "./Controller";
import { t } from "./I18n";
import { PANEL_ID } from "./Panel";
import {
    createCaptionTranslation,
    registerAllVfxTypes,
} from "./data/NodeDefinitions";

export class Main {
    @IEditor.onLoad
    static async onLoad(): Promise<void> {
        const typeCaptions = await loadTypeCaptions();
        registerAllVfxTypes(typeCaptions);
        attachComponentTypeTranslations(typeCaptions);
        Editor.typeRegistry.addTypes(
            componentTypes.filter(type => !Editor.typeRegistry.types[type.name]),
        );

        Editor.extensionManager.setFileType(["vfx"], "VFXGraph");
        Editor.extensionManager.setFileIcon(
            ["vfx"],
            "editorResources/vfx/icons/vfx-file.svg",
        );
        Editor.extensionManager.addFileActions(["vfx"], {
            onOpen: asset => openVfx(asset.id),
        });
    }

    @IEditor.menu("Project/create/VFXGraph", {
        label: t("vfxGraph"),
        position: "after create",
    })
    static async createGraph(): Promise<void> {
        const project = Editor.panelManager.getPanel("ProjectPanel") as IEditor.IProjectPanel;
        const template = await Editor.assetDb.getAsset("editorResources/vfx/VfxGraph.vfx", true);
        project.createAsset("VfxGraph.vfx", template ? Editor.assetDb.getFullPath(template) : "");
    }
}

export async function openVfx(assetId: string): Promise<void> {
    Editor.panelManager.showPanel(PANEL_ID);
    await editorController.openFile(assetId);
}

async function loadTypeCaptions(): Promise<Record<string, string> | undefined> {
    if (!i18n.language.startsWith("zh"))
        return undefined;
    try {
        const asset = await Editor.assetDb.getAsset("editorResources/vfx/typeCaption.json", true);
        if (!asset)
            return undefined;
        return await IEditor.utils.readJsonAsync(Editor.assetDb.getFullPath(asset));
    } catch {
        return undefined;
    }
}

function attachComponentTypeTranslations(
    captions?: Record<string, string>,
): void {
    if (!captions)
        return;
    for (const type of componentTypes) {
        type.captionTranslation = createCaptionTranslation(
            captions,
            type.caption ?? type.name,
            type.properties,
        );
    }
}
