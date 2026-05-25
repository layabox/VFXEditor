/**
 * VisualEffect 组件 Inspector 的"Properties"区域自定义字段。
 *
 * 数据流：
 *   - this.target.data         → VisualEffect 组件 props 对象（含 asset / randomSeed / propertyOverrides 等）
 *   - this.target.getValue()   → 当前 propertyOverrides 对象（plain { [name]: number[] }）
 *   - this.target.data.asset   → LayaPro IDE 资源引用 wrapper `{ _$uuid, _$type }` 形态
 *                                通过 Editor.assetDb.getAsset(uuid) → fullPath → readJsonAsync 拿 .vfx JSON
 *
 * UI 结构（按 group 分组）：
 *   ┌──────────────────────────────────────────┐
 *   │ ▼ GroupName                              │  <- group title
 *   │   ☑ DisplayName  [NumericInput] [Input]  │  <- 一行：checkbox + label + editor
 *   │   ☐ Another      [NumericInput]          │
 *   └──────────────────────────────────────────┘
 *
 * 编辑控件按 type：
 *   - float / number / int → 单个 NumericInput
 *   - vec2 / vec3 / vec4   → 多个 NumericInput 横排
 *   - color                → ColorInput（色拾取器，含 alpha）
 *   - Gradient             → read-only placeholder（暂不支持 override）
 *   - 其他                 → 文字显示 default 值
 *
 * checkbox 关闭时 editor 灰显（touchable=false），值显示 default；开启后 editor 可交互，值写到 propertyOverrides[name]
 */
export class VfxPropertyOverridesField extends IEditor.PropertyField {
    private _box: gui.Box;
    private _rowHeight: number = 24;
    private _groupGap: number = 4;

    // asset.properties 缓存（async load）
    private _propertiesCache: any[] | null = null;
    private _cachedAssetKey: string = "";
    private _loadInflight: boolean = false;

    create(): IEditor.IPropertyFieldCreateResult {
        const box = new gui.Box();
        try {
            box.layout.type = gui.LayoutType.SingleColumn;
            box.layout.foldInvisibles = true;
        } catch { /* layout 设置失败不影响 */ }
        box.setSize(280, 24);
        this._box = box;
        this._safeRefresh();
        return { ui: box, stretchWidth: true, captionDisplay: "none" };
    }

    refresh(): void {
        this._safeRefresh();
    }

    private _safeRefresh(): void {
        try { this._rebuild(); }
        catch (e: any) {
            console.warn("[VfxPropertyOverrides] refresh err:", e);
            try { this._addText(`[VFX] error: ${e?.message || e}`, 0xE57C5C); } catch { }
        }
    }

    private _rebuild(): void {
        if (!this._box) return;
        this._box.removeChildren();

        const overrides = this._getOverrides();
        const properties = this._getAssetProperties();

        if (!properties) {
            if (this._loadInflight) {
                this._addText("(加载 properties 中...)", 0x888888);
            } else {
                const data = this.target?.data;
                const asset = data?.asset;
                if (asset) {
                    this._addText(`(无法解析 asset; type=${typeof asset}; 见 console)`, 0xE5C76A);
                } else {
                    this._addText("(请先设置 Asset)", 0x888888);
                }
            }
            return;
        }
        if (properties.length === 0) {
            this._addText("(此 VFX 未在 Blackboard 暴露 Property)", 0x888888);
            return;
        }

        // 按 group 分组（保持 Blackboard 内顺序）
        const groupOrder: string[] = [];
        const groups = new Map<string, any[]>();
        for (const p of properties) {
            const g = (p.group && p.group.length > 0) ? p.group : "Default";
            if (!groups.has(g)) { groups.set(g, []); groupOrder.push(g); }
            groups.get(g)!.push(p);
        }

        for (let i = 0; i < groupOrder.length; i++) {
            const gname = groupOrder[i];
            this._addText(`▼ ${gname}`, 0xAACCEE, 13);
            for (const p of groups.get(gname)!) {
                this._addPropertyRow(p, overrides);
            }
            if (i < groupOrder.length - 1) this._addSpacer(this._groupGap);
        }
    }

    // ── 行渲染 ────────────────────────────────────────────────────

    /** 一行：[checkbox] [label] [editor widget] */
    private _addPropertyRow(p: any, overrides: { [name: string]: number[] }): void {
        try {
            const totalW = (this._box.width || 280);
            const enabled = overrides[p.name] !== undefined;
            const curVal = enabled ? overrides[p.name] : this._toNumberArray(p.default, p.type);
            const display = p.displayName && p.displayName.length > 0 ? p.displayName : p.name;

            const row = new gui.Box();
            try {
                row.layout.type = gui.LayoutType.SingleRow;
                row.layout.foldInvisibles = false;
            } catch { }
            row.setSize(totalW, this._rowHeight);

            // checkbox
            const cb = this._createCheckbox(enabled);
            cb.setSize(18, 18);
            cb.on("changed", () => {
                const newOn = (cb as any).selected;
                if (newOn && overrides[p.name] === undefined) {
                    overrides[p.name] = this._toNumberArray(p.default, p.type);
                } else if (!newOn && overrides[p.name] !== undefined) {
                    delete overrides[p.name];
                }
                this._commit(overrides);
                this._safeRefresh();
            }, this);
            row.addChild(cb);

            // label
            const label = new gui.TextField();
            label.text = display;
            label.color = enabled ? 0xEEEEEE : 0x999999;
            label.wrap = false;
            try { label.style.fontSize = 12; } catch { }
            label.setSize(Math.floor(totalW * 0.32), this._rowHeight);
            row.addChild(label);

            // editor widget by type
            const editorW = totalW - 18 - Math.floor(totalW * 0.32) - 8;
            const t = String(p.type).toLowerCase();
            if (t === "float" || t === "number" || t === "int") {
                this._addNumericEditor(row, p.name, curVal, 1, overrides, enabled, editorW, t === "int");
            } else if (t === "vec2") {
                this._addNumericEditor(row, p.name, curVal, 2, overrides, enabled, editorW, false);
            } else if (t === "vec3") {
                this._addNumericEditor(row, p.name, curVal, 3, overrides, enabled, editorW, false);
            } else if (t === "vec4") {
                this._addNumericEditor(row, p.name, curVal, 4, overrides, enabled, editorW, false);
            } else if (t === "color") {
                this._addColorEditor(row, p.name, curVal, overrides, enabled, editorW);
            } else if (t === "gradient") {
                const note = new gui.TextField();
                note.text = "(gradient: 暂只读)";
                note.color = 0x888888;
                note.wrap = false;
                try { note.style.fontSize = 11; } catch { }
                note.setSize(editorW, this._rowHeight);
                row.addChild(note);
            } else {
                const note = new gui.TextField();
                note.text = `(${p.type}: 暂不支持)`;
                note.color = 0x888888;
                note.wrap = false;
                try { note.style.fontSize = 11; } catch { }
                note.setSize(editorW, this._rowHeight);
                row.addChild(note);
            }

            this._box.addChild(row);
        } catch (e) {
            console.warn("[VfxPropertyOverrides] addPropertyRow failed for", p?.name, e);
        }
    }

    /** Float / Vec 编辑控件：N 个 NumericInput 横排 */
    private _addNumericEditor(
        row: gui.Box, propName: string, values: number[], dim: number,
        overrides: { [name: string]: number[] }, enabled: boolean, totalW: number, intMode: boolean,
    ): void {
        const gap = 2;
        const subW = Math.floor((totalW - gap * (dim - 1)) / dim);
        const localVals: number[] = [];
        for (let i = 0; i < dim; i++) localVals[i] = Number(values?.[i] ?? 0);

        for (let i = 0; i < dim; i++) {
            const input: any = gui.UIPackage.createWidgetSync("~/ui/basic/Input/NumericInput.widget");
            try {
                if (intMode) input.step = 1;
                input.value = localVals[i];
                input.touchable = enabled;
                input.alpha = enabled ? 1.0 : 0.4;
            } catch { }
            input.setSize(subW, this._rowHeight - 2);
            const idx = i;
            input.on("submit", () => {
                if (!enabled) return;
                localVals[idx] = Number(input.value);
                overrides[propName] = localVals.slice();
                this._commit(overrides);
            }, this);
            row.addChild(input);
        }
    }

    /** Color 编辑控件：ColorInput 色拾取器 */
    private _addColorEditor(
        row: gui.Box, propName: string, values: number[],
        overrides: { [name: string]: number[] }, enabled: boolean, totalW: number,
    ): void {
        try {
            const input: any = gui.UIPackage.createWidgetSync("~/ui/basic/ColorPicker/ColorInput.widget");
            const r = Number(values?.[0] ?? 0);
            const g = Number(values?.[1] ?? 0);
            const b = Number(values?.[2] ?? 0);
            const a = Number(values?.[3] ?? 1);
            try {
                // ColorInput 用 gui.Color 设值
                const col = new gui.Color();
                col.r = r; col.g = g; col.b = b; col.a = a;
                if ((input as any).colorValue) (input as any).colorValue = col;
                input.touchable = enabled;
                input.alpha = enabled ? 1.0 : 0.4;
            } catch (e) { console.warn("[VfxPropertyOverrides] color init failed", e); }
            input.setSize(totalW, this._rowHeight - 2);
            input.on("submit", () => {
                if (!enabled) return;
                try {
                    const c: any = (input as any).colorValue;
                    if (c) {
                        overrides[propName] = [Number(c.r) || 0, Number(c.g) || 0, Number(c.b) || 0, Number(c.a) || 1];
                        this._commit(overrides);
                    }
                } catch (e) { console.warn("[VfxPropertyOverrides] color submit err", e); }
            }, this);
            row.addChild(input);
        } catch (e) {
            // ColorInput widget 不存在或抛错 → fallback 用 4 个 NumericInput
            console.warn("[VfxPropertyOverrides] ColorInput fallback to NumericInput x4:", e);
            this._addNumericEditor(row, propName, values, 4, overrides, enabled, totalW, false);
        }
    }

    /** 创建 checkbox widget（清空 default "text" 字段避免跟 label 文字重叠） */
    private _createCheckbox(checked: boolean): gui.Button {
        const cb: any = gui.UIPackage.createWidgetSync("~/ui/basic/Button/Checkbox_as.widget");
        try { cb.text = ""; cb.selected = checked; cb.width = 20; } catch { }
        return cb;
    }

    /** 单行 TextField（group title / placeholder） */
    private _addText(text: string, color: number, fontSize: number = 12): void {
        try {
            const tf = new gui.TextField();
            tf.text = text;
            tf.color = color;
            tf.wrap = false;
            try { tf.style.fontSize = fontSize; } catch { }
            tf.setSize((this._box.width || 280) - 4, this._rowHeight);
            this._box.addChild(tf);
        } catch (e) {
            console.warn("[VfxPropertyOverrides] addText failed:", e);
        }
    }

    /** Group 之间空白行 */
    private _addSpacer(height: number): void {
        try {
            const tf = new gui.TextField();
            tf.text = "";
            tf.setSize(1, height);
            this._box.addChild(tf);
        } catch { }
    }

    // ── 数据 helpers ──────────────────────────────────────────────

    /** 取当前 propertyOverrides（字段是 JSON string，反序列化成 object 给 UI 用） */
    private _getOverrides(): { [name: string]: number[] } {
        try {
            const v = this.target?.getValue();
            // 已经是 object（老版本场景兼容）
            if (v && typeof v === "object") return v;
            // string 形式
            if (typeof v === "string" && v.length > 0) {
                try {
                    const parsed = JSON.parse(v);
                    return (parsed && typeof parsed === "object") ? parsed : {};
                } catch { return {}; }
            }
            return {};
        } catch { return {}; }
    }

    /** 取 asset.properties（async load .vfx JSON） */
    private _getAssetProperties(): any[] | null {
        try {
            const data = this.target?.data;
            const asset = data?.asset;
            if (!asset) { this._propertiesCache = null; this._cachedAssetKey = ""; return null; }

            // 形态 1：已加载 VFXAsset 实例
            if (Array.isArray((asset as any).properties)) {
                return (asset as any).properties;
            }

            // 形态 2/3：拿 uuid（LayaPro IDE wrapper 用 _$uuid）
            let uuid: string | null = null;
            if (typeof asset === "string") {
                uuid = asset.replace(/^res:\/\//, "");
            } else if (typeof asset === "object") {
                const a: any = asset;
                uuid = a._$uuid || a.uuid || a._uuid || a.id || null;
            }
            if (!uuid) {
                try {
                    console.log("[VfxPropertyOverrides] unknown asset shape:", typeof asset,
                        typeof asset === "object" ? Object.keys(asset as any).slice(0, 10) : asset);
                } catch { }
                return null;
            }

            // cache 命中
            if (this._propertiesCache && this._cachedAssetKey === uuid) {
                return this._propertiesCache;
            }
            if (this._loadInflight) return null;

            // async 加载
            this._loadInflight = true;
            const myKey = uuid;
            (async () => {
                try {
                    const assetInfo: any = await (Editor as any).assetDb?.getAsset?.(myKey);
                    if (!assetInfo) return;
                    const fullPath: string = (Editor as any).assetDb?.getFullPath?.(assetInfo);
                    if (!fullPath) return;
                    const json: any = await (IEditor as any).utils?.readJsonAsync?.(fullPath);
                    if (!json) return;
                    if (Array.isArray(json.properties)) {
                        this._propertiesCache = json.properties;
                        this._cachedAssetKey = myKey;
                        this._safeRefresh();
                    }
                } catch (e) {
                    console.warn("[VfxPropertyOverrides] async load failed:", e);
                } finally {
                    this._loadInflight = false;
                }
            })();
            return null;
        } catch { return null; }
    }

    /** VFXPropertyDesc.default 正规化成 number[] */
    private _toNumberArray(value: any, type: string): number[] {
        const t = String(type).toLowerCase();
        if (Array.isArray(value)) {
            const r = value.map(v => Number(v) || 0);
            switch (t) {
                case "vec4": case "color":
                    while (r.length < 4) r.push(0);
                    return r.slice(0, 4);
                case "vec3":
                    while (r.length < 3) r.push(0);
                    return r.slice(0, 3);
                case "vec2":
                    while (r.length < 2) r.push(0);
                    return r.slice(0, 2);
                default:
                    return r.length > 0 ? [r[0]] : [0];
            }
        }
        if (typeof value === "number") return [value];
        if (value && typeof value === "object") {
            const keys = t === "color" ? ["r", "g", "b", "a"] : ["x", "y", "z", "w"];
            const r: number[] = [];
            for (const k of keys) {
                if (k in value) r.push(Number((value as any)[k]) || 0);
            }
            if (r.length > 0) return r;
        }
        switch (t) {
            case "vec4": case "color": return [0, 0, 0, 0];
            case "vec3": return [0, 0, 0];
            case "vec2": return [0, 0];
            default: return [0];
        }
    }

    /** 写回 propertyOverrides 到 target data，触发 dirty + scene save
     *  序列化成 JSON string —— LayaPro 序列化层不识别 plain object dynamic-key map（会 fallback null），
     *  必须 string 才能正确保存到 .ls 文件。
     */
    private _commit(overrides: { [name: string]: number[] }): void {
        try {
            const json = JSON.stringify(overrides || {});
            this.target?.setValue(json);
        } catch (e) {
            console.warn("[VfxPropertyOverrides] commit failed:", e);
        }
    }
}
