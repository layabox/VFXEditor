import { VfxDocument } from "./Document";

type FileTabBar = InstanceType<typeof IEditor.React.FileTabBar>;

export interface WorkspaceState {
    openFiles: string[];
    activeFile?: string;
    leftWidth: number;
    inspectorHeight: number;
}

class EditorController {
    readonly documents = new Map<string, VfxDocument>();
    active: VfxDocument | null = null;

    private _tabBar: FileTabBar | null = null;
    private _version = 0;
    private readonly _listeners = new Set<() => void>();
    private readonly _opening = new Map<string, Promise<VfxDocument | null>>();
    private _leftWidth = 320;
    private _inspectorHeight = 240;
    private _historyScope: "graph" | "meta" = "graph";
    private _activeOpenRequest = 0;
    private _watchingAssets = false;

    get tabBar(): FileTabBar {
        if (!this._tabBar) {
            this._tabBar = new IEditor.React.FileTabBar();
            this._tabBar.onTabSelected = tab => this.setActive(tab.assetId);
            this._tabBar.onTabWillClose = async (tabs, needSave) => {
                if (needSave) {
                    for (const tab of tabs) {
                        if (tab.isModified)
                            await this.documents.get(tab.assetId)?.save();
                    }
                }
                for (const tab of tabs)
                    this.closeDocument(tab.assetId);
            };
            this._tabBar.onTabSave = async tabs => {
                for (const tab of tabs)
                    await this.documents.get(tab.assetId)?.save();
                this.emit();
            };
        }
        return this._tabBar;
    }

    get leftWidth(): number {
        return this._leftWidth;
    }

    setLeftWidth(value: number): void {
        if (!Number.isFinite(value))
            return;
        const next = Math.max(220, Math.round(value));
        if (next === this._leftWidth)
            return;
        this._leftWidth = next;
        this.emit();
    }

    get inspectorHeight(): number {
        return this._inspectorHeight;
    }

    setInspectorHeight(value: number): void {
        if (!Number.isFinite(value))
            return;
        const next = Math.max(140, Math.min(420, Math.round(value)));
        if (next === this._inspectorHeight)
            return;
        this._inspectorHeight = next;
        this.emit();
    }

    setHistoryScope(scope: "graph" | "meta"): void {
        this._historyScope = scope;
    }

    readonly subscribe = (listener: () => void): (() => void) => {
        this._listeners.add(listener);
        return () => this._listeners.delete(listener);
    };

    readonly getSnapshot = (): number => this._version;

    startAssetWatching(): void {
        if (this._watchingAssets)
            return;
        this._watchingAssets = true;
        Editor.assetDb.onAssetChanged.add(this.onAssetChanged, this);
    }

    stopAssetWatching(): void {
        if (!this._watchingAssets)
            return;
        this._watchingAssets = false;
        Editor.assetDb.onAssetChanged.remove(this.onAssetChanged, this);
    }

    async openFile(assetId: string, activate = true): Promise<void> {
        const request = activate ? ++this._activeOpenRequest : 0;
        let document: VfxDocument | null | undefined = this.documents.get(assetId);
        if (!document) {
            let opening = this._opening.get(assetId);
            if (!opening) {
                opening = VfxDocument.open(assetId);
                this._opening.set(assetId, opening);
            }
            try {
                document = await opening;
            } finally {
                if (this._opening.get(assetId) === opening)
                    this._opening.delete(assetId);
            }
            if (!document)
                return;

            const registered = this.documents.get(assetId);
            if (registered) {
                document.dispose();
                document = registered;
            } else {
                this.attachDocument(document);
                this.documents.set(assetId, document);
                const asset = await Editor.assetDb.getAsset(assetId);
                if (!asset) {
                    this.closeDocument(assetId);
                    return;
                }
                this.tabBar.addTab({
                    id: assetId,
                    assetId,
                    fileType: asset.type,
                    isModified: false,
                }, undefined, false);
            }
        }
        if (activate && request === this._activeOpenRequest)
            this.setActive(assetId);
    }

    setActive(assetId: string): void {
        const document = this.documents.get(assetId) ?? null;
        this.active = document;
        if (document && this._tabBar) {
            const tab = this._tabBar.findTab(item => item.assetId === assetId);
            if (tab && this._tabBar.selectedTab !== tab)
                this._tabBar.selectedTab = tab;
        }
        this.emit();
    }

    async saveActive(): Promise<void> {
        await this.active?.save();
        this.emit();
    }

    async saveModified(): Promise<void> {
        for (const document of this.documents.values()) {
            if (document.modified)
                await document.save();
        }
        this.emit();
    }

    getUnsavedFiles(): string[] {
        return Array.from(this.documents.values())
            .filter(document => document.modified)
            .map(document => document.fileName);
    }

    async restoreWorkspaceState(state: Partial<WorkspaceState>): Promise<void> {
        const mayRestoreActive = this._activeOpenRequest === 0;
        this.setLeftWidth(state.leftWidth ?? this._leftWidth);
        this.setInspectorHeight(state.inspectorHeight ?? this._inspectorHeight);
        const openFiles = Array.isArray(state.openFiles)
            ? Array.from(new Set(state.openFiles.filter(id => typeof id === "string" && !!id)))
            : [];
        for (const assetId of openFiles) {
            try {
                await this.openFile(assetId, false);
            } catch (error) {
                console.warn("[VfxEditor] failed to restore document:", assetId, error);
            }
        }
        const target = state.activeFile && this.documents.has(state.activeFile)
            ? state.activeFile
            : openFiles.find(id => this.documents.has(id));
        if (target && mayRestoreActive && this._activeOpenRequest === 0)
            this.setActive(target);
        else
            this.emit();
    }

    getWorkspaceState(): WorkspaceState {
        const tabs = this._tabBar?.getTabs() ?? [];
        return {
            openFiles: tabs.length ? tabs.map(tab => tab.assetId) : Array.from(this.documents.keys()),
            activeFile: this.active?.assetId,
            leftWidth: this._leftWidth,
            inspectorHeight: this._inspectorHeight,
        };
    }

    handleHotkey(combo: string): boolean {
        if (combo === "save" || combo === "mod+s") {
            void this.saveActive();
            return true;
        }
        if (combo === "undo" || combo === "redo") {
            const document = this.active;
            const scope = this._historyScope;
            const store = scope === "meta" ? document?.metaStore : document?.graphStore;
            if (combo === "undo") {
                if (store?.canUndo) document?.undo(scope);
                else Editor.shell.beep();
            } else {
                if (store?.canRedo) document?.redo(scope);
                else Editor.shell.beep();
            }
            return true;
        }
        return false;
    }

    dispose(): void {
        for (const document of this.documents.values())
            document.dispose();
        this.documents.clear();
        this.active = null;
        this._opening.clear();
        this.emit();
    }

    notify(): void {
        this.emit();
    }

    private attachDocument(document: VfxDocument): void {
        document.onChange = () => {
            this.updateTab(document);
            this.emit();
        };
        document.onModifiedChange = () => {
            this.updateTab(document);
            this.emit();
        };
    }

    private updateTab(document: VfxDocument): void {
        if (!Editor.assetDb.getAssetSync(document.assetId)) {
            this.closeDocument(document.assetId);
            return;
        }
        const tab = this._tabBar?.findTab(item => item.assetId === document.assetId);
        if (!tab)
            return;
        tab.isModified = document.modified;
        this._tabBar?.updateUI(tab.id);
    }

    private onAssetChanged(
        assetId: string,
        _assetPath: string,
        _assetType: IEditor.AssetType,
        flag: IEditor.AssetChangedFlag,
    ): void {
        if (flag === IEditor.AssetChangedFlag.Deleted)
            this.closeDocument(assetId);
    }

    private closeDocument(assetId: string): void {
        const document = this.documents.get(assetId);
        if (!document)
            return;
        if (this.active === document)
            this.active = null;
        document.dispose();
        this.documents.delete(assetId);
        this._tabBar?.removeTab(assetId);
        this.emit();
    }

    private emit(): void {
        this._version++;
        for (const listener of Array.from(this._listeners))
            listener();
    }
}

export const editorController = new EditorController();
