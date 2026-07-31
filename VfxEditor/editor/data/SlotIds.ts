const BLOCK_SLOT_PREFIX = "block_";
const SHORT_BLOCK_SLOT_PREFIX = "b";
const BLOCK_SLOT_SEPARATOR = "_";

export function buildBlockSlotId(blockId: number, inputId: string): string {
    return `${BLOCK_SLOT_PREFIX}${blockId}${BLOCK_SLOT_SEPARATOR}${inputId}`;
}

export function parseBlockSlotId(slotId: string): { blockId: number; inputId: string } | null {
    if (slotId.startsWith(BLOCK_SLOT_PREFIX)) {
        const separator = slotId.indexOf(BLOCK_SLOT_SEPARATOR, BLOCK_SLOT_PREFIX.length);
        if (separator < 0)
            return null;
        const blockId = Number(slotId.slice(BLOCK_SLOT_PREFIX.length, separator));
        if (!Number.isSafeInteger(blockId))
            return null;
        return { blockId, inputId: slotId.slice(separator + 1) };
    }

    if (!slotId.startsWith(SHORT_BLOCK_SLOT_PREFIX))
        return null;
    const separator = slotId.indexOf(BLOCK_SLOT_SEPARATOR, SHORT_BLOCK_SLOT_PREFIX.length);
    if (separator < 0)
        return null;
    const blockId = Number(slotId.slice(SHORT_BLOCK_SLOT_PREFIX.length, separator));
    if (!Number.isSafeInteger(blockId))
        return null;
    return { blockId, inputId: slotId.slice(separator + 1) };
}

export function normalizeBlockSlotId(slotId: string): string {
    const parsed = parseBlockSlotId(slotId);
    return parsed ? buildBlockSlotId(parsed.blockId, parsed.inputId) : slotId;
}
