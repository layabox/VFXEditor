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

    // 已构建的行(供 resize 时廉价重排, 不重建)
    private _rowItems: Array<{ row: gui.Box; label: gui.TextField; display: string; editor: any; editorY: number; editorH: number }> = [];
    private _relayouting: boolean = false;

    // 分组折叠状态(组名 → 是否折叠), 点击组标题箭头切换, 折叠则不渲染该组属性行
    private _collapsed: { [group: string]: boolean } = {};

    // 本次构建累计的内容高度(用于撑高 box, 见 _setBoxHeight)
    private _builtHeight: number = 0;

    create(): IEditor.IPropertyFieldCreateResult {
        const box = new gui.Box();
        try {
            box.layout.type = gui.LayoutType.SingleColumn;   // 仅做行的纵向堆叠; 横向宽度由 _relayout 手动控制
            box.layout.foldInvisibles = true;
            box.layout.rowGap = 0;   // 无行间距, 使 _builtHeight 累加值 = 实际内容高度
        } catch { /* layout 设置失败不影响 */ }
        box.setSize(280, 24);
        this._box = box;
        // 面板缩放时只做廉价重排(setPos/setSize + 截断 label, 不 removeChildren 不重建) → 既不闪动也无重建延迟,
        // 且 caption 列宽跟随面板收缩(跟标准字段一致), 避免窄面板 label 溢出重叠.
        try { box.on("size_changed", this._onResize, this); } catch { }
        this._safeRefresh();
        return { ui: box, stretchWidth: true, captionDisplay: "none" };
    }

    /** box 尺寸变化 → 廉价重排已存在的行(不重建). 加 guard 防递归. */
    private _onResize(): void {
        if (this._relayouting) return;
        try { this._relayout(); } catch (e) { console.warn("[VfxPropertyOverrides] relayout err:", e); }
    }

    /** 按当前可用宽度重新摆放每行的 label / editor(setPos/setSize), 并截断 label 文字防溢出.
     *  纯轻量操作, 无 DOM 重建 → 拖动面板时实时跟手且不闪动. */
    private _relayout(): void {
        if (!this._box || this._rowItems.length === 0) return;
        this._relayouting = true;
        try {
            const totalW = this._availWidth();
            const rh = this._rowHeight;
            const cbW = 18, gap = 4;
            const labelAreaW = this._labelAreaWidth(totalW);
            const labelW = Math.max(24, labelAreaW - cbW - gap * 2);
            const editorX = labelAreaW;
            const editorW = Math.max(40, totalW - labelAreaW - 2);
            for (const it of this._rowItems) {
                if (!it || !it.row) continue;
                try { it.row.setSize(totalW, rh); } catch { }
                if (it.label) {
                    try {
                        it.label.setSize(labelW, rh);
                        it.label.setPos(cbW + gap, 0);
                        it.label.text = this._truncate(it.display, labelW);   // 手动截断, 不依赖 autoSize=Ellipsis(本版本不裁)
                    } catch { }
                }
                if (it.editor) {
                    try {
                        it.editor.setPos(editorX, it.editorY);
                        it.editor.setSize(editorW, it.editorH);
                    } catch { }
                }
            }
        } finally {
            this._relayouting = false;
        }
    }

    /** 按像素宽度估算可容纳字符数并截断(超出加省略号). fontSize 12 取保守 ~6.8px/char, 宁可短不溢出. */
    private _truncate(text: string, width: number): string {
        if (!text) return "";
        const maxChars = Math.max(1, Math.floor((width - 4) / 6.8));
        if (text.length <= maxChars) return text;
        return text.slice(0, Math.max(1, maxChars - 1)) + "…";
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
        this._rowItems = [];
        this._builtHeight = 0;   // 累计内容高度, 构建后设到 box.height(否则下方组件会压上来重叠)

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
            this._setBoxHeight();
            return;
        }
        if (properties.length === 0) {
            this._addText("(此 VFX 未在 Blackboard 暴露 Property)", 0x888888);
            this._setBoxHeight();
            return;
        }

        // 按 group 分组（保持 Blackboard 内顺序）
        const groupOrder: string[] = [];
        const groups = new Map<string, any[]>();
        for (const p of properties) {
            const g = (p.group && p.group.length > 0) ? p.group : "Properties";
            if (!groups.has(g)) { groups.set(g, []); groupOrder.push(g); }
            groups.get(g)!.push(p);
        }

        for (let i = 0; i < groupOrder.length; i++) {
            const gname = groupOrder[i];
            const collapsed = this._collapsed[gname] === true;
            this._addGroupHeader(gname, collapsed);
            if (!collapsed) {
                for (const p of groups.get(gname)!) {
                    this._addPropertyRow(p, overrides);
                }
            }
            if (i < groupOrder.length - 1) this._addSpacer(this._groupGap);
        }

        // 构建完成后按当前宽度摆放一次(确定 label/editor 列宽与位置)
        this._relayout();
        // 把 box 高度撑到内容总高, 否则框架按 holder.height=panel.height 定位下个组件会重叠
        this._setBoxHeight();
    }

    /** box 高度设为已累计的内容总高(SingleColumn 布局不会自动撑高 box 自身, 需手动设) */
    private _setBoxHeight(): void {
        try { this._box.height = Math.max(this._builtHeight, this._rowHeight); } catch { }
    }

    /** 当前可用内容宽度.
     *  不能直接读 this._box.width: box 挂了 SingleColumn layout, layout 会把 box 宽度塌缩到内容宽度,
     *  跟框架给 panel 设的 Width relation(=holder.width) 打架, 读到的是塌缩后的过小值, 导致编辑控件填不满面板.
     *  改从 cell(InspectorItem) 直接取: 本字段 box 从 titleObject.x 起始铺满 holder, 可用宽度 = cell.width - titleObject.x. */
    private _availWidth(): number {
        try {
            const cell: any = (this as any).cell;
            if (cell && typeof cell.width === "number" && cell.width > 0) {
                const titleX = Number(cell.titleObject && cell.titleObject.x) || 0;
                const w = cell.width - titleX - 2;   // 右侧留 2px 边距
                if (w > 60) return w;
            }
        } catch { }
        return (this._box && this._box.width) || 280;
    }

    /** 计算 label 区域宽度, 使编辑控件起始位置对齐 IDE 标准属性面板的 value 列.
     *  复刻 InspectorItem 的 caption 宽度公式:
     *    w = clamp(floor((cell.width - sourceWidth) * 0.5) + titleInitWidth, 70, 400)   // caption 右边缘(cell 坐标)
     *  本字段 captionDisplay="none", box 从 titleObject.x 起始铺满, 故 value 列在 box-local = w - titleObject.x.
     *  读不到 cell 内部时回退到 0.38 启发式. */
    private _labelAreaWidth(totalW: number): number {
        try {
            const cell: any = (this as any).cell;
            if (cell && typeof cell.width === "number") {
                const sourceW = Number(cell.sourceWidth) || 0;
                const titleInitW = Number(cell._titleInitWidth) || 0;
                const titleX = Number(cell.titleObject && cell.titleObject.x) || 0;
                let w = Math.floor((cell.width - sourceW) * 0.5) + titleInitW;
                if (w < 70) w = 70; else if (w > 400) w = 400;
                const la = w - titleX;
                if (la > 30 && la < totalW - 40) return la;
            }
        } catch { }
        return Math.floor(totalW * 0.38);
    }

    // ── 行渲染 ────────────────────────────────────────────────────

    /** 一行：[checkbox] [label] [editor widget] */
    private _addPropertyRow(p: any, overrides: { [name: string]: number[] }): void {
        try {
            const totalW = this._availWidth();
            const enabled = overrides[p.name] !== undefined;
            const curVal = enabled ? overrides[p.name] : this._toNumberArray(p.default, p.type);
            const display = p.displayName && p.displayName.length > 0 ? p.displayName : p.name;

            // 行容器: 不用 layout, 子节点 setPos 定位. 这里只做初始摆放, 面板缩放时由 _relayout 重新摆放(无重建).
            const rh = this._rowHeight;
            const cbW = 18;
            const gap = 4;
            const labelAreaW = this._labelAreaWidth(totalW);
            const labelW = Math.max(24, labelAreaW - cbW - gap * 2);  // editor 起始 x = cbW + gap + labelW + gap = labelAreaW
            const editorX = labelAreaW;
            const editorW = Math.max(40, totalW - labelAreaW - 2);

            const row = new gui.Box();
            row.setSize(totalW, rh);

            // checkbox —— 固定, 左对齐, 垂直居中
            const cb = this._createCheckbox(enabled);
            cb.setSize(cbW, 18);
            cb.setPos(0, Math.floor((rh - 18) / 2));
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

            // label —— 固定宽度列, 文字由 _relayout 手动截断防溢出, 列宽对齐标准 caption 使编辑控件与标准 value 列对齐
            const label = new gui.TextField();
            label.text = display;
            label.color = enabled ? 0xEEEEEE : 0x999999;
            label.wrap = false;
            try { label.style.fontSize = 12; } catch { }
            try { (label as any).title = display; } catch { }   // 悬停显示完整名
            label.setSize(labelW, rh);
            label.setPos(cbW + gap, 0);
            row.addChild(label);

            // editor —— 初始摆放在 editorX/editorW, 之后由 _relayout 随面板宽度重新摆放(无重建)
            const t = String(p.type).toLowerCase();
            let editor: any = null, editorY = 1, editorH = rh - 2;
            if (t === "float" || t === "number" || t === "int") {
                editor = this._addNumericEditor(row, p.name, curVal, overrides, enabled, editorX, editorW, rh, t === "int");
                editorY = 1; editorH = rh - 2;
            } else if (t === "vec2" || t === "vec3" || t === "vec4") {
                const dim = t === "vec2" ? 2 : (t === "vec3" ? 3 : 4);
                editor = this._addVecEditor(row, p.name, curVal, dim, overrides, enabled, editorX, editorW, rh);
                editorY = 0; editorH = rh;
            } else if (t === "color") {
                editor = this._addColorEditor(row, p.name, curVal, overrides, enabled, editorX, editorW, rh);
                editorY = 1; editorH = rh - 2;
            } else {
                const note = new gui.TextField();
                note.text = t === "gradient" ? "(gradient: 暂只读)" : `(${p.type}: 暂不支持)`;
                note.color = 0x888888;
                note.wrap = false;
                try { note.style.fontSize = 11; } catch { }
                note.setSize(editorW, rh);
                note.setPos(editorX, 0);
                row.addChild(note);
                editor = note; editorY = 0; editorH = rh;
            }

            this._box.addChild(row);
            this._rowItems.push({ row, label, display, editor, editorY, editorH });
            this._builtHeight += this._rowHeight;
        } catch (e) {
            console.warn("[VfxPropertyOverrides] addPropertyRow failed for", p?.name, e);
        }
    }

    /** Float 编辑控件：单个 NumericInput. 返回 widget 供 _relayout 重新摆放 */
    private _addNumericEditor(
        row: gui.Box, propName: string, values: number[],
        overrides: { [name: string]: number[] }, enabled: boolean,
        x: number, width: number, rh: number, intMode: boolean,
    ): any {
        const localVals: number[] = [Number(values?.[0] ?? 0)];
        const input: any = gui.UIPackage.createWidgetSync("~/ui/basic/Input/NumericInput.widget");
        try {
            if (intMode) input.step = 1;
            input.value = localVals[0];
            input.touchable = enabled;
            input.alpha = enabled ? 1.0 : 0.4;
        } catch { }
        input.setSize(width, rh - 2);
        input.setPos(x, 1);
        input.on("submit", () => {
            if (!enabled) return;
            localVals[0] = Number(input.value);
            overrides[propName] = localVals.slice();
            this._commit(overrides);
        }, this);
        row.addChild(input);
        return input;
    }

    /** Vec2/3/4 编辑控件：直接复用 IDE 标准 Vec*Field.widget 预制件,
     *  其内部 relation 会把 x/y/z/w 输入框等分并随宽度伸缩(跟 Position 字段完全一致). 返回 widget. */
    private _addVecEditor(
        row: gui.Box, propName: string, values: number[], dim: number,
        overrides: { [name: string]: number[] }, enabled: boolean,
        x: number, width: number, rh: number,
    ): any {
        const res = dim === 2 ? "Vec2Field" : (dim === 3 ? "Vec3Field" : "Vec4Field");
        let widget: any = null;
        try { widget = gui.UIPackage.createWidgetSync(`~/ui/basic/Inspector/${res}.widget`); } catch { }
        if (!widget) {
            // 预制件不可用 → 兜底用单个 NumericInput 显示第一分量
            return this._addNumericEditor(row, propName, values, overrides, enabled, x, width, rh, false);
        }
        const axes = ["x", "y", "z", "w"];
        const localVals: number[] = [];
        for (let i = 0; i < dim; i++) localVals[i] = Number(values?.[i] ?? 0);

        try { widget.getController("checkable").selectedIndex = 0; } catch { }   // 关掉 nullable 勾选, 始终显示输入框
        for (let i = 0; i < dim; i++) {
            const ni: any = widget.getChild(axes[i]);
            if (!ni) continue;
            try { ni.value = localVals[i]; ni.touchable = enabled; } catch { }
            const idx = i;
            ni.on("submit", () => {
                if (!enabled) return;
                localVals[idx] = Number(ni.value);
                overrides[propName] = localVals.slice();
                this._commit(overrides);
            }, this);
        }
        try { widget.alpha = enabled ? 1.0 : 0.4; } catch { }
        widget.setSize(width, rh);
        widget.setPos(x, 0);
        row.addChild(widget);
        return widget;
    }

    /** Color 编辑控件：ColorInput 色拾取器. 返回 widget 供 _relayout 重新摆放 */
    private _addColorEditor(
        row: gui.Box, propName: string, values: number[],
        overrides: { [name: string]: number[] }, enabled: boolean,
        x: number, width: number, rh: number,
    ): any {
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
            input.setSize(width, rh - 2);
            input.setPos(x, 1);
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
            return input;
        } catch (e) {
            // ColorInput widget 不存在或抛错 → fallback 用单个 NumericInput
            console.warn("[VfxPropertyOverrides] ColorInput fallback to NumericInput:", e);
            return this._addNumericEditor(row, propName, values, overrides, enabled, x, width, rh, false);
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
            tf.setSize(this._availWidth() - 4, this._rowHeight);
            this._box.addChild(tf);
            this._builtHeight += this._rowHeight;
        } catch (e) {
            console.warn("[VfxPropertyOverrides] addText failed:", e);
        }
    }

    /** 可折叠的分组标题: 点击切换折叠状态(箭头 ▼ 展开 / ▶ 折叠), 折叠时不渲染该组属性行(参考 Unity foldout) */
    private _addGroupHeader(gname: string, collapsed: boolean): void {
        try {
            const tf = new gui.TextField();
            tf.text = `${collapsed ? "▶" : "▼"} ${gname}`;
            tf.color = 0xAACCEE;
            tf.wrap = false;
            try { tf.style.fontSize = 13; } catch { }
            try { (tf as any).touchable = true; } catch { }
            try { (tf as any).cursor = "pointer"; } catch { }
            tf.setSize(this._availWidth() - 4, this._rowHeight);
            tf.on("click", () => {
                this._collapsed[gname] = !(this._collapsed[gname] === true);
                this._safeRefresh();
            }, this);
            this._box.addChild(tf);
            this._builtHeight += this._rowHeight;
        } catch (e) {
            console.warn("[VfxPropertyOverrides] addGroupHeader failed:", e);
        }
    }

    /** Group 之间空白行 */
    private _addSpacer(height: number): void {
        try {
            const tf = new gui.TextField();
            tf.text = "";
            tf.setSize(1, height);
            this._box.addChild(tf);
            this._builtHeight += height;
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
