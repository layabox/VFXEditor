import { createElement } from "react";
import { editorController, type WorkspaceState } from "./Controller";
import { EditorView } from "./EditorView";
import { t } from "./I18n";
import panelStyles from "./Panel.css";

export const PANEL_ID = "Layabox.VfxEditor.MainPanel";

@IEditor.panel(PANEL_ID, {
    title: t("vfxGraph"),
    icon: "editorResources/vfx/icons/vfx-panel.svg",
    location: "popup",
    showInMenu: false,
    autoStart: false,
    alwaysInFront: false
})
export class Panel extends IEditor.EditorPanel {
    private _react: IEditor.ReactDOM;
    private _restored = false;

    async create(): Promise<void> {
        this._react = new IEditor.ReactDOM();
        this._react.setSize(1100, 720);
        this._react.adoptStyles(IEditor.Flow.styles + "\n" + panelStyles);
        this._panel = this._react;
        editorController.onLastDocumentClosed = this.closePopupIfAlone;
        this._react.render(createElement(EditorView));
    }

    async openFile(assetId: string): Promise<void> {
        await editorController.openFile(assetId);
    }

    onStart(): void {
        editorController.startAssetWatching();
        if (this._restored)
            return;
        this._restored = true;
        void editorController.restoreWorkspaceState(readWorkspaceState());
    }

    onHotkey(combo: string): boolean {
        return editorController.handleHotkey(combo);
    }

    getUnsavedFiles(): string[] {
        return editorController.getUnsavedFiles();
    }

    async onSave(): Promise<void> {
        await editorController.saveModified();
    }

    onSaveStatus(): void {
        if (this._restored)
            writeWorkspaceState(editorController.getWorkspaceState());
    }

    onDestroy(): void {
        editorController.onLastDocumentClosed = null;
        editorController.stopAssetWatching();
        editorController.dispose();
        this._react?.dispose();
    }

    private readonly closePopupIfAlone = (): void => {
        if (Editor.panelManager.isPanelAloneInSingleGridPopup(PANEL_ID))
            Editor.panelManager.hidePanel(PANEL_ID);
    };
}

function readWorkspaceState(): Partial<WorkspaceState> {
    const section = Editor.workspaceConf.data.getSection(PANEL_ID);
    const openFiles = section.get("openFiles", []);
    return {
        openFiles: Array.isArray(openFiles) ? openFiles : [],
        activeFile: section.get("activeFile", ""),
        leftWidth: section.getNumber("leftWidth", 320),
        inspectorHeight: section.getNumber("inspectorHeight", 240),
    };
}

function writeWorkspaceState(state: WorkspaceState): void {
    const section = Editor.workspaceConf.data.getSection(PANEL_ID);
    section.set("openFiles", state.openFiles);
    section.set("activeFile", state.activeFile ?? "");
    section.set("leftWidth", state.leftWidth);
    section.set("inspectorHeight", state.inspectorHeight);
}
