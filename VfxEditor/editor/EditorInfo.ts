import path from "path";

interface VfxEditorInfo {
    kind: "vfx-editor";
    version: 1;
    viewport?: IEditor.FlowApi.GraphViewport;
}

const cache = new Map<string, VfxEditorInfo>();
let cachedProjectPath = "";

function ensureProjectCache(): void {
    if (cachedProjectPath === Editor.projectPath)
        return;
    cachedProjectPath = Editor.projectPath;
    cache.clear();
}

function emptyInfo(): VfxEditorInfo {
    return {
        kind: "vfx-editor",
        version: 1,
    };
}

function infoPath(projectPath: string, assetId: string): string {
    return path.join(projectPath, "library", assetId.substring(0, 2), `${assetId}.info`);
}

function normalizeInfo(value: unknown): VfxEditorInfo | null {
    if (!value || typeof value !== "object")
        return null;
    const raw = value as Partial<VfxEditorInfo>;
    if (raw.kind !== "vfx-editor")
        return null;
    return {
        kind: "vfx-editor",
        version: 1,
        viewport: raw.viewport
            ? IEditor.Flow.normalizeGraphViewport(raw.viewport)
            : undefined,
    };
}

function getInfo(assetId: string): VfxEditorInfo {
    ensureProjectCache();
    const info = cache.get(assetId);
    if (!info)
        throw new Error(`VFX editor state for '${assetId}' was accessed before the document was opened`);
    return info;
}

function scheduleWrite(assetId: string, info: VfxEditorInfo): void {
    IEditor.utils.scheduleFileWrite(
        infoPath(cachedProjectPath, assetId),
        JSON.stringify(info),
    );
}

export async function openEditorInfo(assetId: string): Promise<void> {
    ensureProjectCache();
    if (cache.has(assetId))
        return;
    const filePath = infoPath(cachedProjectPath, assetId);
    await IEditor.utils.flushFileWrites(filePath);
    const source = await IEditor.utils.readJsonAsync(filePath, true);
    cache.set(assetId, normalizeInfo(source) ?? emptyInfo());
}

export function closeEditorInfo(assetId: string): void {
    ensureProjectCache();
    cache.delete(assetId);
}

export function getGraphViewport(
    assetId: string,
    legacyViewport?: Partial<IEditor.FlowApi.GraphViewport>,
): IEditor.FlowApi.GraphViewport {
    const info = getInfo(assetId);
    if (info.viewport)
        return IEditor.Flow.normalizeGraphViewport(info.viewport);
    const viewport = IEditor.Flow.normalizeGraphViewport(legacyViewport);
    info.viewport = viewport;
    scheduleWrite(assetId, info);
    return viewport;
}

export function setGraphViewport(
    assetId: string,
    viewport: IEditor.FlowApi.GraphViewport,
): void {
    const info = getInfo(assetId);
    const next = IEditor.Flow.normalizeGraphViewport(viewport);
    const current = info.viewport;
    if (current?.x === next.x && current.y === next.y && current.zoom === next.zoom)
        return;
    info.viewport = next;
    scheduleWrite(assetId, info);
}
