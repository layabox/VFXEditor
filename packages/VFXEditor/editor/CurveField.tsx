import * as React from "react";

type StoredFormat = "frameData" | "frames";

@IEditor.inspectorField("VfxEditor.Curve")
export class CurveField extends IEditor.PropertyField {
    create(): IEditor.IPropertyFieldCreateResult {
        return { stretchWidth: true };
    }

    render(): React.ReactNode {
        const { value, format } = readCurve(this.target.getValue());
        return (
            <IEditor.React.CurveInput
                value={value}
                readonly={this.react?.readonly}
                isCurve
                isWeight
                forceStartEndKeys
                onCommit={(next) => this.target.setValue(writeCurve(next, format))}
            />
        );
    }
}

export function readCurve(source: any): { value: IEditor.CurveInputValue; format: StoredFormat } {
    const keys: IEditor.CurveInputKey[] = [];
    let format: StoredFormat = "frameData";

    if (Array.isArray(source?.frames)) {
        format = "frames";
        for (const frame of source.frames) {
            if (!appendKey(keys, {
                time: Number(frame.time) || 0,
                value: Number(frame.value) || 0,
                inTangent: Number(frame.inTangent) || 0,
                outTangent: Number(frame.outTangent) || 0,
                inWeight: frame.inWeight == null ? 1 / 3 : Number(frame.inWeight),
                outWeight: frame.outWeight == null ? 1 / 3 : Number(frame.outWeight),
                weightedMode: Number(frame.weightedMode) || 0,
            })) break;
        }
    } else if (Array.isArray(source?.frameData)) {
        for (let index = 0; index + 3 < source.frameData.length; index += 7) {
            const values = source.frameData;
            if (!appendKey(keys, {
                time: Number(values[index]) || 0,
                value: Number(values[index + 1]) || 0,
                inTangent: Number(values[index + 2]) || 0,
                outTangent: Number(values[index + 3]) || 0,
                inWeight: values[index + 4] == null ? 1 / 3 : Number(values[index + 4]),
                outWeight: values[index + 5] == null ? 1 / 3 : Number(values[index + 5]),
                weightedMode: Number(values[index + 6]) || 0,
            })) break;
        }
    }

    if (keys.length < 2) {
        keys.length = 0;
        keys.push(
            { time: 0, value: 0, inTangent: 0, outTangent: 0, inWeight: 1 / 3, outWeight: 1 / 3 },
            { time: 1, value: 1, inTangent: 0, outTangent: 0, inWeight: 1 / 3, outWeight: 1 / 3 },
        );
    }

    let curveMin = Math.min(0, ...keys.map(key => key.value));
    let curveMax = Math.max(1, ...keys.map(key => key.value));
    if (curveMin === curveMax)
        curveMax = curveMin + 1;
    return { value: { keys, curveMin, curveMax }, format };
}

function appendKey(keys: IEditor.CurveInputKey[], key: IEditor.CurveInputKey): boolean {
    if (keys.length > 0 && key.time <= keys[keys.length - 1].time)
        return false;
    keys.push(key);
    return true;
}

export function writeCurve(value: IEditor.CurveInputValue | null, format: StoredFormat): any {
    const keys = value?.keys ?? [];
    if (format === "frames") {
        return {
            frames: keys.map(key => ({
                time: key.time,
                value: key.value,
                inTangent: key.inTangent ?? 0,
                outTangent: key.outTangent ?? 0,
                inWeight: key.inWeight ?? 1 / 3,
                outWeight: key.outWeight ?? 1 / 3,
                weightedMode: key.weightedMode ?? 0,
            })),
        };
    }

    const frameData: number[] = [];
    for (const key of keys) {
        frameData.push(
            key.time,
            key.value,
            key.inTangent ?? 0,
            key.outTangent ?? 0,
            key.inWeight ?? 1 / 3,
            key.outWeight ?? 1 / 3,
            key.weightedMode ?? 0,
        );
    }
    return { frameData };
}
